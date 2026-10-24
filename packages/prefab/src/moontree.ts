import * as THREE from 'three';
import {
  createAnimatedSpriteFactory,
  loadBuildOverride,
  type SpriteController,
  type SpriteAnimationController,
} from '@dontstarve-web/animation/sprite';
import type { PickaxeTarget } from '@dontstarve-web/stategraphs/pickaxe';
import type { ShovelTarget } from '@dontstarve-web/stategraphs/shovel';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { Workable, type Worker } from '../../componets/src/workable';
import { actionEntity } from './actionEntity';
import catalog from './groundItems.json' with { type: 'json' };
import { ProximityEntities, type ProximityEntity } from './proximityEntities';
import { PlaySound } from './sound';
import { TILE_SIZE } from './tile';
import definitions from './definitions.json' with { type: 'json' };
import { Growable, type GrowableSave } from '../../componets/src/growable';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Timer, type NamedTimerSave } from '../../componets/src/timer';
import { newEntityId } from './saveRecord';
import { PreloadSounds, type SoundHandle } from './sound';
import { BurnableBinding, FireFxHost, TREE_BURN_TIME, type BurnEnvironment, type BurnSpec } from './treeFire';
import { getBoundWatchWorldContent, type GetWatchWorldContent, type ReadonlySignal, type SeasonState } from '@dontstarve-web/signals';
import type { WorldEventEmitter } from './worldContext';

/** tuning.lua MOON_TREE_CHOPS_TALL: the forest's trees are the tall stage. */
export const MOON_TREE_CHOPS_TALL = 16;
export const MOON_TREE_SIZES = ['short', 'normal', 'tall'] as const;
export type MoonTreeSize = typeof MOON_TREE_SIZES[number];
export const MOON_TREE_CHOPS = [8, 12, 16] as const;
// tuning.lua day_time = 10 * 30 seconds, distinct from total_day_time = 480.
export const MOON_TREE_GROWTH_TIME = [{ base: 450, random: 150 }, { base: 1500, random: 600 }, { base: 1500, random: 600 }] as const;
export const MOONBUTTERFLY_SAPLING_GROW_TIME = { base: 225, random: 75 };
export const MOON_TREE_SPAWN_IDS = ['moon_tree', 'moon_tree_short', 'moon_tree_normal', 'moon_tree_tall'] as const;
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

/** What the forest needs from the running game once a scene exists. */
export interface MoonTreeWorld {
  readonly camera: THREE.Camera;
  readonly scheduler?: GameTimeScheduler;
  /** Searched for propagator neighbours; receives fire effects. */
  readonly scene: THREE.Object3D;
  readonly season?: ReadonlySignal<SeasonState>;
  /** DefaultBurntFn: one ash at the burnt inst's position. */
  worldEvents: WorldEventEmitter;
  growthDuration?(seconds: number): number;
  dropLoot(items: readonly { itemId: string; count: number }[], position: THREE.Vector3): void;
}

/** moontree.lua OnSave keeps the stump flag; workable progress is not saved. */
export interface MoonTreeSaveState { stump?: true; burnt?: true; size?: MoonTreeSize }
export interface MoonTreeComponents { moonTree?: MoonTreeSaveState; growable?: GrowableSave }
export interface MoonTreeSaplingRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { saplingTimer: NamedTimerSave };
}

interface TreeState { stump: boolean; burnt: boolean; workLeft: number; growable: Growable; changesTask?: () => void; removeTask?: () => void }

interface TreeController {
  readonly entity: ProximityEntity;
  readonly model: THREE.Group;
  readonly inst: ReturnType<typeof actionEntity>;
  workable?: Workable;
  /** MakeXBurnable + MakeXPropagator while the tree is awake. */
  burn?: BurnableBinding;
}

