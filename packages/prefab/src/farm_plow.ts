import type { EntityEventData } from '../../componets/src/entityEvents';
import * as THREE from 'three';
import type { ItemEntity, InventoryStack } from '@dontstarve-web/inventory';
import { SpriteState } from '@dontstarve-web/display';
import type { ReadonlySignal, HandEquipment } from '@dontstarve-web/signals';
import { Workable } from '../../componets/src/workable';
import { Deployable } from '../../componets/src/deployable';
import { Timer } from '../../componets/src/timer';
import { LootDropper } from '../../componets/src/lootdropper';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { FarmPlantWorld } from '../../componets/src/farmplantable';
import { addComponent } from './components';
import { PrefabInstance, type EntityTask, type PrefabEntityDefinition } from './prefabInstance';
import type { PlacementSaveRecord } from './saveRecord';
import { PlaySound } from './sound';
import { MakeObstaclePhysics } from './standardcomponents';
import { snapToTileCenter, TILE_SIZE } from './tile';
import { ToolMouseTarget } from './toolMouseTarget';
import { FARM_PLANT_ART } from './veggies';
import type { WorldContext } from './worldContext';

export const FARM_PLOW_ITEM_ID = 'farm_plow_item';
export const FARM_PLOW_ID = 'farm_plow';
export const PLANTED_SEED_ID = 'farm_plant_randomseed';
interface PlantedSeedArt { animationArchive: string; buildArchives: string[]; bank: string; pre: string; idle: string }
/** farm_plants.lua: randomseed plays sow → sow_idle; stage "seed" plays grow_seed → crop_seed over farm_soil's soil01. */
const PLANTED_SEED_ART: Readonly<Record<string, PlantedSeedArt>> = {
  [PLANTED_SEED_ID]: { animationArchive: 'farm_soil.zip', buildArchives: ['farm_soil.zip'], bank: 'farm_soil', pre: 'sow', idle: 'sow_idle' },
  ...Object.fromEntries(Object.entries(FARM_PLANT_ART).map(([id, { bank, build }]) => [id, {
    animationArchive: `${bank}.zip`, buildArchives: [`${build}.zip`, 'farm_soil.zip'], bank, pre: 'grow_seed', idle: 'crop_seed',
  }])),
};
export const PLANTED_SEED_IDS = Object.keys(PLANTED_SEED_ART);
/** tuning.lua FARM_PLOW_USES. */
export const FARM_PLOW_USES = 4;
/** tuning.lua FARM_PLOW_DRILLING_DURATION: seg_time * 0.5. */
export const FARM_PLOW_DRILLING_DURATION = 15;
export const FARM_DECOR_IDS = ['farm_soil', 'farm_soil_debris'] as const;
export type FarmDecorId = typeof FARM_DECOR_IDS[number];
/** The plow's record: its drilling timer, its deploy_item_save_record, and whether it is folding up. */
export interface FarmPlowSaveState {
  phase: 'drill_pre' | 'drill_loop' | 'collapse';
  remainingSeconds: number;
  /** Lua deploy_item_save_record, captured after finiteuses:Use(1); null on depletion/debug spawn. */
  deployItem: InventoryStack | null;
}
/** farm_soil.lua OnSave: broken, and the plow it was dug by. */
export interface FarmSoilSaveState { broken: boolean; plowId?: string }
/** farm_soil_debris.lua onsave: anim. */
export interface FarmDebrisSaveState { animation: 'f1' | 'f2' | 'f3' | 'f4' }

/** In scene units: map.lua's distances are in Lua units, a quarter tile each. */
export const FARM_SCALE = TILE_SIZE / 4;
/** tuning.lua FARM_TILL_SPACING. */
export const FARM_TILL_SPACING = 1.25 * FARM_SCALE;
const soilOverride = { soil01: { archive: 'farm_soil.zip', symbol: 'soil01' } };
/** farm_soil_debris.lua chance_loot. */
const DEBRIS_LOOT = [['twigs', 40], ['rocks', 25], ['flint', 20], ['nitre', 10], ['goldnugget', 5]] as const;
/** tuning.lua FARM_SOIL_DEBRIS_LOOT_CHANCE. */
const DEBRIS_LOOT_CHANCE = .25;

