import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import type { PickaxeTarget } from '@dontstarve-web/stategraphs/mine';
import type { ShovelTarget } from '@dontstarve-web/stategraphs/dig';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { createEffect, WorldContentKey, type GetWatchWorldContent, type HandEquipment, type ReadonlySignal, type WorldContentSignal, type SeasonState, type TileStateQuery } from '@dontstarve-web/signals';
import { Growable, type GrowableSave } from '../../componets/src/growable';
import { LootDropper } from '../../componets/src/lootdropper';
import { Workable } from '../../componets/src/workable';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { modelEntries } from './modelRecords';
import { actionEntity } from './actionEntity';
import { ToolMouseTarget } from './toolMouseTarget';
import { PrefabDisplayGroup, SpriteResources, SpriteState, type ArchiveSpriteCommands, type PrefabDisplay } from '@dontstarve-web/display';
import { bindInstance, PrefabInstance } from './prefabInstance';
import { ComponentTimer, Timer } from '../../componets/src/timer';
import { AnimState } from '../../componets/src/animstate';
import { watchTileActivity } from './tileActivity';
import { newEntityId } from './saveRecord';
import { MakeObstaclePhysics, RemovePhysicsColliders } from './standardcomponents';
import { BurnableBinding, FireFxHost, type BurnEnvironment, type BurnSpec } from './treeFire';
import { PlaySound } from './sound';
import { TILE_SIZE } from './tile';
import type { WorldEventEmitter } from './worldContext';
import catalog from './groundItems.json' with { type: 'json' };
import { animationTiming } from './animationTimings';

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
  handEquipment?: ReadonlySignal<HandEquipment | null>;
  physics?: CANNON.World;
  /** The running game's clock; without one the manager advances a private scheduler from `update`. */
  scheduler?: GameTimeScheduler;
  /** Searched for propagator neighbours; receives fire effects. */
  scene: THREE.Object3D;
  /** Season is watched per tree through its own tile key, so trees outside the tickingarea stop following it. */
  getWatchWorldContent?: GetWatchWorldContent;
  /** Trees outside it release their sprite; without it they stay loaded. */
  tickingarea?: TileStateQuery;
  worldEvents: WorldEventEmitter;
  dropLoot(items: readonly { itemId: string; count: number }[], position: THREE.Vector3): void;
}

interface MushtreeEnvironment extends BurnEnvironment {
  readonly world: Omit<MushtreeWorld, 'scene'>;
  spawnBurntFx(prefab: MushtreeId, treestate: MushtreeState, position: THREE.Vector3): void;
}

/** mushtree.lua's logical inst; source tasks, components and build declarations survive visual unloading. */
export class MushtreeInstance extends PrefabInstance<ArchiveSpriteCommands> {
  declare readonly components: PrefabInstance<ArchiveSpriteCommands>['components'] & {
    workable: Workable;
    lootdropper: LootDropper;
    timer: Timer;
    growable?: Growable;
  };
  private readonly data: TreeData;
  private readonly env: MushtreeEnvironment;
  private readonly change: ComponentTimer;
  private readonly growthTransition: ComponentTimer;
  private pendingChange?: { state: MushtreeState; phase: 'delay' | 'swap' };
  private season?: WorldContentSignal<SeasonState>;
  private stopSeason?: () => void;
  private burn?: BurnableBinding;

  /** The burnable's fire flickers with the manager's frames. */
  updateFire(dt: number): void { this.burn?.update(dt); }

  get stump(): boolean { return this.hasTag('stump'); }
  get treestate(): MushtreeState {
    const build = this.sprite.sprite.peek().appearance.get('archive-build');
    return build?.kind === 'archive-build' && build.archive === this.data.buildArchives[1] ? 'bloom' : 'normal';
  }
  get changeTimer(): ComponentTimer['snapshot'] { return this.change.snapshot; }
  get growthTransitionTimer(): ComponentTimer['snapshot'] { return this.growthTransition.snapshot; }

