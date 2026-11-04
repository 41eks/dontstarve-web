import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import * as THREE from 'three';
import { SpriteState } from '@dontstarve-web/display';
import { Growable } from '../../componets/src/growable';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { Timer } from '../../componets/src/timer';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { Worker } from '../../componets/src/workable';
import { actionEntity } from './actionEntity';
import { addComponent, removeComponent } from './components';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { PlacementSaveRecord } from './saveRecord';
import { PlaySound, type SoundEventPath, type SoundHandle } from './sound';
import { MakeObstaclePhysics, RemovePhysicsColliders, WORLD_SCALE } from './standardcomponents';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import { Transform } from './transform';
import { BurnableBinding, TREE_BURN_TIME, type FireFxHost } from './treeFire';
import type { WorldEventEmitter } from './worldContext';

export const EVERGREEN_ID = 'evergreen' as const;
export const EVERGREEN_SPAWN_IDS = [EVERGREEN_ID, 'evergreen_short', 'evergreen_normal', 'evergreen_tall'] as const;
export type EvergreenSpawnId = typeof EVERGREEN_SPAWN_IDS[number];
export const EVERGREEN_STAGES = ['short', 'normal', 'tall', 'old'] as const;
export const EVERGREEN_CHOPS = [5, 10, 15, 1] as const;
/** tuning.lua EVERGREEN_GROW_TIME, using day_time = 300 seconds. */
export const EVERGREEN_GROW_TIME = [{ base: 450, random: 150 }, { base: 1500, random: 600 },
  { base: 1500, random: 600 }, { base: 300, random: 150 }] as const;
const LOOT = [
  [{ itemId: 'log', count: 1 }],
  [{ itemId: 'log', count: 2 }, { itemId: 'pinecone', count: 1 }],
  [{ itemId: 'log', count: 3 }, { itemId: 'pinecone', count: 2 }],
  [{ itemId: 'pinecone', count: 1 }],
] as const;

// evergreens.lua OnBurnt: GetBuild(inst).drop_pinecones adds a 10% pinecone to the burnt tree's loot.
SetSharedLootTable('evergreen_burnt', [['pinecone', .1]]);

export interface EvergreenSaveState { stump?: true; burnt?: true; burntcone?: true }

export interface EvergreenWorld extends ToolMouseTargetWorld {
  readonly scheduler: GameTimeScheduler;
  readonly fire: FireFxHost;
  readonly camera: THREE.Camera;
  /** DefaultBurntFn: one ash at the burnt inst's position. */
  readonly worldEvents: WorldEventEmitter;
  /** SpawnPrefab for the needles a chop throws off. */
  spawnPrefab(prefab: string, position: ReadonlyVector3): PrefabInstance;
  growthDuration?(seconds: number): number;
  dropLoot(items: readonly { itemId: string; count: number }[], position: ReadonlyVector3): void;
}

/** evergreens.lua's normal build. Growth and work belong to the logical tree, independently of loaded art. */
export class EvergreenInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { growable: Growable; lootdropper: LootDropper; timer: Timer };
  readonly world: EvergreenWorld;
  readonly random: () => number;
  readonly sounds = new Set<SoundHandle>();
  mouseTarget?: ToolMouseTarget;
  /** MakeLargeBurnable/MakeMediumPropagator (or the stump's small pair) while the tree is awake. */
  fire?: BurnableBinding;
  burntcone = false;
  changesTask?: () => void;
  pineconeTask?: () => void;
  removeTask?: () => void;
  /** Growth settled while the visual was unloaded is shown as its final stage, without the transition animation. */
  catchingUp = false;
  private awake = false;

  constructor(world: EvergreenWorld, position: ReadonlyVector3, stage: number, random: () => number) {
    super(EVERGREEN_ID, new SpriteState({ name: 'sway1_loop_short', billboard: true }), Transform.stationary());
    this.world = world; this.random = random;
    this.setActive(false);
    this.setPosition(position.x, 0, position.z);
    this.deploySmartRadius = 1; this.logicalPlacement = true;
    this.minimap.SetPriority(-1);
    for (const tag of ['plant', 'tree', 'evergreens', 'evergreen', 'petrifiable', 'SnowCovered']) this.addTag(tag);
    const workable = addComponent(this as EvergreenInstance, 'workable');
    workable.SetWorkAction('CHOP');
    workable.SetOnWorkCallback(chop_tree);
    workable.SetOnFinishCallback(chop_down_tree);
    this.components.lootdropper = new LootDropper({ getPosition: () => this.getPosition(), PushEvent: (name, data) => this.PushEvent(name, data) }, prefab => {
      world.dropLoot([{ itemId: prefab, count: 1 }], this.position); return undefined;
    });
    const growable = this.components.growable = new Growable(world.scheduler, EVERGREEN_GROW_TIME.map(time => ({
      time: () => time.base + (random() * 2 - 1) * time.random,
      fn: () => setStage(this), growfn: () => grow(this),
    })), seconds => world.growthDuration?.(seconds) ?? seconds);
    growable.loopstages = true; growable.springgrowth = true;
    const timer = this.components.timer = new Timer(world.scheduler, name => { if (name === 'decay') this.remove(); }, ['decay']);
    this.OnSave = (_inst, data) => onsave(this, data);
    this.OnLoad = (_inst, data) => onload(this, data);
    this.onRemove(() => {
      this.changesTask?.(); this.pineconeTask?.(); this.removeTask?.();
      unbindFire(this);
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
      if (active) OnEntityWake(this); else OnEntitySleep(this);
    }
    super.setActive(active);
  }

  get isAwake(): boolean { return this.awake; }
}

