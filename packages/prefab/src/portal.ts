import { addComponent, removeComponent } from './components';
import { SpriteState } from '@dontstarve-web/display';
import { createEffect, watchSignal, type GameTimeScheduler, type ReadonlySignal } from '@dontstarve-web/signals';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { AnimState } from '../../componets/src/animstate';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { Hauntable, HAUNT_INSTANT_REZ } from '../../componets/src/hauntable';
import {
  createMultiplayerPortalStateGraph, type MultiplayerPortalSound, type MultiplayerPortalStateInst,
} from '../../stategraphs/src/SGmultiplayerportal';
import { animationLengths } from './animationTimings';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { RezSource } from './player_common_extensions';
import type { SoundEventPath } from './sound';
import type { SoundEmitter } from './soundEmitter';
import { TILE_SIZE } from './tile';

export const PORTAL_ID = 'multiplayer_portal_moonrock' as const;
export const PORTAL_FX_ID = 'multiplayer_portal_moonrock_fx' as const;

/** assets_moonrock / assets_fx: the portal_moonrock bank and build, with symbols from portal_stone. */
const ASSETS = { animationArchive: 'portal_moonrock.zip', buildArchives: ['portal_moonrock.zip', 'portal_stone.zip'], bank: 'portal_moonrock_dst' };

/** The portal_moonrock_dst clips SGmultiplayerportal plays, from the source anim.bin. */
const PORTAL_ANIMATION_LENGTHS = animationLengths('portal_moonrock.zip');

/** multiplayer_portal.lua MOONROCK_SOUNDS; the keys it leaves nil are absent. */
const MOONROCK_SOUNDS: Partial<Record<MultiplayerPortalSound, SoundEventPath>> = {
  jacob: 'dontstarve/common/together/spawn_vines/spawnportal_jacob',
  spawning_loop: 'dontstarve/common/together/spawn_vines/spawnportal_spawning',
  shake: 'dontstarve/common/together/spawn_vines/spawnportal_shake',
  open: 'dontstarve/common/together/spawn_vines/spawnportal_open',
};

export interface PortalWorld {
  scheduler: GameTimeScheduler;
  /** GetPortalRez, which ms_onportalrez announces as it changes. */
  portalRez?: ReadonlySignal<boolean>;
  /** SpawnPrefab for the moonrock fx child. */
  spawnPrefab(prefab: typeof PORTAL_FX_ID, position: ReadonlyVector3): PrefabInstance;
}

/**
 * multiplayer_portal.lua MakePortal("multiplayer_portal_moonrock", ...) with moonrock_common_postinit and
 * moonrock_master_postinit, outside a cave. The moontrader component, its reroll save data and moonportalkey proximity
 * task, ms_newplayercharacterspawned and the construction portal are not ported.
 */
export class PortalInstance extends PrefabInstance implements MultiplayerPortalStateInst, RezSource {
  readonly fx: PrefabInstance;
  declare sg: ReturnType<typeof createMultiplayerPortalStateGraph>;
  declare SoundEmitter: SoundEmitter;
  /** inst.sounds = MOONROCK_SOUNDS (moonrock_master_postinit). */
  readonly sounds = MOONROCK_SOUNDS;
  /** inst.AnimState's playback: a clip ends after its source length in game time, whether or not its art is drawn. */
  readonly animstate: AnimState;

