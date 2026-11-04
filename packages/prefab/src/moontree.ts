import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import * as THREE from 'three';
import { createRenderEffect, WorldContentKey, type GetWatchWorldContent } from '@dontstarve-web/signals';
import { SpriteState } from '@dontstarve-web/display';
import { Growable } from '../../componets/src/growable';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { Timer } from '../../componets/src/timer';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { Worker } from '../../componets/src/workable';
import { actionEntity } from './actionEntity';
import { addComponent, removeComponent } from './components';
import definitions from './definitions.json' with { type: 'json' };
import catalog from './groundItems.json' with { type: 'json' };
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { PlacementSaveRecord } from './saveRecord';
import { PlaySound, type SoundEventPath, type SoundHandle } from './sound';
import { MakeObstaclePhysics, RemovePhysicsColliders } from './standardcomponents';
import { TILE_SIZE } from './tile';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import { Transform } from './transform';
import { BurnableBinding, TREE_BURN_TIME, type BurnSpec, type FireFxHost } from './treeFire';
import type { WorldEventEmitter } from './worldContext';

export const MOON_TREE_ID = 'moon_tree' as const;
export const MOONBUTTERFLY_SAPLING_ID = 'moonbutterfly_sapling' as const;
/** tuning.lua MOON_TREE_CHOPS_TALL: the tall stage requires sixteen chops. */
export const MOON_TREE_CHOPS_TALL = 16;
export const MOON_TREE_SIZES = ['short', 'normal', 'tall'] as const;
export type MoonTreeSize = typeof MOON_TREE_SIZES[number];
export const MOON_TREE_CHOPS = [8, 12, 16] as const;
// tuning.lua day_time = 10 * 30 seconds, distinct from total_day_time = 480.
export const MOON_TREE_GROWTH_TIME = [{ base: 450, random: 150 }, { base: 1500, random: 600 }, { base: 1500, random: 600 }] as const;
export const MOONBUTTERFLY_SAPLING_GROW_TIME = { base: 225, random: 75 };
export const MOON_TREE_SPAWN_IDS = [MOON_TREE_ID, 'moon_tree_short', 'moon_tree_normal', 'moon_tree_tall'] as const;
export type MoonTreeSpawnId = typeof MOON_TREE_SPAWN_IDS[number];
SetSharedLootTable('moontree_short', [['log', 1], ['log', 1], ['moon_tree_blossom', .5]]);
SetSharedLootTable('moontree_normal', [['log', 1], ['log', 1], ['log', 1],
  ['moon_tree_blossom', 1], ['moon_tree_blossom', .25], ['moonbutterfly', 1]]);

// moontree.lua moontree_tall; entries whose prefab is not in the ground-item catalog are not dropped.
SetSharedLootTable('moontree_tall', [
  ['log', 1], ['log', 1], ['log', 1], ['log', 1],
  ['moon_tree_blossom', 1], ['moon_tree_blossom', 1],
  ['moonbutterfly', 1], ['moonbutterfly', .5],
]);

// moontree.lua moontree_burnt: a burnt tree's chop leaves only charcoal.
SetSharedLootTable('moontree_burnt', [['charcoal', 1]]);

const UNIT = TILE_SIZE / 4;

export interface MoonTreeWorld extends ToolMouseTargetWorld {
  readonly scheduler: GameTimeScheduler;
  readonly fire: FireFxHost;
  readonly camera: THREE.Camera;
  /** DefaultBurntFn: one ash at the burnt inst's position. */
  readonly worldEvents: WorldEventEmitter;
  readonly getWatchWorldContent?: GetWatchWorldContent;
  /** SpawnPrefab for the petals a chop throws off and the tree a sapling grows into. */
  spawnPrefab(prefab: string, position: ReadonlyVector3): PrefabInstance;
  growthDuration?(seconds: number): number;
  dropLoot(items: readonly { itemId: string; count: number }[], position: ReadonlyVector3): void;
}