const stageOf = (inst: EvergreenInstance) => inst.components.growable.GetStage() - 1;
// evergreens.lua old_anims: burnt/chop_burnt reuse the tall clips.
const burntStage = (inst: EvergreenInstance) => EVERGREEN_STAGES[Math.min(stageOf(inst), 2)];
const rest = (inst: EvergreenInstance) => inst.hasTag('stump') ? `stump_${EVERGREEN_STAGES[stageOf(inst)]}`
  : inst.hasTag('burnt') ? `burnt_${burntStage(inst)}`
  : stageOf(inst) === 3 ? 'idle_old' : `sway1_loop_${EVERGREEN_STAGES[stageOf(inst)]}`;

function playSound(inst: EvergreenInstance, path: SoundEventPath): void {
  for (const sound of inst.sounds) if (sound.isPlaying?.() === false) inst.sounds.delete(sound);
  inst.sounds.add(PlaySound(path, inst.position));
}

/** Set*: the stage's work, loot and shelter, then its resting clip. */
function setStage(inst: EvergreenInstance): void {
  inst.components.workable!.SetWorkLeft(EVERGREEN_CHOPS[stageOf(inst)]);
  inst.components.lootdropper.SetLoot(LOOT[stageOf(inst)].flatMap(({ itemId, count }) => Array.from({ length: count }, () => itemId)));
  if (stageOf(inst) === 3) inst.removeTag('shelter'); else inst.addTag('shelter');
  inst.sprite.start(rest(inst));
}

/** Grow*: the transition into the stage just set. */
function grow(inst: EvergreenInstance): void {
  if (!inst.isAwake || inst.catchingUp) return;
  const stage = stageOf(inst);
  playSound(inst, stage === 3 ? 'dontstarve/forest/treeWilt'
    : stage === 0 ? 'dontstarve/forest/treeGrowFromWilt' : 'dontstarve/forest/treeGrow');
  inst.sprite.playOnce(['grow_old_to_short', 'grow_short_to_normal', 'grow_normal_to_tall', 'grow_tall_to_old'][stage],
    () => inst.sprite.start(rest(inst)));
}

function unbindFire(inst: EvergreenInstance): void { inst.fire?.dispose(); inst.fire = undefined; }

/** OnEntityWake: MakeLargeBurnable + MakeMediumPropagator, or the stump's small pair, unless burnt. */
function bindFire(inst: EvergreenInstance): void {
  if (!inst.isAwake || inst.fire || inst.hasTag('burnt') || inst.isRemoved) return;
  inst.fire = new BurnableBinding(inst, inst.hasTag('stump')
    ? { propagator: 'small', burnTime: 10, fxLevel: 2, onBurnt: () => burnStump(inst) }
    : { propagator: 'medium', burnTime: TREE_BURN_TIME, fxLevel: 5, onBurnt: () => tree_burnt(inst) }, inst.world);
}

/** DefaultBurntFn on a stump: one ash, then the inst is removed. */
function burnStump(inst: EvergreenInstance): void {
  inst.world.worldEvents.emit('spawnAsh', inst.getPosition().clone());
  inst.remove();
}