  constructor(prefab: MushtreeId, env: MushtreeEnvironment) {
    super(prefab, new SpriteState({ name: 'idle_loop', billboard: true }));
    this.data = TREES[prefab]; this.env = env;
    this.change = new ComponentTimer(env.scheduler, () => this.changeDone());
    this.growthTransition = new ComponentTimer(env.scheduler, () => {
      if (!this.stump && !this.isRemoved) {
        const growable = this.components.growable!;
        growable.SetStage(growable.GetNextStage());
      }
    });
    this.components.timer = new Timer(env.scheduler, name => { if (name === 'decay') this.remove(); }, ['decay']);
    const colour = .5 + Math.random() * .5;
    this.sprite.setColour([colour, colour, colour]);
    this.sprite.setFrameAt(Math.random());
    this.sprite.setBuildArchive(this.data.buildArchives[0]);
    this.onRemove(() => {
      this.cancelChange(); this.growthTransition.stop(); this.components.timer.dispose();
      this.stopSeason?.(); this.stopSeason = undefined;
      this.burn?.dispose(); this.components.growable?.dispose(); this.components.workable?.dispose();
      this.light.set(null);
    });
  }

  initialize(saved: MushtreeRecord | undefined, spawnAsStump: boolean): void {
    const { data, components } = this;
    this.saveRecord = saved;
    for (const tag of ['cavedweller', 'mushtree', 'plant', 'shelter', 'tree', ...data.webbable ? ['webbable'] : []]) this.addTag(tag);
    this.minimap.SetIcon(data.icon);
    this.light.set({ colour: data.lightColour, radius: data.lightRadius * (TILE_SIZE / 4), intensity: .8, falloff: .5 });
    MakeObstaclePhysics(this, .25);
    if (this.env.world.physics) this.bindPhysics(this.env.world.physics);
    components.workable = new Workable(this);
    components.lootdropper = new LootDropper(this, (prefab, position) => {
      this.dropCatalogLoot([prefab], new THREE.Vector3(position.x, position.y, position.z));
      return undefined;
    });
    components.lootdropper.SetLoot(data.loot);
    this.watchSeason(); this.bindBurn();
    if (data.growable) this.createGrowable(saved?.components.growable);
    this.setupWork();
    const state = saved?.components.mushtree;
    if (state?.burnt) {
      if (spawnAsStump || state.stump) this.stumpBurnt(); else this.treeBurnt();
    } else if (spawnAsStump || state?.stump) this.makeStump(state?.decay);
    else this.initialSeason(state?.treestate);
  }

  private watchSeason(): void {
    const { data, env } = this;
    if (!data.season || !env.world.getWatchWorldContent) return;
    const season = this.season = env.world.getWatchWorldContent(WorldContentKey.Season,
      cleanup => { this.stopSeason = cleanup; }, { tile: this.tileTracker.tile });
    let previous = season.peek().season;
    createEffect(() => {
      const current = season.get().season;
      if (current === previous) return;
      const left = previous; previous = current;
      if (current === data.season) this.onIsInSeason(true);
      else if (left === data.season) this.onIsInSeason(false);
    });
  }

  /** Source burnable replacement when a tree becomes a stump. */
  private bindBurn(): void {
    this.burn?.dispose();
    const spec: BurnSpec = this.stump
      ? { propagator: 'small', burnTime: 10, fxLevel: 2, onBurnt: () => this.stumpBurnt() }
      : { propagator: 'medium', burnTime: 30, fxLevel: 5, onBurnt: () => this.treeBurnt() };
    this.burn = new BurnableBinding(this, spec, this.env);
  }

  private treeBurnt(): void {
    if (this.isRemoved) return;
    const position = this.position.clone();
    this.env.world.worldEvents.emit('spawnAsh', position);
    if (Math.random() < .5) this.env.world.dropLoot([{ itemId: 'charcoal', count: 1 }], position);
    this.env.spawnBurntFx(this.prefab as MushtreeId, this.treestate, position);
    this.remove();
  }

  private stumpBurnt(): void {
    if (this.isRemoved) return;
    this.env.world.worldEvents.emit('spawnAsh', this.position.clone());
    this.remove();
  }