/** moontree.lua OnSave keeps the stump flag; workable progress is not saved. */
export interface MoonTreeSaveState { stump?: true; burnt?: true; size?: MoonTreeSize }

/** moontree.lua. Growth and work belong to the logical tree, independently of loaded art. */
export class MoonTreeInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { growable: Growable; lootdropper: LootDropper; timer: Timer };
  readonly world: MoonTreeWorld;
  readonly random: () => number;
  readonly sounds = new Set<SoundHandle>();
  mouseTarget?: ToolMouseTarget;
  /** MakeXBurnable + MakeXPropagator while the tree is awake. */
  burn?: BurnableBinding;
  /** Private snow-level bridge; its cleanup owns the source subscription and the layer effect. */
  stopSnow?: () => void;
  changesTask?: () => void;
  removeTask?: () => void;
  /** Growth settled while the visual was unloaded is shown as its final stage, without the transition animation. */
  catchingUp = false;
  private awake = false;

  constructor(world: MoonTreeWorld, position: ReadonlyVector3, stage: number, random: () => number) {
    super(MOON_TREE_ID, new SpriteState({ name: definitions.moonTree.animationName, billboard: true }), Transform.stationary());
    this.world = world; this.random = random;
    this.setActive(false);
    this.setPosition(position.x, 0, position.z);
    this.deploySmartRadius = 1.6 * UNIT; this.logicalPlacement = true;
    this.minimap.SetPriority(-1);
    // standardcomponents.lua MakeSnowCoveredPristine applies to trees and stumps, not saplings.
    for (const tag of ['plant', 'tree', 'moon_tree', 'SnowCovered', 'shelter']) this.addTag(tag);
    const workable = addComponent(this as MoonTreeInstance, 'workable');
    workable.SetWorkAction('CHOP');
    workable.SetOnWorkCallback(on_chop_tree);
    workable.SetOnFinishCallback(on_chop_tree_down);
    this.components.lootdropper = new LootDropper({ getPosition: () => this.getPosition() }, prefab => {
      world.dropLoot([{ itemId: prefab, count: 1 }], this.position); return undefined;
    });
    const growable = this.components.growable = new Growable(world.scheduler, MOON_TREE_SIZES.map((size, index) => ({
      time: () => MOON_TREE_GROWTH_TIME[index].base + (random() * 2 - 1) * MOON_TREE_GROWTH_TIME[index].random,
      fn: () => setStage(this, size, index),
      growfn: () => playGrowth(this, ['grow_tall_to_short', 'grow_short_to_normal', 'grow_normal_to_tall'][index], index === 0),
    })), seconds => world.growthDuration?.(seconds) ?? seconds);
    growable.loopstages = true; growable.springgrowth = true;
    const timer = this.components.timer = new Timer(world.scheduler, name => { if (name === 'decay') this.remove(); }, ['decay']);
    this.OnSave = (_inst, data) => on_save(this, data);
    this.OnLoad = (_inst, data) => on_load(this, data);
    this.onRemove(() => {
      this.changesTask?.(); this.removeTask?.();
      unbindFire(this);
      this.stopSnow?.(); this.stopSnow = undefined;
      growable.dispose(); timer.dispose();
      for (const sound of this.sounds) sound.stop();
      this.sounds.clear();
    });
    growable.SetStage(stage); growable.StartGrowing();
  }

  /** OnEntitySleep / OnEntityWake follow the entity's tile. */
  setActive(active: boolean): void {
    if (active !== this.awake && !this.isRemoved) {
      this.awake = active;
      if (active) on_wake(this); else on_sleep(this);
    }
    super.setActive(active);
  }

  get isAwake(): boolean { return this.awake; }

  /** inst.growfromseed: the transition out of the sapling that this tree replaced. */
  growfromseed(): void { playGrowth(this, 'grow_seed_to_short'); }
}

const sizeOf = (inst: MoonTreeInstance): MoonTreeSize => MOON_TREE_SIZES[inst.components.growable.GetStage() - 1];

