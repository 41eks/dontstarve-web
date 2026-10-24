import { ModelRecords, modelEntries } from './modelRecords';
import * as THREE from 'three';
import {
  createAnimatedSpriteFactory,
  type SpriteAnimationController,
} from '@dontstarve-web/animation/sprite';
import { ArchiveSpriteAssets, preloadSharedArchiveSprite, type ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { PickaxeTarget } from '@dontstarve-web/stategraphs/pickaxe';
import type { ShovelTarget } from '@dontstarve-web/stategraphs/shovel';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { Workable, type Worker } from '../../componets/src/workable';
import { actionEntity, disposeActionEntity } from './actionEntity';
import catalog from './groundItems.json' with { type: 'json' };
import { ResidentSprite, type ResidentEntity } from './residentSprite';
import { watchTileActivity } from './tileActivity';
import { registerPlacementTree } from './placementEntities';
import { PlaySound } from './sound';
import { TILE_SIZE } from './tile';
import definitions from './definitions.json' with { type: 'json' };
import { Growable, type GrowableSave } from '../../componets/src/growable';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Timer, type NamedTimerSave } from '../../componets/src/timer';
import { newEntityId } from './saveRecord';
import { MiniMapEntity } from './minimapEntity';
import { PreloadSounds, type SoundHandle } from './sound';
import { BurnableBinding, FireFxHost, TREE_BURN_TIME, type BurnEnvironment, type BurnSpec } from './treeFire';
import { getBoundWatchWorldContent, WorldContentKey, createEffect, type GetWatchWorldContent, type ReadonlySignal, type SeasonState, type TileStateQuery } from '@dontstarve-web/signals';
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
  /** Only visuals are resident while the entity's tile is active; set by `bindWorld`. */
  readonly tickingarea?: TileStateQuery;
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
export interface MoonTreeComponents { moonTree?: MoonTreeSaveState; growable?: GrowableSave; moonTreeTimer?: NamedTimerSave }
export interface MoonTreeSaplingRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { saplingTimer: NamedTimerSave };
}

interface TreeState { stump: boolean; burnt: boolean; workLeft: number; growable: Growable; minimap: MiniMapEntity; timer: Timer; changesTask?: () => void; removeTask?: () => void }

interface TreeController {
  readonly entity: ResidentEntity;
  readonly model: THREE.Group;
  readonly inst: ReturnType<typeof actionEntity>;
  stopActivity?: () => void;
  workable?: Workable;
  /** MakeXBurnable + MakeXPropagator while the tree is awake. */
  burn?: BurnableBinding;
  /** Private snow-level bridge; its cleanup owns the source subscription and the layer effect. */
  stopSnow?: () => void;
}

export interface MoonTreeForestOptions {
  animationName?: string;
  areaSize?: number;
  count?: number;
  exclusionRadiusSquared?: number;
  /** Explicit ground positions; takes precedence over random generation options. */
  positions?: readonly THREE.Vector3[];
  entityIds?: readonly string[];
  random?: () => number;
  scale?: number;
}