/** TheWorld.Map's soil functions the farm prefabs call. */
export interface FarmSoilMap {
  /** map.lua CanTillSoilAtPoint(x, y, z, ignore_tile_type). */
  CanTillSoilAtPoint(point: THREE.Vector3, ignoreTileType?: boolean): boolean;
  /** map.lua CollapseSoilAtPoint. */
  CollapseSoilAtPoint(point: THREE.Vector3): void;
  /** terraformer:Terraform with turf FARMING_SOIL and plow = true. */
  Terraform(point: THREE.Vector3): boolean;
}
export interface FarmWorld extends Partial<Pick<FarmPlantWorld, 'worldEvents'>> {
  scheduler: GameTimeScheduler;
  map: FarmSoilMap;
  /** SpawnPrefab for the farm prefabs one another spawns. */
  spawnPrefab(prefab: string, position: THREE.Vector3): PrefabInstance;
  /** The saved entity a plow's soil was dug by: OnLoadPostPass's newents. */
  getEntity(entityId: string): PrefabInstance | undefined;
  /** SpawnSaveRecord(deploy_item_save_record) at the position. */
  spawnSaveRecord(position: THREE.Vector3, item: InventoryStack): void;
  /** lootdropper:SpawnLootPrefab. */
  spawnLoot?(itemId: string, position: THREE.Vector3): void;
  fx?: WorldContext['fx'];
  handEquipment?: ReadonlySignal<HandEquipment | null>;
  random?: () => number;
}

/** farm_plow main_fn's deploy_item_save_record and startup_task; folding is this port's fold-up before the item returns. */
export class FarmPlowInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { workable: Workable; timer: Timer };
  deploy_item_save_record: InventoryStack | null = null;
  startup_task?: EntityTask;
  folding = false;
  readonly world: FarmWorld;
  constructor(world: FarmWorld) {
    super(FARM_PLOW_ID, new SpriteState({ name: 'idle_place', billboard: true }));
    this.world = world;
  }
}

/** farm_soil.lua: the plow SetPlowing listens to. */
export class FarmSoilInstance extends PrefabInstance {
  _plow?: PrefabInstance;
  /** _onremoveplow and _onfinishplowing, as their RemoveEventCallback. */
  _plowListeners: (() => void)[] = [];
}

export class FarmDebrisInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { workable: Workable; lootdropper: LootDropper };
  animname: FarmDebrisSaveState['animation'];
  readonly world: FarmWorld;
  constructor(world: FarmWorld) {
    super('farm_soil_debris', new SpriteState({ name: 'f1', billboard: true }));
    this.world = world;
    this.animname = `f${1 + Math.floor((world.random ?? Math.random)() * 4)}` as FarmDebrisSaveState['animation'];
  }
}

const random = (world: FarmWorld) => (world.random ?? Math.random)();
const dirtPuff = (world: FarmWorld, position: THREE.Vector3) => world.fx?.spawn('dirt_puff', position);

// farm_plow.lua

function onhammered(inst: FarmPlowInstance): void {
  const position = inst.position.clone();
  inst.world.fx?.collapse?.('small', position);
  if (inst.deploy_item_save_record) inst.world.spawnSaveRecord(position, { ...inst.deploy_item_save_record });
  inst.remove();
}

/**
 * Finished. The source spawns the saved item at once and the item plays the fold-up; here the plow plays `collapse`
 * itself and spawns the item when the clip ends, as the packed item has no animated ground display.
 */
function Finished(inst: FarmPlowInstance): void {
  inst.SoundEmitter!.KillSound('loop');
  if (inst.deploy_item_save_record !== null) {
    Fold(inst);
    inst.SoundEmitter!.PlaySound('farming/common/farm/plow/collapse');
    dirtPuff(inst.world, inst.position.clone());
    inst.SoundEmitter!.PlaySound('farming/common/farm/plow/dirt_puff');
    inst.PushEvent('finishplowing');
  } else {
    inst.world.fx?.collapse?.('small', inst.position.clone());
    inst.PushEvent('finishplowing');
    inst.remove();
  }
}