function playSound(inst: MoonTreeInstance, path: SoundEventPath): void {
  for (const sound of inst.sounds) if (sound.isPlaying?.() === false) inst.sounds.delete(sound);
  inst.sounds.add(PlaySound(path, inst.position));
}

function playGrowth(inst: MoonTreeInstance, clip: string, wilt = false): void {
  if (!inst.isAwake || inst.catchingUp) return;
  playSound(inst, wilt ? 'dontstarve/forest/treeGrowFromWilt' : 'dontstarve/forest/treeGrow');
  inst.sprite.playOnce(clip, () => inst.sprite.start(`sway1_loop_${sizeOf(inst)}`));
}

/** set_short / set_normal / set_tall. */
function setStage(inst: MoonTreeInstance, size: MoonTreeSize, index: number): void {
  if (inst.hasTag('stump') || inst.hasTag('burnt')) return;
  inst.components.workable!.SetWorkLeft(MOON_TREE_CHOPS[index]);
  inst.components.lootdropper.SetChanceLootTable(`moontree_${size}`);
  inst.sprite.start(`sway1_loop_${size}`);
  refreshFire(inst);
}

/** set_short/normal/tall_burnable (MakeSmall/MediumPropagator values) and make_stump_burnable (MakeMediumPropagator). */
function burnSpec(inst: MoonTreeInstance): BurnSpec {
  const size = sizeOf(inst);
  if (inst.hasTag('stump')) {
    return { propagator: 'medium', burnTime: size === 'short' ? 10 : size === 'normal' ? 20 : 30,
      fxLevel: size === 'short' ? 2 : size === 'normal' ? 3 : 5, onBurnt: () => burnStump(inst) };
  }
  return size === 'tall'
    ? { propagator: 'medium', propagatorValues: { propagaterange: 7, heatoutput: 8.5 }, burnTime: TREE_BURN_TIME * 1.5, fxLevel: 5, onBurnt: () => on_moon_tree_burnt(inst, false) }
    : { propagator: 'small', propagatorValues: { propagaterange: 5, heatoutput: 5 }, burnTime: size === 'short' ? TREE_BURN_TIME / 2 : TREE_BURN_TIME,
      fxLevel: size === 'short' ? 2 : 3, onBurnt: () => on_moon_tree_burnt(inst, false) };
}

function bindFire(inst: MoonTreeInstance): void {
  if (!inst.isAwake || inst.burn || inst.hasTag('burnt') || inst.isRemoved) return;
  inst.burn = new BurnableBinding(inst, burnSpec(inst), inst.world);
}

function unbindFire(inst: MoonTreeInstance): void { inst.burn?.dispose(); inst.burn = undefined; }

/** A stage change reconfigures the burnable in place, unless it is already burning. */
function refreshFire(inst: MoonTreeInstance): void {
  if (inst.burn?.burnable.IsBurning()) return;
  unbindFire(inst); bindFire(inst);
}

/** weather.lua SNOW_COVERED_THRESHOLD; without a bound world the snow layer stays hidden. */
function bindSnow(inst: MoonTreeInstance): void {
  inst.stopSnow?.();
  let stopWatch: (() => void) | undefined;
  const level = inst.world.getWatchWorldContent?.(WorldContentKey.SnowLevel, stop => { stopWatch = stop; });
  const stopEffect = createRenderEffect(() => { inst.sprite.setSymbolHidden('snow', level ? level.get() < .015 : true); });
  inst.stopSnow = () => { stopEffect(); stopWatch?.(); };
}

/** DefaultBurntFn on a stump: one ash, then the inst is removed. */
function burnStump(inst: MoonTreeInstance): void {
  inst.world.worldEvents.emit('spawnAsh', inst.getPosition().clone());
  inst.remove();
}

// moontree.lua: thirty days with +/- 50% variance, created only once for a dead tree.
function startDecay(inst: MoonTreeInstance): void {
  const { timer } = inst.components;
  if (!timer.TimerExists('decay')) timer.StartTimer('decay', 14400 + (inst.random() * 2 - 1) * 7200);
}