function burntChanges(inst: EvergreenInstance): void {
  unbindFire(inst);
  inst.components.growable.StopGrowing();
  inst.removeTag('shelter'); inst.removeTag('petrifiable');
  inst.components.lootdropper.SetLoot([]); inst.components.lootdropper.SetChanceLootTable('evergreen_burnt');
  const workable = inst.components.workable;
  if (workable) {
    workable.SetWorkLeft(1);
    workable.SetOnWorkCallback(() => {});
    workable.SetOnFinishCallback(() => chop_down_burnt_tree(inst));
  }
}

/** OnBurnt: the burnt pose and tag at once; the component changes follow after .5 seconds. */
function OnBurnt(inst: EvergreenInstance, immediate: boolean): void {
  if (inst.hasTag('burnt')) return;
  inst.addTag('burnt');
  inst.minimap.SetIcon('evergreen_burnt.png');
  inst.sprite.start(rest(inst));
  if (immediate) burntChanges(inst);
  else inst.changesTask = inst.world.scheduler.schedule(.5, () => { inst.changesTask = undefined; burntChanges(inst); });
}

function dropGrouped(inst: EvergreenInstance, items: readonly string[], position: ReadonlyVector3): void {
  const loot = new Map<string, number>();
  for (const itemId of items) loot.set(itemId, (loot.get(itemId) ?? 0) + 1);
  if (loot.size) inst.world.dropLoot([...loot].map(([itemId, count]) => ({ itemId, count })), position);
}

/** onpineconetask: the 10% pinecone lands one unit away from the burnt tree, once. */
function startPineconeTask(inst: EvergreenInstance): void {
  if (inst.burntcone || inst.pineconeTask) return;
  inst.pineconeTask = inst.world.scheduler.schedule(10, () => {
    inst.pineconeTask = undefined;
    const angle = inst.random() * Math.PI * 2;
    const position = inst.getPosition().clone().add(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(WORLD_SCALE));
    dropGrouped(inst, inst.components.lootdropper.GenerateLoot(inst.random), position);
    inst.burntcone = true;
  });
}

function tree_burnt(inst: EvergreenInstance): void {
  OnBurnt(inst, false);
  startPineconeTask(inst);
}

/** chop_down_burnt_tree: charcoal and the chance loot, then removal when the clip ends. */
function chop_down_burnt_tree(inst: EvergreenInstance): void {
  removeComponent(inst, 'workable');
  playSound(inst, 'dontstarve/forest/treeCrumble');
  playSound(inst, 'dontstarve/wilson/use_axe_tree');
  RemovePhysicsColliders(inst);
  inst.components.lootdropper.SpawnLootPrefab('charcoal');
  inst.components.lootdropper.DropLoot();
  inst.pineconeTask?.(); inst.pineconeTask = undefined;
  inst.sprite.playOnce(`chop_burnt_${burntStage(inst)}`, () => inst.remove());
}

/** dig_up_stump. */
function dig_up_stump(inst: EvergreenInstance): void {
  inst.components.lootdropper.SpawnLootPrefab('log');
  inst.remove();
}

/** make_stump: replace CHOP work with one DIG, removing shelter. */
function make_stump(inst: EvergreenInstance): void {
  unbindFire(inst);
  inst.minimap.SetIcon('evergreen_stump.png');
  inst.addTag('stump'); inst.components.growable.StopGrowing();
  inst.removeTag('shelter');
  RemovePhysicsColliders(inst);
  removeComponent(inst, 'workable');
  const workable = addComponent(inst, 'workable');
  workable.SetWorkAction('DIG'); workable.SetWorkLeft(1);
  inst.mouseTarget?.setWorkable(inst.components.workable);
  workable.SetOnFinishCallback(dig_up_stump);
  bindFire(inst);
}

/** chop_tree: the sound always; an old tree shows nothing else. */
function chop_tree(inst: EvergreenInstance): void {
  if (!inst.isAwake) return;
  playSound(inst, 'dontstarve/wilson/use_axe_tree');
  if (stageOf(inst) === 3) return;
  inst.sprite.playOnce(`chop_${EVERGREEN_STAGES[stageOf(inst)]}`, () => inst.sprite.start(rest(inst)));
  const { x, z } = inst.position;
  inst.world.spawnPrefab('pine_needles_chop', inst.position).setPosition(x, inst.random() * 2 * WORLD_SCALE, z);
}

