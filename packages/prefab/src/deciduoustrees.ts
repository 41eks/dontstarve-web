import { ModelRecords } from './modelRecords';
import { MiniMapEntity } from './minimapEntity';
import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createSignal, readonlySignal, createEffect, getBoundWatchWorldContent, WorldContentKey, type Signal, type TileStateQuery } from '@dontstarve-web/signals';
import { ArchiveSpriteAssets, preloadSharedArchiveSprite, type ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { createAnimatedSpriteFactory, type SpriteAnimationController } from '@dontstarve-web/animation/sprite';
import type { PickaxeTarget } from '@dontstarve-web/stategraphs/pickaxe';
import type { ShovelTarget } from '@dontstarve-web/stategraphs/shovel';
import { performToolWork, type ComponentActionEntity } from '../../stategraphs/src/componentactions';
import { Workable, type WorkableInst, type Worker } from '../../componets/src/workable';
import { Growable, type GrowableSave } from '../../componets/src/growable';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { Timer, type NamedTimerSave } from '../../componets/src/timer';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ResidentSprite, type ResidentEntity } from '@dontstarve-web/animation/residentSprite';
import { watchTileActivity } from './tileActivity';
import { registerPlacementTree } from './placementEntities';
import { actionEntity } from './actionEntity';
import { MakeObstaclePhysics, WORLD_SCALE } from './standardcomponents';
import { newEntityId } from './saveRecord';
import { DeciduousTreeLeaves, type DeciduousTreeSave, type LeafWorld, type LeafBuild } from './deciduousTreeLeaves';
import { PlaySound, PreloadSounds, type SoundEventPath, type SoundHandle } from './sound';
import { BurnableBinding, FireFxHost, TREE_BURN_TIME, type BurnEnvironment } from './treeFire';
import type { WorldEventEmitter } from './worldContext';

export const DECIDUOUS_SPAWN_IDS = ['deciduoustree', 'deciduoustree_short', 'deciduoustree_normal', 'deciduoustree_tall'] as const;
export type DeciduousSpawnId = typeof DECIDUOUS_SPAWN_IDS[number];
export const DECIDUOUS_STAGES = ['short', 'normal', 'tall'] as const;
export const DECIDUOUS_CHOPS = [5, 10, 15] as const;
/** tuning.lua DECIDUOUS_GROW_TIME, using day_time = 300 seconds. */
export const DECIDUOUS_GROW_TIME = [{ base: 450, random: 150 }, { base: 1500, random: 600 },
  { base: 1500, random: 600 }] as const;
// deciduoustrees.lua onburntchanges: GetBuild(inst).drop_acorns adds a 10% acorn to the burnt tree's loot.
SetSharedLootTable('deciduoustree_burnt', [['acorn', .1]]);

export interface DeciduousRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { deciduoustree: DeciduousTreeSave; growable?: GrowableSave; deciduousTimer?: NamedTimerSave };
}
export interface DeciduousWorld {
  camera: THREE.Camera;
  /** Searched for propagator neighbours; receives fire effects. */
  scene: THREE.Object3D;
  /** DefaultBurntFn: one ash at the burnt inst's position. */
  worldEvents: WorldEventEmitter;
  scheduler?: GameTimeScheduler;
  /** Only visuals are resident while the entity's tile is active. */
  tickingarea: TileStateQuery;
  physics?: CANNON.World;
  season: LeafWorld['season'];
  secondsUntilNextDay: LeafWorld['secondsUntilNextDay'];
  seasonCalendar?: LeafWorld['seasonCalendar'];
  growthDuration?(seconds: number): number;
  dropLoot(items: readonly { itemId: string; count: number }[], position: THREE.Vector3): void;
}
interface Tree {
  logical: ResidentEntity;
  sprite: ResidentSprite;
  stopActivity(): void;
  stopPlacement(): void;
  minimap: MiniMapEntity;
  inst: ComponentActionEntity & WorkableInst & { getPosition(): THREE.Vector3 };
  removeInst(): void;
  stump: Signal<boolean>;
  growable: Growable;
  timer: Timer;
  workable: Workable;
  lootdropper: LootDropper;
  body?: CANNON.Body;
  sounds: Set<SoundHandle>;
  leaves: DeciduousTreeLeaves;
  color: number;
  /** MakeLargeBurnable/MakeMediumPropagator (or the stump's small pair) while the tree is awake. */
  fire?: BurnableBinding;
  burntcone: boolean;
  changesTask?: () => void;
  acornTask?: () => void;
  removeTask?: () => void;
  stopSnow?: () => void;
  stopDress?: () => void;
}
export interface DeciduousForest {
  group: THREE.Group;
  readonly entities: readonly ResidentEntity[];
  readonly miniMapEntities: readonly MiniMapEntity[];
  readonly chopTargets: readonly PickaxeTarget[];
  getChopTargets(model?: THREE.Object3D): readonly PickaxeTarget[];
  readonly digTargets: readonly ShovelTarget[];
  getDigTargets(model?: THREE.Object3D): readonly ShovelTarget[];
  readonly renderEntities: readonly { object: THREE.Group; footPosition: THREE.Vector3; cameraDepth: number }[];
  spawn(prefab: DeciduousSpawnId, position: THREE.Vector3, saved?: DeciduousRecord): ResidentEntity;
  update(dt: number, quaternion: THREE.Quaternion): void;
  exportRecords(): DeciduousRecord[];
  dispose(): void;
}

