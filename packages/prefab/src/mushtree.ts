import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createArchiveSprite, ArchiveSpriteAssets, type ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { PickaxeTarget } from '@dontstarve-web/stategraphs/pickaxe';
import type { ShovelTarget } from '@dontstarve-web/stategraphs/shovel';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { createEffect, WorldContentKey, type GetWatchWorldContent, type WorldContentSignal, type SeasonState } from '@dontstarve-web/signals';
import { TileTracker } from '../../componets/src/tileManager';
import { Growable, type GrowableSave } from '../../componets/src/growable';
import { LootDropper } from '../../componets/src/lootdropper';
import { Workable } from '../../componets/src/workable';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { modelEntries } from './modelRecords';
import { MiniMapEntity } from './minimapEntity';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { MakeObstaclePhysics } from './standardcomponents';
import { setPrefabLocalLight } from './localLight';
import { BurnableBinding, FireFxHost, type BurnSpec } from './treeFire';
import { PlaySound, PreloadSounds } from './sound';
import { TILE_SIZE } from './tile';
import type { WorldEventEmitter } from './worldContext';
import catalog from './groundItems.json' with { type: 'json' };

export const MUSHTREE_MOON_ID = 'mushtree_moon' as const;
export const MUSHTREE_MEDIUM_ID = 'mushtree_medium' as const;
export const MUSHTREE_TALL_ID = 'mushtree_tall' as const;
export const MUSHTREE_IDS = [MUSHTREE_MOON_ID, MUSHTREE_MEDIUM_ID, MUSHTREE_TALL_ID] as const;
/** The `_stump` prefabs are the same constructors with state == "stump". */
export const MUSHTREE_SPAWN_IDS = [...MUSHTREE_IDS, ...MUSHTREE_IDS.map(id => `${id}_stump` as const)] as const;
export type MushtreeId = typeof MUSHTREE_IDS[number];
export type MushtreeSpawnId = typeof MUSHTREE_SPAWN_IDS[number];
export const MUSHTREE_GROWTH_STAGES = 3;
// tuning.lua: day_time = 10 * 30 and total_day_time = 480, EVERGREEN_GROW_TIME / MUSHTREE_REGROWTH.DEAD_DECAY_TIME.
export const MUSHTREE_GROWTH_TIME = [{ base: 450, random: 150 }, { base: 1500, random: 600 }, { base: 1500, random: 600 }] as const;
const DEAD_DECAY_TIME = 480 * 30;
/** tuning.lua SEG_TIME. */
const SEG_TIME = 30;
/** Animation frames are 30 per second. */
const FRAMES = 1 / 30;
/** Trees farther than this from the player are neither drawn nor animated (the moon forest has hundreds). */
const ACTIVE_RADIUS_SQUARED = (12 * TILE_SIZE) ** 2;
const STAGE_SCALE = [.9, 1, 1.1] as const;

interface TreeData {
  bank: string;
  animationArchive: string;
  /** The normal build first; the bloom build, when the tree has one, second. */
  buildArchives: readonly string[];
  icon: string;
  loot: readonly string[];
  work: number;
  lightRadius: number;
  lightColour: readonly [number, number, number];
  /** mushtree.lua tree_data season: the tree blooms while this season lasts. */
  season?: 'summer' | 'winter';
  /** mushtree.lua tree_data.tall webbable. */
  webbable?: boolean;
  growable: boolean;
}

// mushtree.lua tree_data.medium / tall (TUNING.MUSHTREE_CHOPS_MEDIUM = 10, MUSHTREE_CHOPS_TALL = 15) and mushtree_moon.lua data.moon.
const TREES: Record<MushtreeId, TreeData> = {
  mushtree_moon: {
    bank: 'mushroom_tree', animationArchive: 'mushroom_tree_tall.zip', buildArchives: ['mutatedmushroom_tree_build.zip'],
    icon: 'mushtree_moon.png', loot: ['log', 'log', 'moon_cap'], work: 15, lightRadius: 1.25,
    lightColour: [227 / 255, 227 / 255, 227 / 255], growable: false,
  },
  mushtree_medium: {
    bank: 'mushroom_tree_med', animationArchive: 'mushroom_tree_med.zip',
    buildArchives: ['mushroom_tree_med.zip', 'mushroom_tree_med_bloom.zip'],
    icon: 'mushroom_tree_med.png', loot: ['log', 'red_cap'], work: 10, lightRadius: 1.25,
    lightColour: [197 / 255, 126 / 255, 126 / 255], season: 'summer', growable: true,
  },
  mushtree_tall: {
    bank: 'mushroom_tree', animationArchive: 'mushroom_tree_tall.zip',
    buildArchives: ['mushroom_tree_tall.zip', 'mushroom_tree_tall_bloom.zip'],
    icon: 'mushroom_tree.png', loot: ['log', 'log', 'blue_cap'], work: 15, lightRadius: 1.5,
    lightColour: [111 / 255, 111 / 255, 227 / 255], season: 'winter', webbable: true, growable: true,
  },
};
const HIDDEN_SYMBOLS = [1, 2, 3].flatMap(index => [`swap_acidglob${index}`, `swap_acidglob_bloom${index}`]);