export interface MoonTreeForest {
  group: THREE.Group;
  positions: readonly THREE.Vector3[];
  entities: readonly ResidentEntity[];
  readonly miniMapEntities: readonly MiniMapEntity[];
  readonly activeEntities: ReadonlySet<ResidentEntity>;
  setNormals(cameraWorldQuaternion: THREE.Quaternion): void;
  update(dt: number): void;
  dispose(): void;
  /** Binds the loot sink and camera used by tree work; returns the matching release. */
  bindWorld(world: MoonTreeWorld): () => void;
  /** CHOP_workable trees with resident visuals, at their ground-contact points. */
  readonly chopTargets: readonly PickaxeTarget[];
  getChopTargets(model?: THREE.Object3D): readonly PickaxeTarget[];
  /** DIG_workable stumps with resident visuals. */
  readonly digTargets: readonly ShovelTarget[];
  getDigTargets(model?: THREE.Object3D): readonly ShovelTarget[];
  /** Resident tree visuals plus transient chop effects, for whole-entity depth ordering. */
  readonly renderEntities: readonly { object: THREE.Group; footPosition: THREE.Vector3; cameraDepth: number }[];
  restoreState(saveId: string, state: MoonTreeSaveState | undefined, growth?: GrowableSave, timer?: NamedTimerSave): void;
  exportState(entity: ResidentEntity): MoonTreeComponents;
  spawnTree(prefab: typeof MOON_TREE_SPAWN_IDS[number], position: THREE.Vector3, id?: string, fromSeed?: boolean): ResidentEntity;
  spawnSapling(position: THREE.Vector3, saved?: MoonTreeSaplingRecord): THREE.Group;
  prepareTransplant(): Promise<{ spawn(position: THREE.Vector3): boolean; dispose(): void }>;
  exportSaplings(): MoonTreeSaplingRecord[];
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
  const treeAssets = new ArchiveSpriteAssets('moon_tree', assetBaseUrl);
  const standingAnimation = options.animationName ?? definitions.moonTree.animationName;
  const [createTree, fxFactory, saplingFactory, fireFx] = await Promise.all([
    // MakeSnowCoveredPristine: the `snow` placeholder is drawn from snow.zip while the snow level is covered.
    preloadSharedArchiveSprite(treeAssets, { animationArchive: definitions.moonTree.archive,
      buildArchives: [definitions.moonTree.archive, 'snow.zip'], bank: 'moon_tree', hiddenSymbols: ['snow'],
      symbolOverrides: { snow: { archive: 'snow.zip', symbol: 'snow' } } },
    { scale, staticBillboard: true, instancedAnimations: [...new Set([standingAnimation, ...MOON_TREE_SIZES.map(size => `sway1_loop_${size}`)])] }),
    createAnimatedSpriteFactory(assetBaseUrl, 'tree_petal_fx.zip'),
    createAnimatedSpriteFactory(assetBaseUrl, 'baby_moon_tree.zip'),
    FireFxHost.load(assetBaseUrl),
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
  const group = new THREE.Group(); group.name = 'MoonTreeForest';
  const entities: ResidentEntity[] = [];
  const active = new Set<ResidentEntity>();
  const sprites = new Map<ResidentEntity, ResidentSprite>();
  const placementStops = new Map<ResidentEntity, () => void>();
  let nextId = 0;
  const states = new Map<ResidentEntity, TreeState>();
  const controllers = new Map<THREE.Group, TreeController>();
  const mouseRecords = new ModelRecords<ResidentEntity>();
  const effects = new Set<THREE.Group>();
  const saplings = new Map<THREE.Group, { timer: Timer; workable: Workable }>();
  const sounds = new Set<SoundHandle>();
  const sound = (path: Parameters<typeof PlaySound>[0], position: THREE.Vector3) => {
    for (const handle of sounds) if (!handle.isPlaying?.()) sounds.delete(handle);
    sounds.add(PlaySound(path, position));
  };
  let scheduler = new GameTimeScheduler();
  let ownsScheduler = true;
  let disposed = false;
  let world: MoonTreeWorld | undefined;
  let getWatchWorldContent: GetWatchWorldContent | undefined;
  const lastQuaternion = new THREE.Quaternion();
  const env = (): BurnEnvironment => ({ scheduler, root: world!.scene, fire: fireFx });
  const sizeOf = (state: TreeState): MoonTreeSize => MOON_TREE_SIZES[state.growable.GetStage() - 1];
  /** Growth settled while the visual was unloaded is shown as its final stage, without the transition animation. */
  let catchingUp = false;
  const wakeGrowable = (entity: ResidentEntity) => {
    catchingUp = true;
    try { stateOf(entity).growable.OnEntityWake(); } finally { catchingUp = false; }
  };
  const playGrowth = (entity: ResidentEntity, clip: string, wilt = false) => {
    if (!active.has(entity) || catchingUp) return;
    const animation = entity.model.userData.animationController as SpriteAnimationController;
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
            (controller.model.userData.animationController as SpriteAnimationController).start(`sway1_loop_${size}`);
            refreshFire(controller);
          }
        },
        growfn: () => playGrowth(entity, ['grow_tall_to_short', 'grow_short_to_normal', 'grow_normal_to_tall'][index], index === 0),
      })), seconds => world?.growthDuration?.(seconds) ?? seconds);
      const minimap = new MiniMapEntity(entity.position);
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
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(world!.camera.getWorldQuaternion(new THREE.Quaternion()));
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
    if (!world || !active.has(controller.entity) || controller.burn || state.burnt) return;
    controller.burn = new BurnableBinding(controller.inst, burnSpec(controller.entity, state), env());
  };
  /** weather.lua SNOW_COVERED_THRESHOLD; without a bound world the snow layer stays hidden. */
  const bindSnow = (controller: TreeController) => {
    controller.stopSnow?.(); controller.stopSnow = undefined;
    const sprite = controller.model.userData.animationController as ArchiveSprite;
    const level = getWatchWorldContent?.(WorldContentKey.SnowLevel, stop => { controller.stopSnow = stop; });
    if (level) createEffect(() => sprite.setSymbolHidden('snow', level.get() < .015));
    else sprite.setSymbolHidden('snow', true);
  };
  const unbindFire = (controller: TreeController) => { controller.burn?.dispose(); controller.burn = undefined; };
  /** A stage change reconfigures the burnable in place, unless it is already burning. */
  const refreshFire = (controller: TreeController) => {
    if (controller.burn?.burnable.IsBurning()) return;
    unbindFire(controller); bindFire(controller);
  };
  /** DefaultBurntFn on a stump: one ash, then the inst is removed. */
  const burnStump = (entity: ResidentEntity) => {
    world?.worldEvents.emit('spawnAsh', entity.position.clone());
    removeTree(entity);
  };
  const removeTree = (entity: ResidentEntity) => {
    const state = states.get(entity);
    if (!state) return;
    state.changesTask?.(); state.removeTask?.();
    const controller = controllers.get(entity.model);
    if (controller) unbindFire(controller);
    state.growable.dispose(); state.timer.dispose(); state.minimap.dispose();
    states.delete(entity);
    active.delete(entity);
    entities.splice(entities.indexOf(entity), 1);
    controller?.stopActivity?.(); controller?.stopSnow?.(); controller?.workable?.dispose();
    controllers.delete(entity.model);
    placementStops.get(entity)?.(); placementStops.delete(entity);
    entity.model.userData.removed = true; disposeActionEntity(entity.model);
    const sprite = sprites.get(entity); sprites.delete(entity); sprite?.dispose();
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
    (controller?.model.userData.animationController as SpriteAnimationController | undefined)?.start(`burnt_${sizeOf(state)}`);
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

  // moontree.lua: thirty days with +/- 50% variance, created only once for a dead tree.
  const startDecay = (state: TreeState) => {
    if (!state.timer.TimerExists('decay')) state.timer.StartTimer('decay', 14400 + (random() * 2 - 1) * 7200);
  };

  /** make_stump: replace CHOP work with one DIG, removing shelter. */
  const makeStump = (controller: TreeController) => {
    const { entity, model, inst } = controller;
    unbindFire(controller);
    const state = stateOf(entity);
    state.growable.StopGrowing();
    state.minimap.SetIcon('moon_tree_stump.png');
    startDecay(state);
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
    group.add(fx);
    effects.add(fx);
    (fx.userData.animationController as SpriteAnimationController).playOnce('chop', () => {
      effects.delete(fx);
      fxFactory.disposeSprite(fx);
    });
  };

  const attach = (entity: ResidentEntity, model: THREE.Group) => {
    const state = stateOf(entity);
    const inst = actionEntity(model, 'moon_tree');
    const controller: TreeController = { entity, model, inst };
    mouseRecords.set(model, entity);
    controllers.set(model, controller);
    model.userData.prefab = 'moon_tree';
    model.userData.deploySmartRadius = 1.6 * unit;
    model.userData.MiniMapEntity = state.minimap;
    model.userData.components.growable = state.growable;
    model.userData.components.timer = state.timer;
    for (const tag of ['plant', 'tree', 'moon_tree']) inst.addTag(tag);
    // standardcomponents.lua MakeSnowCoveredPristine applies to trees and stumps, not saplings.
    inst.addTag('SnowCovered');
    if (state.stump) {
      makeStump(controller);
      (model.userData.animationController as SpriteAnimationController).playOnce(`stump_${sizeOf(state)}`);
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

  const createEntity = (position: THREE.Vector3, saveId?: string): ResidentEntity => {
    if (saveId && entities.some(entity => entity.saveId === saveId)) throw new Error(`Duplicate entity ID: ${saveId}`);
    const id = nextId++;
    const sprite = new ResidentSprite(clip => {
      const drawn = createTree(clip.name, clip.loop, `MoonTree-${id}`);
      drawn.model.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(drawn.model);
      drawn.model.children[0].position.y -= bounds.min.y;
      return drawn;
    }, { name: standingAnimation, loop: true });
    const model = sprite.model; model.position.copy(position);
    model.userData.animationController = sprite;
    model.userData.placementLogical = true;
    if (saveId) model.userData.entityId = saveId;
    const entity: ResidentEntity = { id, saveId, model, position: model.position };
    sprites.set(entity, sprite); entities.push(entity); group.add(model);
    placementStops.set(entity, registerPlacementTree(group, entity, 'moon_tree', 1.6 * unit));
    return entity;
  };
  const setActive = (controller: TreeController, awake: boolean) => {
    const { entity } = controller, sprite = sprites.get(entity);
    if (!sprite || active.has(entity) === awake) return;
    if (awake) {
      active.add(entity);
      wakeGrowable(entity);
      bindSnow(controller); bindFire(controller);
      sprite.setActive(true);
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
      sprite.setActive(false);
    }
  };
  const bindActivity = (entity: ResidentEntity) => {
    let controller = controllers.get(entity.model);
    if (!controller) { attach(entity, entity.model); controller = controllers.get(entity.model)!; }
    controller.stopActivity?.();
    controller.stopActivity = watchTileActivity(entity.model, world?.tickingarea, awake => setActive(controller!, awake));
  };

  const removeSapling = (model: THREE.Group) => {
    const sapling = saplings.get(model);
    if (!sapling) return;
    model.userData.removed = true;
    sapling.timer.dispose(); sapling.workable.dispose();
    saplings.delete(model); saplingFactory.disposeSprite(model);
  };

  const spawnTree = (prefab: typeof MOON_TREE_SPAWN_IDS[number], position: THREE.Vector3,
    id = newEntityId(), fromSeed = false): ResidentEntity => {
    const stage = prefab === 'moon_tree' ? Math.min(3, Math.floor(random() * 3) + 1) : MOON_TREE_SPAWN_IDS.indexOf(prefab);
    const entity = createEntity(position, id);
    stateOf(entity, stage);
    if (world) bindActivity(entity);
    if (fromSeed) playGrowth(entity, 'grow_seed_to_short');
    return entity;
  };

  const spawnSapling = (position: THREE.Vector3, saved?: MoonTreeSaplingRecord): THREE.Group => {
    const model = saplingFactory.create({ initialAnimation: 'idle', name: 'moonbutterfly_sapling' });
    model.position.copy(position);
    model.quaternion.copy(world!.camera.getWorldQuaternion(new THREE.Quaternion()));
    Object.assign(model.userData, { entityId: saved?.id ?? newEntityId(), prefab: 'moonbutterfly_sapling', deploySmartRadius: 1.6 * unit, tags: ['plant', 'moon_tree'] });
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
    saplings.set(model, { timer, workable }); group.add(model);
    timer.StartTimer('grow', MOONBUTTERFLY_SAPLING_GROW_TIME.base + (random() * 2 - 1) * MOONBUTTERFLY_SAPLING_GROW_TIME.random);
    timer.OnLoad(saved?.components.saplingTimer);
    return model;
  };

  const workTargets = (action: 'CHOP' | 'DIG', selectedModel?: THREE.Object3D): PickaxeTarget[] => {
    if (!world) return [];
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
    const saplingTargets = modelEntries(saplings, model).map(([model, { workable }]) => ({
      id: String(model.userData.entityId), model, position: model.position, entity: actionEntity(model, 'moonbutterfly_sapling'),
      isValid: () => saplings.has(model) && workable.CanBeWorked(),
    }));
    return [...workTargets('DIG', model), ...saplingTargets].map(target => ({ ...target,
      dig: () => target.isValid() && performToolWork('DIG', target.entity, {}),
    }));
  };
  if (options.entityIds && (options.entityIds.length !== positions.length
    || new Set(options.entityIds).size !== positions.length || options.entityIds.some(id => !id))) throw new Error('Invalid persistent entity IDs');
  positions.forEach((position, index) => createEntity(position, options.entityIds?.[index]));
  return {
    group,
    get positions() { return entities.map(entity => entity.position); },
    entities,
    get miniMapEntities() { return [...states.values()].map(state => state.minimap); },
    get activeEntities() { return active; },
    setNormals(cameraWorldQuaternion) {
      lastQuaternion.copy(cameraWorldQuaternion);
      for (const entity of active) {
        (entity.model.userData.animationController as ArchiveSprite).faceCamera(cameraWorldQuaternion);
      }
      for (const fx of effects) fx.quaternion.copy(cameraWorldQuaternion);
      for (const model of saplings.keys()) model.quaternion.copy(cameraWorldQuaternion);
    },
    update(dt) {
      if (ownsScheduler) scheduler.advance(dt);
      fireFx.update(dt, lastQuaternion);
      for (const entity of active) {
        const animation = entity.model.userData.animationController as SpriteAnimationController;
        animation.update(dt);
      }
      for (const fx of [...effects]) (fx.userData.animationController as SpriteAnimationController).update(dt);
      for (const model of saplings.keys()) (model.userData.animationController as SpriteAnimationController).update(dt);
    },
    bindWorld(next) {
      for (const controller of controllers.values()) {
        controller.stopActivity?.(); controller.stopActivity = undefined;
        setActive(controller, false);
      }
      world = next;
      getWatchWorldContent = getBoundWatchWorldContent();
      if (next.scheduler && ownsScheduler && !states.size && !saplings.size) {
        scheduler.dispose(); scheduler = next.scheduler; ownsScheduler = false;
      }
      for (const entity of entities) { stateOf(entity); bindActivity(entity); }
      return () => {
        if (world !== next) return;
        for (const controller of controllers.values()) {
          controller.stopActivity?.(); controller.stopActivity = undefined;
          setActive(controller, false);
        }
        world = undefined; getWatchWorldContent = undefined;
      };
    },
    get chopTargets() { return workTargets('CHOP'); },
    getChopTargets(model) { return workTargets('CHOP', model); },
    get digTargets() { return digTargets(); },
    getDigTargets: digTargets,
    get renderEntities() {
      return [
        ...Array.from(active, (entity) => ({ object: entity.model, footPosition: entity.position, cameraDepth: 0 })),
        ...Array.from(effects, (fx) => ({ object: fx, footPosition: fx.userData.footPosition as THREE.Vector3, cameraDepth: 0 })),
        ...Array.from(saplings.keys(), model => ({ object: model, footPosition: model.position, cameraDepth: 0 })),
        ...fireFx.renderEntities,
      ];
    },
    restoreState(saveId, saved, growth, timer) {
      const entity = entities.find(candidate => candidate.saveId === saveId);
      if (!entity) return;
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
        (controller.model.userData.animationController as SpriteAnimationController).start(`stump_${sizeOf(state)}`);
      }
      // on_load: a saved burnt tree (or one that was burning) becomes burnt at once; its stump variant is not restored.
      if (saved?.burnt && !state.stump) burn(entity, true);
    },
    exportState(entity) {
      const state = stateOf(entity);
      // on_save: a burning tree is saved as burnt; a burning stump is still a stump.
      const controller = controllers.get(entity.model);
      const burnt = !state.stump && (state.burnt || controller?.burn?.burnable.IsBurning() === true);
      const timer = state.timer.OnSave();
      return { moonTree: { size: sizeOf(state), ...(state.stump ? { stump: true } : {}), ...(burnt ? { burnt: true } : {}) },
        growable: burnt ? { stage: state.growable.GetStage() } : state.growable.OnSave(),
        ...(timer ? { moonTreeTimer: timer } : {}) };
    },
    spawnTree,
    spawnSapling,
    async prepareTransplant() {
      if (disposed || !world) throw new Error('Moon tree forest is unavailable');
      let available = true;
      return {
        dispose: () => { available = false; },
        spawn: position => {
          if (!available || disposed || !world) return false;
          available = false;
          spawnSapling(position);
          return true;
        },
      };
    },
    exportSaplings: () => [...saplings].map(([model, { timer }]) => ({
      id: String(model.userData.entityId), transform: { position: model.position.toArray(), rotationY: 0 },
      components: { saplingTimer: timer.OnSave()! },
    })),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entity of [...entities]) {
        if (states.has(entity)) removeTree(entity);
        else { placementStops.get(entity)?.(); sprites.get(entity)?.dispose(); }
      }
      entities.length = 0; sprites.clear(); placementStops.clear(); group.removeFromParent();
      for (const model of [...saplings.keys()]) removeSapling(model);
      for (const handle of sounds) handle.stop(); sounds.clear();
      for (const fx of effects) fxFactory.disposeSprite(fx);
      effects.clear();
      treeAssets.dispose();
      fxFactory.dispose();
      fireFx.dispose();
      saplingFactory.dispose();
      if (ownsScheduler) scheduler.dispose();
    },
  };
}