/** The fold-up: no hammering, `collapse`, then item_foldup_finished returns the saved item in the plow's place. */
function Fold(inst: FarmPlowInstance): void {
  inst.folding = true;
  inst.components.workable.SetWorkable(false);
  inst.sprite.playOnce('collapse', () => {
    if (inst.isRemoved || !inst.deploy_item_save_record) return;
    inst.world.spawnSaveRecord(inst.position.clone(), { ...inst.deploy_item_save_record });
    inst.remove();
  });
}

function OnTerraform(inst: FarmPlowInstance): void {
  const { world } = inst, center = tileCenter(inst.position);
  const extents = TILE_SIZE * .9, spawned: THREE.Vector3[] = [];
  // math.random(FARM_PLOW_DRILLING_DEBRIS_MIN, FARM_PLOW_DRILLING_DEBRIS_MAX).
  const count = 2 + Math.floor(random(world) * 3);
  for (let i = 0; i < count; i++) {
    const position = new THREE.Vector3(center.x + random(world) * extents - extents / 2, 0, center.z + random(world) * extents - extents / 2);
    if (spawned.some(previous => previous.distanceToSquared(position) < FARM_SCALE ** 2)) continue;
    spawned.push(position);
    world.map.CollapseSoilAtPoint(position);
    world.spawnPrefab('farm_soil_debris', position);
  }
  for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) dirtPuff(world, new THREE.Vector3(
    center.x + dx * (random(world) + 1) * FARM_SCALE, 0, center.z + dz * (random(world) + 1) * FARM_SCALE));
  Finished(inst);
}

function dirt_anim(inst: FarmPlowInstance, quad: number, timer: number): void {
  // The source plow is removed at Finished, which ends these tasks; this one stays to fold up.
  if (inst.folding) return;
  const { world } = inst;
  let x = 1 - random(world) ** 2, z = 1 - random(world) ** 2;
  x *= 2; z *= 2;
  if (quad === 1) { x = -x; z = -z; } else if (quad === 2) z = -z; else if (quad === 3) x = -x;
  if (x * x + z * z > .75 * .75) {
    const position = inst.position.clone().add(new THREE.Vector3(x * FARM_SCALE, 0, z * FARM_SCALE));
    if (world.map.CanTillSoilAtPoint(position, true)) {
      world.map.CollapseSoilAtPoint(position);
      const soil = world.spawnPrefab('farm_soil', position);
      if (soil instanceof FarmSoilInstance) SetPlowing(soil, inst);
    }
  }
  const t = Math.min(1, timer / FARM_PLOW_DRILLING_DURATION);
  // Lerp(FARM_PLOW_DRILLING_DIRT_DELAY_BASE_START, _END, t) + math.random() * FARM_PLOW_DRILLING_DIRT_DELAY_VAR.
  const delay = 1.5 + (.2 - 1.5) * t + random(world) * .3;
  inst.DoTaskInTime(delay, plow => dirt_anim(plow, quad, timer + delay));
}

function DoDrilling(inst: FarmPlowInstance): void {
  inst.sprite.start('drill_loop');
  inst.SoundEmitter!.PlaySound('farming/common/farm/plow/LP', 'loop');
  const { timer } = inst.components;
  let fxTime = 0;
  if (!timer.TimerExists('drilling')) timer.StartTimer('drilling', FARM_PLOW_DRILLING_DURATION);
  else fxTime = FARM_PLOW_DRILLING_DURATION - timer.GetTimeLeft('drilling')!;
  const r = () => random(inst.world);
  inst.DoTaskInTime(r() * .2, plow => dirt_anim(plow, 1, fxTime));
  inst.DoTaskInTime(.2 + r() * .3, plow => dirt_anim(plow, 2, fxTime));
  inst.DoTaskInTime(1 + r() * .5, plow => dirt_anim(plow, 3, fxTime));
  inst.DoTaskInTime(.5 + r() * .3, plow => dirt_anim(plow, 4, fxTime));
}

