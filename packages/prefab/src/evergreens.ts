import { ModelRecords } from './modelRecords';
import type { MiniMapState } from '../../map/src/minimapState';
import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createSignal, readonlySignal, type HandEquipment, type ReadonlySignal, type Signal, type TileStateQuery } from '@dontstarve-web/signals';
import { ArchiveSpriteAssets, preloadSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { createAnimatedSpriteFactory } from '@dontstarve-web/animation/sprite';
import type { PickaxeTarget } from '@dontstarve-web/stategraphs/pickaxe';
import type { ShovelTarget } from '@dontstarve-web/stategraphs/shovel';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { Workable, type Worker } from '../../componets/src/workable';
import { Growable, type GrowableSave } from '../../componets/src/growable';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { Timer, type NamedTimerSave } from '../../componets/src/timer';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { ResidentEntity } from '@dontstarve-web/animation/residentSprite';
import type { ArchiveSpriteCommands, PrefabDisplay } from '@dontstarve-web/display';
import { createArchiveEntity, createPrefabEntity, type PrefabInstance } from './prefabInstance';
import { watchTileActivity } from './tileActivity';
import { registerPlacementTree } from './placementEntities';
import { actionEntity } from './actionEntity';
import { ToolMouseTarget } from './toolMouseTarget';
import { MakeObstaclePhysics, RemovePhysicsColliders, WORLD_SCALE } from './standardcomponents';
import { newEntityId } from './saveRecord';
import { PlaySound, type SoundEventPath, type SoundHandle } from './sound';
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
  handEquipment?: ReadonlySignal<HandEquipment | null>;
  camera: THREE.Camera;
  /** Searched for propagator neighbours; receives fire effects. */
  scene: THREE.Object3D;
  /** DefaultBurntFn: one ash at the burnt inst's position. */
  worldEvents: WorldEventEmitter;
  scheduler?: GameTimeScheduler;
  /** Only visuals are resident while the entity's tile is active. */
  tickingarea: TileStateQuery;
  physics?: CANNON.World;
  growthDuration?(seconds: number): number;
  dropLoot(items: readonly { itemId: string; count: number }[], position: THREE.Vector3): void;
}
interface Tree {
  logical: ResidentEntity;
  instance: PrefabInstance<ArchiveSpriteCommands>;
  display: PrefabDisplay;
  sprite: ArchiveSpriteCommands;
  stopActivity(): void;
  stopPlacement(): void;
  minimap: MiniMapState;
  stump: Signal<boolean>;
  growable: Growable;
  timer: Timer;
  workable: Workable;
  mouseTarget?: ToolMouseTarget;
  lootdropper: LootDropper;
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
  readonly entities: readonly ResidentEntity[];
  readonly chopTargets: readonly PickaxeTarget[];
  getChopTargets(model?: THREE.Object3D): readonly PickaxeTarget[];
  readonly digTargets: readonly ShovelTarget[];
  getDigTargets(model?: THREE.Object3D): readonly ShovelTarget[];
  readonly renderEntities: readonly { object: THREE.Group; footPosition: THREE.Vector3; cameraDepth: number }[];
  spawn(prefab: EvergreenSpawnId, position: THREE.Vector3, saved?: EvergreenRecord): ResidentEntity;
  update(dt: number, quaternion: THREE.Quaternion): void;
  exportRecords(): EvergreenRecord[];
  dispose(): void;
}