/** burnt_changes: no burnable, shelter or growth; one chop for charcoal. */
function burntChanges(inst: MoonTreeInstance): void {
  inst.components.growable.StopGrowing();
  unbindFire(inst);
  inst.removeTag('shelter');
  inst.components.lootdropper.SetChanceLootTable('moontree_burnt');
  const workable = inst.components.workable;
  if (workable) {
    workable.SetWorkLeft(1);
    workable.SetOnWorkCallback(() => {});
    workable.SetOnFinishCallback(() => chop_down_burnt_moon_tree(inst));
  }
}

/** on_moon_tree_burnt_immediate_helper: burnt pose and tag at once; component changes follow after .5 seconds. */
function on_moon_tree_burnt(inst: MoonTreeInstance, immediate: boolean): void {
  if (inst.hasTag('burnt')) return;
  inst.addTag('burnt');
  inst.minimap.SetIcon('moon_tree_burnt.png');
  startDecay(inst);
  inst.sprite.start(`burnt_${sizeOf(inst)}`);
  if (immediate) burntChanges(inst);
  else inst.changesTask = inst.world.scheduler.schedule(.5, () => { inst.changesTask = undefined; burntChanges(inst); });
}

/** The prefabs the lootdropper generates that the ground-item catalog has, grouped into stacks. */
function catalogLoot(inst: MoonTreeInstance): { itemId: string; count: number }[] {
  const items = new Map<string, number>();
  for (const itemId of inst.components.lootdropper.GenerateLoot()) if (Object.hasOwn(catalog.items, itemId)) items.set(itemId, (items.get(itemId) ?? 0) + 1);
  return [...items].map(([itemId, count]) => ({ itemId, count }));
}

/** chop_down_burnt_moon_tree: the crumble and chop sounds, charcoal, and removal when the clip ends. */
function chop_down_burnt_moon_tree(inst: MoonTreeInstance): void {
  RemovePhysicsColliders(inst);
  removeComponent(inst, 'workable');
  playSound(inst, 'dontstarve/forest/treeCrumble');
  playSound(inst, 'dontstarve/wilson/use_axe_tree');
  inst.world.dropLoot(catalogLoot(inst), inst.getPosition().clone());
  inst.sprite.playOnce(`chop_burnt_${sizeOf(inst)}`, () => inst.remove());
}

/** dig_up_stump: NORMAL/TALL drop two logs, then inst:Remove(). */
function dig_up_stump(inst: MoonTreeInstance): void {
  inst.world.dropLoot([{ itemId: 'log', count: sizeOf(inst) === 'short' ? 1 : 2 }], inst.position);
  inst.remove();
}

/** make_stump: replace CHOP work with one DIG, removing shelter. */
function make_stump(inst: MoonTreeInstance): void {
  RemovePhysicsColliders(inst);
  unbindFire(inst);
  inst.components.growable.StopGrowing();
  inst.minimap.SetIcon('moon_tree_stump.png');
  startDecay(inst);
  removeComponent(inst, 'workable');
  const workable = addComponent(inst, 'workable');
  inst.removeTag('shelter');
  inst.addTag('stump');
  workable.SetWorkAction('DIG');
  workable.SetWorkLeft(1);
  inst.mouseTarget?.setWorkable(inst.components.workable);
  workable.SetOnFinishCallback(dig_up_stump);
  bindFire(inst);
}

/** on_chop_tree: sound, chop pose, then back to swaying, with petals at the crown. TALL spawns 2.0..2.25 units up at scale 1.25. */
function on_chop_tree(inst: MoonTreeInstance): void {
  const size = sizeOf(inst);
  playSound(inst, 'dontstarve/wilson/use_axe_tree');
  inst.sprite.playOnce(`chop_${size}`, () => inst.sprite.start(`sway1_loop_${size}`));
  const { x, z } = inst.position;
  const fx = inst.world.spawnPrefab('tree_petal_fx_chop', inst.position);
  fx.setPosition(x, (size === 'short' ? .25 : size === 'normal' ? .8 + inst.random() * .25 : 2 + inst.random() * .25) * UNIT, z);
  fx.setScale(size === 'short' ? .75 : size === 'normal' ? 1 : 1.25);
}

