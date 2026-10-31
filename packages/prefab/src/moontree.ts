import { MakeObstaclePhysics, RemovePhysicsColliders } from './standardcomponents';
import { ModelRecords, modelEntries } from './modelRecords';
import * as THREE from 'three';
import {
  createAnimatedSpriteFactory,
} from '@dontstarve-web/animation/sprite';
import { ArchiveSpriteAssets, preloadSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { PickaxeTarget } from '@dontstarve-web/stategraphs/mine';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { Workable, type Worker } from '../../componets/src/workable';
import { actionEntity, disposeActionEntity } from './actionEntity';
import { ToolMouseTarget } from './toolMouseTarget';
import catalog from './groundItems.json' with { type: 'json' };
import type { ResidentEntity } from '@dontstarve-web/animation/residentSprite';
import type { ArchiveSpriteCommands } from '@dontstarve-web/display';
import { createArchiveEntity, createPrefabEntity, prefabInstance } from './prefabInstance';
import { watchTileActivity } from './tileActivity';
import { registerPlacementTree } from './placementEntities';
import { PlaySound } from './sound';
import { TILE_SIZE } from './tile';
import definitions from './definitions.json' with { type: 'json' };
import { Growable, type GrowableSave } from '../../componets/src/growable';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Timer, type NamedTimerSave } from '../../componets/src/timer';
import { newEntityId } from './saveRecord';
import type { MiniMapState } from '../../map/src/minimapState';
import { type SoundHandle } from './sound';
import { BurnableBinding, FireFxHost, TREE_BURN_TIME, type BurnEnvironment, type BurnSpec } from './treeFire';
import { getBoundWatchWorldContent, WorldContentKey, createRenderEffect, type GetWatchWorldContent, type HandEquipment, type ReadonlySignal, type TileStateQuery } from '@dontstarve-web/signals';
import type { WorldEventEmitter } from './worldContext';

/** tuning.lua MOON_TREE_CHOPS_TALL: the tall stage requires sixteen chops. */
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

/** World services owned by this moon-tree manager. */
export interface MoonTreeWorld {
  handEquipment?: ReadonlySignal<HandEquipment | null>;
  physics?: import('cannon-es').World;
  readonly camera: THREE.Camera;
  readonly scheduler?: GameTimeScheduler;
  /** Only visuals are resident while the entity's tile is active. */
  readonly tickingarea?: TileStateQuery;
  /** Searched for propagator neighbours; receives fire effects. */
  readonly scene: THREE.Object3D;
  readonly getWatchWorldContent?: GetWatchWorldContent;
  /** DefaultBurntFn: one ash at the burnt inst's position. */
  worldEvents: WorldEventEmitter;
  growthDuration?(seconds: number): number;
  dropLoot(items: readonly { itemId: string; count: number }[], position: THREE.Vector3): void;
}

/** moontree.lua OnSave keeps the stump flag; workable progress is not saved. */
export interface MoonTreeSaveState { stump?: true; burnt?: true; size?: MoonTreeSize }
export interface MoonTreeComponents { moonTree?: MoonTreeSaveState; growable?: GrowableSave; moonTreeTimer?: NamedTimerSave }
export interface MoonTreeSaplingRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { saplingTimer: NamedTimerSave };
}

interface TreeState { stump: boolean; burnt: boolean; workLeft: number; growable: Growable; minimap: MiniMapState; timer: Timer; changesTask?: () => void; removeTask?: () => void }

interface TreeController {
  readonly entity: ResidentEntity;
  readonly model: THREE.Group;
  readonly inst: ReturnType<typeof actionEntity>;
  stopActivity?: () => void;
  workable?: Workable;
  mouseTarget?: ToolMouseTarget;
  /** MakeXBurnable + MakeXPropagator while the tree is awake. */
  burn?: BurnableBinding;
  /** Private snow-level bridge; its cleanup owns the source subscription and the layer effect. */
  stopSnow?: () => void;
}

export interface MoonTreeRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: MoonTreeComponents;
}

