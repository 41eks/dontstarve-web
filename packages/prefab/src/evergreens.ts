import { ModelRecords } from './modelRecords';
import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createSignal, readonlySignal, type Signal } from '@dontstarve-web/signals';
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
import { ProximityEntities, type ProximityEntity } from './proximityEntities';
import { actionEntity } from './actionEntity';
import { MakeObstaclePhysics, WORLD_SCALE } from './standardcomponents';
import { newEntityId } from './saveRecord';
import { PlaySound, PreloadSounds, type SoundEventPath, type SoundHandle } from './sound';
import { BurnableBinding, FireFxHost, TREE_BURN_TIME, type BurnEnvironment } from './treeFire';
import type { WorldEventEmitter } from './worldContext';

export const EVERGREEN_SPAWN_IDS = ['evergreen', 'evergreen_short', 'evergreen_normal', 'evergreen_tall'] as const;
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

export interface EvergreenRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { evergreen?: { stump?: true; burnt?: true; burntcone?: true }; growable?: GrowableSave; evergreenTimer?: NamedTimerSave };
}
export interface EvergreenWorld {
  camera: THREE.Camera;
  /** Searched for propagator neighbours; receives fire effects. */
  scene: THREE.Object3D;
  /** DefaultBurntFn: one ash at the burnt inst's position. */
  worldEvents: WorldEventEmitter;
  scheduler?: GameTimeScheduler;
  physics?: CANNON.World;
  growthDuration?(seconds: number): number;
  dropLoot(items: readonly { itemId: string; count: number }[], position: THREE.Vector3): void;
}
interface Tree {
  logical: ProximityEntity;
  inst: ComponentActionEntity & WorkableInst & { getPosition(): THREE.Vector3 };
  removeInst(): void;
  stump: Signal<boolean>;
  growable: Growable;
  timer: Timer;
  workable: Workable;
  lootdropper: LootDropper;
  body?: CANNON.Body;
  sounds: Set<SoundHandle>;
  /** MakeLargeBurnable/MakeMediumPropagator (or the stump's small pair) while the tree is awake. */
  fire?: BurnableBinding;
  burntcone: boolean;
  changesTask?: () => void;
  pineconeTask?: () => void;
  removeTask?: () => void;
}
export interface EvergreenForest {
  group: THREE.Group;
  readonly entities: readonly ProximityEntity[];
  readonly chopTargets: readonly PickaxeTarget[];
  getChopTargets(model?: THREE.Object3D): readonly PickaxeTarget[];
  readonly digTargets: readonly ShovelTarget[];
  getDigTargets(model?: THREE.Object3D): readonly ShovelTarget[];
  readonly renderEntities: readonly { object: THREE.Group; footPosition: THREE.Vector3; cameraDepth: number }[];
  spawn(prefab: EvergreenSpawnId, position: THREE.Vector3, saved?: EvergreenRecord): ProximityEntity;
  updateNearby(playerPosition: THREE.Vector3): void;
  update(dt: number, quaternion: THREE.Quaternion): void;
  exportRecords(): EvergreenRecord[];
  dispose(): void;
}