/** on_chop_tree_down: fall away from the chopper, scatter loot on the fall side and leave a stump. */
function on_chop_tree_down(inst: MoonTreeInstance, worker: Worker): void {
  playSound(inst, 'dontstarve/forest/treeFall');
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(inst.world.camera.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
  const chopper = worker.getPosition?.();
  const { x, z } = inst.position;
  const chopperOnRight = chopper ? (chopper.x - x) * right.x + (chopper.z - z) * right.z > 0 : inst.random() > .5;
  inst.world.dropLoot(catalogLoot(inst), inst.getPosition().clone().addScaledVector(right, chopperOnRight ? -UNIT : UNIT));
  const size = sizeOf(inst);
  make_stump(inst);
  inst.sprite.playOnce(`${chopperOnRight ? 'fallleft' : 'fallright'}_${size}`, () => inst.sprite.start(`stump_${size}`));
}

function on_wake(inst: MoonTreeInstance): void {
  inst.catchingUp = true;
  try { inst.components.growable.OnEntityWake(); } finally { inst.catchingUp = false; }
  bindSnow(inst); bindFire(inst);
}

function on_sleep(inst: MoonTreeInstance): void {
  inst.components.growable.OnEntitySleep();
  if (inst.burn?.burnable.IsBurning()) {
    if (inst.hasTag('stump')) inst.removeTask = inst.world.scheduler.schedule(0, () => { inst.removeTask = undefined; burnStump(inst); });
    else on_moon_tree_burnt(inst, true);
  }
  unbindFire(inst);
  inst.stopSnow?.(); inst.stopSnow = undefined;
}

/** on_save: a burning tree is saved as burnt; a burning stump is still a stump. */
function on_save(inst: MoonTreeInstance, data: PlacementSaveRecord['components']): void {
  const stump = inst.hasTag('stump');
  const burnt = !stump && (inst.hasTag('burnt') || inst.burn?.burnable.IsBurning() === true);
  data.moonTree = { size: sizeOf(inst), ...(stump ? { stump: true as const } : {}), ...(burnt ? { burnt: true as const } : {}) };
  if (burnt) data.growable = { stage: inst.components.growable.GetStage() };
  // The timer's record keeps the name existing saves hold.
  if (data.timer) data.moonTreeTimer = data.timer;
  delete data.timer;
}

function on_load(inst: MoonTreeInstance, data: PlacementSaveRecord['components']): void {
  const saved = data.moonTree, { growable, timer } = inst.components;
  timer.OnLoad(data.moonTreeTimer);
  // An older record without growth holds its size, and an older forest's empty record is a tall tree.
  if (!data.growable) {
    growable.SetStage(MOON_TREE_SIZES.indexOf(saved?.size ?? 'tall') + 1);
    growable.StartGrowing();
  }
  if (saved?.stump) {
    make_stump(inst);
    inst.sprite.playOnce(`stump_${sizeOf(inst)}`);
  } else if (saved?.burnt) on_moon_tree_burnt(inst, true);
}

function onSpawned(inst: MoonTreeInstance): void {
  inst.components.growable.OnEntitySleep();
  inst.mouseTarget = new ToolMouseTarget(actionEntity(inst.transform.model, MOON_TREE_ID), inst, inst.components.workable, inst.world.handEquipment);
}

/** moonbutterfly's planted form: a timer until it becomes a short moon tree, or one DIG for twigs. */
export class MoonButterflySaplingInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { timer: Timer };
  readonly world: MoonTreeWorld;

  constructor(world: MoonTreeWorld, position: ReadonlyVector3, random: () => number) {
    super(MOONBUTTERFLY_SAPLING_ID, new SpriteState({ name: 'idle', billboard: true }), Transform.stationary());
    this.world = world;
    this.setActive(false);
    this.sprite.playOnce('idle');
    this.setPosition(position.x, 0, position.z);
    this.deploySmartRadius = 1.6 * UNIT; this.logicalPlacement = true;
    for (const tag of ['plant', 'moon_tree']) this.addTag(tag);
    const workable = addComponent(this as MoonButterflySaplingInstance, 'workable');
    workable.SetWorkAction('DIG'); workable.SetWorkLeft(1);
    workable.SetOnFinishCallback(dig_up_sapling);
    const timer = this.components.timer = new Timer(world.scheduler, () => grow_sapling(this), ['grow']);
    this.onRemove(() => timer.dispose());
    timer.StartTimer('grow', MOONBUTTERFLY_SAPLING_GROW_TIME.base + (random() * 2 - 1) * MOONBUTTERFLY_SAPLING_GROW_TIME.random);
    this.OnSave = (_inst, data) => {
      // The timer's record keeps the name existing saves hold.
      data.saplingTimer = data.timer; delete data.timer;
    };
    this.OnLoad = (_inst, data) => { timer.OnLoad(data.saplingTimer); };
  }
}