export type MushtreeState = 'normal' | 'bloom';
/** OnSave: stump, treestate and the burning flag; a stump's decay timer is the only timer component state. */
export interface MushtreeSaveState { stump?: true; burnt?: true; treestate?: MushtreeState; decay?: number }
export interface MushtreeComponents { mushtree?: MushtreeSaveState; growable?: GrowableSave }
export interface MushtreeRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: MushtreeComponents;
}

export function isMushtreeSpawnId(value: string): value is MushtreeSpawnId {
  return (MUSHTREE_SPAWN_IDS as readonly string[]).includes(value);
}

export interface MushtreeWorld {
  physics?: CANNON.World;
  /** The running game's clock; without one the manager advances a private scheduler from `update`. */
  scheduler?: GameTimeScheduler;
  /** Searched for propagator neighbours; receives fire effects. */
  scene: THREE.Object3D;
  /** Season is watched per tree through its own tile key, so trees outside the tickingarea stop following it. */
  getWatchWorldContent?: GetWatchWorldContent;
  worldEvents: WorldEventEmitter;
  dropLoot(items: readonly { itemId: string; count: number }[], position: THREE.Vector3): void;
}

interface Tree {
  prefab: MushtreeId;
  data: TreeData;
  sprite: ArchiveSprite;
  inst: ReturnType<typeof actionEntity>;
  minimap: MiniMapEntity;
  body?: CANNON.Body;
  workable: Workable;
  growable?: Growable;
  burn?: BurnableBinding;
  stump: boolean;
  treestate: MushtreeState;
  /** startchange / swapbuild task; cancelled when the tree is stumped or changes direction again. */
  changeTask?: () => void;
  growTask?: () => void;
  decayTask?: () => void;
  decayAt?: number;
  /** Private season bridge for seasonal trees; its cleanup owns the tile-gated source subscription and effect. */
  season?: WorldContentSignal<SeasonState>;
  cleanups: (() => void)[];
  removed: boolean;
}

/** mushtree.lua / mushtree_moon.lua: chopped for logs and caps, blooming with the season, leaving a diggable stump. */
export class MushtreeManager {
  private readonly scene: THREE.Scene;
  private readonly world: MushtreeWorld;
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly assets = new ArchiveSpriteAssets();
  private readonly trees = new Map<THREE.Group, Tree>();
  private readonly effects = new Set<ArchiveSprite>();
  private fire?: Promise<FireFxHost>;
  private fireHost?: FireFxHost;
  private readonly quaternion = new THREE.Quaternion();
  private disposed = false;

  constructor(scene: THREE.Scene, world: MushtreeWorld) {
    this.scene = scene; this.world = world;
    this.ownsScheduler = !world.scheduler;
    this.scheduler = world.scheduler ?? new GameTimeScheduler();
  }