/** deciduoustrees.lua's normal build. Growth/work belong to logical trees, independently of loaded art. */
export async function createDeciduousForest(assetBaseUrl: string, world: DeciduousWorld,
  random = Math.random): Promise<DeciduousForest> {
  const colors = ['green', 'red', 'orange', 'yellow'] as const;
  const assets = new ArchiveSpriteAssets('deciduoustree', assetBaseUrl);
  const [createTree, banks, leafFx, fireFx] = await Promise.all([
    preloadSharedArchiveSprite(assets, {
      animationArchive: 'tree_leaf_short.zip', extraAnimationArchives: ['tree_leaf_normal.zip', 'tree_leaf_tall.zip'],
      buildArchives: ['tree_leaf_trunk_build.zip', ...colors.map(color => `tree_leaf_${color}_build.zip`), 'snow.zip'], bank: 'tree_leaf',
      symbolOverrides: { swap_leaves: { archive: 'tree_leaf_green_build.zip', symbol: 'swap_leaves' },
        snow: { archive: 'snow.zip', symbol: 'snow' } },
      hiddenSymbols: ['mouseover', 'snow'],
    }, { scale: .02, staticBillboard: true, instancedAnimations: DECIDUOUS_STAGES.flatMap(stage =>
      [`sway1_loop_${stage}`, `sway2_loop_${stage}`, `burnt_${stage}`]) }),
    Promise.all(DECIDUOUS_STAGES.map(stage => assets.loadAnimation(`tree_leaf_${stage}.zip`))),
    Promise.all(colors.map(color => createAnimatedSpriteFactory(assetBaseUrl, `tree_leaf_fx_${color}.zip`))),
    FireFxHost.load(assetBaseUrl),
    PreloadSounds('dontstarve/wilson/use_axe_tree', 'dontstarve/forest/treeFall', 'dontstarve/forest/treeCrumble',
      'dontstarve/forest/treeGrow', 'dontstarve/forest/treeWilt', 'dontstarve_DLC001/fall/leaf_rustle'),
  ]);
  const animations = { animations: banks.flatMap(bank => bank.animations) };
  const fxFactories = new Map<LeafBuild, typeof leafFx[number]>(colors.map((color, i) => [color === 'green' ? 'normal' : color, leafFx[i]]));
  const scheduler = world.scheduler ?? new GameTimeScheduler();
  const group = new THREE.Group(); group.name = 'DeciduousForest';
  const entities: ResidentEntity[] = [];
  const active = new Set<ResidentEntity>();
  let nextId = 0;
  const trees = new Map<ResidentEntity, Tree>();
  const mouseRecords = new ModelRecords<ResidentEntity>();
  const effects = new Map<THREE.Group, { position: THREE.Vector3; factory: typeof leafFx[number] }>();
  let disposed = false;
  const stageOf = (tree: Tree) => tree.growable.GetStage() - 1;
  const rest = (tree: Tree) => tree.stump.peek() ? `stump_${DECIDUOUS_STAGES[stageOf(tree)]}`
    : tree.inst.hasTag('burnt') ? `burnt_${DECIDUOUS_STAGES[stageOf(tree)]}`
    : `sway1_loop_${DECIDUOUS_STAGES[stageOf(tree)]}`;
  const env: BurnEnvironment = { scheduler, root: world.scene, fire: fireFx };
  const animationOf = (tree: Tree) => tree.sprite;
  const playSound = (tree: Tree, path: SoundEventPath) => {
    for (const sound of tree.sounds) if (sound.isPlaying?.() === false) tree.sounds.delete(sound);
    tree.sounds.add(PlaySound(path, tree.logical.position));
  };
  const animationDuration = (clip: string) => {
    const anim = animations.animations.find(animation => animation.name === clip)!;
    return anim.frames.length / anim.frameRate;
  };
  const playOnce = (tree: Tree, clip: string) => {
    tree.leaves?.OnAnimation(animationDuration(clip));
    animationOf(tree)?.playOnce(clip, () => {
      const sprite = animationOf(tree);
      if (tree.stump.peek()) sprite?.playOnce(rest(tree)); else sprite?.start(rest(tree));
    });
    return animationDuration(clip);
  };
  const updateLoot = (tree: Tree) => {
    tree.lootdropper.SetLoot([...Array.from({ length: stageOf(tree) + 1 }, () => 'log'),
      ...(stageOf(tree) === 2 && tree.leaves.state.build.peek() !== 'barren' ? ['acorn'] : [])]);
  };
  const applyBuild = (tree: Tree, model = tree.logical.model) => {
    if (!model) return;
    const sprite = model.userData.animationController as ArchiveSprite;
    const leafBuild = tree.leaves.state.build.peek();
    const tint = leafBuild === 'normal' ? tree.color : 1;
    sprite.setBuildArchive('tree_leaf_trunk_build.zip');
    sprite.setSymbolOverride('swap_leaves', leafBuild === 'barren' ? undefined
      : `tree_leaf_${leafBuild === 'normal' ? 'green' : leafBuild}_build.zip`);
    sprite.setColour([tint, tint, tint]);
  };
  const setStage = (tree: Tree) => {
    tree.workable.SetWorkLeft(DECIDUOUS_CHOPS[stageOf(tree)]);
    if (tree.leaves) updateLoot(tree);
    animationOf(tree)?.start(rest(tree));
  };
  /** Growth settled while the visual was unloaded is shown as its final stage, without the transition animation. */
  let catchingUp = false;
  const wakeGrowable = (tree: Tree) => {
    catchingUp = true;
    try { tree.growable.OnEntityWake(); } finally { catchingUp = false; }
  };
  const grow = (tree: Tree) => {
    if (!active.has(tree.logical) || catchingUp) return;
    playSound(tree, 'dontstarve/forest/treeGrow');
    playOnce(tree, ['grow_tall_to_short', 'grow_short_to_normal', 'grow_normal_to_tall'][stageOf(tree)]);
    if (tree.leaves.state.leaf.peek() === 'colorful') tree.leaves.SpawnLeafFxAfter(stageOf(tree) === 0 ? 17 / 30 : 10 / 30);
  };
  const unbindFire = (tree: Tree) => { tree.fire?.dispose(); tree.fire = undefined; };
  /** OnEntityWake: MakeLargeBurnable + MakeMediumPropagator, or the stump's small pair, unless burnt. */
  const bindFire = (tree: Tree) => {
    if (disposed || !active.has(tree.logical) || tree.fire || tree.inst.hasTag('burnt') || tree.inst.isRemoved) return;
    tree.fire = new BurnableBinding(tree.inst, tree.stump.peek()
      ? { propagator: 'small', burnTime: 10, fxLevel: 2, onBurnt: () => burnStump(tree) }
      : { propagator: 'medium', burnTime: TREE_BURN_TIME, fxLevel: 5, onBurnt: () => treeBurnt(tree) }, env);
  };
  /** DefaultBurntFn on a stump: one ash, then the inst is removed. */
  const burnStump = (tree: Tree) => {
    world.worldEvents.emit('spawnAsh', tree.logical.position.clone());
    remove(tree);
  };
  const burntChanges = (tree: Tree) => {
    unbindFire(tree);
    tree.growable.StopGrowing(); tree.leaves.Stop();
    tree.inst.removeTag('shelter'); tree.inst.removeTag('cattoyairborne');
    tree.lootdropper.SetLoot([]); tree.lootdropper.SetChanceLootTable('deciduoustree_burnt');
    if (tree.inst.components.workable === tree.workable) {
      tree.workable.SetWorkLeft(1);
      tree.workable.SetOnWorkCallback(() => {});
      tree.workable.SetOnFinishCallback(() => chopDownBurnt(tree));
    }
  };
  /** OnBurnt: the burnt tag and pose at once; the component changes follow after .5 seconds. */
  const burn = (tree: Tree, immediate: boolean) => {
    if (tree.inst.hasTag('burnt')) return;
    tree.inst.addTag('burnt');
    tree.minimap.SetIcon('tree_leaf_burnt.png');
    animationOf(tree)?.start(rest(tree));
    if (immediate) burntChanges(tree);
    else tree.changesTask = scheduler.schedule(.5, () => { tree.changesTask = undefined; burntChanges(tree); });
  };
  /** OnAcornTask: the 10% acorn lands one camera-right unit to either side of the burnt tree, once. */
  const startAcornTask = (tree: Tree) => {
    if (tree.burntcone || tree.acornTask) return;
    tree.acornTask = scheduler.schedule(10, () => {
      tree.acornTask = undefined;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(world.camera.getWorldQuaternion(new THREE.Quaternion()));
      const position = tree.logical.position.clone().addScaledVector(right, random() < .5 ? WORLD_SCALE : -WORLD_SCALE);
      const loot = new Map<string, number>();
      for (const itemId of tree.lootdropper.GenerateLoot(random)) loot.set(itemId, (loot.get(itemId) ?? 0) + 1);
      if (loot.size) world.dropLoot([...loot].map(([itemId, count]) => ({ itemId, count })), position);
      tree.burntcone = true;
    });
  };
  const treeBurnt = (tree: Tree) => {
    burn(tree, false);
    startAcornTask(tree);
  };
  /** chop_down_burnt_tree: charcoal and the chance loot, then removal when the clip ends. */
  const chopDownBurnt = (tree: Tree) => {
    tree.workable.dispose(); delete tree.inst.components.workable;
    playSound(tree, 'dontstarve/forest/treeCrumble');
    playSound(tree, 'dontstarve/wilson/use_axe_tree');
    if (tree.body) { world.physics?.removeBody(tree.body); tree.body = undefined; }
    tree.lootdropper.SpawnLootPrefab('charcoal');
    tree.lootdropper.DropLoot();
    tree.acornTask?.(); tree.acornTask = undefined;
    tree.sprite.playOnce(`chop_burnt_${DECIDUOUS_STAGES[stageOf(tree)]}`, () => remove(tree));
  };
  const remove = (tree: Tree) => {
    if (!trees.delete(tree.logical)) return;
    active.delete(tree.logical);
    entities.splice(entities.indexOf(tree.logical), 1);
    tree.stopActivity(); tree.stopPlacement(); tree.stopSnow?.(); tree.stopSnow = undefined; tree.stopDress?.(); tree.stopDress = undefined;
    tree.logical.model.userData.removed = true;
    tree.changesTask?.(); tree.acornTask?.(); tree.removeTask?.();
    unbindFire(tree);
    tree.minimap.dispose();
    tree.removeInst(); tree.workable.dispose(); tree.growable.dispose(); tree.leaves.dispose(); tree.timer.dispose();
    if (tree.body) world.physics?.removeBody(tree.body);
    for (const sound of tree.sounds) sound.stop(); tree.sounds.clear();
    tree.sprite.dispose();
  };
  const makeStump = (tree: Tree) => {
    unbindFire(tree);
    tree.minimap.SetIcon('tree_leaf_stump.png');
    tree.stump.set(true); tree.growable.StopGrowing(); tree.leaves.Stop();
    tree.inst.removeTag('cattoyairborne');
    tree.inst.removeTag('shelter'); tree.inst.addTag('stump');
    if (tree.body) { world.physics?.removeBody(tree.body); tree.body = undefined; }
    tree.workable.dispose();
    tree.workable = new Workable(tree.inst);
    tree.inst.components.workable = tree.workable;
    tree.workable.SetWorkAction('DIG'); tree.workable.SetWorkLeft(1);
    tree.workable.SetOnFinishCallback(() => {
      tree.lootdropper.SpawnLootPrefab('log');
      remove(tree);
    });
    if (active.has(tree.logical)) bindFire(tree);
  };
  const spawnLeaves = (tree: Tree, chopped = false) => {
    if (!active.has(tree.logical) || tree.stump.peek()) return;
    const fxFactory = fxFactories.get(tree.leaves.state.build.peek());
    if (!fxFactory) return;
    const clip = chopped ? 'chop' : 'fall';
    const fx = fxFactory.create({ initialAnimation: clip, name: `deciduous_leaves_${clip}` });
    fx.position.copy(tree.logical.position);
    fx.position.y += (stageOf(tree) === 1 ? -.3 : 0) * WORLD_SCALE + (chopped ? random() * 2 * WORLD_SCALE : 0);
    fx.quaternion.copy(world.camera.getWorldQuaternion(new THREE.Quaternion()));
    fx.userData.tags = ['FX', 'NOCLICK']; effects.set(fx, { position: tree.logical.position, factory: fxFactory }); group.add(fx);
    playSound(tree, 'dontstarve_DLC001/fall/leaf_rustle');
    (fx.userData.animationController as SpriteAnimationController).playOnce(clip, () => {
      effects.delete(fx); fxFactory.disposeSprite(fx);
    });
  };
  const chopDown = (tree: Tree, worker: Worker) => {
    playSound(tree, 'dontstarve/forest/treeFall');
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(world.camera.getWorldQuaternion(new THREE.Quaternion()));
    const workerPosition = worker.getPosition?.();
    const onRight = workerPosition ? workerPosition.clone().sub(tree.logical.position).dot(right) > 0 : random() <= .5;
    const loot = new Map<string, number>();
    for (const itemId of tree.lootdropper.GenerateLoot()) loot.set(itemId, (loot.get(itemId) ?? 0) + 1);
    if (stageOf(tree) === 2 && tree.leaves.state.leaf.peek() === 'colorful') loot.set('acorn', (loot.get('acorn') ?? 0) + 1);
    world.dropLoot([...loot].map(([itemId, count]) => ({ itemId, count })),
      tree.logical.position.clone().addScaledVector(right, onRight ? -WORLD_SCALE : WORLD_SCALE));
    const clip = `${onRight ? 'fallleft' : 'fallright'}_${DECIDUOUS_STAGES[stageOf(tree)]}`;
    makeStump(tree);
    playOnce(tree, clip);
  };
  const initializeModel = (tree: Tree) => {
    const model = tree.logical.model;
    model.userData.animationController = tree.sprite;
    Object.assign(model.userData, { entityId: tree.logical.saveId, prefab: 'deciduoustree', deploySmartRadius: 1,
      physicsRadius: .25 * WORLD_SCALE, MiniMapEntity: tree.minimap, components: tree.inst.components,
      deciduoustreeState: { stump: readonlySignal(tree.stump), growth: tree.growable.state, leaves: tree.leaves.state } });
    Object.defineProperty(model.userData, 'tags', { get: () => ['plant', 'tree', 'birchnut', 'deciduoustree', 'cattoyairborne',
      'SnowCovered', '__combat', 'shelter', 'stump', 'burnt', 'fire', 'CHOP_workable', 'DIG_workable'].filter(tag => tree.inst.hasTag(tag)) });
    model.userData.placementLogical = true;
    actionEntity(model, 'deciduoustree', tree.inst);
    mouseRecords.set(model, tree.logical);
  };
  const setActive = (tree: Tree, awake: boolean) => {
    const { logical, sprite } = tree;
    if (!trees.has(logical) || active.has(logical) === awake) return;
    if (awake) {
      active.add(logical);
      wakeGrowable(tree);
      tree.leaves.SetAwake(true);
      tree.stopDress = createEffect(() => { tree.sprite.art.get(); applyBuild(tree); });
      const snow = getBoundWatchWorldContent()?.(WorldContentKey.SnowLevel, stop => { tree.stopSnow = stop; });
      if (snow) createEffect(() => { tree.sprite.art.get(); tree.sprite.setSymbolHidden('snow', snow.get() < .015); });
      bindFire(tree);
      if (tree.inst.hasTag('burnt')) startAcornTask(tree);
      sprite.setActive(true);
    } else {
      active.delete(logical);
      tree.growable.OnEntitySleep();
      tree.stopSnow?.(); tree.stopSnow = undefined;
      tree.stopDress?.(); tree.stopDress = undefined;
      tree.leaves.SetAwake(false);
      if (tree.fire?.burnable.IsBurning()) {
        if (tree.stump.peek()) tree.removeTask = scheduler.schedule(0, () => { tree.removeTask = undefined; burnStump(tree); });
        else burn(tree, true);
      }
      unbindFire(tree);
      sprite.setActive(false);
    }
  };
  const targets = (action: 'CHOP' | 'DIG', model?: THREE.Object3D): PickaxeTarget[] => mouseRecords.select(model, active).flatMap(logical => {
    const tree = trees.get(logical)!, model = logical.model;
    const isValid = () => !disposed && active.has(logical) && !tree.inst.isRemoved && logical.model === model
      && tree.workable.CanBeWorked() && tree.workable.GetWorkAction() === action;
    return isValid() ? [{ id: logical.saveId!, model, position: logical.position,
      entity: actionEntity(model, 'deciduoustree', tree.inst), isValid }] : [];
  });
  const digTargets = (model?: THREE.Object3D) => targets('DIG', model).map(target => ({ ...target,
    dig: () => target.isValid() && performToolWork('DIG', target.entity, {}),
  }));
  return {
    group,
    get entities() { return entities; },
    get miniMapEntities() { return [...trees.values()].map(tree => tree.minimap); },
    spawn(prefab, position, saved) {
      if (disposed) throw new Error('Deciduous forest has been disposed');
      const saveId = saved?.id ?? newEntityId();
      if (entities.some(entity => entity.saveId === saveId)) throw new Error(`Duplicate entity ID: ${saveId}`);
      const sprite = new ResidentSprite(clip => createTree(clip.name, clip.loop, `Deciduous-${saveId}`, { colour: [1, 1, 1] }),
        { name: 'sway1_loop_short', loop: true });
      let firstFrame = true;
      sprite.onAttach(drawn => {
        if (firstFrame) {
          firstFrame = false;
          if (!tree.stump.peek()) sprite.setFrame(Math.floor(random() * drawn.frameCount));
        }
      });
      const model = sprite.model; model.position.copy(position);
      model.userData.animationController = sprite;
      const logical: ResidentEntity = { id: nextId++, saveId, model, position: model.position };
      entities.push(logical);
      const minimap = new MiniMapEntity(logical.position);
      minimap.SetIcon('tree_leaf.png'); minimap.SetPriority(-1);
      const removed = createSignal(false), tags = new Set(['plant', 'tree', 'birchnut', 'deciduoustree', 'cattoyairborne', 'SnowCovered', '__combat']);
      const components: ComponentActionEntity['components'] & { growable?: Growable; lootdropper?: LootDropper; timer?: Timer } = {};
      const inst: Tree['inst'] = {
        prefab: 'deciduoustree', removal: readonlySignal(removed), get isRemoved() { return removed.peek(); }, components,
        hasTag: tag => components.workable?.HasTag(tag) ?? tags.has(tag),
        addTag: tag => { tags.add(tag); }, removeTag: tag => { tags.delete(tag); },
        PushEvent: (name, data) => logical.model.dispatchEvent({ type: name, data } as never),
        getPosition: () => logical.position,
      };
      const workable = new Workable(inst, () => scheduler.now); components.workable = workable;
      const lootdropper = new LootDropper({ getPosition: () => logical.position, PushEvent: inst.PushEvent }, prefab => {
        world.dropLoot([{ itemId: prefab, count: 1 }], logical.position); return undefined;
      });
      components.lootdropper = lootdropper;
      workable.SetWorkAction('CHOP');
      const growable = new Growable(scheduler, DECIDUOUS_GROW_TIME.map(time => ({
        time: () => time.base + (random() * 2 - 1) * time.random,
        fn: () => setStage(trees.get(logical)!), growfn: () => grow(trees.get(logical)!),
      })), seconds => world.growthDuration?.(seconds) ?? seconds);
      components.growable = growable;
      const tree: Tree = { logical, sprite, stopActivity() {}, stopPlacement() {}, minimap, inst, removeInst: () => removed.set(true), stump: createSignal(false),
        growable, workable, lootdropper, sounds: new Set(), color: .5 + random() * .5, leaves: undefined!, burntcone: false,
        timer: new Timer(scheduler, name => { if (name === 'decay') remove(tree); }, ['decay']) };
      components.timer = tree.timer;
      trees.set(logical, tree);
      tree.stopPlacement = registerPlacementTree(group, logical, 'deciduoustree', 1);
      group.add(model);
      tree.leaves = new DeciduousTreeLeaves(scheduler, world, {
        lastWorkTime: () => tree.workable.lastworktime.peek(), applyBuild: () => applyBuild(tree), updateLoot: () => updateLoot(tree),
        setShelter: value => value ? inst.addTag('shelter') : inst.removeTag('shelter'),
        playTransition: kind => { playSound(tree, kind === 'grow_leaves' ? 'dontstarve/forest/treeGrow' : 'dontstarve/forest/treeWilt');
          return playOnce(tree, `${kind}_${DECIDUOUS_STAGES[stageOf(tree)]}`); },
        sway: () => animationOf(tree)?.start(rest(tree)), spawnLeafFx: () => spawnLeaves(tree),
      }, random);
      growable.loopstages = true; growable.springgrowth = true;
      const stage = prefab === 'deciduoustree' ? Math.min(3, Math.floor(random() * 3) + 1) : DECIDUOUS_SPAWN_IDS.indexOf(prefab);
      growable.SetStage(stage); growable.StartGrowing();
      initializeModel(tree);
      tree.leaves.Initialize(saved?.components.deciduoustree);
      if (saved?.components.growable) growable.OnLoad(saved.components.growable);
      tree.timer.OnLoad(saved?.components.deciduousTimer);
      if (world.physics) { tree.body = MakeObstaclePhysics(logical.position, .25); world.physics.addBody(tree.body); }
      workable.SetOnWorkCallback(() => {
        if (!active.has(logical)) return;
        playSound(tree, 'dontstarve/wilson/use_axe_tree');
        spawnLeaves(tree, true);
        playOnce(tree, `chop_${DECIDUOUS_STAGES[stageOf(tree)]}`);
      });
      workable.SetOnFinishCallback(worker => chopDown(tree, worker));
      if (saved?.components.deciduoustree?.stump) makeStump(tree);
      else if (saved?.components.deciduoustree?.burnt) {
        tree.burntcone = saved.components.deciduoustree.burntcone === true;
        burn(tree, true);
      }
      sprite.start(rest(tree));
      if (tree.stump.peek()) sprite.playOnce(rest(tree));
      applyBuild(tree);
      growable.OnEntitySleep();
      tree.stopActivity = watchTileActivity(model, world.tickingarea, awake => setActive(tree, awake));
      return logical;
    },
    get chopTargets() { return targets('CHOP'); },
    getChopTargets(model) { return targets('CHOP', model); },
    get digTargets() { return digTargets(); },
    getDigTargets: digTargets,
    update(dt, quaternion) {
      if (!world.scheduler) scheduler.advance(dt);
      fireFx.update(dt, quaternion);
      for (const logical of active) {
        const sprite = logical.model.userData.animationController as ArchiveSprite;
        sprite.faceCamera(quaternion); sprite.update(dt);
      }
      for (const model of [...effects.keys()]) {
        model.quaternion.copy(quaternion); (model.userData.animationController as SpriteAnimationController).update(dt);
      }
    },
    get renderEntities() {
      return [...Array.from(active, logical => ({ object: logical.model, footPosition: logical.position, cameraDepth: 0 })),
        ...Array.from(effects, ([object, fx]) => ({ object, footPosition: fx.position, cameraDepth: 0 })), ...fireFx.renderEntities];
    },
    exportRecords: () => [...trees.values()].map(tree => {
      // onsave: a burning tree is saved as burnt; a burning stump is still a stump.
      const burnt = !tree.stump.peek() && (tree.inst.hasTag('burnt') || tree.fire?.burnable.IsBurning() === true);
      const timer = tree.timer.OnSave();
      const { stump: _stump, leaveschangetime: _change, ...leaves } = tree.leaves.OnSave();
      return { id: tree.logical.saveId!,
        transform: { position: tree.logical.position.toArray(), rotationY: 0 }, components: { ...(timer ? { deciduousTimer: timer } : {}), ...(burnt ? {
          deciduoustree: { ...leaves, burnt: true as const, ...(tree.burntcone ? { burntcone: true as const } : {}) },
          growable: { stage: tree.growable.GetStage() },
        } : { deciduoustree: tree.leaves.OnSave(), growable: tree.growable.OnSave() }) } };
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const tree of [...trees.values()]) remove(tree);
      for (const [model, fx] of effects) fx.factory.disposeSprite(model);
      effects.clear(); group.removeFromParent(); assets.dispose(); fireFx.dispose();
      for (const fx of leafFx) fx.dispose();
      if (!world.scheduler) scheduler.dispose();
    },
  };
}