/** evergreens.lua's normal build. Growth/work belong to logical trees, independently of loaded art. */
export async function createEvergreenForest(assetBaseUrl: string, world: EvergreenWorld,
  random = Math.random): Promise<EvergreenForest> {
  const assets = new ArchiveSpriteAssets('evergreen', assetBaseUrl);
  const [createTree, needles] = await Promise.all([
    // evergreens.lua builds.normal: one bank for every stage; clips are split across two anim archives.
    preloadSharedArchiveSprite(assets, { animationArchive: 'evergreen_short_normal.zip', extraAnimationArchives: ['evergreen_tall_old.zip'],
      buildArchives: ['evergreen_new.zip'], bank: 'evergreen_short' },
    { scale: .02, staticBillboard: true, instancedAnimations: EVERGREEN_STAGES.flatMap(stage =>
      [`sway1_loop_${stage}`, `stump_${stage}`, `burnt_${stage}`, 'idle_old']) }),
    createAnimatedSpriteFactory(assetBaseUrl, 'pine_needles.zip'),
  ]);
  const fireFx = FireFxHost.create(assetBaseUrl);
  const scheduler = world.scheduler ?? new GameTimeScheduler();
  const group = new THREE.Group(); group.name = 'EvergreenForest';
  const entities: ResidentEntity[] = [];
  const active = new Set<ResidentEntity>();
  let nextId = 0;
  const trees = new Map<ResidentEntity, Tree>();
  const mouseRecords = new ModelRecords<ResidentEntity>();
  const effects = new Map<THREE.Group, { entity: ReturnType<typeof createPrefabEntity>; position: THREE.Vector3 }>();
  let disposed = false;
  const stageOf = (tree: Tree) => tree.growable.GetStage() - 1;
  // evergreens.lua old_anims: burnt/chop_burnt reuse the tall clips.
  const burntStage = (tree: Tree) => EVERGREEN_STAGES[Math.min(stageOf(tree), 2)];
  const rest = (tree: Tree) => tree.stump.peek() ? `stump_${EVERGREEN_STAGES[stageOf(tree)]}`
    : tree.instance.hasTag('burnt') ? `burnt_${burntStage(tree)}`
    : stageOf(tree) === 3 ? 'idle_old' : `sway1_loop_${EVERGREEN_STAGES[stageOf(tree)]}`;
  const env: BurnEnvironment = { scheduler, fire: fireFx };
  const animationOf = (tree: Tree) => tree.sprite;
  const playSound = (tree: Tree, path: SoundEventPath) => {
    for (const sound of tree.sounds) if (sound.isPlaying?.() === false) tree.sounds.delete(sound);
    tree.sounds.add(PlaySound(path, tree.logical.position));
  };
  const setStage = (tree: Tree) => {
    tree.workable.SetWorkLeft(EVERGREEN_CHOPS[stageOf(tree)]);
    tree.lootdropper.SetLoot(LOOT[stageOf(tree)].flatMap(({ itemId, count }) => Array.from({ length: count }, () => itemId)));
    if (stageOf(tree) === 3) tree.instance.removeTag('shelter'); else tree.instance.addTag('shelter');
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
    const stage = stageOf(tree);
    playSound(tree, stage === 3 ? 'dontstarve/forest/treeWilt'
      : stage === 0 ? 'dontstarve/forest/treeGrowFromWilt' : 'dontstarve/forest/treeGrow');
    animationOf(tree)!.playOnce(['grow_old_to_short', 'grow_short_to_normal', 'grow_normal_to_tall', 'grow_tall_to_old'][stage],
      () => animationOf(tree)?.start(rest(tree)));
  };
  const unbindFire = (tree: Tree) => { tree.fire?.dispose(); tree.fire = undefined; };
  /** OnEntityWake: MakeLargeBurnable + MakeMediumPropagator, or the stump's small pair, unless burnt. */
  const bindFire = (tree: Tree) => {
    if (disposed || !active.has(tree.logical) || tree.fire || tree.instance.hasTag('burnt') || tree.instance.isRemoved) return;
    tree.fire = new BurnableBinding(tree.instance, tree.stump.peek()
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
    tree.instance.removeTag('shelter'); tree.instance.removeTag('petrifiable');
    tree.lootdropper.SetLoot([]); tree.lootdropper.SetChanceLootTable('evergreen_burnt');
    if (tree.instance.components.workable === tree.workable) {
      tree.workable.SetWorkLeft(1);
      tree.workable.SetOnWorkCallback(() => {});
      tree.workable.SetOnFinishCallback(() => chopDownBurnt(tree));
    }
  };
  /** OnBurnt: the burnt pose and tag at once; the component changes follow after .5 seconds. */
  const burn = (tree: Tree, immediate: boolean) => {
    if (tree.instance.hasTag('burnt')) return;
    tree.instance.addTag('burnt');
    tree.minimap.SetIcon('evergreen_burnt.png');
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
    tree.workable.dispose(); delete tree.instance.components.workable;
    playSound(tree, 'dontstarve/forest/treeCrumble');
    playSound(tree, 'dontstarve/wilson/use_axe_tree');
    RemovePhysicsColliders(tree.instance);
    tree.lootdropper.SpawnLootPrefab('charcoal');
    tree.lootdropper.DropLoot();
    tree.pineconeTask?.(); tree.pineconeTask = undefined;
    tree.sprite.playOnce(`chop_burnt_${burntStage(tree)}`, () => remove(tree));
  };
  const remove = (tree: Tree) => {
    if (!trees.delete(tree.logical)) return;
    active.delete(tree.logical);
    entities.splice(entities.indexOf(tree.logical), 1);
    tree.stopActivity(); tree.stopPlacement();
    tree.logical.model.userData.removed = true;
    tree.changesTask?.(); tree.pineconeTask?.(); tree.removeTask?.();
    unbindFire(tree);

    tree.workable.dispose(); tree.growable.dispose(); tree.timer.dispose();
    for (const sound of tree.sounds) sound.stop(); tree.sounds.clear();
    tree.instance.remove();
  };
  const makeStump = (tree: Tree) => {
    unbindFire(tree);
    tree.minimap.SetIcon('evergreen_stump.png');
    tree.stump.set(true); tree.growable.StopGrowing();
    tree.instance.removeTag('shelter'); tree.instance.addTag('stump');
    RemovePhysicsColliders(tree.instance);
    tree.workable.dispose();
    tree.workable = new Workable(tree.instance);
    tree.instance.components.workable = tree.workable;
    tree.workable.SetWorkAction('DIG'); tree.workable.SetWorkLeft(1);
    tree.mouseTarget?.setWorkable(tree.workable);
    tree.workable.SetOnFinishCallback(() => {
      tree.lootdropper.SpawnLootPrefab('log');
      remove(tree);
    });
    if (active.has(tree.logical)) bindFire(tree);
  };
  const spawnNeedles = (tree: Tree) => {
    const entity = createPrefabEntity('pine_needles_chop', { create: animation => needles.create({ initialAnimation: animation, name: 'pine_needles_chop' }),
      release: drawn => needles.disposeSprite(drawn) }, { name: 'chop', billboard: true }, 'pine_needles_chop');
    const fx = entity.display.model; entity.instance.persists = false;
    fx.position.copy(tree.logical.position); fx.position.y += random() * 2 * WORLD_SCALE;
    entity.instance.addTag('FX'); effects.set(fx, { entity, position: tree.logical.position }); group.add(fx);
    entity.instance.sprite.playOnce('chop', () => {
      effects.delete(fx); entity.instance.remove();
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
  const initializeModel = (tree: Tree) => {
    const model = tree.logical.model;

    Object.assign(model.userData, { deploySmartRadius: 1,
      components: tree.instance.components,
      evergreenState: { stump: readonlySignal(tree.stump), growth: tree.growable.state } });
    model.userData.placementLogical = true;
    const entity = actionEntity(model, 'evergreen');
    tree.mouseTarget = new ToolMouseTarget(entity, tree.instance, tree.workable, world.handEquipment);
    mouseRecords.set(model, tree.logical);
  };
  const setActive = (tree: Tree, awake: boolean) => {
    const { logical, instance } = tree;
    if (!trees.has(logical)) return;
    if (active.has(logical) === awake) { instance.setActive(awake); return; }
    if (awake) {
      active.add(logical);
      wakeGrowable(tree);
      bindFire(tree);
      if (tree.instance.hasTag('burnt')) startPineconeTask(tree);
      instance.setActive(true);
    } else {
      active.delete(logical);
      tree.growable.OnEntitySleep();
      if (tree.fire?.burnable.IsBurning()) {
        if (tree.stump.peek()) tree.removeTask = scheduler.schedule(0, () => { tree.removeTask = undefined; burnStump(tree); });
        else burn(tree, true);
      }
      unbindFire(tree);
      instance.setActive(false);
    }
  };
  const targets = (action: 'CHOP' | 'DIG', model?: THREE.Object3D): PickaxeTarget[] => mouseRecords.select(model, active).flatMap(logical => {
    const tree = trees.get(logical)!, model = logical.model;
    const isValid = () => !disposed && active.has(logical) && !tree.instance.isRemoved && logical.model === model
      && tree.workable.CanBeWorked() && tree.workable.GetWorkAction() === action;
    return isValid() ? [{ id: logical.saveId!, model, position: logical.position,
      entity: actionEntity(model, 'evergreen'), isValid }] : [];
  });
  const digTargets = (model?: THREE.Object3D) => targets('DIG', model).map(target => ({ ...target,
    dig: () => target.isValid() && performToolWork('DIG', target.entity, {}),
  }));
  return {
    group,
    get entities() { return entities; },
    spawn(prefab, position, saved) {
      if (disposed) throw new Error('Evergreen forest has been disposed');
      const saveId = saved?.id ?? newEntityId();
      if (entities.some(entity => entity.saveId === saveId)) throw new Error(`Duplicate entity ID: ${saveId}`);
      const { instance, display } = createArchiveEntity('evergreen', { create: clip => createTree(clip.name, clip.loop, `Evergreen-${saveId}`) },
        { name: 'sway1_loop_short', billboard: true }, `Evergreen-${saveId}`, instance => instance.setActive(false));
      instance.entityId = saveId;
      const sprite = instance.sprite, model = display.model;
      instance.position.copy(position);
      const logical: ResidentEntity = { id: nextId++, saveId, model, position: model.position };
      entities.push(logical);
      const minimap = instance.minimap;
      minimap.SetIcon('evergreen.png'); minimap.SetPriority(-1);
      for (const tag of ['plant', 'tree', 'evergreens', 'evergreen', 'petrifiable', 'SnowCovered']) instance.addTag(tag);
      // The tree's components are its entity's: hasTag asks them first, as workable reports CHOP_workable.
      const components = instance.components;
      const workable = new Workable(instance); components.workable = workable;
      const lootdropper = new LootDropper({ getPosition: () => logical.position, PushEvent: (name, data) => instance.PushEvent(name, data) }, prefab => {
        world.dropLoot([{ itemId: prefab, count: 1 }], logical.position); return undefined;
      });
      components.lootdropper = lootdropper;
      workable.SetWorkAction('CHOP');
      const growable = new Growable(scheduler, EVERGREEN_GROW_TIME.map(time => ({
        time: () => time.base + (random() * 2 - 1) * time.random,
        fn: () => setStage(trees.get(logical)!), growfn: () => grow(trees.get(logical)!),
      })), seconds => world.growthDuration?.(seconds) ?? seconds);
      components.growable = growable;
      const tree: Tree = { logical, instance, display, sprite, stopActivity() {}, stopPlacement() {}, minimap, stump: createSignal(false),
        growable, workable, lootdropper, sounds: new Set(), burntcone: false,
        timer: new Timer(scheduler, name => { if (name === 'decay') remove(tree); }, ['decay']) };
      components.timer = tree.timer;
      trees.set(logical, tree);
      initializeModel(tree);
      tree.stopPlacement = registerPlacementTree(group, logical, 'evergreen', 1);
      group.add(model);
      growable.loopstages = true; growable.springgrowth = true;
      const stage = prefab === 'evergreen' ? Math.min(3, Math.floor(random() * 3) + 1) : EVERGREEN_SPAWN_IDS.indexOf(prefab);
      growable.SetStage(stage); growable.StartGrowing();
      if (saved?.components.growable) growable.OnLoad(saved.components.growable);
      tree.timer.OnLoad(saved?.components.evergreenTimer);
      MakeObstaclePhysics(instance, .25);
      if (world.physics) instance.bindPhysics(world.physics);
      workable.SetOnWorkCallback(() => {
        if (!active.has(logical)) return;
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
      sprite.start(rest(tree));
      growable.OnEntitySleep();
      tree.stopActivity = watchTileActivity(model, world.tickingarea, awake => setActive(tree, awake));
      return logical;
    },
    get chopTargets() { return targets('CHOP'); },
    getChopTargets(model) { return targets('CHOP', model); },
    get digTargets() { return digTargets(); },
    getDigTargets: digTargets,
    update(dt, _quaternion) {
      if (!world.scheduler) scheduler.advance(dt);
      for (const logical of active) {
        const { sprite, fire } = trees.get(logical)!;
        sprite.update(dt);
        fire?.update(dt);
      }
      for (const { entity } of [...effects.values()]) {
        entity.instance.sprite.update(dt);
      }
    },
    get renderEntities() {
      return [...Array.from(active, logical => ({ object: logical.model, footPosition: logical.position, cameraDepth: 0 })),
        ...Array.from(effects, ([object, { position }]) => ({ object, footPosition: position, cameraDepth: 0 })),
        ...Array.from(active, logical => trees.get(logical)!.display.fxRenderEntries).flat()];
    },
    exportRecords: () => [...trees.values()].map(tree => {
      // onsave: a burning tree is saved as burnt; a burning stump is still a stump.
      const timer = tree.timer.OnSave();
      const burnt = !tree.stump.peek() && (tree.instance.hasTag('burnt') || tree.fire?.burnable.IsBurning() === true);
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
      for (const { entity } of effects.values()) entity.instance.remove();
      effects.clear(); group.removeFromParent(); assets.dispose(); needles.dispose(); fireFx.dispose();
      if (!world.scheduler) scheduler.dispose();
    },
  };
}