function timerdone(inst: FarmPlowInstance, data: EntityEventData['timerdone']): void {
  if (data.name !== 'drilling') return;
  if (inst.world.map.Terraform(inst.position.clone())) OnTerraform(inst);
  else Finished(inst);
}

function StartUp(inst: FarmPlowInstance): void {
  // ListenForEvent("animover", DoDrilling): the display reports the end of drill_pre.
  inst.sprite.playOnce('drill_pre', () => { if (!inst.isRemoved && !inst.folding) DoDrilling(inst); });
  inst.SoundEmitter!.PlaySound('farming/common/farm/plow/drill_pre');
  inst.startup_task = undefined;
}

function plowOnSave(plow: FarmPlowInstance, data: PlacementSaveRecord['components']): void {
  const { timer } = plow.components;
  const drilling = timer.TimerExists('drilling');
  data.farmPlow = {
    phase: plow.folding ? 'collapse' : drilling ? 'drill_loop' : 'drill_pre',
    remainingSeconds: plow.folding ? 0 : drilling ? timer.GetTimeLeft('drilling')! : FARM_PLOW_DRILLING_DURATION,
    deployItem: plow.deploy_item_save_record ? { ...plow.deploy_item_save_record } : null,
  };
  // The drilling timer is saved in farmPlow, the record existing saves hold.
  delete data.timer;
}

/** OnLoadPostPass: deploy_item, then a running drilling timer resumes DoDrilling in place of StartUp. */
function plowOnLoad(plow: FarmPlowInstance, data: PlacementSaveRecord['components']): void {
  const saved = data.farmPlow;
  if (!saved) return;
  plow.deploy_item_save_record = saved.deployItem ? { ...saved.deployItem } : null;
  if (saved.phase === 'drill_pre') return;
  plow.startup_task?.Cancel(); plow.startup_task = undefined;
  if (saved.phase === 'collapse') { Fold(plow); return; }
  plow.components.timer.StartTimer('drilling', saved.remainingSeconds, false, FARM_PLOW_DRILLING_DURATION);
  DoDrilling(plow);
}

function main_fn(world: FarmWorld): FarmPlowInstance {
  const inst = new FarmPlowInstance(world);
  // startup_task is scheduled here, before the manager would bind the world's scheduler.
  inst.BindScheduler(world.scheduler);
  inst.AddSoundEmitter();
  // SetDeploySmartRadius(1): matches the art; the item snaps to tiles with CUSTOM spacing.
  inst.deploySmartRadius = 1 * FARM_SCALE;
  inst.addTag('scarytoprey');
  addComponent(inst, 'inspectable', Inspectable);
  const workable = addComponent(inst, 'workable', Workable);
  workable.SetWorkAction('HAMMER');
  workable.SetWorkLeft(1);
  workable.SetOnFinishCallback(onhammered);
  addComponent(inst, 'timer', Timer, world.scheduler);
  // MakeMediumBurnable / MakeLargePropagator are not ported for the plow.
  inst.startup_task = inst.DoTaskInTime(0, StartUp);
  inst.ListenForEvent('timerdone', timerdone);
  inst.OnSave = plowOnSave;
  inst.OnLoad = plowOnLoad;
  return inst;
}

// farm_soil.lua

function OnBreak(inst: FarmSoilInstance): void {
  if (!inst.hasTag('soil') || inst.hasTag('NOBLOCK')) return;
  inst.addTag('NOCLICK');
  inst.addTag('NOBLOCK');
  inst.sprite.playOnce('collapse');
  inst.sprite.pushAnimation('collapse_idle', false);
}

function CancelPlowing(inst: FarmSoilInstance): void {
  for (const stop of inst._plowListeners) stop();
  inst._plowListeners = [];
  inst._plow = undefined;
}

function OnCollapse(inst: FarmSoilInstance): void {
  CancelPlowing(inst);
  if (!inst.hasTag('soil')) return;
  inst.removeTag('soil');
  inst.persists = false;
  // ListenForEvent("animover", inst.Remove).
  const remove = () => inst.remove();
  if (inst.hasTag('NOBLOCK')) inst.sprite.playOnce('collapse_remove', remove);
  else {
    inst.addTag('NOCLICK');
    inst.addTag('NOBLOCK');
    inst.sprite.playOnce('till_remove', remove);
  }
}