function dig_up_sapling(inst: MoonButterflySaplingInstance): void {
  inst.world.dropLoot([{ itemId: 'twigs', count: 1 }], inst.position);
  inst.remove();
}

function grow_sapling(inst: MoonButterflySaplingInstance): void {
  (inst.world.spawnPrefab('moon_tree_short', inst.position) as MoonTreeInstance).growfromseed();
  inst.remove();
}

/** moon_tree at a random or chosen size, and the moonbutterfly sapling that grows into one. */
export function moonTreePrefabs(world: MoonTreeWorld, random: () => number = Math.random): Readonly<Record<MoonTreeSpawnId, PrefabEntityDefinition<MoonTreeInstance>>
  & Record<typeof MOONBUTTERFLY_SAPLING_ID, PrefabEntityDefinition<MoonButterflySaplingInstance>>> {
  const standingAnimation = definitions.moonTree.animationName;
  const tree = (id: MoonTreeSpawnId): PrefabEntityDefinition<MoonTreeInstance> => ({
    fn: position => new MoonTreeInstance(world, position, id === MOON_TREE_ID ? Math.min(3, Math.floor(random() * 3) + 1) : MOON_TREE_SPAWN_IDS.indexOf(id), random),
    // MakeSnowCoveredPristine: the `snow` placeholder is drawn from snow.zip while the snow level is covered.
    assets: { animationArchive: definitions.moonTree.archive,
      buildArchives: [definitions.moonTree.archive, 'snow.zip'], bank: 'moon_tree', hiddenSymbols: ['snow'],
      symbolOverrides: { snow: { archive: 'snow.zip', symbol: 'snow' } } },
    assetOptions: { scale: definitions.moonTree.scale, staticBillboard: true,
      instancedAnimations: [...new Set([standingAnimation, ...MOON_TREE_SIZES.map(size => `sway1_loop_${size}`)])] },
    alignBottom: true,
    physics: { make: MakeObstaclePhysics, radius: .5 },
    minimapIcon: 'moon_tree.png',
    onSpawned,
  });
  return {
    ...Object.fromEntries(MOON_TREE_SPAWN_IDS.map(id => [id, tree(id)])) as Record<MoonTreeSpawnId, PrefabEntityDefinition<MoonTreeInstance>>,
    [MOONBUTTERFLY_SAPLING_ID]: {
      fn: position => new MoonButterflySaplingInstance(world, position, random),
      assets: { animationArchive: 'baby_moon_tree.zip', buildArchives: ['baby_moon_tree.zip'], bank: 'baby_moon_tree' },
      assetOptions: { staticBillboard: true, instancedAnimations: 'all' },
      onSpawned: inst => { new ToolMouseTarget(actionEntity(inst.transform.model, MOONBUTTERFLY_SAPLING_ID), inst, inst.components.workable, world.handEquipment); },
    },
  };
}
