import { SpriteState, type SpriteResources } from '@dontstarve-web/display';
import type { GetWatchWorldContent } from '@dontstarve-web/signals';
import { Burnable } from '../../componets/src/burnable';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
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
export const OCEANTREE_PILLAR_RIPPLES_ID = 'oceantree_pillar_ripples' as const;
export const OCEANTREE_PILLAR_ROOTS_ID = 'oceantree_pillar_roots' as const;
type OceanTreePillarChildId = typeof OCEANTREE_PILLAR_RIPPLES_ID | typeof OCEANTREE_PILLAR_ROOTS_ID;
/** Asset("ANIM", ...): the bank's archive, SetBuild's and AddOverrideBuild's. */
export const OCEANTREE_PILLAR_ARCHIVES = ['oceantree_pillar_small.zip', 'oceantree_pillar_small_build1.zip', 'oceantree_pillar_small_build2.zip'];

/** tuning.lua SHADE_CANOPY_RANGE_SMALL, WATERTREE_PILLAR_CANOPY_BUFFER and OCEANTREE_PILLAR_CHOPS. */
const SHADE_CANOPY_RANGE_SMALL = 22, WATERTREE_PILLAR_CANOPY_BUFFER = 1, OCEANTREE_PILLAR_CHOPS = 25;
const MIN = SHADE_CANOPY_RANGE_SMALL;
const MAX = MIN + WATERTREE_PILLAR_CANOPY_BUFFER;
/**
 * roots_fn: SetLayer(LAYER_WIP_BELOW_OCEAN), which is LAYER_BELOW_GROUND, and SetSortOrder(ANIM_SORT_ORDER_BELOW_GROUND
 * .UNDERWATER): drawn after the ocean's clear colour (-1.76) and before its translucent surface (-1.75), so the ocean
 * covers it and every turf layer above the ocean hides it.
 */
const BELOW_OCEAN_MESH_ORDER = -1.755;
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
  /** SpawnPrefab for the ripples and roots children. */
  spawnPrefab(prefab: OceanTreePillarChildId, position: ReadonlyVector3): PrefabInstance;
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
  declare _ripples: PrefabInstance;
  declare roots: PrefabInstance;
}

function OnSave(inst: OceanTreePillarInstance, data: PlacementSaveRecord['components']): void {
  if (inst.droppedvines) data.oceantreePillar = { droppedvines: true };
}

function OnLoad(inst: OceanTreePillarInstance, data: PlacementSaveRecord['components']): void {
  if (data.oceantreePillar?.droppedvines) inst.droppedvines = true;
}

/**
 * oceantree_pillar.lua fn, for loading, drawing and saving. Not ported: OnRemoveEntity (its roots / _ripples Remove is
 * the parenting's own removal here), sproutfn (OnSprout), the on_collide and hascanopydirty listeners and
 * the _hascanopy net_bool, the DoTaskInTime(0.5) that runs startvines, playerprox's SetTargetMode and OnNear / OnFar,
 * workable's chop_tree / chop_down_tree, burnable's AddBurnFX, its ignite / extinguish callbacks and OnBurnt,
 * propagator's SetOnFlashPoint, lightningblocker's OnLightningStrike, SetDeployExtraSpacing, SetAABB and the
 * SoundEmitter. The signature components take no configuration.
 */
function fn(world: OceanTreePillarWorld, position: ReadonlyVector3, sprites: SpriteResources): OceanTreePillarInstance {
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

  inst._ripples = world.spawnPrefab(OCEANTREE_PILLAR_RIPPLES_ID, position);
  inst._ripples.entityParent = inst;
  inst.roots = world.spawnPrefab(OCEANTREE_PILLAR_ROOTS_ID, position);
  inst.roots.entityParent = inst;

  inst.OnSave = OnSave;
  inst.OnLoad = OnLoad;
  return inst;
}

/** ripples_fn: the FX | NOCLICK root_ripple loop. SetOceanBlendParams has no declaration and is skipped. */
function ripples_fn(sprites: SpriteResources): PrefabInstance {
  const inst = new PrefabInstance(OCEANTREE_PILLAR_RIPPLES_ID, new SpriteState({ name: 'root_ripple', billboard: true }));
  inst.addTag('FX');
  inst.addTag('NOCLICK');
  inst.AnimState.AddOverrideBuild('oceantree_pillar_small_build2');
  inst.sprite.setAnimState(inst.AnimState.json, sprites.archives);
  inst.persists = false;
  return inst;
}

/** roots_fn: the FX | NOCLICK root_shadow, played once below the ocean surface. */
function roots_fn(sprites: SpriteResources): PrefabInstance {
  const inst = new PrefabInstance(OCEANTREE_PILLAR_ROOTS_ID, new SpriteState({ name: 'root_shadow', billboard: true }));
  inst.addTag('FX');
  inst.addTag('NOCLICK');
  inst.sprite.playOnce('root_shadow');
  inst.AnimState.AddOverrideBuild('oceantree_pillar_small_build2');
  inst.sprite.setAnimState(inst.AnimState.json, sprites.archives);
  inst.sprite.setLayer('background');
  inst.sprite.setMeshOrder(BELOW_OCEAN_MESH_ORDER);
  inst.persists = false;
  return inst;
}

/** SetBank("oceantree_pillar_small") and SetBuild("oceantree_pillar_small_build1"), shared by all the file's prefabs. */
const ASSETS = {
  animationArchive: 'oceantree_pillar_small.zip', buildArchives: ['oceantree_pillar_small_build1.zip'], bank: 'oceantree_pillar_small',
} as const;

/** The oceantree_pillar, _ripples and _roots Prefabs oceantree_pillar.lua returns; oceantree_pillar_leaves is not ported. */
export function oceanTreePillarPrefabs(world: OceanTreePillarWorld): Readonly<{
  [OCEANTREE_PILLAR_ID]: PrefabEntityDefinition<OceanTreePillarInstance>;
  [OCEANTREE_PILLAR_RIPPLES_ID]: PrefabEntityDefinition<PrefabInstance>;
  [OCEANTREE_PILLAR_ROOTS_ID]: PrefabEntityDefinition<PrefabInstance>;
}> {
  return {
    [OCEANTREE_PILLAR_ID]: {
      fn: (position, sprites) => fn(world, position, sprites),
      assets: ASSETS,
      physics: { make: MakeWaterObstaclePhysics, radius: 1.5, height: 2 },
      minimapIcon: 'oceantree_pillar_small.png',
    },
    [OCEANTREE_PILLAR_RIPPLES_ID]: { fn: (_position, sprites) => ripples_fn(sprites), assets: ASSETS, targetable: false },
    [OCEANTREE_PILLAR_ROOTS_ID]: { fn: (_position, sprites) => roots_fn(sprites), assets: ASSETS, targetable: false },
  };
}