  constructor(world: PortalWorld, position: ReadonlyVector3) {
    super(PORTAL_ID, new SpriteState({ name: 'idle_loop', billboard: true }));
    this.setPosition(position.x, 0, position.z);
    this.AddSoundEmitter();
    this.addTag('multiplayer_portal');
    this.addTag('antlion_sinkhole_blocker');
    this.deploySmartRadius = 2.5 * (TILE_SIZE / 4);

    // moonrock_common_postinit, outside a cave.
    for (const symbol of ['light', 'portalbg', 'spiralfx1']) this.sprite.setSymbolOverride(symbol, 'portal_stone.zip', symbol);
    this.sprite.setLightOverride(.04);
    for (const layer of ['eye', 'eyefx', 'FX_rays']) this.sprite.hideLayer(layer);
    this.addTag('moonportal');
    this.addTag('moontrader');
    // inst.fx = SpawnPrefab("multiplayer_portal_moonrock_fx"); fx.entity:SetParent(inst.entity).
    this.fx = world.spawnPrefab(PORTAL_FX_ID, position);
    this.fx.entityParent = this;

    this.animstate = new AnimState(world.scheduler, PORTAL_ANIMATION_LENGTHS, event => { if (!this.isRemoved) this.sg.pushEvent(event); });
    this.SetStateGraph(inst => createMultiplayerPortalStateGraph(inst, world.scheduler));
    this.addTag('inspectable');
    addComponent(this, 'inspectable', Inspectable);

    // OnGetPortalRez(inst, GetPortalRez()) and its ms_onportalrez listener.
    const cleanups: (() => void)[] = [];
    if (world.portalRez) {
      const portalRez = watchSignal(world.portalRez, stop => cleanups.push(stop));
      cleanups.push(createEffect(() => OnGetPortalRez(this, world.scheduler, portalRez.get())));
    }
    cleanups.push(this.ListenForEvent('rez_player', () => OnRezPlayer(this)));

    // The stategraph and the clip it waits for sleep with the entity.
    const status = watchSignal(this.status, stop => cleanups.push(stop));
    cleanups.push(createEffect(() => {
      const value = status.get();
      if (value === 'asleep') { this.sg.pause(); this.animstate.pause(); }
      else if (value === 'active') { this.animstate.resume(); this.sg.resume(); }
    }));
    this.onRemove(() => { this.animstate.dispose(); cleanups.splice(0).forEach(stop => stop()); });
  }

  /** inst:IsValid(). */
  isValid(): boolean { return !this.isRemoved; }

  /** SGmultiplayerportal's PlayAnimation: inst.AnimState and inst.fx.AnimState; the logical clip's end is the animover. */
  playAnimation(name: string): void {
    this.animstate.PlayAnimation(name);
    this.sprite.playOnce(name);
    this.fx.sprite.playOnce(name);
  }
}

function OnRezPlayer(inst: PortalInstance): void {
  if (!inst.sg.hasStateTag('construction')) inst.sg.goToState('spawn_pre');
}

function OnGetPortalRez(inst: PortalInstance, scheduler: GameTimeScheduler, portalrez: boolean): void {
  if (portalrez) {
    if (inst.components.hauntable) return;
    addComponent(inst, 'hauntable', Hauntable, scheduler).SetHauntValue(HAUNT_INSTANT_REZ);
    inst.addTag('resurrector');
  } else if (inst.components.hauntable) {
    removeComponent(inst, 'hauntable');
    inst.removeTag('resurrector');
  }
}

/** moonrockfxfn: the non-networked half drawn over the portal, never saved. */
function createPortalFx(position: ReadonlyVector3): PrefabInstance {
  const inst = new PrefabInstance(PORTAL_FX_ID, new SpriteState({ name: 'idle_loop', billboard: true }));
  inst.setPosition(position.x, 0, position.z);
  inst.sprite.hideLayer('portal');
  inst.sprite.setSymbolOverride('FX_ray1', 'portal_stone.zip', 'FX_ray1');
  inst.sprite.setLightOverride(.2);
  inst.addTag('FX');
  inst.persists = false;
  return inst;
}

/** The moonrock Prefab multiplayer_portal.lua returns, and its fx. */
export function portalPrefabs(world: PortalWorld): Readonly<Record<typeof PORTAL_ID, PrefabEntityDefinition<PortalInstance>>
  & Record<typeof PORTAL_FX_ID, PrefabEntityDefinition<PrefabInstance>>> {
  return {
    [PORTAL_ID]: { fn: position => new PortalInstance(world, position), assets: ASSETS, minimapIcon: 'portal_dst.png' },
    [PORTAL_FX_ID]: { fn: createPortalFx, assets: ASSETS, targetable: false },
  };
}