export function SetPlowing(inst: FarmSoilInstance, plow: PrefabInstance): void {
  CancelPlowing(inst);
  inst._plow = plow;
  inst._plowListeners = [
    inst.ListenForEvent('onremove', () => OnCollapse(inst), plow),
    inst.ListenForEvent('finishplowing', () => {
      CancelPlowing(inst);
      if (!inst.hasTag('NOBLOCK')) inst.removeTag('NOCLICK');
    }, plow),
  ];
  inst.addTag('NOCLICK');
}

function soilOnSave(soil: FarmSoilInstance, data: PlacementSaveRecord['components']): void {
  data.farmSoil = { broken: soil.hasTag('NOBLOCK'), ...soil._plow ? { plowId: String(soil._plow.entityId) } : {} };
}

function soilOnLoad(soil: FarmSoilInstance, data: PlacementSaveRecord['components'], world: FarmWorld): void {
  const saved = data.farmSoil;
  if (saved?.broken) {
    OnBreak(soil);
    soil.sprite.playOnce('collapse_idle');
  } else soil.sprite.playOnce('till_idle');
  const plowId = saved?.plowId;
  if (plowId === undefined) return;
  // OnLoadPostPass runs once every saved entity exists: the plow may be restored after its soil.
  soil.addTag('NOCLICK');
  soil.DoTaskInTime(0, () => {
    const plow = world.getEntity(plowId);
    if (plow && !plow.isRemoved) SetPlowing(soil, plow);
    else OnCollapse(soil);
  });
}

function soil_fn(world: FarmWorld): FarmSoilInstance {
  const inst = new FarmSoilInstance('farm_soil', new SpriteState({ name: 'till_rise', billboard: true }));
  inst.sprite.playOnce('till_rise');
  inst.sprite.pushAnimation('till_idle', false);
  inst.addTag('soil');
  // SetDeploySmartRadius(0.5): seeds use CUSTOM spacing.
  inst.deploySmartRadius = .5 * FARM_SCALE;
  // farmplantable:Plant's SpawnPrefab("farm_plant_*") replaces this soil.
  inst.worldServices = { scheduler: world.scheduler, worldEvents: world.worldEvents as never,
    spawnFarmPlant: (prefab: string, position: THREE.Vector3) => {
      const plant = world.spawnPrefab(prefab, position);
      PlaySound('dontstarve/common/plant', position);
      return plant;
    } };
  inst.ListenForEvent('breaksoil', () => OnBreak(inst));
  inst.ListenForEvent('collapsesoil', () => OnCollapse(inst));
  inst.OnSave = soilOnSave;
  inst.OnLoad = (loaded, data) => soilOnLoad(loaded, data, world);
  return inst;
}

// farm_soil_debris.lua

function onfinishcallback(inst: FarmDebrisInstance): void {
  const position = inst.position.clone();
  dirtPuff(inst.world, position);
  inst.remove();
  // FARM_SOIL_DEBRIS_LOOT_CHANCE without the luck formulas, then weighted_random_choice(chance_loot).
  if (random(inst.world) < DEBRIS_LOOT_CHANCE) {
    let roll = random(inst.world) * 100;
    const loot = DEBRIS_LOOT.find(([, weight]) => { roll -= weight; return roll < 0; })?.[0] ?? 'goldnugget';
    inst.components.lootdropper.SpawnLootPrefab(loot, position);
  }
}

