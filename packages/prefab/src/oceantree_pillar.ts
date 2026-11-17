import { SpriteState, type SpriteResources } from '@dontstarve-web/display';
import type { GetWatchWorldContent } from '@dontstarve-web/signals';
import { Burnable } from '../../componets/src/burnable';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Inspectable } from '../../componets/src/inspectable';
import { LootDropper, type LootSpawn } from '../../componets/src/lootdropper';
import { PlayerProx } from '../../componets/src/playerprox';
import { Propagator, PROPAGATOR_CANT_TAGS } from '../../componets/src/propagator';
import { CanopyShadows, DistanceFade, LightningBlocker, WaterPhysics } from '../../componets/src/watertreePillarSignatures';
import { Workable } from '../../componets/src/workable';
import { addComponent } from './components';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { PlacementSaveRecord } from './saveRecord';
import { MakeWaterObstaclePhysics } from './standardcomponents';
import { TILE_SIZE } from './tile';

export const OCEANTREE_PILLAR_ID = 'oceantree_pillar' as const;
/** Asset("ANIM", ...): the bank's archive, SetBuild's and AddOverrideBuild's. */
export const OCEANTREE_PILLAR_ARCHIVES = ['oceantree_pillar_small.zip', 'oceantree_pillar_small_build1.zip', 'oceantree_pillar_small_build2.zip'];

/** tuning.lua SHADE_CANOPY_RANGE_SMALL, WATERTREE_PILLAR_CANOPY_BUFFER and OCEANTREE_PILLAR_CHOPS. */
const SHADE_CANOPY_RANGE_SMALL = 22, WATERTREE_PILLAR_CANOPY_BUFFER = 1, OCEANTREE_PILLAR_CHOPS = 25;
const MIN = SHADE_CANOPY_RANGE_SMALL;
const MAX = MIN + WATERTREE_PILLAR_CANOPY_BUFFER;
/** MakeLargeBurnable(inst) without a time: standardcomponents.lua's default. */
const LARGE_BURNABLE_DEFAULT_TIME = 30;

/** OnSave's field. */
export interface OceanTreePillarSaveState {
  droppedvines?: true;
}

export interface OceanTreePillarWorld {
  scheduler: GameTimeScheduler;
  getWatchWorldContent?: GetWatchWorldContent;
  /** LootDropper:SpawnLootPrefab. */
  spawnLoot: LootSpawn;
}

/** oceantree_pillar.lua fn: the fields it sets on inst. */
export class OceanTreePillarInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    waterphysics: WaterPhysics; distancefade: DistanceFade; canopyshadows: CanopyShadows; lootdropper: LootDropper;
    playerprox: PlayerProx<OceanTreePillarInstance>; workable: Workable; inspectable: Inspectable;
    lightningblocker: LightningBlocker; burnable: Burnable; propagator: Propagator;
  };
  /** inst.players: the players OnNear has counted; OnNear is not ported. */
  declare players: Set<unknown>;
  /** startvines sets it once the pillar has dropped its vines; startvines is not ported. */
  declare droppedvines?: boolean;
}

function OnSave(inst: OceanTreePillarInstance, data: PlacementSaveRecord['components']): void {
  if (inst.droppedvines) data.oceantreePillar = { droppedvines: true };
}

function OnLoad(inst: OceanTreePillarInstance, data: PlacementSaveRecord['components']): void {
  if (data.oceantreePillar?.droppedvines) inst.droppedvines = true;
}

/**
 * oceantree_pillar.lua fn, for loading, drawing and saving. Not ported: the oceantree_pillar_ripples and
 * oceantree_pillar_roots children, OnRemoveEntity, sproutfn (OnSprout), the on_collide and hascanopydirty listeners and
 * the _hascanopy net_bool, the DoTaskInTime(0.5) that runs startvines, playerprox's SetTargetMode and OnNear / OnFar,
 * workable's chop_tree / chop_down_tree, burnable's AddBurnFX, its ignite / extinguish callbacks and OnBurnt,
 * propagator's SetOnFlashPoint, lightningblocker's OnLightningStrike, SetDeployExtraSpacing, SetAABB and the
 * SoundEmitter. The signature components take no configuration.
 */
function fn(world: OceanTreePillarWorld, sprites: SpriteResources): OceanTreePillarInstance {
  // SetBank("oceantree_pillar_small"), SetBuild("oceantree_pillar_small_build1"), PlayAnimation("idle", true).
  const inst = new OceanTreePillarInstance(OCEANTREE_PILLAR_ID, new SpriteState({ name: 'idle', billboard: true }));
  // MakeWaterObstaclePhysics(inst, 1.5, 2, 0.75): the tag and component here, the body from the definition's physics.
  inst.addTag('blocker');
  addComponent(inst, 'waterphysics', WaterPhysics);
  inst.addTag('shadecanopysmall');
  inst.addTag('event_trigger');
  inst.addTag('ignorewalkableplatforms');
  inst.AnimState.AddOverrideBuild('oceantree_pillar_small_build2');
  inst.sprite.setAnimState(inst.AnimState.json, sprites.archives);
  addComponent(inst, 'distancefade', DistanceFade);
  addComponent(inst, 'canopyshadows', CanopyShadows);

  addComponent(inst, 'lootdropper', LootDropper, world.spawnLoot).SetLoot(['log', 'log', 'log', 'log', 'twigs', 'twigs', 'twigs']);
  inst.players = new Set();
  const playerprox = addComponent(inst, 'playerprox', PlayerProx<OceanTreePillarInstance>, world.getWatchWorldContent);
  playerprox.SetDist(MIN, MAX);

  const workable = addComponent(inst, 'workable', Workable);
  workable.SetWorkAction('CHOP');
  workable.SetMaxWork(OCEANTREE_PILLAR_CHOPS);
  workable.SetWorkLeft(OCEANTREE_PILLAR_CHOPS);
  addComponent(inst, 'inspectable', Inspectable);
  addComponent(inst, 'lightningblocker', LightningBlocker);

  // MakeLargeBurnable(inst) and MakeMediumPropagator(inst), without their callbacks and fx.
  const burnable = addComponent(inst, 'burnable', Burnable, world.scheduler);
  burnable.SetFXLevel(4);
  burnable.SetBurnTime(LARGE_BURNABLE_DEFAULT_TIME);
  addComponent(inst, 'propagator', Propagator, 'medium', radius =>
    inst.TheSim.FindEntities(inst.position, radius, undefined, PROPAGATOR_CANT_TAGS), TILE_SIZE / 4, world.scheduler, world.getWatchWorldContent);
  burnable.SetFXLevel(6);

  inst.OnSave = OnSave;
  inst.OnLoad = OnLoad;
  return inst;
}

/** The oceantree_pillar Prefab oceantree_pillar.lua returns; its ripples, roots and leaves prefabs are not ported. */
export function oceanTreePillarPrefabs(world: OceanTreePillarWorld):
  Readonly<Record<typeof OCEANTREE_PILLAR_ID, PrefabEntityDefinition<OceanTreePillarInstance>>> {
  return {
    [OCEANTREE_PILLAR_ID]: {
      fn: (_position, sprites) => fn(world, sprites),
      assets: {
        animationArchive: 'oceantree_pillar_small.zip', buildArchives: ['oceantree_pillar_small_build1.zip'], bank: 'oceantree_pillar_small',
      },
      physics: { make: MakeWaterObstaclePhysics, radius: 1.5, height: 2 },
      minimapIcon: 'oceantree_pillar_small.png',
    },
  };
}