  private createGrowable(saved: GrowableSave | undefined): void {
    const growable = this.components.growable = new Growable(this.env.scheduler, STAGE_SCALE.map((scale, index) => ({
      time: () => MUSHTREE_GROWTH_TIME[index].base + (Math.random() * 2 - 1) * MUSHTREE_GROWTH_TIME[index].random,
      fn: () => this.scale.setScalar(scale),
      growfn: () => this.doGrow((index + 1) as 1 | 2 | 3),
    })));
    growable.loopstages = true; growable.growonly = true;
    if (saved) growable.OnLoad(saved);
    else { growable.SetStage(Math.floor(Math.random() * 3) + 1); growable.StartGrowing(); }
  }

  private doGrow(toStage: 1 | 2 | 3): void {
    if (this.stump || this.isRemoved) return;
    this.sprite.playOnce(toStage === 1 ? 'shrink' : 'change', () => this.sprite.start('idle_loop'));
    PlaySound(toStage === 1 ? 'dontstarve/cave/mushtree_tall_shrink'
      : toStage === 2 ? 'dontstarve/cave/mushtree_tall_grow_1' : 'dontstarve/cave/mushtree_tall_grow_2', this.position);
    // DoGrowNextStage is a game-time task, independently of whether the transition is drawn.
    this.growthTransition.start(14 * FRAMES);
  }

  private setupWork(): void {
    const { workable, lootdropper } = this.components;
    workable.SetWorkAction('CHOP'); workable.SetWorkLeft(this.data.work);
    workable.SetOnWorkCallback((_inst, _worker, workleft) => {
      PlaySound('dontstarve/wilson/use_axe_mushroom', this.position);
      if (workleft > 0) this.sprite.playOnce('chop', () => this.sprite.start('idle_loop'));
    });
    workable.SetOnFinishCallback(() => {
      // DropLoot, makestump, the fall sound, then fall and idle_stump.
      // The host's catalog adapter continues to omit moon_cap, which has no ground prefab yet.
      const loot = lootdropper.GenerateLoot();
      this.dropCatalogLoot(loot, this.position);
      this.makeStump();
      PlaySound('dontstarve/forest/treefall', this.position);
      this.sprite.playOnce('fall', () => this.sprite.start('idle_stump'));
    });
  }

  private dropCatalogLoot(loot: readonly string[], position: THREE.Vector3): void {
    const counts = new Map<string, number>();
    for (const itemId of loot) if (Object.hasOwn(catalog.items, itemId)) counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
    this.env.world.dropLoot([...counts].map(([itemId, count]) => ({ itemId, count })), position);
  }

  private makeStump(decayRemaining?: number): void {
    if (this.stump || this.isRemoved) return;
    this.cancelChange(); this.growthTransition.stop();
    this.stopSeason?.(); this.stopSeason = undefined;
    RemovePhysicsColliders(this);
    this.addTag('stump'); this.removeTag('shelter');
    this.bindBurn(); this.components.growable?.StopGrowing();
    const { workable, timer } = this.components;
    workable.SetWorkAction('DIG'); workable.SetOnWorkCallback(undefined);
    workable.SetOnFinishCallback(() => { this.components.lootdropper.SpawnLootPrefab('log'); this.remove(); });
    workable.SetWorkLeft(1);
    this.sprite.start('idle_stump');
    this.minimap.SetIcon('mushroom_tree_stump.png'); this.light.set(null);
    if (!timer.TimerExists('decay')) timer.StartTimer('decay', decayRemaining ?? DEAD_DECAY_TIME * (1 + (Math.random() - .5)));
  }

  private cancelChange(): void {
    this.change.stop(); this.pendingChange = undefined;
  }

  private swapBuild(state: MushtreeState): void {
    if (!this.stump && !this.isRemoved) this.sprite.setBuildArchive(this.data.buildArchives[state === 'bloom' ? 1 : 0]);
  }

  private setTreeState(state: MushtreeState, instant: boolean): void {
    this.cancelChange();
    if (instant) { this.swapBuild(state); return; }
    this.pendingChange = { state, phase: 'delay' };
    this.change.start(Math.random() * 3 * SEG_TIME);
  }