function debris_fn(world: FarmWorld): FarmDebrisInstance {
  const inst = new FarmDebrisInstance(world);
  inst.addTag('farm_debris');
  inst.addTag('farm_plant_killjoy');
  // OnSpawnIn: <anim>_pre, then <anim>.
  inst.sprite.playOnce(`${inst.animname}_pre`);
  inst.sprite.pushAnimation(inst.animname, false);
  addComponent(inst, 'inspectable', Inspectable);
  const workable = addComponent(inst, 'workable', Workable);
  workable.SetWorkAction('DIG');
  workable.SetWorkLeft(1);
  workable.SetOnFinishCallback(onfinishcallback);
  addComponent(inst, 'lootdropper', LootDropper, (prefab, position) => {
    world.spawnLoot?.(prefab, new THREE.Vector3(position.x, 0, position.z)); return undefined;
  });
  inst.OnSave = (_inst, data) => { data.farmDebris = { animation: inst.animname }; };
  inst.OnLoad = (_inst, data) => {
    if (!data.farmDebris) return;
    inst.animname = data.farmDebris.animation;
    inst.sprite.playOnce(inst.animname);
  };
  return inst;
}

// farm_plants.lua, as far as a sown seed's appearance.

function seed_fn(prefab: string): PrefabInstance {
  const { pre, idle } = PLANTED_SEED_ART[prefab];
  const inst = new PrefabInstance(prefab, new SpriteState({ name: idle, billboard: true }));
  for (const tag of ['plantedsoil', 'farm_plant', 'planted_seed']) inst.addTag(tag);
  // SetDeploySmartRadius(0.5).
  inst.deploySmartRadius = .5 * FARM_SCALE;
  inst.sprite.playOnce(pre);
  inst.sprite.pushAnimation(idle, true);
  // A loaded seed only loops its idle.
  inst.OnLoad = () => inst.sprite.start(idle);
  return inst;
}

function tileCenter(point: Pick<THREE.Vector3, 'x' | 'z'>): THREE.Vector3 {
  const center = snapToTileCenter(point); return new THREE.Vector3(center.x, 0, center.z);
}

/** The farm_plow_item_placer's art: farm_plow's idle_place with its soil symbol. */
export const FARM_PLOW_PLACER_ART = { animationArchive: 'farm_plow.zip', buildArchives: ['farm_plow.zip', 'farm_soil.zip'], bank: 'farm_plow',
  symbolOverrides: soilOverride, animation: 'idle_place' };

/** farm_plow.lua item_fn: tile_deploy with the deploy string, deployable(CUSTOM) on can_plow_tile, item_ondeploy. */
export function configureFarmPlowItemEntity(entity: ItemEntity): void {
  if (entity.prefab !== FARM_PLOW_ITEM_ID || entity.components.deployable) return;
  for (const tag of ['usedeploystring', 'tile_deploy', 'deployable']) entity.addTag(tag);
  addComponent(entity, 'deployable', Deployable,
    (point, _deployer, map) => map.deployPlow(point, entity),
    { mode: 'CUSTOM', spacing: 2 * FARM_SCALE, usegridplacer: false, candeploy: (point, map) => map.canDeployPlow(point) });
}

/** farm_plow, farm_soil, farm_soil_debris and the sown seeds. */
export function farmPrefabs(world: FarmWorld): Readonly<Record<string, PrefabEntityDefinition<PrefabInstance>>> {
  const soil = (archive: string, bank: string) => ({ animationArchive: archive, buildArchives: [archive, 'farm_soil.zip'], bank, symbolOverrides: soilOverride });
  return {
    [FARM_PLOW_ID]: {
      fn: () => main_fn(world),
      assets: soil('farm_plow.zip', 'farm_plow'),
      physics: { make: MakeObstaclePhysics, radius: .5 },
      onSpawned: inst => {
        const plow = inst as FarmPlowInstance;
        new ToolMouseTarget(plow, plow.components.workable, world.handEquipment);
      },
    },
    farm_soil: { fn: () => soil_fn(world), assets: { animationArchive: 'farm_soil.zip', buildArchives: ['farm_soil.zip'], bank: 'farm_soil' } },
    farm_soil_debris: { fn: () => debris_fn(world), assets: soil('farm_soil_debris.zip', 'farm_soil_debris') },
    ...Object.fromEntries(Object.entries(PLANTED_SEED_ART).map(([prefab, { animationArchive, buildArchives, bank }]) => [prefab, {
      fn: () => seed_fn(prefab), assets: { animationArchive, buildArchives, bank, symbolOverrides: soilOverride },
    }])),
  };
}