export interface MoonTreeForestOptions {
  animationName?: string;
  areaSize?: number;
  count?: number;
  exclusionRadiusSquared?: number;
  /** Ground distance in world units; defaults to ten tiles. */
  loadRadius?: number;
  /** Explicit ground positions; takes precedence over random generation options. */
  positions?: readonly THREE.Vector3[];
  entityIds?: readonly string[];
  random?: () => number;
  scale?: number;
}

export interface MoonTreeForest {
  group: THREE.Group;
  positions: readonly THREE.Vector3[];
  entities: readonly ProximityEntity[];
  readonly activeEntities: ReadonlySet<ProximityEntity>;
  setNormals(cameraWorldQuaternion: THREE.Quaternion): void;
  updateNearby(playerPosition: THREE.Vector3): void;
  update(dt: number): void;
  dispose(): void;
  /** Binds the loot sink and camera used by tree work; returns the matching release. */
  bindWorld(world: MoonTreeWorld): () => void;
  /** CHOP_workable trees among the loaded models, with their ground-contact points. */
  readonly chopTargets: readonly PickaxeTarget[];
  /** DIG_workable stumps among the loaded models. */
  readonly digTargets: readonly ShovelTarget[];
  /** Loaded trees plus their transient chop effects, for whole-entity depth ordering. */
  readonly renderEntities: readonly { object: THREE.Group; footPosition: THREE.Vector3; cameraDepth: number }[];
  restoreState(saveId: string, state: MoonTreeSaveState | undefined, growth?: GrowableSave): void;
  exportState(entity: ProximityEntity): MoonTreeComponents;
  spawnTree(prefab: typeof MOON_TREE_SPAWN_IDS[number], position: THREE.Vector3, id?: string, fromSeed?: boolean): ProximityEntity;
  spawnSapling(position: THREE.Vector3, saved?: MoonTreeSaplingRecord): THREE.Group;
  deploySapling(position: THREE.Vector3, take: () => boolean): boolean;
  exportSaplings(): MoonTreeSaplingRecord[];
  readonly saplingPositions: readonly THREE.Vector3[];
  createSaplingPreview(): THREE.Group;
  disposeSaplingPreview(model: THREE.Group): void;
}