  private changeDone(): void {
    const pending = this.pendingChange;
    if (!pending || this.stump || this.isRemoved) return;
    if (pending.phase === 'delay') {
      this.sprite.playOnce('change', () => this.sprite.start('idle_loop'));
      PlaySound(pending.state === 'bloom' ? 'dontstarve/cave/mushtree_tall_grow_3' : 'dontstarve/cave/mushtree_tall_shrink', this.position);
      this.pendingChange = { state: pending.state, phase: 'swap' };
      this.change.start(14 * FRAMES);
    } else {
      this.pendingChange = undefined;
      this.swapBuild(pending.state);
    }
  }

  private onIsInSeason(inSeason: boolean): void {
    if (!this.data.season || this.stump || this.isRemoved) return;
    const state = inSeason ? 'bloom' : 'normal';
    if (this.treestate !== state) this.setTreeState(state, false); else this.cancelChange();
  }

  private initialSeason(saved: MushtreeState | undefined): void {
    if (!this.data.season) return;
    const inSeason = this.season?.peek().season === this.data.season;
    if (inSeason) this.setTreeState('bloom', true);
    if (saved === 'normal') {
      this.setTreeState('normal', true);
      if (inSeason) this.setTreeState('bloom', false);
    } else if (saved === 'bloom') {
      this.setTreeState('bloom', true);
      if (!inSeason) this.setTreeState('normal', false);
    }
  }

  exportRecord(): MushtreeRecord {
    const decay = this.components.timer.GetTimeLeft('decay');
    const mushtree: MushtreeSaveState = { ...this.stump ? { stump: true } : {},
      ...this.components.burnable?.IsBurning() ? { burnt: true } : {},
      ...this.data.growable && !this.stump ? { treestate: this.treestate } : {}, ...decay === undefined ? {} : { decay } };
    return { id: String(this.entityId), transform: { position: this.position.toArray() as [number, number, number], rotationY: 0 },
      components: { ...Object.keys(mushtree).length ? { mushtree } : {},
        ...this.components.growable ? { growable: this.components.growable.OnSave() } : {} } };
  }
}

/** makeburntfx: logical animover plus the source's game-time fallback, without waiting for downloaded art. */
class MushtreeBurntFxInstance extends PrefabInstance<ArchiveSpriteCommands> {
  private readonly animstate: AnimState;
  private readonly fallback: ComponentTimer;

  constructor(prefab: string, data: TreeData, bloom: boolean, scheduler: GameTimeScheduler) {
    super(prefab, new SpriteState({ name: 'chop_burnt', billboard: true }));
    this.persists = false; this.addTag('FX');
    this.sprite.setBuildArchive(data.buildArchives[bloom ? 1 : 0]);
    this.sprite.playOnce('chop_burnt');
    const clip = animationTiming(data.animationArchive, 'chop_burnt'), duration = clip.frames / clip.frameRate;
    this.animstate = new AnimState(scheduler, new Map([['chop_burnt', duration]]), event => { if (event === 'animover') this.remove(); });
    this.fallback = new ComponentTimer(scheduler, () => this.remove());
    this.onRemove(() => { this.animstate.dispose(); if (this.fallback.snapshot.peek().status !== 'expired') this.fallback.stop(); });
    this.animstate.PlayAnimation('chop_burnt'); this.fallback.start(duration + FRAMES);
  }
}

interface TreeDisplay { readonly instance: MushtreeInstance; readonly display: PrefabDisplay }

/** World registration and display ownership; all mushtree behavior belongs to the logical inst. */
export class MushtreeManager {
  private readonly world: Omit<MushtreeWorld, 'scene'>;
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly resources = new SpriteResources(undefined, 'mushtree');
  private readonly displays: PrefabDisplayGroup;
  private readonly trees = new Map<THREE.Object3D, TreeDisplay>();
  private readonly effects = new Set<MushtreeBurntFxInstance>();
  private readonly fire: FireFxHost;
  private disposed = false;

  constructor(scene: THREE.Scene, world: MushtreeWorld) {
    const { scene: _scene, ...services } = world;
    this.world = services;
    this.ownsScheduler = !world.scheduler; this.scheduler = world.scheduler ?? new GameTimeScheduler();
    this.displays = new PrefabDisplayGroup(scene);
    this.fire = FireFxHost.create(`${import.meta.env.BASE_URL}dst/data/anim`);
  }