/** chop_down_tree: falls away from the chopper and scatters loot on the fall side. */
function chop_down_tree(inst: EvergreenInstance, worker: Worker): void {
  playSound(inst, 'dontstarve/forest/treeFall');
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(inst.world.camera.getWorldQuaternion(new THREE.Quaternion()));
  const workerPosition = worker.getPosition?.();
  const onRight = workerPosition ? workerPosition.clone().sub(inst.position).dot(right) > 0 : inst.random() <= .5;
  dropGrouped(inst, inst.components.lootdropper.GenerateLoot(),
    inst.getPosition().clone().addScaledVector(right, onRight ? -WORLD_SCALE : WORLD_SCALE));
  const clip = stageOf(inst) === 3 ? 'chop_old' : `${onRight ? 'fallleft' : 'fallright'}_${EVERGREEN_STAGES[stageOf(inst)]}`;
  make_stump(inst);
  inst.sprite.playOnce(clip, () => inst.sprite.start(rest(inst)));
}

function OnEntityWake(inst: EvergreenInstance): void {
  inst.catchingUp = true;
  try { inst.components.growable.OnEntityWake(); } finally { inst.catchingUp = false; }
  bindFire(inst);
  if (inst.hasTag('burnt')) startPineconeTask(inst);
}

function OnEntitySleep(inst: EvergreenInstance): void {
  inst.components.growable.OnEntitySleep();
  if (inst.fire?.burnable.IsBurning()) {
    if (inst.hasTag('stump')) inst.removeTask = inst.world.scheduler.schedule(0, () => { inst.removeTask = undefined; burnStump(inst); });
    else OnBurnt(inst, true);
  }
  unbindFire(inst);
}

/** onsave: a burning tree is saved as burnt; a burning stump is still a stump. */
function onsave(inst: EvergreenInstance, data: PlacementSaveRecord['components']): void {
  const stump = inst.hasTag('stump');
  const burnt = !stump && (inst.hasTag('burnt') || inst.fire?.burnable.IsBurning() === true);
  if (stump) data.evergreen = { stump: true };
  else if (burnt) data.evergreen = { burnt: true, ...(inst.burntcone ? { burntcone: true as const } : {}) };
  if (burnt) data.growable = { stage: inst.components.growable.GetStage() };
  // The timer's record keeps the name existing saves hold.
  if (data.timer) data.evergreenTimer = data.timer;
  delete data.timer;
}

function onload(inst: EvergreenInstance, data: PlacementSaveRecord['components']): void {
  inst.components.timer.OnLoad(data.evergreenTimer);
  if (data.evergreen?.stump) make_stump(inst);
  else if (data.evergreen?.burnt) {
    inst.burntcone = data.evergreen.burntcone === true;
    OnBurnt(inst, true);
  }
}

function onSpawned(inst: EvergreenInstance): void {
  inst.sprite.start(rest(inst));
  inst.components.growable.OnEntitySleep();
  inst.mouseTarget = new ToolMouseTarget(actionEntity(inst.transform.model, EVERGREEN_ID), inst, inst.components.workable, inst.world.handEquipment);
}

/** evergreens.lua normal build: one bank for every stage; its clips are split across two anim archives. */
export function evergreenPrefabs(world: EvergreenWorld, random: () => number = Math.random): Readonly<Record<EvergreenSpawnId, PrefabEntityDefinition<EvergreenInstance>>> {
  const definition = (id: EvergreenSpawnId): PrefabEntityDefinition<EvergreenInstance> => ({
    fn: position => new EvergreenInstance(world, position, id === EVERGREEN_ID ? Math.min(3, Math.floor(random() * 3) + 1) : EVERGREEN_SPAWN_IDS.indexOf(id), random),
    assets: { animationArchive: 'evergreen_short_normal.zip', extraAnimationArchives: ['evergreen_tall_old.zip'],
      buildArchives: ['evergreen_new.zip'], bank: 'evergreen_short' },
    assetOptions: { scale: .02, staticBillboard: true, instancedAnimations: EVERGREEN_STAGES.flatMap(stage =>
      [`sway1_loop_${stage}`, `stump_${stage}`, `burnt_${stage}`, 'idle_old']) },
    physics: { make: MakeObstaclePhysics, radius: .25 },
    minimapIcon: 'evergreen.png',
    onSpawned,
  });
  return Object.fromEntries(EVERGREEN_SPAWN_IDS.map(id => [id, definition(id)])) as Record<EvergreenSpawnId, PrefabEntityDefinition<EvergreenInstance>>;
}