  async spawn(id: MushtreeSpawnId, position: THREE.Vector3, saved?: MushtreeRecord): Promise<THREE.Group> {
    if (this.disposed) throw new Error('Mushtrees have been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid mushtree position');
    const prefab = id.replace(/_stump$/, '') as MushtreeId;
    const data = TREES[prefab];
    this.fire ??= FireFxHost.load(`${import.meta.env.BASE_URL}dst/data/anim`);
    const [sprite, fire] = await Promise.all([
      createArchiveSprite(this.assets, { animationArchive: data.animationArchive, buildArchives: data.buildArchives, bank: data.bank,
        animation: 'idle_loop', loop: true, hiddenSymbols: HIDDEN_SYMBOLS }, { name: prefab, colour: this.tint() }),
      this.fire,
      PreloadSounds('dontstarve/wilson/use_axe_mushroom', 'dontstarve/forest/treefall', 'dontstarve/forest/treeCrumble',
        'dontstarve/cave/mushtree_tall_grow_1', 'dontstarve/cave/mushtree_tall_grow_2', 'dontstarve/cave/mushtree_tall_grow_3',
        'dontstarve/cave/mushtree_tall_shrink'),
    ]);
    if (this.disposed) { sprite.dispose(); throw new Error('Mushtrees have been disposed'); }
    this.fireHost = fire;
    return this.create(prefab, data, sprite, position, saved, id.endsWith('_stump'));
  }

  /** inst.AnimState:SetMultColour(color, color, color, 1) with color = .5 + math.random() * .5. */
  private tint(): [number, number, number] {
    const colour = .5 + Math.random() * .5;
    return [colour, colour, colour];
  }

  private create(prefab: MushtreeId, data: TreeData, sprite: ArchiveSprite, position: THREE.Vector3,
    saved: MushtreeRecord | undefined, spawnAsStump: boolean): THREE.Group {
    const model = sprite.model;
    model.position.set(position.x, 0, position.z);
    Object.assign(model.userData, { entityId: saved?.id ?? newEntityId(), prefab, tags: [], physicsRadius: .25 });
    const inst = actionEntity(model, prefab);
    for (const tag of ['cavedweller', 'mushtree', 'plant', 'shelter', 'tree', ...data.webbable ? ['webbable'] : []]) inst.addTag(tag);
    const tree: Tree = { prefab, data, sprite, inst, stump: false, treestate: 'normal', removed: false, cleanups: [],
      minimap: new MiniMapEntity(model.position), workable: new Workable(inst) };
    tree.minimap.SetIcon(data.icon);
    setPrefabLocalLight(model, { colour: data.lightColour, radius: data.lightRadius * (TILE_SIZE / 4), intensity: .8, falloff: .5 });
    if (this.world.physics) {
      tree.body = MakeObstaclePhysics(model.position, .25);
      model.userData.physicsBody = tree.body;
      this.world.physics.addBody(tree.body);
    }
    this.trees.set(model, tree);
    this.scene.add(model);
    model.userData.components.workable = tree.workable;
    // The prefab starts in a random frame of idle_loop; sprite playback is clocked from 0, so advance it.
    sprite.update(Math.random() * 2);

    const components = saved?.components, state = components?.mushtree;
    this.watchSeason(tree);
    this.bindBurn(tree);
    if (data.growable) this.createGrowable(tree, components?.growable);
    this.setupWork(tree);
    if (spawnAsStump || state?.stump) this.makeStump(tree, state?.decay);
    else if (state?.burnt) this.treeBurnt(tree);
    else this.initialSeason(tree, state?.treestate);
    return model;
  }

  /** WatchWorldState("is"..season, onisinseason): only changes notify, and a tree outside the tickingarea resyncs on return. */
  private watchSeason(tree: Tree): void {
    const { data, sprite } = tree;
    if (!data.season || !this.world.getWatchWorldContent) return;
    const tracker = new TileTracker(() => sprite.model.position);
    const season = tree.season = this.world.getWatchWorldContent(WorldContentKey.Season, cleanup => tree.cleanups.push(cleanup), { tile: tracker.tile });
    let previous = season.peek().season;
    createEffect(() => {
      const current = season.get().season;
      if (current === previous) return;
      const left = previous;
      previous = current;
      if (current === data.season) this.onIsInSeason(tree, true);
      else if (left === data.season) this.onIsInSeason(tree, false);
    });
  }

  /** MakeMediumPropagator + MakeLargeBurnable(FX level 5) on a tree; MakeSmallBurnable + MakeSmallPropagator on a stump. */
  private bindBurn(tree: Tree): void {
    tree.burn?.dispose();
    const fire = this.fireHost, scheduler = this.scheduler;
    if (!fire) return;
    const spec: BurnSpec = tree.stump
      ? { propagator: 'small', burnTime: 10, fxLevel: 2, onBurnt: () => this.stumpBurnt(tree) }
      : { propagator: 'medium', burnTime: 30, fxLevel: 5, onBurnt: () => this.treeBurnt(tree) };
    tree.burn = new BurnableBinding(tree.inst, spec, { scheduler, root: this.world.scene, fire });
  }