  spawn(id: MushtreeSpawnId, position: THREE.Vector3, saved?: MushtreeRecord): THREE.Group {
    if (this.disposed) throw new Error('Mushtrees have been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid mushtree position');
    const prefab = id.replace(/_stump$/, '') as MushtreeId;
    const instance = new MushtreeInstance(prefab, { scheduler: this.scheduler, fire: this.fire,
      world: this.world, spawnBurntFx: (prefab, state, point) => this.spawnBurntFx(prefab, state, point) });
    const display = this.displays.add({ name: prefab, archive: this.archive(TREES[prefab]),
      status: instance.status, sprite: instance.sprite as SpriteState, light: instance.light });
    bindInstance(display.model, instance);
    instance.position.copy(position); instance.entityId = saved?.id ?? newEntityId();
    this.trees.set(display.model, { instance, display });
    instance.onRemove(() => { this.trees.delete(display.model); display.dispose(); });
    const entity = actionEntity(display.model, prefab, instance);
    instance.initialize(saved, id.endsWith('_stump'));
    if (!instance.isRemoved) {
      new ToolMouseTarget(entity, instance, instance.components.workable, this.world.handEquipment);
      const stopTile = watchTileActivity(display.model, this.world.tickingarea, active => instance.setActive(active));
      instance.onRemove(stopTile);
    }
    return display.model;
  }

  private archive(data: TreeData) {
    return this.resources.archive({ animationArchive: data.animationArchive, buildArchives: data.buildArchives,
      bank: data.bank, hiddenSymbols: HIDDEN_SYMBOLS },
    { colour: [1, 1, 1], instancedAnimations: ['idle_loop'], staticBillboard: true });
  }

  private spawnBurntFx(prefab: MushtreeId, treestate: MushtreeState, position: THREE.Vector3): void {
    if (this.disposed) return;
    const data = TREES[prefab], bloom = treestate === 'bloom' && data.buildArchives.length > 1;
    const instance = new MushtreeBurntFxInstance(`${prefab}${bloom ? '_bloom' : ''}_burntfx`, data, bloom, this.scheduler);
    const display = this.displays.add({ name: instance.prefab, archive: this.archive(data),
      status: instance.status, sprite: instance.sprite as SpriteState });
    bindInstance(display.model, instance); instance.position.copy(position);
    this.effects.add(instance);
    const stopTile = watchTileActivity(display.model, this.world.tickingarea, active => instance.setActive(active));
    instance.onRemove(() => { stopTile(); this.effects.delete(instance); display.dispose(); });
    PlaySound('dontstarve/forest/treeCrumble', instance.position);
  }

  update(dt: number, quaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    if (this.ownsScheduler) this.scheduler.advance(dt);
    this.displays.update(dt, quaternion);
    for (const { instance } of this.trees.values()) instance.updateFire(dt);
  }

  get renderEntities() { return this.displays.renderEntities; }

  getChopTargets(model?: THREE.Object3D): PickaxeTarget[] { return this.workTargets('CHOP', model); }
  getDigTargets(model?: THREE.Object3D): ShovelTarget[] {
    return this.workTargets('DIG', model).map(target => ({ ...target, dig: () => target.isValid() && performToolWork('DIG', target.entity, {}) }));
  }

  private workTargets(action: 'CHOP' | 'DIG', model?: THREE.Object3D): PickaxeTarget[] {
    return modelEntries(this.trees, model).filter(([, { instance }]) => instance.components.workable.CanBeWorked()
      && instance.components.workable.GetWorkAction() === action).map(([, { instance, display }]) => ({
      id: String(instance.entityId), instance, display, position: instance.position, entity: instance,
      isValid: () => !instance.isRemoved && instance.components.workable.CanBeWorked() && instance.components.workable.GetWorkAction() === action,
    }));
  }

  exportRecords(): { prefabId: MushtreeId; record: MushtreeRecord }[] {
    return [...this.trees.values()].filter(({ instance }) => instance.persists)
      .map(({ instance }) => ({ prefabId: instance.prefab as MushtreeId, record: instance.exportRecord() }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const { instance } of this.trees.values()) instance.remove();
    for (const effect of this.effects) effect.remove();
    this.displays.dispose(); this.fire.dispose(); this.resources.dispose();
    if (this.ownsScheduler) this.scheduler.dispose();
  }
}
