import { prefabDisplay, SpriteState } from '@dontstarve-web/display';
import type { GetWatchWorldContent } from '@dontstarve-web/signals';
import { PlayerProx } from '../../componets/src/playerprox';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { WormholeStateGraph, type WormholeStateInst } from '../../stategraphs/src/SGwormhole';
import { actionEntity } from './actionEntity';
import { addComponent } from './components';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { reskinTarget } from './reskin_tool';
import type { PlacementSaveRecord } from './saveRecord';
import type { SoundEmitter } from './soundEmitter';
import { TILE_SIZE } from './tile';
import { Transform } from './transform';

export const WORMHOLE_ID = 'wormhole' as const;
// prefabskins.lua order; wormhole_init_fn swaps the build, retaining the base bank.
export const WORMHOLE_SKINS = [
  'wormhole_claw', 'wormhole_fantasy', 'wormhole_gothic',
  'wormhole_lureplant', 'wormhole_spider', 'wormhole_worm',
] as const;
/** playerprox:SetDist(4, 5). */
export const WORMHOLE_ENTER_DISTANCE = 4 * (TILE_SIZE / 4);
export const WORMHOLE_EXIT_DISTANCE = 5 * (TILE_SIZE / 4);

export interface WormholeSaveState { skinId?: string }
export interface WormholeWorld {
  scheduler: GameTimeScheduler;
  /** The player positions playerprox follows. */
  getWatchWorldContent?: GetWatchWorldContent;
}

/**
 * wormhole.lua fn and its SGwormhole. The teleporter, trader, inventory and roseinspectable are not ported, so no
 * wormhole has a target: onnear opens it whenever a player comes close, where the source requires an active teleporter.
 */
export class WormholeInstance extends PrefabInstance implements WormholeStateInst {
  declare sg: ReturnType<typeof WormholeStateGraph>;
  declare SoundEmitter: SoundEmitter;
  constructor() {
    super(WORMHOLE_ID, new SpriteState({ name: 'idle_loop', billboard: true }), Transform.stationary());
  }
  // conventions-allow instance-method: the AnimState call SGwormhole makes; a one-shot reports animover to the stategraph.
  playAnimation(name: string, loop = false): void {
    if (loop) this.sprite.start(name);
    else this.sprite.playOnce(name, () => this.PushEvent('animover'));
  }
  // conventions-allow instance-method: SGwormhole's SetGroundLayering / SetBBLayering.
  setGroundLayering(ground: boolean): void {
    this.sprite.setLayer(ground ? 'background' : 'world');
    this.sprite.setMeshOrder(ground ? -.5 : 0);
  }
}

function onnear(inst: WormholeInstance): void {
  if (!inst.sg.hasStateTag('open')) inst.sg.goToState('opening');
}

function onfar(inst: WormholeInstance): void {
  if (inst.sg.hasStateTag('open')) inst.sg.goToState('closing');
}

/** wormhole_init_fn's build swap is the skin; OnSave / OnLoad keep it under `wormhole`. */
function OnSave(inst: PrefabInstance, data: PlacementSaveRecord['components']): void {
  if (inst.skinId !== undefined) data.wormhole = { skinId: inst.skinId };
}
function OnLoad(inst: PrefabInstance, data: PlacementSaveRecord['components']): void {
  const skinId = data.wormhole?.skinId;
  if (skinId === undefined) return;
  if (!(WORMHOLE_SKINS as readonly string[]).includes(skinId)) throw new Error(`Unsupported wormhole skin: ${skinId}`);
  inst.skinId = skinId;
}

function fn(world: WormholeWorld): WormholeInstance {
  const inst = new WormholeInstance();
  inst.BindScheduler(world.scheduler);
  inst.AddSoundEmitter();
  inst.sprite.start('idle_loop');
  for (const tag of ['trader', 'alltrader', 'antlion_sinkhole_blocker', 'wormhole']) inst.addTag(tag);
  inst.sg = WormholeStateGraph(inst, world.scheduler);
  addComponent(inst, 'inspectable', Inspectable);
  inst.OnSave = OnSave;
  inst.OnLoad = OnLoad;
  inst.onRemove(() => inst.sg.dispose());
  return inst;
}

/** The Prefab wormhole.lua returns, with its PREFAB_SKINS. */
export function wormholePrefabs(world: WormholeWorld): Readonly<Record<typeof WORMHOLE_ID, PrefabEntityDefinition<WormholeInstance>>> {
  return {
    [WORMHOLE_ID]: {
      fn: () => fn(world),
      assets: { animationArchive: 'teleporter_worm.zip', buildArchives: ['teleporter_worm_build.zip'], bank: 'teleporter_worm' },
      skins: Object.fromEntries(WORMHOLE_SKINS.map(id => [id, `dynamic/${id}.zip`])),
      minimapIcon: 'wormhole.png',
      onSpawned: inst => {
        // playerprox reads the position once, so it starts where the entity has spawned.
        const playerprox = addComponent(inst, 'playerprox', PlayerProx, world.getWatchWorldContent);
        playerprox.SetDist(WORMHOLE_ENTER_DISTANCE, WORMHOLE_EXIT_DISTANCE);
        playerprox.SetOnPlayerNear(() => onnear(inst));
        playerprox.SetOnPlayerFar(() => onfar(inst));
        playerprox.ForceUpdate();
        const model = inst.transform.model;
        actionEntity(model, WORMHOLE_ID).reskinTarget = reskinTarget({
          get id() { return String(inst.entityId); }, prefabId: WORMHOLE_ID, instance: inst, display: prefabDisplay(model)!,
          sprite: inst.sprite, skins: WORMHOLE_SKINS, get position() { return inst.position; },
          hasTag: tag => inst.hasTag(tag), isValid: () => !inst.isRemoved,
        });
      },
    },
  };
}
