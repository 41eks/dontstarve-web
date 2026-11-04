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
import { DeciduousTreeLeaves, type LeafWorld } from './deciduousTreeLeaves';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { PlacementSaveRecord } from './saveRecord';
import { PlaySound, type SoundEventPath, type SoundHandle } from './sound';
import { MakeObstaclePhysics, RemovePhysicsColliders, WORLD_SCALE } from './standardcomponents';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import { Transform } from './transform';
import { BurnableBinding, TREE_BURN_TIME, type FireFxHost } from './treeFire';
import type { WorldEventEmitter } from './worldContext';

export const DECIDUOUS_ID = 'deciduoustree' as const;
export const DECIDUOUS_SPAWN_IDS = [DECIDUOUS_ID, 'deciduoustree_short', 'deciduoustree_normal', 'deciduoustree_tall'] as const;
export type DeciduousSpawnId = typeof DECIDUOUS_SPAWN_IDS[number];
export const DECIDUOUS_STAGES = ['short', 'normal', 'tall'] as const;
export const DECIDUOUS_CHOPS = [5, 10, 15] as const;
/** tuning.lua DECIDUOUS_GROW_TIME, using day_time = 300 seconds. */
export const DECIDUOUS_GROW_TIME = [{ base: 450, random: 150 }, { base: 1500, random: 600 },
  { base: 1500, random: 600 }] as const;
const LEAF_COLORS = ['green', 'red', 'orange', 'yellow'] as const;
/**
 * Frames of the clips a pending leaf change waits on, from the tree_leaf_{short,normal,tall}.zip anims at 30 fps.
 * The change completes on game time, whether or not the art has loaded.
 */
export const DECIDUOUS_CLIP_FRAMES: Readonly<Record<string, number>> = {
  chop_short: 14, drop_leaves_short: 26, grow_leaves_short: 18, grow_tall_to_short: 26,
  chop_normal: 14, drop_leaves_normal: 26, grow_leaves_normal: 18, grow_short_to_normal: 26,
  chop_tall: 14, drop_leaves_tall: 26, grow_leaves_tall: 18, grow_normal_to_tall: 26,
};
const FRAMES = 1 / 30;
// deciduoustrees.lua onburntchanges: GetBuild(inst).drop_acorns adds a 10% acorn to the burnt tree's loot.
SetSharedLootTable('deciduoustree_burnt', [['acorn', .1]]);

export interface DeciduousWorld extends ToolMouseTargetWorld, LeafWorld {
  readonly scheduler: GameTimeScheduler;
  readonly fire: FireFxHost;
  readonly camera: THREE.Camera;
  /** DefaultBurntFn: one ash at the burnt inst's position. */
  readonly worldEvents: WorldEventEmitter;
  readonly getWatchWorldContent?: GetWatchWorldContent;
  /** SpawnPrefab for the leaves the tree throws off. */
  spawnPrefab(prefab: string, position: ReadonlyVector3): PrefabInstance;
  growthDuration?(seconds: number): number;
  dropLoot(items: readonly { itemId: string; count: number }[], position: ReadonlyVector3): void;
}