export async function createMoonTreeForest(
  assetBaseUrl: string,
  options: MoonTreeForestOptions = {},
): Promise<MoonTreeForest> {
  const count = options.count ?? 500;
  const areaSize = options.areaSize ?? 1000;
  const exclusionRadiusSquared = options.exclusionRadiusSquared ?? 600;
  const random = options.random ?? Math.random;
  const scale = options.scale ?? definitions.moonTree.scale;
  const [factory, fxFactory, saplingFactory, fireFx, snow] = await Promise.all([
    createAnimatedSpriteFactory(assetBaseUrl, definitions.moonTree.archive),
    createAnimatedSpriteFactory(assetBaseUrl, 'tree_petal_fx.zip'),
    createAnimatedSpriteFactory(assetBaseUrl, 'baby_moon_tree.zip'),
    FireFxHost.load(assetBaseUrl),
    loadBuildOverride(assetBaseUrl, 'snow.zip'),
    PreloadSounds('dontstarve/wilson/plant_tree', 'dontstarve/forest/treeCrumble', 'dontstarve/wilson/use_axe_tree', 'dontstarve/forest/treeGrow', 'dontstarve/forest/treeGrowFromWilt'),
  ]);
  const positions = options.positions?.map((position) => position.clone())
    ?? Array.from({ length: count }, () => {
      while (true) {
        const x = random() * areaSize - areaSize / 2;
        const z = random() * areaSize - areaSize / 2;
        if (x * x + z * z > exclusionRadiusSquared) return new THREE.Vector3(x, 0, z);
      }
    });
  const unit = TILE_SIZE / 4;
  const states = new Map<ProximityEntity, TreeState>();
  const controllers = new Map<THREE.Group, TreeController>();
  const effects = new Set<THREE.Group>();
  const saplings = new Map<THREE.Group, { timer: Timer; workable: Workable }>();
  const sounds = new Set<SoundHandle>();
  const sound = (path: Parameters<typeof PlaySound>[0], position: THREE.Vector3) => {
    for (const handle of sounds) if (!handle.isPlaying?.()) sounds.delete(handle);
    sounds.add(PlaySound(path, position));
  };
  let scheduler = new GameTimeScheduler();
  let ownsScheduler = true;
  const lastPlayerPosition = new THREE.Vector3();
  let world: MoonTreeWorld | undefined;
  let getWatchWorldContent: GetWatchWorldContent | undefined;
  const lastQuaternion = new THREE.Quaternion();
  const env = (): BurnEnvironment => ({ scheduler, root: world!.scene, fire: fireFx });
  const standingAnimation = options.animationName ?? definitions.moonTree.animationName;
  const sizeOf = (state: TreeState): MoonTreeSize => MOON_TREE_SIZES[state.growable.GetStage() - 1];
  const playGrowth = (entity: ProximityEntity, clip: string, wilt = false) => {
    if (!entity.model) return;
    const animation = entity.model.userData.animationController as SpriteAnimationController;
    sound(wilt ? 'dontstarve/forest/treeGrowFromWilt' : 'dontstarve/forest/treeGrow', entity.position);
    animation.playOnce(clip, () => animation.start(`sway1_loop_${sizeOf(stateOf(entity))}`));
  };
  const stateOf = (entity: ProximityEntity, stage = 3): TreeState => {
    let state = states.get(entity);
    if (!state) {
      const growable = new Growable(scheduler, MOON_TREE_SIZES.map((size, index) => ({
        time: () => MOON_TREE_GROWTH_TIME[index].base + (random() * 2 - 1) * MOON_TREE_GROWTH_TIME[index].random,
        fn: () => {
          const current = states.get(entity)!;
          current.workLeft = MOON_TREE_CHOPS[index];
          const controller = entity.model && controllers.get(entity.model);
          if (controller && !current.stump && !current.burnt) {
            controller.workable?.SetWorkLeft(current.workLeft);
            (controller.model.userData.animationController as SpriteAnimationController).start(`sway1_loop_${size}`);
            refreshFire(controller);
          }
        },
        growfn: () => playGrowth(entity, ['grow_tall_to_short', 'grow_short_to_normal', 'grow_normal_to_tall'][index], index === 0),
      })), seconds => world?.growthDuration?.(seconds) ?? seconds);
      states.set(entity, state = { stump: false, burnt: false, workLeft: MOON_TREE_CHOPS[stage - 1], growable });
      growable.loopstages = true; growable.springgrowth = true;
      growable.SetStage(stage); growable.StartGrowing();
      if (!entity.model) growable.OnEntitySleep();
    }
    return state;
  };
  const cameraRight = () => {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(world!.camera.getWorldQuaternion(new THREE.Quaternion()));
    return right.setY(0).normalize();
  };

  /** set_short/normal/tall_burnable (MakeSmall/MediumPropagator values) and make_stump_burnable (MakeMediumPropagator). */
  const burnSpec = (entity: ProximityEntity, state: TreeState): BurnSpec => {
    const size = sizeOf(state);
    if (state.stump) {
      return { propagator: 'medium', burnTime: size === 'short' ? 10 : size === 'normal' ? 20 : 30,
        fxLevel: size === 'short' ? 2 : size === 'normal' ? 3 : 5, onBurnt: () => burnStump(entity) };
    }
    return size === 'tall'
      ? { propagator: 'medium', propagatorValues: { propagaterange: 7, heatoutput: 8.5 }, burnTime: TREE_BURN_TIME * 1.5, fxLevel: 5, onBurnt: () => burn(entity, false) }
      : { propagator: 'small', propagatorValues: { propagaterange: 5, heatoutput: 5 }, burnTime: size === 'short' ? TREE_BURN_TIME / 2 : TREE_BURN_TIME,
        fxLevel: size === 'short' ? 2 : 3, onBurnt: () => burn(entity, false) };
  };
  const bindFire = (controller: TreeController) => {
    const state = stateOf(controller.entity);
    if (!world || controller.burn || state.burnt) return;
    controller.burn = new BurnableBinding(controller.inst, burnSpec(controller.entity, state), env());
  };
  const unbindFire = (controller: TreeController) => { controller.burn?.dispose(); controller.burn = undefined; };
  /** A stage change reconfigures the burnable in place, unless it is already burning. */
  const refreshFire = (controller: TreeController) => {
    if (controller.burn?.burnable.IsBurning()) return;
    unbindFire(controller); bindFire(controller);
  };
  /** DefaultBurntFn on a stump: one ash, then the inst is removed. */
  const burnStump = (entity: ProximityEntity) => {
    world?.worldEvents.emit('spawnAsh', entity.position.clone());
    removeTree(entity);
  };
  const removeTree = (entity: ProximityEntity) => {
    const state = states.get(entity);
    if (!state) return;
    state.changesTask?.(); state.removeTask?.();
    if (entity.model) { const controller = controllers.get(entity.model); if (controller) unbindFire(controller); }
    state.growable.dispose();
    nearby.remove(entity);
    states.delete(entity);
  };
  /** burnt_changes on a loaded model: no burnable, shelter or growth; one chop for charcoal. */
  const configureBurnt = (controller: TreeController) => {
    unbindFire(controller);
    controller.inst.removeTag('shelter');
    controller.workable?.SetWorkLeft(1);
    controller.workable?.SetOnWorkCallback(() => {});
    controller.workable?.SetOnFinishCallback(() => chopDownBurnt(controller.entity));
  };
  /** on_moon_tree_burnt_immediate_helper: burnt pose and tag at once; component changes follow after .5 seconds. */
  const burn = (entity: ProximityEntity, immediate: boolean) => {
    const state = stateOf(entity);
    if (state.burnt) return;
    state.burnt = true;
    const controller = entity.model && controllers.get(entity.model);
    controller?.inst.addTag('burnt');
    (controller?.model.userData.animationController as SpriteAnimationController | undefined)?.start(`burnt_${sizeOf(state)}`);
    const changes = () => {
      state.growable.StopGrowing();
      const current = entity.model && controllers.get(entity.model);
      if (current) configureBurnt(current);
    };
    if (immediate) changes();
    else state.changesTask = scheduler.schedule(.5, () => { state.changesTask = undefined; changes(); });
  };
  /** chop_down_burnt_moon_tree: the crumble and chop sounds, charcoal, and removal when the clip ends. */
  const chopDownBurnt = (entity: ProximityEntity) => {
    const state = stateOf(entity), controller = entity.model && controllers.get(entity.model);
    controller?.workable?.dispose(); if (controller) delete controller.inst.components.workable;
    sound('dontstarve/forest/treeCrumble', entity.position);
    sound('dontstarve/wilson/use_axe_tree', entity.position);
    const loot: string[] = [];
    const dropper = new LootDropper({ getPosition: () => entity.position }, prefab => { loot.push(prefab); return undefined; });
    dropper.SetChanceLootTable('moontree_burnt');
    dropper.DropLoot();
    world?.dropLoot(loot.map(itemId => ({ itemId, count: 1 })), entity.position.clone());
    const animation = controller?.model.userData.animationController as SpriteAnimationController | undefined;
    if (animation) animation.playOnce(`chop_burnt_${sizeOf(state)}`, () => removeTree(entity));
    else removeTree(entity);
  };

  /** make_stump: replace CHOP work with one DIG, removing shelter. */
  const makeStump = (controller: TreeController) => {
    const { entity, model, inst } = controller;
    unbindFire(controller);
    stateOf(entity).growable.StopGrowing();
    controller.workable?.dispose();
    const workable = new Workable(inst);
    controller.workable = workable;
    model.userData.components.workable = workable;
    inst.removeTag('shelter');
    inst.addTag('stump');
    workable.SetWorkAction('DIG');
    workable.SetWorkLeft(1);
    // dig_up_stump: NORMAL/TALL drop two logs, then inst:Remove().
    workable.SetOnFinishCallback(() => {
      world?.dropLoot([{ itemId: 'log', count: sizeOf(stateOf(entity)) === 'short' ? 1 : 2 }], entity.position);
      removeTree(entity);
    });
    bindFire(controller);
  };

  const spawnChopFx = (position: THREE.Vector3, size: MoonTreeSize) => {
    const fx = fxFactory.create({ initialAnimation: 'chop', name: 'tree_petal_fx_chop' });
    // on_chop_tree: TALL spawns 2.0..2.25 units up at scale 1.25.
    fx.position.set(position.x, (size === 'short' ? .25 : size === 'normal' ? .8 + random() * .25 : 2 + random() * .25) * unit, position.z);
    fx.scale.setScalar(size === 'short' ? .75 : size === 'normal' ? 1 : 1.25);
    fx.userData.tags = ['FX', 'NOCLICK'];
    fx.userData.footPosition = position;
    fx.quaternion.copy(world!.camera.getWorldQuaternion(new THREE.Quaternion()));
    nearby.group.add(fx);
    effects.add(fx);
    (fx.userData.animationController as SpriteAnimationController).playOnce('chop', () => {
      effects.delete(fx);
      fxFactory.disposeSprite(fx);
    });
  };

  const attach = (entity: ProximityEntity, model: THREE.Group) => {
    const state = stateOf(entity);
    const inst = actionEntity(model, 'moon_tree');
    const controller: TreeController = { entity, model, inst };
    controllers.set(model, controller);
    model.userData.prefab = 'moon_tree';
    model.userData.deploySmartRadius = 1.6;
    model.userData.components.growable = state.growable;
    for (const tag of ['plant', 'tree', 'moon_tree']) inst.addTag(tag);
    // standardcomponents.lua MakeSnowCoveredPristine applies to trees and stumps, not saplings.
    inst.addTag('SnowCovered');
    if (state.stump) {
      makeStump(controller);
      return;
    }
    if (state.burnt) {
      inst.addTag('burnt');
      const workable = new Workable(inst);
      controller.workable = workable;
      model.userData.components.workable = workable;
      workable.SetWorkAction('CHOP'); workable.SetWorkLeft(1);
      workable.SetOnFinishCallback(() => chopDownBurnt(entity));
      (model.userData.animationController as SpriteAnimationController).start(`burnt_${sizeOf(state)}`);
      return;
    }
    bindFire(controller);
    inst.addTag('shelter');
    const animation = model.userData.animationController as SpriteAnimationController;
    animation.start(`sway1_loop_${sizeOf(state)}`);
    const workable = new Workable(inst);
    controller.workable = workable;
    model.userData.components.workable = workable;
    workable.SetWorkAction('CHOP');
    workable.SetWorkLeft(state.workLeft);
    // on_chop_tree: sound, chop pose, then back to swaying, with petals at the crown.
    workable.SetOnWorkCallback((_worker, workLeft) => {
      state.workLeft = workLeft;
      PlaySound('dontstarve/wilson/use_axe_tree', entity.position);
      animation.playOnce(`chop_${sizeOf(state)}`, () => animation.start(`sway1_loop_${sizeOf(state)}`));
      if (world) spawnChopFx(entity.position, sizeOf(state));
    });
    // on_chop_tree_down: fall away from the chopper, scatter loot on the fall side and leave a stump.
    workable.SetOnFinishCallback((worker: Worker) => {
      PlaySound('dontstarve/forest/treeFall', entity.position);
      const right = cameraRight();
      const chopper = worker.getPosition?.();
      const chopperOnRight = chopper
        ? (chopper.x - entity.position.x) * right.x + (chopper.z - entity.position.z) * right.z > 0
        : Math.random() > .5;
      const loot: string[] = [];
      const dropper = new LootDropper({ getPosition: () => entity.position }, prefab => { loot.push(prefab); return undefined; });
      dropper.SetChanceLootTable(`moontree_${sizeOf(state)}`);
      dropper.DropLoot();
      const items = new Map<string, number>();
      for (const itemId of loot) if (Object.hasOwn(catalog.items, itemId)) items.set(itemId, (items.get(itemId) ?? 0) + 1);
      world?.dropLoot([...items].map(([itemId, count]) => ({ itemId, count })),
        entity.position.clone().addScaledVector(right, chopperOnRight ? -unit : unit));
      state.stump = true;
      makeStump(controller);
      animation.playOnce(`${chopperOnRight ? 'fallleft' : 'fallright'}_${sizeOf(state)}`, () => animation.start(`stump_${sizeOf(state)}`));
    });
  };

  const nearby: ProximityEntities = new ProximityEntities(
    positions,
    options.loadRadius ?? definitions.moonTree.loadRadiusTiles * TILE_SIZE,
    (entity) => {
      const model = factory.create({
        initialAnimation: stateOf(entity).stump ? `stump_${sizeOf(stateOf(entity))}`
          : stateOf(entity).burnt ? `burnt_${sizeOf(stateOf(entity))}`
          : sizeOf(stateOf(entity)) === 'tall' ? standingAnimation : `sway1_loop_${sizeOf(stateOf(entity))}`,
        name: `MoonTree-${entity.id}`,
        scale, getWatchWorldContent, snowCovered: snow,
      });
      // Anchor the billboard at its foot, so both loading and depth sorting use
      // the persistent ground position rather than the centre of the tall art.
      model.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(model);
      model.children[0].position.y -= bounds.min.y;
      if (entity.saveId) model.userData.entityId = entity.saveId;
      attach(entity, model);
      return model;
    },
    (model) => {
      const controller = controllers.get(model);
      if (controller) stateOf(controller.entity).growable.OnEntitySleep();
      if (controller?.burn?.burnable.IsBurning()) {
        // on_sleep: a burning stump finishes as DefaultBurntFn, a burning tree as burnt.
        const state = stateOf(controller.entity);
        if (state.stump) state.removeTask = scheduler.schedule(0, () => { state.removeTask = undefined; burnStump(controller.entity); });
        else burn(controller.entity, true);
      }
      if (controller) unbindFire(controller);
      controllers.delete(model);
      model.userData.removed = true;
      controller?.workable?.dispose();
      factory.disposeSprite(model);
    },
    options.entityIds,
  );
  nearby.group.name = 'MoonTreeForest';

  const removeSapling = (model: THREE.Group) => {
    const sapling = saplings.get(model);
    if (!sapling) return;
    model.userData.removed = true;
    sapling.timer.dispose(); sapling.workable.dispose();
    saplings.delete(model); saplingFactory.disposeSprite(model);
  };

  const spawnTree = (prefab: typeof MOON_TREE_SPAWN_IDS[number], position: THREE.Vector3,
    id = newEntityId(), fromSeed = false): ProximityEntity => {
    const stage = prefab === 'moon_tree' ? Math.min(3, Math.floor(random() * 3) + 1) : MOON_TREE_SPAWN_IDS.indexOf(prefab);
    const entity = nearby.add(position, id);
    stateOf(entity, stage);
    nearby.update(lastPlayerPosition);
    stateOf(entity).growable.OnEntityWake();
    if (fromSeed) playGrowth(entity, 'grow_seed_to_short');
    return entity;
  };

  const spawnSapling = (position: THREE.Vector3, saved?: MoonTreeSaplingRecord): THREE.Group => {
    const model = saplingFactory.create({ initialAnimation: 'idle', name: 'moonbutterfly_sapling' });
    model.position.copy(position);
    model.quaternion.copy(world!.camera.getWorldQuaternion(new THREE.Quaternion()));
    Object.assign(model.userData, { entityId: saved?.id ?? newEntityId(), prefab: 'moonbutterfly_sapling', deploySmartRadius: 1.6, tags: ['plant', 'moon_tree'] });
    const inst = actionEntity(model, 'moonbutterfly_sapling');
    const timer = new Timer(scheduler, () => {
      spawnTree('moon_tree_short', model.position, undefined, true);
      removeSapling(model);
    }, ['grow']);
    const workable = new Workable(inst);
    workable.SetWorkAction('DIG'); workable.SetWorkLeft(1);
    workable.SetOnFinishCallback(() => {
      world?.dropLoot([{ itemId: 'twigs', count: 1 }], model.position);
      removeSapling(model);
    });
    model.userData.components.workable = workable;
    model.userData.components.timer = timer;
    saplings.set(model, { timer, workable }); nearby.group.add(model);
    timer.StartTimer('grow', MOONBUTTERFLY_SAPLING_GROW_TIME.base + (random() * 2 - 1) * MOONBUTTERFLY_SAPLING_GROW_TIME.random);
    timer.OnLoad(saved?.components.saplingTimer);
    return model;
  };

  const workTargets = (action: 'CHOP' | 'DIG'): PickaxeTarget[] => {
    if (!world) return [];
    return [...nearby.activeEntities].flatMap(entity => {
      const model = entity.model!;
      const controller = controllers.get(model);
      const isValid = () => controllers.get(model) === controller
        && controller?.workable?.CanBeWorked() === true
        && controller.workable.GetWorkAction() === action;
      if (!controller || !isValid()) return [];
      return [{ id: entity.saveId ?? String(entity.id), entity: controller.inst, model,
        position: entity.position, isValid }];
    });
  };

  return {
    group: nearby.group,
    get positions() { return nearby.entities.map(entity => entity.position); },
    entities: nearby.entities,
    get activeEntities() { return nearby.activeEntities; },
    updateNearby(playerPosition) {
      // Retain the current ground point for loading newly planted trees.
      lastPlayerPosition.copy(playerPosition);
      nearby.update(playerPosition);
      for (const entity of nearby.activeEntities) stateOf(entity).growable.OnEntityWake();
    },
    setNormals(cameraWorldQuaternion) {
      lastQuaternion.copy(cameraWorldQuaternion);
      for (const entity of nearby.activeEntities) {
        entity.model!.quaternion.copy(cameraWorldQuaternion);
      }
      for (const fx of effects) fx.quaternion.copy(cameraWorldQuaternion);
      for (const model of saplings.keys()) model.quaternion.copy(cameraWorldQuaternion);
    },
    update(dt) {
      if (ownsScheduler) scheduler.advance(dt);
      fireFx.update(dt, lastQuaternion);
      for (const entity of nearby.activeEntities) {
        const animation = entity.model!.userData.animationController as SpriteAnimationController;
        animation.update(dt);
      }
      for (const fx of [...effects]) (fx.userData.animationController as SpriteAnimationController).update(dt);
      for (const model of saplings.keys()) (model.userData.animationController as SpriteAnimationController).update(dt);
    },
    bindWorld(next) {
      world = next;
      getWatchWorldContent = getBoundWatchWorldContent();
      for (const { model } of controllers.values()) (model.userData.animationController as SpriteController).setWorldContent(getWatchWorldContent);
      if (next.scheduler && ownsScheduler && !states.size && !saplings.size) {
        scheduler.dispose(); scheduler = next.scheduler; ownsScheduler = false;
      }
      for (const entity of nearby.entities) stateOf(entity);
      return () => {
        if (world !== next) return;
        world = undefined; getWatchWorldContent = undefined;
        for (const { model } of controllers.values()) (model.userData.animationController as SpriteController).setWorldContent(undefined);
      };
    },
    get chopTargets() {
      return workTargets('CHOP');
    },
    get digTargets() {
      const saplingTargets = [...saplings].map(([model, { workable }]) => ({
        id: String(model.userData.entityId), model, position: model.position, entity: actionEntity(model, 'moonbutterfly_sapling'),
        isValid: () => saplings.has(model) && workable.CanBeWorked(),
      }));
      return [...workTargets('DIG'), ...saplingTargets].map(target => ({ ...target,
        dig: () => target.isValid() && performToolWork('DIG', target.entity, {}),
      }));
    },
    get renderEntities() {
      return [
        ...Array.from(nearby.activeEntities, (entity) => ({ object: entity.model!, footPosition: entity.position, cameraDepth: 0 })),
        ...Array.from(effects, (fx) => ({ object: fx, footPosition: fx.userData.footPosition as THREE.Vector3, cameraDepth: 0 })),
        ...Array.from(saplings.keys(), model => ({ object: model, footPosition: model.position, cameraDepth: 0 })),
        ...fireFx.renderEntities,
      ];
    },
    restoreState(saveId, saved, growth) {
      const entity = nearby.entities.find(candidate => candidate.saveId === saveId);
      if (!entity) return;
      const state = stateOf(entity);
      state.stump = saved?.stump ?? false;
      if (growth) state.growable.OnLoad(growth);
      else if (saved?.size) {
        state.growable.SetStage(MOON_TREE_SIZES.indexOf(saved.size) + 1);
        state.growable.StartGrowing();
      }
      if (state.stump) state.growable.StopGrowing();
      else if (!entity.model) state.growable.OnEntitySleep();
      const controller = entity.model && controllers.get(entity.model);
      if (controller?.workable && state.stump) {
        makeStump(controller);
        (controller.model.userData.animationController as SpriteAnimationController).start(`stump_${sizeOf(state)}`);
      }
      // on_load: a saved burnt tree (or one that was burning) becomes burnt at once; its stump variant is not restored.
      if (saved?.burnt && !state.stump) burn(entity, true);
    },
    exportState(entity) {
      const state = stateOf(entity);
      // on_save: a burning tree is saved as burnt; a burning stump is still a stump.
      const controller = entity.model && controllers.get(entity.model);
      const burnt = !state.stump && (state.burnt || controller?.burn?.burnable.IsBurning() === true);
      return { moonTree: { size: sizeOf(state), ...(state.stump ? { stump: true } : {}), ...(burnt ? { burnt: true } : {}) },
        growable: burnt ? { stage: state.growable.GetStage() } : state.growable.OnSave() };
    },
    spawnTree,
    spawnSapling,
    deploySapling(position, take) {
      const model = spawnSapling(position);
      try {
        if (!take()) { removeSapling(model); return false; }
      } catch (error) { removeSapling(model); throw error; }
      sound('dontstarve/wilson/plant_tree', position);
      return true;
    },
    exportSaplings: () => [...saplings].map(([model, { timer }]) => ({
      id: String(model.userData.entityId), transform: { position: model.position.toArray(), rotationY: 0 },
      components: { saplingTimer: timer.OnSave()! },
    })),
    get saplingPositions() { return [...saplings.keys()].map(model => model.position); },
    createSaplingPreview: () => saplingFactory.create({ initialAnimation: 'idle', name: 'MoonButterflyPlacer' }),
    disposeSaplingPreview: model => saplingFactory.disposeSprite(model),
    dispose() {
      nearby.dispose();
      for (const state of states.values()) { state.changesTask?.(); state.removeTask?.(); state.growable.dispose(); }
      states.clear();
      for (const model of [...saplings.keys()]) removeSapling(model);
      for (const handle of sounds) handle.stop(); sounds.clear();
      for (const fx of effects) fxFactory.disposeSprite(fx);
      effects.clear();
      factory.dispose();
      snow.dispose();
      fxFactory.dispose();
      fireFx.dispose();
      saplingFactory.dispose();
      if (ownsScheduler) scheduler.dispose();
    },
  };
}
