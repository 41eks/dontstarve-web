import { SpriteState } from '@dontstarve-web/display';
import { createEffect, watchSignal, type GameTimeScheduler, type ReadonlySignal } from '@dontstarve-web/signals';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { Hauntable, HAUNT_INSTANT_REZ } from '../../componets/src/hauntable';
import {
  createMultiplayerPortalStateGraph, type MultiplayerPortalSound, type MultiplayerPortalStateInst,
} from '../../stategraphs/src/SGmultiplayerportal';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { RezSource } from './player_common';
import type { SoundEventPath } from './sound';
import { TILE_SIZE } from './tile';
import { Transform } from './transform';

export const PORTAL_ID = 'multiplayer_portal_moonrock' as const;
export const PORTAL_FX_ID = 'multiplayer_portal_moonrock_fx' as const;

/** assets_moonrock / assets_fx: the portal_moonrock bank and build, with symbols from portal_stone. */
const ASSETS = { animationArchive: 'portal_moonrock.zip', buildArchives: ['portal_moonrock.zip', 'portal_stone.zip'], bank: 'portal_moonrock_dst' };

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

  constructor(world: PortalWorld, position: ReadonlyVector3) {
    super(PORTAL_ID, new SpriteState({ name: 'idle_loop', billboard: true }), Transform.stationary());
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
    this.fx.entityParent = this as PrefabInstance<SpriteState, object>;
    this.onRemove(() => this.fx.remove());

    this.sg = createMultiplayerPortalStateGraph(this, world.scheduler);
    this.addTag('inspectable');
    Object.assign(this.components, { inspectable: new Inspectable(this) });

    // OnGetPortalRez(inst, GetPortalRez()) and its ms_onportalrez listener.
    const cleanups: (() => void)[] = [];
    if (world.portalRez) {
      const portalRez = watchSignal(world.portalRez, stop => cleanups.push(stop));
      cleanups.push(createEffect(() => OnGetPortalRez(this, world.scheduler, portalRez.get())));
    }
    cleanups.push(this.ListenForEvent('rez_player', () => OnRezPlayer(this)));

    // The stategraph sleeps with the entity. A clip settled while nothing is drawn holds the animover chain, which
    // resumes once the display has drawn the sprite again.
    const status = watchSignal(this.status, stop => cleanups.push(stop));
    cleanups.push(createEffect(() => {
      const value = status.get();
      if (value === 'asleep') this.sg.pause();
      else if (value === 'active') this.sg.resume();
    }));
    cleanups.push(createEffect(() => {
      this.sprite.art.get();
      if (this.sprite.loaded && this.sprite.sprite.peek().clip.finished) this.animover();
    }));
    this.onRemove(() => {
      cleanups.splice(0).forEach(stop => stop());
      this.sg.dispose();
      this.components.hauntable?.dispose();
      delete this.components.hauntable;
    });
  }

  /** inst:IsValid(). */
  isValid(): boolean { return !this.isRemoved; }

  playAnimation(name: string): void {
    this.fx.sprite.playOnce(name);
    this.sprite.playOnce(name, () => this.animover());
  }

  playSound(sound: MultiplayerPortalSound, id?: string): void {
    const path = MOONROCK_SOUNDS[sound];
    if (path !== undefined && (id === undefined || !this.SoundEmitter!.PlayingSound(id))) this.SoundEmitter!.PlaySound(path, id);
  }

  killSound(id: string): void { this.SoundEmitter!.KillSound(id); }

  private animover(): void {
    if (this.sprite.loaded && !this.isRemoved) this.sg.pushEvent('animover');
  }
}

function OnRezPlayer(inst: PortalInstance): void {
  if (!inst.sg.hasStateTag('construction')) inst.sg.goToState('spawn_pre');
}

function OnGetPortalRez(inst: PortalInstance, scheduler: GameTimeScheduler, portalrez: boolean): void {
  if (portalrez) {
    if (inst.components.hauntable) return;
    const hauntable = new Hauntable(inst, scheduler);
    hauntable.SetHauntValue(HAUNT_INSTANT_REZ);
    inst.components.hauntable = hauntable;
    inst.addTag('resurrector');
  } else if (inst.components.hauntable) {
    inst.components.hauntable.dispose();
    delete inst.components.hauntable;
    inst.removeTag('resurrector');
  }
}

/** moonrockfxfn: the non-networked half drawn over the portal, never saved. */
function createPortalFx(position: ReadonlyVector3): PrefabInstance {
  const inst = new PrefabInstance(PORTAL_FX_ID, new SpriteState({ name: 'idle_loop', billboard: true }), Transform.stationary());
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