  /** tree_burnt: ash, charcoal half of the time, the burnt fx, then the inst is removed. */
  private treeBurnt(tree: Tree): void {
    if (tree.removed) return;
    const position = tree.sprite.model.position.clone();
    this.world.worldEvents.emit('spawnAsh', position);
    if (Math.random() < .5) this.world.dropLoot([{ itemId: 'charcoal', count: 1 }], position);
    void this.spawnBurntFx(tree, position);
    this.remove(tree.sprite.model);
  }

  /** stump_burnt: one ash. */
  private stumpBurnt(tree: Tree): void {
    if (tree.removed) return;
    this.world.worldEvents.emit('spawnAsh', tree.sprite.model.position.clone());
    this.remove(tree.sprite.model);
  }

  /** makeburntfx: chop_burnt in the current build, with the crumble sound, then removed. */
  private async spawnBurntFx(tree: Tree, position: THREE.Vector3): Promise<void> {
    const { data } = tree;
    const bloom = tree.treestate === 'bloom' && data.buildArchives.length > 1;
    try {
      const fx = await createArchiveSprite(this.assets, { animationArchive: data.animationArchive,
        buildArchives: [data.buildArchives[bloom ? 1 : 0]], bank: data.bank, animation: 'chop_burnt', loop: false,
        hiddenSymbols: HIDDEN_SYMBOLS }, { name: `${tree.prefab}_burntfx` });
      if (this.disposed) { fx.dispose(); return; }
      fx.model.position.set(position.x, 0, position.z);
      fx.model.quaternion.copy(this.quaternion);
      fx.model.userData.tags = ['FX', 'NOCLICK'];
      this.scene.add(fx.model);
      this.effects.add(fx);
      PlaySound('dontstarve/forest/treeCrumble', position);
      fx.playOnce('chop_burnt', () => { this.effects.delete(fx); fx.dispose(); });
    } catch (error) { console.error('Unable to play mushtree burnt fx', error); }
  }

  private createGrowable(tree: Tree, saved: GrowableSave | undefined): void {
    const { sprite } = tree;
    const growNext = () => {
      tree.growTask = undefined;
      // DoGrowNextStage: the stage advances 14 frames after the growth animation starts, unless the tree was stumped.
      if (!tree.stump && !tree.removed) tree.growable!.SetStage(tree.growable!.GetNextStage());
    };
    const doGrow = (toStage: 1 | 2 | 3) => {
      if (tree.stump) return;
      sprite.playOnce(toStage === 1 ? 'shrink' : 'change', () => sprite.start('idle_loop'));
      PlaySound(toStage === 1 ? 'dontstarve/cave/mushtree_tall_shrink'
        : toStage === 2 ? 'dontstarve/cave/mushtree_tall_grow_1' : 'dontstarve/cave/mushtree_tall_grow_2', sprite.model.position);
      tree.growTask?.();
      tree.growTask = this.scheduler.schedule(14 * FRAMES, growNext);
    };
    const growable = tree.growable = new Growable(this.scheduler, STAGE_SCALE.map((scale, index) => ({
      time: () => MUSHTREE_GROWTH_TIME[index].base + (Math.random() * 2 - 1) * MUSHTREE_GROWTH_TIME[index].random,
      fn: () => sprite.model.scale.setScalar(scale),
      growfn: () => doGrow((index + 1) as 1 | 2 | 3),
    })));
    growable.loopstages = true; growable.growonly = true;
    sprite.model.userData.components.growable = growable;
    if (saved) growable.OnLoad(saved);
    else { growable.SetStage(Math.floor(Math.random() * 3) + 1); growable.StartGrowing(); }
  }

  /** CHOP work with workcallback / workfinishcallback; stumping swaps it for a single DIG. */
  private setupWork(tree: Tree): void {
    const { workable, sprite, data } = tree;
    const model = sprite.model;
    workable.SetWorkAction('CHOP');
    workable.SetWorkLeft(data.work);
    workable.SetOnWorkCallback((_worker, workleft) => {
      PlaySound('dontstarve/wilson/use_axe_mushroom', model.position);
      if (workleft > 0) sprite.playOnce('chop', () => sprite.start('idle_loop'));
    });
    workable.SetOnFinishCallback(() => {
      // DropLoot, makestump, the fall sound, then fall and idle_stump.
      const loot: string[] = [];
      const dropper = new LootDropper({ getPosition: () => model.position }, itemId => { loot.push(itemId); return undefined; });
      dropper.SetLoot(data.loot);
      dropper.DropLoot();
      this.dropCatalogLoot(loot, model.position);
      this.makeStump(tree);
      PlaySound('dontstarve/forest/treefall', model.position);
      sprite.playOnce('fall', () => sprite.start('idle_stump'));
    });
  }