/** Placed moon_tree entities and their planted saplings; no generated forest or separate world binding. */
export async function createMoonTreeManager(assetBaseUrl: string, world: MoonTreeWorld, random = Math.random) {
  const scale = definitions.moonTree.scale;
  const treeAssets = new ArchiveSpriteAssets('moon_tree', assetBaseUrl);
  const standingAnimation = definitions.moonTree.animationName;
  const [createTree, fxFactory, createSapling] = await Promise.all([
    // MakeSnowCoveredPristine: the `snow` placeholder is drawn from snow.zip while the snow level is covered.
    preloadSharedArchiveSprite(treeAssets, { animationArchive: definitions.moonTree.archive,
      buildArchives: [definitions.moonTree.archive, 'snow.zip'], bank: 'moon_tree', hiddenSymbols: ['snow'],
      symbolOverrides: { snow: { archive: 'snow.zip', symbol: 'snow' } } },
    { scale, staticBillboard: true, instancedAnimations: [...new Set([standingAnimation, ...MOON_TREE_SIZES.map(size => `sway1_loop_${size}`)])] }),
    createAnimatedSpriteFactory(assetBaseUrl, 'tree_petal_fx.zip'),
    preloadSharedArchiveSprite(treeAssets, { animationArchive: 'baby_moon_tree.zip', buildArchives: ['baby_moon_tree.zip'], bank: 'baby_moon_tree' },
      { staticBillboard: true, instancedAnimations: 'all' }),
  ]);
  const fireFx = FireFxHost.create(assetBaseUrl);
  const unit = TILE_SIZE / 4;
  const entities: ResidentEntity[] = [];
  const active = new Set<ResidentEntity>();
  const sprites = new Map<ResidentEntity, ReturnType<typeof createArchiveEntity>>();
  const placementStops = new Map<ResidentEntity, () => void>();
  let nextId = 0;
  const states = new Map<ResidentEntity, TreeState>();
  const controllers = new Map<THREE.Group, TreeController>();
  const mouseRecords = new ModelRecords<ResidentEntity>();
  const effects = new Set<ReturnType<typeof createPrefabEntity>>();
  const saplings = new Map<THREE.Group, { entity: ReturnType<typeof createArchiveEntity>; timer: Timer; workable: Workable; stopActivity(): void; stopPlacement(): void }>();
  const sounds = new Set<SoundHandle>();
  const sound = (path: Parameters<typeof PlaySound>[0], position: THREE.Vector3) => {
    for (const handle of sounds) if (!handle.isPlaying?.()) sounds.delete(handle);
    sounds.add(PlaySound(path, position));
  };
  const scheduler = world.scheduler ?? new GameTimeScheduler();
  const ownsScheduler = !world.scheduler;
  let disposed = false;
  const getWatchWorldContent = world.getWatchWorldContent ?? getBoundWatchWorldContent();
  const env = (): BurnEnvironment => ({ scheduler, fire: fireFx });
  const sizeOf = (state: TreeState): MoonTreeSize => MOON_TREE_SIZES[state.growable.GetStage() - 1];
  /** Growth settled while the visual was unloaded is shown as its final stage, without the transition animation. */
  let catchingUp = false;
  const wakeGrowable = (entity: ResidentEntity) => {
    catchingUp = true;
    try { stateOf(entity).growable.OnEntityWake(); } finally { catchingUp = false; }
  };
  const playGrowth = (entity: ResidentEntity, clip: string, wilt = false) => {
    if (!active.has(entity) || catchingUp) return;
    const animation = prefabInstance(entity.model)!.sprite as ArchiveSpriteCommands;
    sound(wilt ? 'dontstarve/forest/treeGrowFromWilt' : 'dontstarve/forest/treeGrow', entity.position);
    animation.playOnce(clip, () => animation.start(`sway1_loop_${sizeOf(stateOf(entity))}`));
  };
  const stateOf = (entity: ResidentEntity, stage = 3): TreeState => {
    let state = states.get(entity);
    if (!state) {
      const growable = new Growable(scheduler, MOON_TREE_SIZES.map((size, index) => ({
        time: () => MOON_TREE_GROWTH_TIME[index].base + (random() * 2 - 1) * MOON_TREE_GROWTH_TIME[index].random,
        fn: () => {
          const current = states.get(entity)!;
          current.workLeft = MOON_TREE_CHOPS[index];
          const controller = controllers.get(entity.model);
          if (controller && !current.stump && !current.burnt) {
            controller.workable?.SetWorkLeft(current.workLeft);
            (prefabInstance(controller.model)!.sprite as ArchiveSpriteCommands).start(`sway1_loop_${size}`);
            refreshFire(controller);
          }
        },
        growfn: () => playGrowth(entity, ['grow_tall_to_short', 'grow_short_to_normal', 'grow_normal_to_tall'][index], index === 0),
      })), seconds => world.growthDuration?.(seconds) ?? seconds);
      const minimap = sprites.get(entity)!.instance.minimap;
      minimap.SetIcon('moon_tree.png'); minimap.SetPriority(-1);
      const timer = new Timer(scheduler, name => { if (name === 'decay') removeTree(entity); }, ['decay']);
      states.set(entity, state = { stump: false, burnt: false, workLeft: MOON_TREE_CHOPS[stage - 1], growable, minimap, timer });
      growable.loopstages = true; growable.springgrowth = true;
      growable.SetStage(stage); growable.StartGrowing();
      if (!active.has(entity)) growable.OnEntitySleep();
    }
    return state;
  };
  const cameraRight = () => {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(world.camera.getWorldQuaternion(new THREE.Quaternion()));
    return right.setY(0).normalize();
  };

  /** set_short/normal/tall_burnable (MakeSmall/MediumPropagator values) and make_stump_burnable (MakeMediumPropagator). */
  const burnSpec = (entity: ResidentEntity, state: TreeState): BurnSpec => {
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
    if (!active.has(controller.entity) || controller.burn || state.burnt) return;
    controller.burn = new BurnableBinding(controller.inst, burnSpec(controller.entity, state), env());
  };
  /** weather.lua SNOW_COVERED_THRESHOLD; without a bound world the snow layer stays hidden. */
  const bindSnow = (controller: TreeController) => {
    controller.stopSnow?.(); controller.stopSnow = undefined;
    const sprite = prefabInstance(controller.model)!.sprite as ArchiveSpriteCommands;
    const level = getWatchWorldContent?.(WorldContentKey.SnowLevel, stop => { controller.stopSnow = stop; });
    const stopWatch = controller.stopSnow, stopEffect = createRenderEffect(() => { sprite.setSymbolHidden('snow', level ? level.get() < .015 : true); });
    controller.stopSnow = () => { stopEffect(); (stopWatch as (() => void) | undefined)?.(); };
  };
  const unbindFire = (controller: TreeController) => { controller.burn?.dispose(); controller.burn = undefined; };
  /** A stage change reconfigures the burnable in place, unless it is already burning. */
  const refreshFire = (controller: TreeController) => {
    if (controller.burn?.burnable.IsBurning()) return;
    unbindFire(controller); bindFire(controller);
  };
  /** DefaultBurntFn on a stump: one ash, then the inst is removed. */
  const burnStump = (entity: ResidentEntity) => {
    world.worldEvents.emit('spawnAsh', entity.position.clone());
    removeTree(entity);
  };
  const removeTree = (entity: ResidentEntity) => {
    const state = states.get(entity);
    if (!state) return;
    state.changesTask?.(); state.removeTask?.();
    const controller = controllers.get(entity.model);
    if (controller) unbindFire(controller);
    state.growable.dispose(); state.timer.dispose();
    states.delete(entity);
    active.delete(entity);
    entities.splice(entities.indexOf(entity), 1);
    controller?.stopActivity?.(); controller?.stopSnow?.(); controller?.workable?.dispose();
    controllers.delete(entity.model);
    placementStops.get(entity)?.(); placementStops.delete(entity);
    entity.model.userData.removed = true; disposeActionEntity(entity.model);
    const drawn = sprites.get(entity); sprites.delete(entity); drawn?.instance.remove();
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
  const burn = (entity: ResidentEntity, immediate: boolean) => {
    const state = stateOf(entity);
    if (state.burnt) return;
    state.burnt = true;
    state.minimap.SetIcon('moon_tree_burnt.png');
    startDecay(state);
    const controller = controllers.get(entity.model);
    controller?.inst.addTag('burnt');
    (prefabInstance(controller?.model)?.sprite)?.start(`burnt_${sizeOf(state)}`);
    const changes = () => {
      state.growable.StopGrowing();
      const current = controllers.get(entity.model);
      if (current) configureBurnt(current);
    };
    if (immediate) changes();
    else state.changesTask = scheduler.schedule(.5, () => { state.changesTask = undefined; changes(); });
  };
  /** chop_down_burnt_moon_tree: the crumble and chop sounds, charcoal, and removal when the clip ends. */
  const chopDownBurnt = (entity: ResidentEntity) => {
    const state = stateOf(entity), controller = controllers.get(entity.model);
    RemovePhysicsColliders(sprites.get(entity)!.instance);
    controller?.workable?.dispose(); if (controller) delete controller.inst.components.workable;
    sound('dontstarve/forest/treeCrumble', entity.position);
    sound('dontstarve/wilson/use_axe_tree', entity.position);
    const loot: string[] = [];
    const dropper = new LootDropper({ getPosition: () => entity.position }, prefab => { loot.push(prefab); return undefined; });
    dropper.SetChanceLootTable('moontree_burnt');
    dropper.DropLoot();
    world.dropLoot(loot.map(itemId => ({ itemId, count: 1 })), entity.position.clone());
    const animation = prefabInstance(controller?.model)?.sprite;
    if (animation) animation.playOnce(`chop_burnt_${sizeOf(state)}`, () => removeTree(entity));
    else removeTree(entity);
  };

  // moontree.lua: thirty days with +/- 50% variance, created only once for a dead tree.
  const startDecay = (state: TreeState) => {
    if (!state.timer.TimerExists('decay')) state.timer.StartTimer('decay', 14400 + (random() * 2 - 1) * 7200);
  };

  /** make_stump: replace CHOP work with one DIG, removing shelter. */
  const makeStump = (controller: TreeController) => {
    const { entity, model, inst } = controller;
    RemovePhysicsColliders(sprites.get(entity)!.instance);
    unbindFire(controller);
    const state = stateOf(entity);
    state.growable.StopGrowing();
    state.minimap.SetIcon('moon_tree_stump.png');
    startDecay(state);
    controller.workable?.dispose();
    const workable = new Workable(inst);
    controller.workable = workable;
    prefabInstance(model)!.components.workable = workable;
    inst.removeTag('shelter');
    inst.addTag('stump');
    workable.SetWorkAction('DIG');
    workable.SetWorkLeft(1);
    controller.mouseTarget?.setWorkable(workable);
    // dig_up_stump: NORMAL/TALL drop two logs, then inst:Remove().
    workable.SetOnFinishCallback(() => {
      world.dropLoot([{ itemId: 'log', count: sizeOf(stateOf(entity)) === 'short' ? 1 : 2 }], entity.position);
      removeTree(entity);
    });
    bindFire(controller);
  };

  const spawnChopFx = (position: THREE.Vector3, size: MoonTreeSize) => {
    const drawn = createPrefabEntity('tree_petal_fx_chop', { create: animation => fxFactory.create({ initialAnimation: animation, name: 'tree_petal_fx_chop' }),
      release: sprite => fxFactory.disposeSprite(sprite) }, { name: 'chop', billboard: true }, 'tree_petal_fx_chop');
    const fx = drawn.display.model; drawn.instance.persists = false;
    // on_chop_tree: TALL spawns 2.0..2.25 units up at scale 1.25.
    fx.position.set(position.x, (size === 'short' ? .25 : size === 'normal' ? .8 + random() * .25 : 2 + random() * .25) * unit, position.z);
    fx.scale.setScalar(size === 'short' ? .75 : size === 'normal' ? 1 : 1.25);
    drawn.instance.addTag('FX');
    fx.userData.footPosition = position;
    world.scene.add(fx);
    effects.add(drawn);
    drawn.instance.sprite.playOnce('chop', () => {
      effects.delete(drawn);
      drawn.instance.remove();
    });
  };

  const attach = (entity: ResidentEntity, model: THREE.Group) => {
    const state = stateOf(entity);
    const inst = actionEntity(model, 'moon_tree');
    const controller: TreeController = { entity, model, inst };
    mouseRecords.set(model, entity);
    controllers.set(model, controller);
    model.userData.deploySmartRadius = 1.6 * unit;
    prefabInstance(model)!.components.growable = state.growable;
    prefabInstance(model)!.components.timer = state.timer;
    for (const tag of ['plant', 'tree', 'moon_tree']) inst.addTag(tag);
    // standardcomponents.lua MakeSnowCoveredPristine applies to trees and stumps, not saplings.
    inst.addTag('SnowCovered');
    if (state.stump) {
      makeStump(controller);
      (prefabInstance(model)!.sprite as ArchiveSpriteCommands).playOnce(`stump_${sizeOf(state)}`);
      return;
    }
    if (state.burnt) {
      inst.addTag('burnt');
      const workable = new Workable(inst);
      controller.workable = workable;
      prefabInstance(model)!.components.workable = workable;
      workable.SetWorkAction('CHOP'); workable.SetWorkLeft(1);
      workable.SetOnFinishCallback(() => chopDownBurnt(entity));
      (prefabInstance(model)!.sprite as ArchiveSpriteCommands).start(`burnt_${sizeOf(state)}`);
      return;
    }
    bindFire(controller);
    inst.addTag('shelter');
    const animation = prefabInstance(model)!.sprite as ArchiveSpriteCommands;
    animation.start(`sway1_loop_${sizeOf(state)}`);
    const workable = new Workable(inst);
    controller.workable = workable;
    prefabInstance(model)!.components.workable = workable;
    workable.SetWorkAction('CHOP');
    workable.SetWorkLeft(state.workLeft);
    // on_chop_tree: sound, chop pose, then back to swaying, with petals at the crown.
    workable.SetOnWorkCallback((_worker, workLeft) => {
      state.workLeft = workLeft;
      PlaySound('dontstarve/wilson/use_axe_tree', entity.position);
      animation.playOnce(`chop_${sizeOf(state)}`, () => animation.start(`sway1_loop_${sizeOf(state)}`));
      spawnChopFx(entity.position, sizeOf(state));
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
      world.dropLoot([...items].map(([itemId, count]) => ({ itemId, count })),
        entity.position.clone().addScaledVector(right, chopperOnRight ? -unit : unit));
      state.stump = true;
      makeStump(controller);
      animation.playOnce(`${chopperOnRight ? 'fallleft' : 'fallright'}_${sizeOf(state)}`, () => animation.start(`stump_${sizeOf(state)}`));
    });
  };

  const createEntity = (position: THREE.Vector3, saveId?: string): ResidentEntity => {
    if (disposed) throw new Error('Moon tree manager has been disposed');
    if (saveId && entities.some(entity => entity.saveId === saveId)) throw new Error(`Duplicate entity ID: ${saveId}`);
    const id = nextId++;
    const drawn = createArchiveEntity('moon_tree', { create: clip => createTree(clip.name, clip.loop, `MoonTree-${id}`), alignBottom: true },
      { name: standingAnimation, billboard: true }, `MoonTree-${id}`, instance => instance.setActive(false));
    const model = drawn.display.model; drawn.instance.position.copy(position);
    MakeObstaclePhysics(drawn.instance, .5);
    if (world.physics) drawn.instance.bindPhysics(world.physics);
    model.userData.placementLogical = true;
    if (saveId) drawn.instance.entityId = saveId;
    const entity: ResidentEntity = { id, saveId, model, position: model.position };
    sprites.set(entity, drawn); entities.push(entity); world.scene.add(model);
    placementStops.set(entity, registerPlacementTree(world.scene, entity, 'moon_tree', 1.6 * unit));
    return entity;
  };
  const setActive = (controller: TreeController, awake: boolean) => {
    const { entity } = controller, drawn = sprites.get(entity);
    if (!drawn) return;
    if (active.has(entity) === awake) { drawn.instance.setActive(awake); return; }
    if (awake) {
      active.add(entity);
      wakeGrowable(entity);
      bindSnow(controller); bindFire(controller);
      drawn.instance.setActive(true);
    } else {
      active.delete(entity);
      const state = stateOf(entity);
      state.growable.OnEntitySleep();
      if (controller.burn?.burnable.IsBurning()) {
        if (state.stump) state.removeTask = scheduler.schedule(0, () => { state.removeTask = undefined; burnStump(entity); });
        else burn(entity, true);
      }
      unbindFire(controller);
      controller.stopSnow?.(); controller.stopSnow = undefined;
      drawn.instance.setActive(false);
    }
  };
  const bindActivity = (entity: ResidentEntity) => {
    let controller = controllers.get(entity.model);
    if (!controller) {
      attach(entity, entity.model); controller = controllers.get(entity.model)!;
      controller.mouseTarget = new ToolMouseTarget(controller.inst, sprites.get(entity)!.instance, controller.workable!, world.handEquipment);
    }
    controller.stopActivity?.();
    controller.stopActivity = watchTileActivity(entity.model, world.tickingarea, awake => setActive(controller!, awake));
  };

  const removeSapling = (model: THREE.Group) => {
    const sapling = saplings.get(model);
    if (!sapling) return;
    model.userData.removed = true;
    sapling.timer.dispose(); sapling.workable.dispose();
    saplings.delete(model); sapling.stopActivity(); sapling.stopPlacement(); sapling.entity.instance.remove();
  };

  const spawn = (prefab: typeof MOON_TREE_SPAWN_IDS[number], position: THREE.Vector3,
    saved?: MoonTreeRecord, fromSeed = false): ResidentEntity => {
    const stage = saved ? saved.components.growable?.stage ?? MOON_TREE_SIZES.indexOf(saved.components.moonTree?.size ?? 'tall') + 1
      : prefab === 'moon_tree' ? Math.min(3, Math.floor(random() * 3) + 1) : MOON_TREE_SPAWN_IDS.indexOf(prefab);
    const entity = createEntity(position, saved?.id ?? newEntityId());
    stateOf(entity, stage);
    if (saved) restoreState(entity, saved.components.moonTree, saved.components.growable, saved.components.moonTreeTimer);
    bindActivity(entity);
    if (fromSeed) playGrowth(entity, 'grow_seed_to_short');
    return entity;
  };

  const spawnSapling = (position: THREE.Vector3, saved?: MoonTreeSaplingRecord): THREE.Group => {
    const create = (clip: { name: string; loop: boolean }) => createSapling(clip.name, clip.loop, 'moonbutterfly_sapling');
    const entity = createArchiveEntity('moonbutterfly_sapling', { create }, { name: 'idle', billboard: true }, 'moonbutterfly_sapling', instance => instance.setActive(false));
    const model = entity.display.model;
    entity.instance.sprite.playOnce('idle');
    model.position.copy(position);
    entity.instance.entityId = saved?.id ?? newEntityId();
    Object.assign(model.userData, { placementLogical: true, deploySmartRadius: 1.6 * unit });
    for (const tag of ['plant', 'moon_tree']) entity.instance.addTag(tag);
    const inst = actionEntity(model, 'moonbutterfly_sapling');
    const timer = new Timer(scheduler, () => {
      spawn('moon_tree_short', model.position, undefined, true);
      removeSapling(model);
    }, ['grow']);
    const workable = new Workable(inst);
    workable.SetWorkAction('DIG'); workable.SetWorkLeft(1);
    workable.SetOnFinishCallback(() => {
      world.dropLoot([{ itemId: 'twigs', count: 1 }], model.position);
      removeSapling(model);
    });
    prefabInstance(model)!.components.workable = workable;
    prefabInstance(model)!.components.timer = timer;
    new ToolMouseTarget(inst, entity.instance, workable, world.handEquipment);
    saplings.set(model, { entity, timer, workable, stopPlacement: registerPlacementTree(world.scene, { model, position: model.position }, 'moonbutterfly_sapling', 1.6 * unit), stopActivity: watchTileActivity(model, world.tickingarea, active => entity.instance.setActive(active)) });
    world.scene.add(model);
    timer.StartTimer('grow', MOONBUTTERFLY_SAPLING_GROW_TIME.base + (random() * 2 - 1) * MOONBUTTERFLY_SAPLING_GROW_TIME.random);
    timer.OnLoad(saved?.components.saplingTimer);
    return model;
  };

  const workTargets = (action: 'CHOP' | 'DIG', selectedModel?: THREE.Object3D): PickaxeTarget[] => {
    return mouseRecords.select(selectedModel, active).flatMap(entity => {
      const model = entity.model!;
      const controller = controllers.get(model);
      const isValid = () => active.has(entity) && controllers.get(model) === controller
        && controller?.workable?.CanBeWorked() === true
        && controller.workable.GetWorkAction() === action;
      if (!controller || !isValid()) return [];
      return [{ id: entity.saveId ?? String(entity.id), entity: controller.inst, model,
        position: entity.position, isValid }];
    });
  };

  const digTargets = (model?: THREE.Object3D) => {
    const saplingTargets = modelEntries(saplings, model).map(([model, { workable, entity }]) => ({
      id: String(entity.instance.entityId), model, position: model.position, entity: actionEntity(model, 'moonbutterfly_sapling'),
      isValid: () => saplings.has(model) && workable.CanBeWorked(),
    }));
    return [...workTargets('DIG', model), ...saplingTargets].map(target => ({ ...target,
      dig: () => target.isValid() && performToolWork('DIG', target.entity, {}),
    }));
  };
  const restoreState = (entity: ResidentEntity, saved: MoonTreeSaveState | undefined, growth?: GrowableSave, timer?: NamedTimerSave) => {
    const state = stateOf(entity);
    state.timer.OnLoad(timer);
    state.stump = saved?.stump ?? false;
    if (state.stump) { state.minimap.SetIcon('moon_tree_stump.png'); startDecay(state); }
    if (growth) state.growable.OnLoad(growth);
    else if (saved?.size) {
      state.growable.SetStage(MOON_TREE_SIZES.indexOf(saved.size) + 1);
      state.growable.StartGrowing();
    }
    if (state.stump) state.growable.StopGrowing();
    else if (!active.has(entity)) state.growable.OnEntitySleep();
    const controller = controllers.get(entity.model);
    if (controller?.workable && state.stump) {
      makeStump(controller);
      (prefabInstance(controller.model)!.sprite as ArchiveSpriteCommands).start(`stump_${sizeOf(state)}`);
    }
    // on_load: a saved burnt tree (or one that was burning) becomes burnt at once; its stump variant is not restored.
    if (saved?.burnt && !state.stump) burn(entity, true);
  };
  const exportState = (entity: ResidentEntity): MoonTreeComponents => {
    const state = stateOf(entity);
    // on_save: a burning tree is saved as burnt; a burning stump is still a stump.
    const controller = controllers.get(entity.model);
    const burnt = !state.stump && (state.burnt || controller?.burn?.burnable.IsBurning() === true);
    const timer = state.timer.OnSave();
    return { moonTree: { size: sizeOf(state), ...(state.stump ? { stump: true } : {}), ...(burnt ? { burnt: true } : {}) },
      growable: burnt ? { stage: state.growable.GetStage() } : state.growable.OnSave(),
      ...(timer ? { moonTreeTimer: timer } : {}) };
  };
  return {
    entities,

    update(dt: number) {
      if (ownsScheduler) scheduler.advance(dt);
      // Each display advances its entity's declared clip: trees, their effects and saplings.
      for (const entity of active) {
        sprites.get(entity)!.display.update(dt);
        controllers.get(entity.model)?.burn?.update(dt);
      }
      for (const drawn of [...effects]) drawn.display.update(dt);
      for (const { entity } of saplings.values()) entity.display.update(dt);
    },
    get chopTargets() { return workTargets('CHOP'); },
    getChopTargets(model?: THREE.Object3D) { return workTargets('CHOP', model); },
    get digTargets() { return digTargets(); },
    getDigTargets: digTargets,
    get renderEntities() {
      return [
        ...Array.from(active, (entity) => ({ object: entity.model, footPosition: entity.position, cameraDepth: 0 })),
        ...Array.from(effects, ({ display: { model } }) => ({ object: model, footPosition: model.userData.footPosition as THREE.Vector3, cameraDepth: 0 })),
        ...Array.from(saplings).filter(([, { entity }]) => entity.instance.sprite.loaded).map(([model]) => ({ object: model, footPosition: model.position, cameraDepth: 0 })),
        ...Array.from(active, entity => sprites.get(entity)!.display.fxRenderEntries).flat(),
      ];
    },
    exportState,
    exportRecords: (): MoonTreeRecord[] => entities.map(entity => ({ id: entity.saveId!,
      transform: { position: entity.position.toArray(), rotationY: 0 }, components: exportState(entity) })),
    spawn,
    spawnSapling,
    /** moonbutterfly ondeploy: SpawnPrefab("moonbutterfly_sapling"); its display loads the art. */
    transplant(position: THREE.Vector3) {
      if (disposed) return false;
      spawnSapling(position);
      return true;
    },
    exportSaplings: () => [...saplings].map(([model, { timer, entity }]) => ({
      id: String(entity.instance.entityId), transform: { position: model.position.toArray(), rotationY: 0 },
      components: { saplingTimer: timer.OnSave()! },
    })),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entity of [...entities]) {
        if (states.has(entity)) removeTree(entity);
        else { placementStops.get(entity)?.(); sprites.get(entity)?.instance.remove(); }
      }
      entities.length = 0; sprites.clear(); placementStops.clear();
      for (const model of [...saplings.keys()]) removeSapling(model);
      for (const handle of sounds) handle.stop(); sounds.clear();
      for (const drawn of effects) drawn.instance.remove();
      effects.clear();
      treeAssets.dispose();
      fxFactory.dispose();
      fireFx.dispose();
      if (ownsScheduler) scheduler.dispose();
    },
  };
}