/** deciduoustrees.lua's normal build. Growth and work belong to the logical tree, independently of loaded art. */
export class DeciduousInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { growable: Growable; lootdropper: LootDropper; timer: Timer };
  readonly world: DeciduousWorld;
  readonly random: () => number;
  readonly sounds = new Set<SoundHandle>();
  readonly leaves: DeciduousTreeLeaves;
  readonly color: number;
  leavesInitialized = false;
  mouseTarget?: ToolMouseTarget;
  /** MakeLargeBurnable/MakeMediumPropagator (or the stump's small pair) while the tree is awake. */
  fire?: BurnableBinding;
  burntcone = false;
  changesTask?: () => void;
  acornTask?: () => void;
  removeTask?: () => void;
  stopSnow?: () => void;
  firstFrame = true;
  /** Growth settled while the visual was unloaded is shown as its final stage, without the transition animation. */
  catchingUp = false;
  private awake = false;

  constructor(world: DeciduousWorld, position: ReadonlyVector3, stage: number, random: () => number) {
    super(DECIDUOUS_ID, new SpriteState({ name: 'sway1_loop_short', billboard: true }), Transform.stationary());
    this.world = world; this.random = random; this.color = .5 + random() * .5;
    this.setActive(false);
    this.setPosition(position.x, 0, position.z);
    this.deploySmartRadius = 1; this.logicalPlacement = true;
    this.minimap.SetPriority(-1);
    for (const tag of ['plant', 'tree', 'birchnut', 'deciduoustree', 'cattoyairborne', 'SnowCovered', '__combat']) this.addTag(tag);
    const workable = addComponent(this as DeciduousInstance, 'workable', () => world.scheduler.now);
    workable.SetWorkAction('CHOP');
    workable.SetOnWorkCallback(chop_tree);
    workable.SetOnFinishCallback(chop_down_tree);
    this.components.lootdropper = new LootDropper({ getPosition: () => this.getPosition(), PushEvent: (name, data) => this.PushEvent(name, data) }, prefab => {
      world.dropLoot([{ itemId: prefab, count: 1 }], this.position); return undefined;
    });
    const growable = this.components.growable = new Growable(world.scheduler, DECIDUOUS_GROW_TIME.map(time => ({
      time: () => time.base + (random() * 2 - 1) * time.random,
      fn: () => setStage(this), growfn: () => grow(this),
    })), seconds => world.growthDuration?.(seconds) ?? seconds);
    growable.loopstages = true; growable.springgrowth = true;
    const timer = this.components.timer = new Timer(world.scheduler, name => { if (name === 'decay') this.remove(); }, ['decay']);
    const leaves = this.leaves = new DeciduousTreeLeaves(world.scheduler, world, {
      lastWorkTime: () => this.components.workable?.lastworktime.peek(), applyBuild: () => applyBuild(this), updateLoot: () => updateLoot(this),
      setShelter: value => { if (value) this.addTag('shelter'); else this.removeTag('shelter'); },
      playTransition: kind => {
        playSound(this, kind === 'grow_leaves' ? 'dontstarve/forest/treeGrow' : 'dontstarve/forest/treeWilt');
        return playOnce(this, `${kind}_${DECIDUOUS_STAGES[stageOf(this)]}`);
      },
      sway: () => this.sprite.start(rest(this)), spawnLeafFx: () => spawnLeaves(this),
    }, random);
    this.OnSave = (_inst, data) => onsave(this, data);
    this.OnLoad = (_inst, data) => onload(this, data);
    this.onRemove(() => {
      this.changesTask?.(); this.acornTask?.(); this.removeTask?.();
      this.stopSnow?.(); this.stopSnow = undefined;
      unbindFire(this);
      growable.dispose(); leaves.dispose(); timer.dispose();
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

const stageOf = (inst: DeciduousInstance) => inst.components.growable.GetStage() - 1;
const rest = (inst: DeciduousInstance) => inst.hasTag('stump') ? `stump_${DECIDUOUS_STAGES[stageOf(inst)]}`
  : inst.hasTag('burnt') ? `burnt_${DECIDUOUS_STAGES[stageOf(inst)]}`
  : `sway1_loop_${DECIDUOUS_STAGES[stageOf(inst)]}`;

function playSound(inst: DeciduousInstance, path: SoundEventPath): void {
  for (const sound of inst.sounds) if (sound.isPlaying?.() === false) inst.sounds.delete(sound);
  inst.sounds.add(PlaySound(path, inst.position));
}

/** PlayAnimation and the following rest clip; tells a pending leaf change when this clip's animover comes. */
function playOnce(inst: DeciduousInstance, clip: string): number {
  const duration = (DECIDUOUS_CLIP_FRAMES[clip] ?? 0) * FRAMES;
  inst.leaves.OnAnimation(duration);
  inst.sprite.playOnce(clip, () => {
    if (inst.hasTag('stump')) inst.sprite.playOnce(rest(inst)); else inst.sprite.start(rest(inst));
  });
  return duration;
}

function updateLoot(inst: DeciduousInstance): void {
  inst.components.lootdropper.SetLoot([...Array.from({ length: stageOf(inst) + 1 }, () => 'log'),
    ...(stageOf(inst) === 2 && inst.leaves.state.build.peek() !== 'barren' ? ['acorn'] : [])]);
}

function applyBuild(inst: DeciduousInstance): void {
  const leafBuild = inst.leaves.state.build.peek();
  const tint = leafBuild === 'normal' ? inst.color : 1;
  inst.sprite.setBuildArchive('tree_leaf_trunk_build.zip');
  inst.sprite.setSymbolOverride('swap_leaves', leafBuild === 'barren' ? undefined
    : `tree_leaf_${leafBuild === 'normal' ? 'green' : leafBuild}_build.zip`);
  inst.sprite.setColour([tint, tint, tint]);
}

function setStage(inst: DeciduousInstance): void {
  inst.components.workable!.SetWorkLeft(DECIDUOUS_CHOPS[stageOf(inst)]);
  updateLoot(inst);
  inst.sprite.start(rest(inst));
}

function grow(inst: DeciduousInstance): void {
  if (!inst.isAwake || inst.catchingUp) return;
  playSound(inst, 'dontstarve/forest/treeGrow');
  playOnce(inst, ['grow_tall_to_short', 'grow_short_to_normal', 'grow_normal_to_tall'][stageOf(inst)]);
  if (inst.leaves.state.leaf.peek() === 'colorful') inst.leaves.SpawnLeafFxAfter(stageOf(inst) === 0 ? 17 / 30 : 10 / 30);
}

function unbindFire(inst: DeciduousInstance): void { inst.fire?.dispose(); inst.fire = undefined; }

/** OnEntityWake: MakeLargeBurnable + MakeMediumPropagator, or the stump's small pair, unless burnt. */
function bindFire(inst: DeciduousInstance): void {
  if (!inst.isAwake || inst.fire || inst.hasTag('burnt') || inst.isRemoved) return;
  inst.fire = new BurnableBinding(inst, inst.hasTag('stump')
    ? { propagator: 'small', burnTime: 10, fxLevel: 2, onBurnt: () => burnStump(inst) }
    : { propagator: 'medium', burnTime: TREE_BURN_TIME, fxLevel: 5, onBurnt: () => tree_burnt(inst) }, inst.world);
}

/** DefaultBurntFn on a stump: one ash, then the inst is removed. */
function burnStump(inst: DeciduousInstance): void {
  inst.world.worldEvents.emit('spawnAsh', inst.getPosition().clone());
  inst.remove();
}

function burntChanges(inst: DeciduousInstance): void {
  unbindFire(inst);
  inst.components.growable.StopGrowing(); inst.leaves.Stop();
  inst.removeTag('shelter'); inst.removeTag('cattoyairborne');
  inst.components.lootdropper.SetLoot([]); inst.components.lootdropper.SetChanceLootTable('deciduoustree_burnt');
  const workable = inst.components.workable;
  if (workable) {
    workable.SetWorkLeft(1);
    workable.SetOnWorkCallback(() => {});
    workable.SetOnFinishCallback(() => chop_down_burnt_tree(inst));
  }
}

/** OnBurnt: the burnt tag and pose at once; the component changes follow after .5 seconds. */
function OnBurnt(inst: DeciduousInstance, immediate: boolean): void {
  if (inst.hasTag('burnt')) return;
  inst.addTag('burnt');
  inst.minimap.SetIcon('tree_leaf_burnt.png');
  inst.sprite.start(rest(inst));
  if (immediate) burntChanges(inst);
  else inst.changesTask = inst.world.scheduler.schedule(.5, () => { inst.changesTask = undefined; burntChanges(inst); });
}

const cameraRight = (inst: DeciduousInstance) => new THREE.Vector3(1, 0, 0).applyQuaternion(inst.world.camera.getWorldQuaternion(new THREE.Quaternion()));

/** OnAcornTask: the 10% acorn lands one camera-right unit to either side of the burnt tree, once. */
function startAcornTask(inst: DeciduousInstance): void {
  if (inst.burntcone || inst.acornTask) return;
  inst.acornTask = inst.world.scheduler.schedule(10, () => {
    inst.acornTask = undefined;
    const position = inst.getPosition().clone().addScaledVector(cameraRight(inst), inst.random() < .5 ? WORLD_SCALE : -WORLD_SCALE);
    const loot = new Map<string, number>();
    for (const itemId of inst.components.lootdropper.GenerateLoot(inst.random)) loot.set(itemId, (loot.get(itemId) ?? 0) + 1);
    if (loot.size) inst.world.dropLoot([...loot].map(([itemId, count]) => ({ itemId, count })), position);
    inst.burntcone = true;
  });
}

function tree_burnt(inst: DeciduousInstance): void {
  OnBurnt(inst, false);
  startAcornTask(inst);
}

/** chop_down_burnt_tree: charcoal and the chance loot, then removal when the clip ends. */
function chop_down_burnt_tree(inst: DeciduousInstance): void {
  removeComponent(inst, 'workable');
  playSound(inst, 'dontstarve/forest/treeCrumble');
  playSound(inst, 'dontstarve/wilson/use_axe_tree');
  RemovePhysicsColliders(inst);
  inst.components.lootdropper.SpawnLootPrefab('charcoal');
  inst.components.lootdropper.DropLoot();
  inst.acornTask?.(); inst.acornTask = undefined;
  inst.sprite.playOnce(`chop_burnt_${DECIDUOUS_STAGES[stageOf(inst)]}`, () => inst.remove());
}

/** dig_up_stump. */
function dig_up_stump(inst: DeciduousInstance): void {
  inst.components.lootdropper.SpawnLootPrefab('log');
  inst.remove();
}

/** make_stump: replace CHOP work with one DIG, removing shelter. */
function make_stump(inst: DeciduousInstance): void {
  unbindFire(inst);
  inst.minimap.SetIcon('tree_leaf_stump.png');
  inst.addTag('stump'); inst.components.growable.StopGrowing(); inst.leaves.Stop();
  inst.removeTag('cattoyairborne');
  inst.removeTag('shelter');
  RemovePhysicsColliders(inst);
  removeComponent(inst, 'workable');
  const workable = addComponent(inst, 'workable');
  workable.SetWorkAction('DIG'); workable.SetWorkLeft(1);
  inst.mouseTarget?.setWorkable(inst.components.workable);
  workable.SetOnFinishCallback(dig_up_stump);
  bindFire(inst);
}

/** SpawnLeafFX: fx.lua's `<color>_leaves` or `<color>_leaves_chop`, which rustle as they spawn; a barren tree has none. */
function spawnLeaves(inst: DeciduousInstance, chopped = false): void {
  if (!inst.isAwake || inst.hasTag('stump')) return;
  const build = inst.leaves.state.build.peek();
  if (build === 'barren') return;
  const { x, z } = inst.position;
  const y = (stageOf(inst) === 1 ? -.3 : 0) * WORLD_SCALE + (chopped ? inst.random() * 2 * WORLD_SCALE : 0);
  inst.world.spawnPrefab(`${build === 'normal' ? 'green' : build}_leaves${chopped ? '_chop' : ''}`, inst.position).setPosition(x, y, z);
}

function chop_tree(inst: DeciduousInstance): void {
  if (!inst.isAwake) return;
  playSound(inst, 'dontstarve/wilson/use_axe_tree');
  spawnLeaves(inst, true);
  playOnce(inst, `chop_${DECIDUOUS_STAGES[stageOf(inst)]}`);
}

/** chop_down_tree: falls away from the chopper and scatters loot on the fall side. */
function chop_down_tree(inst: DeciduousInstance, worker: Worker): void {
  playSound(inst, 'dontstarve/forest/treeFall');
  const right = cameraRight(inst);
  const workerPosition = worker.getPosition?.();
  const onRight = workerPosition ? workerPosition.clone().sub(inst.position).dot(right) > 0 : inst.random() <= .5;
  const loot = new Map<string, number>();
  for (const itemId of inst.components.lootdropper.GenerateLoot()) loot.set(itemId, (loot.get(itemId) ?? 0) + 1);
  if (stageOf(inst) === 2 && inst.leaves.state.leaf.peek() === 'colorful') loot.set('acorn', (loot.get('acorn') ?? 0) + 1);
  inst.world.dropLoot([...loot].map(([itemId, count]) => ({ itemId, count })),
    inst.getPosition().clone().addScaledVector(right, onRight ? -WORLD_SCALE : WORLD_SCALE));
  const clip = `${onRight ? 'fallleft' : 'fallright'}_${DECIDUOUS_STAGES[stageOf(inst)]}`;
  make_stump(inst);
  playOnce(inst, clip);
}

/** weather.lua SNOW_COVERED_THRESHOLD, followed while the tree is awake; its cleanup owns the source and the effect. */
function bindSnow(inst: DeciduousInstance): void {
  let stopWatch: (() => void) | undefined;
  const snow = inst.world.getWatchWorldContent?.(WorldContentKey.SnowLevel, stop => { stopWatch = stop; });
  if (!snow) return;
  const stopEffect = createRenderEffect(() => { inst.sprite.setSymbolHidden('snow', snow.get() < .015); });
  inst.stopSnow = () => { stopEffect(); stopWatch?.(); };
}

function OnEntityWake(inst: DeciduousInstance): void {
  inst.catchingUp = true;
  try { inst.components.growable.OnEntityWake(); } finally { inst.catchingUp = false; }
  inst.leaves.SetAwake(true);
  if (inst.firstFrame && !inst.hasTag('stump')) {
    inst.firstFrame = false;
    inst.sprite.setFrameAt(inst.random());
  }
  bindSnow(inst);
  bindFire(inst);
  if (inst.hasTag('burnt')) startAcornTask(inst);
}

function OnEntitySleep(inst: DeciduousInstance): void {
  inst.components.growable.OnEntitySleep();
  inst.stopSnow?.(); inst.stopSnow = undefined;
  inst.leaves.SetAwake(false);
  if (inst.fire?.burnable.IsBurning()) {
    if (inst.hasTag('stump')) inst.removeTask = inst.world.scheduler.schedule(0, () => { inst.removeTask = undefined; burnStump(inst); });
    else OnBurnt(inst, true);
  }
  unbindFire(inst);
}

/** onsave: a burning tree is saved as burnt; a burning stump is still a stump. */
function onsave(inst: DeciduousInstance, data: PlacementSaveRecord['components']): void {
  const burnt = !inst.hasTag('stump') && (inst.hasTag('burnt') || inst.fire?.burnable.IsBurning() === true);
  const saved = inst.leaves.OnSave();
  if (burnt) {
    const { stump: _stump, leaveschangetime: _change, ...leaves } = saved;
    data.deciduoustree = { ...leaves, burnt: true, ...(inst.burntcone ? { burntcone: true as const } : {}) };
    data.growable = { stage: inst.components.growable.GetStage() };
  } else data.deciduoustree = saved;
  // The timer's record keeps the name existing saves hold.
  if (data.timer) data.deciduousTimer = data.timer;
  delete data.timer;
}

function onload(inst: DeciduousInstance, data: PlacementSaveRecord['components']): void {
  const saved = data.deciduoustree;
  if (saved) { inst.leaves.Initialize(saved); inst.leavesInitialized = true; }
  inst.components.timer.OnLoad(data.deciduousTimer);
  if (saved?.stump) make_stump(inst);
  else if (saved?.burnt) {
    inst.burntcone = saved.burntcone === true;
    OnBurnt(inst, true);
  }
}

function onSpawned(inst: DeciduousInstance): void {
  if (!inst.leavesInitialized) { inst.leaves.Initialize(); inst.leavesInitialized = true; }
  inst.sprite.start(rest(inst));
  if (inst.hasTag('stump')) inst.sprite.playOnce(rest(inst));
  applyBuild(inst);
  inst.components.growable.OnEntitySleep();
  inst.mouseTarget = new ToolMouseTarget(actionEntity(inst.transform.model, DECIDUOUS_ID), inst, inst.components.workable, inst.world.handEquipment);
}

/** deciduoustrees.lua normal build: three size anims over one trunk, with the season's leaves as a symbol override. */
export function deciduousPrefabs(world: DeciduousWorld, random: () => number = Math.random): Readonly<Record<DeciduousSpawnId, PrefabEntityDefinition<DeciduousInstance>>> {
  const definition = (id: DeciduousSpawnId): PrefabEntityDefinition<DeciduousInstance> => ({
    fn: position => new DeciduousInstance(world, position, id === DECIDUOUS_ID ? Math.min(3, Math.floor(random() * 3) + 1) : DECIDUOUS_SPAWN_IDS.indexOf(id), random),
    assets: {
      animationArchive: 'tree_leaf_short.zip', extraAnimationArchives: ['tree_leaf_normal.zip', 'tree_leaf_tall.zip'],
      buildArchives: ['tree_leaf_trunk_build.zip', ...LEAF_COLORS.map(color => `tree_leaf_${color}_build.zip`), 'snow.zip'], bank: 'tree_leaf',
      symbolOverrides: { swap_leaves: { archive: 'tree_leaf_green_build.zip', symbol: 'swap_leaves' },
        snow: { archive: 'snow.zip', symbol: 'snow' } },
      hiddenSymbols: ['mouseover', 'snow'],
    },
    assetOptions: { scale: .02, staticBillboard: true, colour: [1, 1, 1], instancedAnimations: DECIDUOUS_STAGES.flatMap(stage =>
      [`sway1_loop_${stage}`, `sway2_loop_${stage}`, `burnt_${stage}`]) },
    physics: { make: MakeObstaclePhysics, radius: .25 },
    minimapIcon: 'tree_leaf.png',
    onSpawned,
  });
  return Object.fromEntries(DECIDUOUS_SPAWN_IDS.map(id => [id, definition(id)])) as Record<DeciduousSpawnId, PrefabEntityDefinition<DeciduousInstance>>;
}