  /** Loot prefabs that have no ground item in the catalog (moon_cap) cannot be dropped yet. */
  private dropCatalogLoot(loot: readonly string[], position: THREE.Vector3): void {
    const counts = new Map<string, number>();
    for (const itemId of loot) if (Object.hasOwn(catalog.items, itemId)) counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
    this.world.dropLoot([...counts].map(([itemId, count]) => ({ itemId, count })), position.clone());
  }

  private makeStump(tree: Tree, decayRemaining?: number): void {
    if (tree.stump) return;
    const { sprite, inst, workable } = tree, model = sprite.model;
    tree.changeTask?.(); tree.changeTask = undefined;
    tree.growTask?.(); tree.growTask = undefined;
    tree.stump = true;
    if (tree.body) { this.world.physics?.removeBody(tree.body); tree.body = undefined; delete model.userData.physicsBody; }
    inst.addTag('stump'); inst.removeTag('shelter');
    this.bindBurn(tree);
    tree.growable?.StopGrowing();
    workable.SetWorkAction('DIG');
    workable.SetOnWorkCallback(undefined);
    workable.SetOnFinishCallback(() => {
      // dig_up_stump: one log, then the inst is removed.
      this.dropCatalogLoot(['log'], model.position);
      this.remove(model);
    });
    workable.SetWorkLeft(1);
    sprite.start('idle_stump');
    tree.minimap.SetIcon('mushroom_tree_stump.png');
    setPrefabLocalLight(model, null);
    // The decay timer exists only once: a loaded stump keeps what remained.
    const delay = decayRemaining ?? DEAD_DECAY_TIME * (1 + (Math.random() - .5));
    tree.decayAt = this.scheduler.now + delay;
    tree.decayTask = this.scheduler.schedule(delay, () => { tree.decayTask = undefined; this.remove(model); });
  }

  /** bloom_tree / normal_tree: swap the build at once, or after a random delay with the change animation. */
  private setTreeState(tree: Tree, treestate: MushtreeState, instant: boolean): void {
    tree.changeTask?.(); tree.changeTask = undefined;
    const swap = () => {
      tree.changeTask = undefined;
      if (tree.stump || tree.removed) return;
      tree.sprite.setBuildArchive(tree.data.buildArchives[treestate === 'bloom' ? 1 : 0]);
      tree.treestate = treestate;
    };
    if (instant) { swap(); return; }
    tree.changeTask = this.scheduler.schedule(Math.random() * 3 * SEG_TIME, () => {
      tree.changeTask = undefined;
      if (tree.stump || tree.removed) return;
      tree.sprite.playOnce('change', () => tree.sprite.start('idle_loop'));
      PlaySound(treestate === 'bloom' ? 'dontstarve/cave/mushtree_tall_grow_3' : 'dontstarve/cave/mushtree_tall_shrink', tree.sprite.model.position);
      tree.changeTask = this.scheduler.schedule(14 * FRAMES, swap);
    });
  }

  /** onisinseason. */
  private onIsInSeason(tree: Tree, inSeason: boolean): void {
    if (!tree.data.season || tree.stump || tree.removed) return;
    if (inSeason) {
      if (tree.treestate !== 'bloom') this.setTreeState(tree, 'bloom', false);
      else { tree.changeTask?.(); tree.changeTask = undefined; }
    } else if (tree.treestate !== 'normal') this.setTreeState(tree, 'normal', false);
    else { tree.changeTask?.(); tree.changeTask = undefined; }
  }