/** evergreens.lua's normal build. Growth/work belong to logical trees, independently of loaded art. */
export async function createEvergreenForest(assetBaseUrl: string, world: EvergreenWorld,
  random = Math.random, loadRadius = 120): Promise<EvergreenForest> {
  const assets = new ArchiveSpriteAssets('evergreen', assetBaseUrl);
  const [createTree, needles, fireFx] = await Promise.all([
    // evergreens.lua builds.normal: one bank for every stage; clips are split across two anim archives.
    preloadSharedArchiveSprite(assets, { animationArchive: 'evergreen_short_normal.zip', extraAnimationArchives: ['evergreen_tall_old.zip'],
      buildArchives: ['evergreen_new.zip'], bank: 'evergreen_short' },
    { scale: .02, staticBillboard: true, instancedAnimations: EVERGREEN_STAGES.flatMap(stage =>
      [`sway1_loop_${stage}`, `stump_${stage}`, `burnt_${stage}`, 'idle_old']) }),
    createAnimatedSpriteFactory(assetBaseUrl, 'pine_needles.zip'),
    FireFxHost.load(assetBaseUrl),
    PreloadSounds('dontstarve/wilson/use_axe_tree', 'dontstarve/forest/treeFall', 'dontstarve/forest/treeCrumble',
      'dontstarve/forest/treeGrow', 'dontstarve/forest/treeGrowFromWilt', 'dontstarve/forest/treeWilt'),
  ]);
  const scheduler = world.scheduler ?? new GameTimeScheduler();
  const trees = new Map<ProximityEntity, Tree>();
  const mouseRecords = new ModelRecords<ProximityEntity>();
  const effects = new Map<THREE.Group, THREE.Vector3>();
  const lastPlayerPosition = new THREE.Vector3();
  let disposed = false;
  const stageOf = (tree: Tree) => tree.growable.GetStage() - 1;
  // evergreens.lua old_anims: burnt/chop_burnt reuse the tall clips.
  const burntStage = (tree: Tree) => EVERGREEN_STAGES[Math.min(stageOf(tree), 2)];
  const rest = (tree: Tree) => tree.stump.peek() ? `stump_${EVERGREEN_STAGES[stageOf(tree)]}`
    : tree.inst.hasTag('burnt') ? `burnt_${burntStage(tree)}`
    : stageOf(tree) === 3 ? 'idle_old' : `sway1_loop_${EVERGREEN_STAGES[stageOf(tree)]}`;
  const env: BurnEnvironment = { scheduler, root: world.scene, fire: fireFx };
  const animationOf = (tree: Tree) => tree.logical.model?.userData.animationController as ArchiveSprite | undefined;
  const playSound = (tree: Tree, path: SoundEventPath) => {
    for (const sound of tree.sounds) if (sound.isPlaying?.() === false) tree.sounds.delete(sound);
    tree.sounds.add(PlaySound(path, tree.logical.position));
  };
  const setStage = (tree: Tree) => {
    tree.workable.SetWorkLeft(EVERGREEN_CHOPS[stageOf(tree)]);
    tree.lootdropper.SetLoot(LOOT[stageOf(tree)].flatMap(({ itemId, count }) => Array.from({ length: count }, () => itemId)));
    if (stageOf(tree) === 3) tree.inst.removeTag('shelter'); else tree.inst.addTag('shelter');
    animationOf(tree)?.start(rest(tree));
  };
  const grow = (tree: Tree) => {
    if (!tree.logical.model) return;
    const stage = stageOf(tree);
    playSound(tree, stage === 3 ? 'dontstarve/forest/treeWilt'
      : stage === 0 ? 'dontstarve/forest/treeGrowFromWilt' : 'dontstarve/forest/treeGrow');
    animationOf(tree)!.playOnce(['grow_old_to_short', 'grow_short_to_normal', 'grow_normal_to_tall', 'grow_tall_to_old'][stage],
      () => animationOf(tree)?.start(rest(tree)));
  };
  const unbindFire = (tree: Tree) => { tree.fire?.dispose(); tree.fire = undefined; };
  /** OnEntityWake: MakeLargeBurnable + MakeMediumPropagator, or the stump's small pair, unless burnt. */
  const bindFire = (tree: Tree) => {
    if (disposed || tree.fire || tree.inst.hasTag('burnt') || tree.inst.isRemoved) return;
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
    tree.growable.StopGrowing();
    tree.inst.removeTag('shelter');
    tree.lootdropper.SetLoot([]); tree.lootdropper.SetChanceLootTable('evergreen_burnt');
    if (tree.inst.components.workable === tree.workable) {
      tree.workable.SetWorkLeft(1);
      tree.workable.SetOnWorkCallback(() => {});
      tree.workable.SetOnFinishCallback(() => chopDownBurnt(tree));
    }
  };
  /** OnBurnt: the burnt pose and tag at once; the component changes follow after .5 seconds. */
  const burn = (tree: Tree, immediate: boolean) => {
    if (tree.inst.hasTag('burnt')) return;
    tree.inst.addTag('burnt');
    animationOf(tree)?.start(rest(tree));
    if (immediate) burntChanges(tree);
    else tree.changesTask = scheduler.schedule(.5, () => { tree.changesTask = undefined; burntChanges(tree); });
  };
  /** onpineconetask: the 10% pinecone lands one unit away from the burnt tree, once. */
  const startPineconeTask = (tree: Tree) => {
    if (tree.burntcone || tree.pineconeTask) return;
    tree.pineconeTask = scheduler.schedule(10, () => {
      tree.pineconeTask = undefined;
      const angle = random() * Math.PI * 2;
      const position = tree.logical.position.clone().add(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(WORLD_SCALE));
      const loot = new Map<string, number>();
      for (const itemId of tree.lootdropper.GenerateLoot(random)) loot.set(itemId, (loot.get(itemId) ?? 0) + 1);
      if (loot.size) world.dropLoot([...loot].map(([itemId, count]) => ({ itemId, count })), position);
      tree.burntcone = true;
    });
  };
  const treeBurnt = (tree: Tree) => {
    burn(tree, false);
    startPineconeTask(tree);
  };
  /** chop_down_burnt_tree: charcoal and the chance loot, then removal when the clip ends. */
  const chopDownBurnt = (tree: Tree) => {
    tree.workable.dispose(); delete tree.inst.components.workable;
    playSound(tree, 'dontstarve/forest/treeCrumble');
    playSound(tree, 'dontstarve/wilson/use_axe_tree');
    if (tree.body) { world.physics?.removeBody(tree.body); tree.body = undefined; }
    tree.lootdropper.SpawnLootPrefab('charcoal');
    tree.lootdropper.DropLoot();
    tree.pineconeTask?.(); tree.pineconeTask = undefined;
    const animation = animationOf(tree);
    if (animation) animation.playOnce(`chop_burnt_${burntStage(tree)}`, () => remove(tree));
    else remove(tree);
  };
  const remove = (tree: Tree) => {
    tree.changesTask?.(); tree.pineconeTask?.(); tree.removeTask?.();
    unbindFire(tree);
    tree.removeInst(); tree.workable.dispose(); tree.growable.dispose(); tree.timer.dispose();
    if (tree.body) world.physics?.removeBody(tree.body);
    for (const sound of tree.sounds) sound.stop(); tree.sounds.clear();
    nearby.remove(tree.logical); trees.delete(tree.logical);
  };
  const makeStump = (tree: Tree) => {
    unbindFire(tree);
    tree.stump.set(true); tree.growable.StopGrowing();
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
    if (tree.logical.model) bindFire(tree);
  };
  const spawnNeedles = (tree: Tree) => {
    const fx = needles.create({ initialAnimation: 'chop', name: 'pine_needles_chop' });
    fx.position.copy(tree.logical.position); fx.position.y += random() * 2 * WORLD_SCALE;
    fx.quaternion.copy(world.camera.getWorldQuaternion(new THREE.Quaternion()));
    fx.userData.tags = ['FX', 'NOCLICK']; effects.set(fx, tree.logical.position); nearby.group.add(fx);
    (fx.userData.animationController as SpriteAnimationController).playOnce('chop', () => {
      effects.delete(fx); needles.disposeSprite(fx);
    });
  };
  const chopDown = (tree: Tree, worker: Worker) => {
    playSound(tree, 'dontstarve/forest/treeFall');
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(world.camera.getWorldQuaternion(new THREE.Quaternion()));
    const workerPosition = worker.getPosition?.();
    const onRight = workerPosition ? workerPosition.clone().sub(tree.logical.position).dot(right) > 0 : random() <= .5;
    const loot = new Map<string, number>();
    for (const itemId of tree.lootdropper.GenerateLoot()) loot.set(itemId, (loot.get(itemId) ?? 0) + 1);
    world.dropLoot([...loot].map(([itemId, count]) => ({ itemId, count })),
      tree.logical.position.clone().addScaledVector(right, onRight ? -WORLD_SCALE : WORLD_SCALE));
    const clip = stageOf(tree) === 3 ? 'chop_old' : `${onRight ? 'fallleft' : 'fallright'}_${EVERGREEN_STAGES[stageOf(tree)]}`;
    makeStump(tree);
    animationOf(tree)?.playOnce(clip, () => animationOf(tree)?.start(rest(tree)));
  };
  const nearby = new ProximityEntities([], loadRadius, logical => {
    const tree = trees.get(logical)!;
    const sprite = createTree(rest(tree), true, `Evergreen-${logical.saveId}`);
    const model = sprite.model;
    model.userData.animationController = sprite;
    bindFire(tree);
    if (tree.inst.hasTag('burnt')) startPineconeTask(tree);
    Object.assign(model.userData, { entityId: logical.saveId, prefab: 'evergreen', deploySmartRadius: 1,
      physicsRadius: .25 * WORLD_SCALE, components: tree.inst.components,
      evergreenState: { stump: readonlySignal(tree.stump), growth: tree.growable.state } });
    Object.defineProperty(model.userData, 'tags', { get: () => ['plant', 'tree', 'evergreens', 'evergreen',
      'shelter', 'stump', 'burnt', 'fire', 'CHOP_workable', 'DIG_workable'].filter(tag => tree.inst.hasTag(tag)) });
    actionEntity(model, 'evergreen', tree.inst);
    mouseRecords.set(model, logical);
    return model;
  }, model => {
    const tree = [...trees.values()].find(tree => tree.logical.model === model);
    tree?.growable.OnEntitySleep(); model.userData.removed = true;
    if (tree?.fire?.burnable.IsBurning()) {
      // OnEntitySleep: a burning stump finishes as DefaultBurntFn, a burning tree as burnt.
      if (tree.stump.peek()) tree.removeTask = scheduler.schedule(0, () => { tree.removeTask = undefined; burnStump(tree); });
      else burn(tree, true);
    }
    if (tree) unbindFire(tree);
    (model.userData.animationController as ArchiveSprite).dispose();
  }, undefined, { prefab: 'evergreen', smartRadius: 1 });
  nearby.group.name = 'EvergreenForest';
  const targets = (action: 'CHOP' | 'DIG', model?: THREE.Object3D): PickaxeTarget[] => mouseRecords.select(model, nearby.activeEntities).flatMap(logical => {
    const tree = trees.get(logical)!, model = logical.model!;
    const isValid = () => !disposed && !tree.inst.isRemoved && logical.model === model
      && tree.workable.CanBeWorked() && tree.workable.GetWorkAction() === action;
    return isValid() ? [{ id: logical.saveId!, model, position: logical.position,
      entity: actionEntity(model, 'evergreen', tree.inst), isValid }] : [];
  });
  const digTargets = (model?: THREE.Object3D) => targets('DIG', model).map(target => ({ ...target,
    dig: () => target.isValid() && performToolWork('DIG', target.entity, {}),
  }));
  return {
    group: nearby.group,
    get entities() { return nearby.entities; },
    spawn(prefab, position, saved) {
      if (disposed) throw new Error('Evergreen forest has been disposed');
      const logical = nearby.add(position, saved?.id ?? newEntityId());
      const removed = createSignal(false), tags = new Set(['plant', 'tree', 'evergreens', 'evergreen']);
      const components: ComponentActionEntity['components'] & { growable?: Growable; lootdropper?: LootDropper; timer?: Timer } = {};
      const inst: Tree['inst'] = {
        prefab: 'evergreen', removal: readonlySignal(removed), get isRemoved() { return removed.peek(); }, components,
        hasTag: tag => components.workable?.HasTag(tag) ?? tags.has(tag),
        addTag: tag => { tags.add(tag); }, removeTag: tag => { tags.delete(tag); },
        PushEvent: (name, data) => logical.model?.dispatchEvent({ type: name, data } as never),
        getPosition: () => logical.position,
      };
      const workable = new Workable(inst); components.workable = workable;
      const lootdropper = new LootDropper({ getPosition: () => logical.position, PushEvent: inst.PushEvent }, prefab => {
        world.dropLoot([{ itemId: prefab, count: 1 }], logical.position); return undefined;
      });
      components.lootdropper = lootdropper;
      workable.SetWorkAction('CHOP');
      const growable = new Growable(scheduler, EVERGREEN_GROW_TIME.map(time => ({
        time: () => time.base + (random() * 2 - 1) * time.random,
        fn: () => setStage(trees.get(logical)!), growfn: () => grow(trees.get(logical)!),
      })), seconds => world.growthDuration?.(seconds) ?? seconds);
      components.growable = growable;
      const tree: Tree = { logical, inst, removeInst: () => removed.set(true), stump: createSignal(false),
        growable, workable, lootdropper, sounds: new Set(), burntcone: false,
        timer: new Timer(scheduler, name => { if (name === 'decay') remove(tree); }, ['decay']) };
      components.timer = tree.timer;
      trees.set(logical, tree);
      growable.loopstages = true; growable.springgrowth = true;
      const stage = prefab === 'evergreen' ? Math.min(3, Math.floor(random() * 3) + 1) : EVERGREEN_SPAWN_IDS.indexOf(prefab);
      growable.SetStage(stage); growable.StartGrowing();
      if (saved?.components.growable) growable.OnLoad(saved.components.growable);
      tree.timer.OnLoad(saved?.components.evergreenTimer);
      if (world.physics) { tree.body = MakeObstaclePhysics(logical.position, .25); world.physics.addBody(tree.body); }
      workable.SetOnWorkCallback(() => {
        if (!logical.model) return;
        playSound(tree, 'dontstarve/wilson/use_axe_tree');
        if (stageOf(tree) === 3) return;
        animationOf(tree)!.playOnce(`chop_${EVERGREEN_STAGES[stageOf(tree)]}`, () => animationOf(tree)?.start(rest(tree)));
        spawnNeedles(tree);
      });
      workable.SetOnFinishCallback(worker => chopDown(tree, worker));
      if (saved?.components.evergreen?.stump) makeStump(tree);
      else if (saved?.components.evergreen?.burnt) {
        tree.burntcone = saved.components.evergreen.burntcone === true;
        burn(tree, true);
      }
      nearby.update(lastPlayerPosition);
      if (logical.model) growable.OnEntityWake(); else growable.OnEntitySleep();
      return logical;
    },
    get chopTargets() { return targets('CHOP'); },
    getChopTargets(model) { return targets('CHOP', model); },
    get digTargets() { return digTargets(); },
    getDigTargets: digTargets,
    updateNearby(position) {
      lastPlayerPosition.copy(position); nearby.update(position);
      for (const logical of nearby.activeEntities) trees.get(logical)!.growable.OnEntityWake();
    },
    update(dt, quaternion) {
      if (!world.scheduler) scheduler.advance(dt);
      fireFx.update(dt, quaternion);
      for (const logical of nearby.activeEntities) {
        const sprite = logical.model!.userData.animationController as ArchiveSprite;
        sprite.faceCamera(quaternion);
        sprite.update(dt);
      }
      for (const model of [...effects.keys()]) {
        model.quaternion.copy(quaternion); (model.userData.animationController as SpriteAnimationController).update(dt);
      }
    },
    get renderEntities() {
      return [...Array.from(nearby.activeEntities, logical => ({ object: logical.model!, footPosition: logical.position, cameraDepth: 0 })),
        ...Array.from(effects, ([object, footPosition]) => ({ object, footPosition, cameraDepth: 0 })), ...fireFx.renderEntities];
    },
    exportRecords: () => [...trees.values()].map(tree => {
      // onsave: a burning tree is saved as burnt; a burning stump is still a stump.
      const timer = tree.timer.OnSave();
      const burnt = !tree.stump.peek() && (tree.inst.hasTag('burnt') || tree.fire?.burnable.IsBurning() === true);
      return { id: tree.logical.saveId!,
        transform: { position: tree.logical.position.toArray(), rotationY: 0 }, components: {
          ...(tree.stump.peek() ? { evergreen: { stump: true as const } }
            : burnt ? { evergreen: { burnt: true as const, ...(tree.burntcone ? { burntcone: true as const } : {}) } } : {}),
          ...(timer ? { evergreenTimer: timer } : {}),
          growable: burnt ? { stage: tree.growable.GetStage() } : tree.growable.OnSave(),
        } };
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const tree of [...trees.values()]) remove(tree);
      for (const model of effects.keys()) needles.disposeSprite(model);
      effects.clear(); nearby.dispose(); assets.dispose(); needles.dispose(); fireFx.dispose();
      if (!world.scheduler) scheduler.dispose();
    },
  };
}