  /** Construction blooms at once in season; OnLoad restores the saved build and then follows the season. */
  private initialSeason(tree: Tree, saved: MushtreeState | undefined): void {
    if (!tree.data.season) return;
    const inSeason = tree.season?.peek().season === tree.data.season;
    if (inSeason) this.setTreeState(tree, 'bloom', true);
    if (saved === 'normal') {
      this.setTreeState(tree, 'normal', true);
      if (inSeason) this.setTreeState(tree, 'bloom', false);
    } else if (saved === 'bloom') {
      this.setTreeState(tree, 'bloom', true);
      if (!inSeason) this.setTreeState(tree, 'normal', false);
    }
  }

  update(dt: number, quaternion: THREE.Quaternion, focus?: THREE.Vector3): void {
    if (this.disposed) return;
    if (this.ownsScheduler) this.scheduler.advance(dt);
    this.quaternion.copy(quaternion);
    for (const { sprite } of this.trees.values()) {
      const model = sprite.model;
      model.visible = !focus || model.position.distanceToSquared(focus) <= ACTIVE_RADIUS_SQUARED;
      if (!model.visible) continue;
      model.quaternion.copy(quaternion); sprite.update(dt);
    }
    for (const fx of this.effects) { fx.model.quaternion.copy(quaternion); fx.update(dt); }
    this.fireHost?.update(dt, quaternion);
  }

  get renderEntities() {
    return [
      ...[...this.trees.values()].filter(({ sprite }) => sprite.model.visible).map(({ sprite }) => ({ object: sprite.model, footPosition: sprite.model.position, cameraDepth: 0 })),
      ...[...this.effects].map(fx => ({ object: fx.model, footPosition: fx.model.position, cameraDepth: 0 })),
      ...this.fireHost?.renderEntities ?? [],
    ];
  }

  get miniMapEntities(): MiniMapEntity[] { return [...this.trees.values()].map(({ minimap }) => minimap); }

  getChopTargets(model?: THREE.Object3D): PickaxeTarget[] { return this.workTargets('CHOP', model); }

  getDigTargets(model?: THREE.Object3D): ShovelTarget[] {
    return this.workTargets('DIG', model).map(target => ({ ...target, dig: () => target.isValid() && performToolWork('DIG', target.entity, {}) }));
  }

  private workTargets(action: 'CHOP' | 'DIG', model?: THREE.Object3D): PickaxeTarget[] {
    return modelEntries(this.trees, model).filter(([, tree]) => tree.workable.CanBeWorked() && tree.workable.GetWorkAction() === action)
      .map(([model, tree]) => ({ id: String(model.userData.entityId), model, position: model.position, entity: tree.inst,
        isValid: () => this.trees.get(model) === tree && tree.workable.CanBeWorked() && tree.workable.GetWorkAction() === action }));
  }

  exportRecords(): { prefabId: MushtreeId; record: MushtreeRecord }[] {
    return [...this.trees].map(([model, tree]) => {
      // OnSave: a burning tree is saved as burnt (and reloads into ash); a burning stump stays a stump.
      const burnt = !tree.stump && tree.burn?.burnable.IsBurning() === true;
      const decay = tree.decayAt === undefined ? undefined : Math.max(0, tree.decayAt - this.scheduler.now);
      const mushtree: MushtreeSaveState = { ...tree.stump ? { stump: true } : {}, ...burnt ? { burnt: true } : {},
        ...tree.data.growable && !tree.stump ? { treestate: tree.treestate } : {}, ...decay === undefined ? {} : { decay } };
      return { prefabId: tree.prefab, record: {
        id: String(model.userData.entityId),
        transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
        components: { ...Object.keys(mushtree).length ? { mushtree } : {}, ...tree.growable ? { growable: tree.growable.OnSave() } : {} },
      } };
    });
  }

  private remove(model: THREE.Group): void {
    const tree = this.trees.get(model); if (!tree) return;
    this.trees.delete(model); model.userData.removed = true; tree.removed = true;
    tree.changeTask?.(); tree.growTask?.(); tree.decayTask?.();
    tree.burn?.dispose(); tree.growable?.dispose(); tree.workable.dispose();
    for (const cleanup of tree.cleanups.splice(0)) cleanup();
    if (tree.body) this.world.physics?.removeBody(tree.body);
    setPrefabLocalLight(model, null);
    tree.minimap.dispose(); tree.sprite.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of [...this.trees.keys()]) this.remove(model);
    for (const fx of this.effects) fx.dispose();
    this.effects.clear();
    this.fireHost?.dispose();
    this.assets.dispose();
    if (this.ownsScheduler) this.scheduler.dispose();
  }
}
