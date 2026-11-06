import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { Transform } from './transform';
import * as THREE from 'three';
import { createEffect, WorldContentKey, type GetWatchWorldContent, type HandEquipment, type ReadonlySignal, type WorldContentSignal, type SeasonState, type TileStateQuery } from '@dontstarve-web/signals';
import { Growable, type GrowableSave } from '../../componets/src/growable';
import { LootDropper } from '../../componets/src/lootdropper';
import { Workable } from '../../componets/src/workable';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { actionEntity } from './actionEntity';
import { ToolMouseTarget } from './toolMouseTarget';
import { SpriteState } from '@dontstarve-web/display';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { ComponentTimer, Timer } from '../../componets/src/timer';
import { AnimState } from '../../componets/src/animstate';
import { MakeObstaclePhysics, RemovePhysicsColliders } from './standardcomponents';
import { BurnableBinding, type FireFxHost, type BurnSpec } from './treeFire';
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
/** makeburntfx(name, data, bloom): `<name>_burntfx` and `<name>_bloom_burntfx`. */
type MushtreeBurntFxId = `${MushtreeId}_burntfx` | `${MushtreeId}_bloom_burntfx`;
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

export function isMushtreeSpawnId(value: string): value is MushtreeSpawnId {
  return (MUSHTREE_SPAWN_IDS as readonly string[]).includes(value);
}

export interface MushtreeWorld {
  handEquipment?: ReadonlySignal<HandEquipment | null>;
  scheduler: GameTimeScheduler;
  /** The world's fire art owner; it updates the fires it spawns. */
  fire: FireFxHost;
  /** Season is watched per tree through its transform's activity, so trees outside the tickingarea stop following it. */
  getWatchWorldContent?: GetWatchWorldContent;
  tickingarea?: TileStateQuery;
  worldEvents: WorldEventEmitter;
  dropLoot(items: readonly { itemId: string; count: number }[], position: ReadonlyVector3): void;
  /** SpawnPrefab for the burnt fx. */
  spawnPrefab(prefab: MushtreeBurntFxId, position: ReadonlyVector3): PrefabInstance;
}

/** mushtree.lua maketree(name, data, state)'s inst; source tasks, components and build declarations survive visual unloading. */
export class MushtreeInstance extends PrefabInstance {
  declare readonly prefab: MushtreeId;
  declare readonly components: PrefabInstance['components'] & {
    workable: Workable;
    lootdropper: LootDropper;
    timer: Timer;
    growable?: Growable;
  };
  readonly world: MushtreeWorld;
  private readonly data: TreeData;
  private readonly change: ComponentTimer;
  private readonly growthTransition: ComponentTimer;
  private pendingChange?: { state: MushtreeState; phase: 'delay' | 'swap' };
  private season?: WorldContentSignal<SeasonState>;
  private stopSeason?: () => void;
  private burn?: BurnableBinding;
  /** OnLoad saw a growable save, so the random first stage is not rolled. */
  private loadedGrowth = false;

  get stump(): boolean { return this.hasTag('stump'); }
  get treestate(): MushtreeState {
    const build = this.sprite.sprite.peek().appearance.get('archive-build');
    return build?.kind === 'archive-build' && build.archive === this.data.buildArchives[1] ? 'bloom' : 'normal';
  }
  get changeTimer(): ComponentTimer['snapshot'] { return this.change.snapshot; }
  get growthTransitionTimer(): ComponentTimer['snapshot'] { return this.growthTransition.snapshot; }

  constructor(prefab: MushtreeId, world: MushtreeWorld, position: ReadonlyVector3) {
    super(prefab, new SpriteState({ name: 'idle_loop', billboard: true }), Transform.stationary());
    this.data = TREES[prefab]; this.world = world;
    this.setPosition(position.x, 0, position.z);
    const { data } = this;
    this.change = new ComponentTimer(world.scheduler, () => this.changeDone());
    this.growthTransition = new ComponentTimer(world.scheduler, () => {
      if (!this.stump && !this.isRemoved) {
        const growable = this.components.growable!;
        growable.SetStage(growable.GetNextStage());
      }
    });
    this.components.timer = new Timer(world.scheduler, name => { if (name === 'decay') this.remove(); }, ['decay']);
    const colour = .5 + Math.random() * .5;
    this.sprite.setColour([colour, colour, colour]);
    this.sprite.setFrameAt(Math.random());
    this.sprite.setBuildArchive(data.buildArchives[0]);
    // MakeObstaclePhysics adds `blocker`; the body itself is the definition's physics.
    for (const tag of ['blocker', 'cavedweller', 'mushtree', 'plant', 'shelter', 'tree', ...data.webbable ? ['webbable'] : []]) this.addTag(tag);
    this.light.set({ colour: data.lightColour, radius: data.lightRadius * (TILE_SIZE / 4), intensity: .8, falloff: .5 });
    this.components.workable = new Workable(this);
    this.components.lootdropper = new LootDropper(this, (prefab, point) => {
      this.dropCatalogLoot([prefab], new THREE.Vector3(point.x, point.y, point.z));
      return undefined;
    });
    this.components.lootdropper.SetLoot(data.loot);
    this.watchSeason(); this.bindBurn();
    if (data.growable) this.createGrowable();
    this.setupWork();
    // WatchWorldState("is"..season) and the constructor's in-season bloom; a `_stump` makes its stump in onSpawned, after its body.
    if (data.season && this.season?.peek().season === data.season) this.setTreeState('bloom', true);

    this.OnSave = (_inst, saved) => onsave(this, saved);
    this.OnLoad = (_inst, saved) => onload(this, saved);
    this.onRemove(() => {
      this.cancelChange(); this.growthTransition.stop(); this.components.timer.dispose();
      this.stopSeason?.(); this.stopSeason = undefined;
      this.burn?.dispose(); this.components.growable?.dispose(); this.components.workable?.dispose();
      this.light.set(null);
    });
  }

  private watchSeason(): void {
    const { data, world } = this;
    if (!data.season || !world.getWatchWorldContent) return;
    const cleanups: (() => void)[] = [];
    this.stopSeason = () => cleanups.splice(0).reverse().forEach(stop => stop());
    // The transform's shared activity: a stump stops following the season, not its own ticking area.
    const area = this.transform.getTileActivity(world.tickingarea, stop => cleanups.push(stop));
    const season = this.season = world.getWatchWorldContent(WorldContentKey.Season,
      stop => cleanups.push(stop), area ? { active: area } : undefined);
    let previous = season.peek().season;
    cleanups.push(createEffect(() => {
      const current = season.get().season;
      if (current === previous) return;
      const left = previous; previous = current;
      if (current === data.season) this.onIsInSeason(true);
      else if (left === data.season) this.onIsInSeason(false);
    }));
  }

  /** Source burnable replacement when a tree becomes a stump. */
  private bindBurn(): void {
    this.burn?.dispose();
    const spec: BurnSpec = this.stump
      ? { propagator: 'small', burnTime: 10, fxLevel: 2, onBurnt: () => this.stumpBurnt() }
      : { propagator: 'medium', burnTime: 30, fxLevel: 5, onBurnt: () => this.treeBurnt() };
    this.burn = new BurnableBinding(this, spec, this.world);
  }

  /** tree_burnt. */
  treeBurnt(): void {
    if (this.isRemoved) return;
    const position = this.position.clone();
    this.world.worldEvents.emit('spawnAsh', position);
    if (Math.random() < .5) this.world.dropLoot([{ itemId: 'charcoal', count: 1 }], position);
    const bloom = this.treestate === 'bloom' && this.data.buildArchives.length > 1;
    this.world.spawnPrefab(`${this.prefab}${bloom ? '_bloom' : ''}_burntfx` as MushtreeBurntFxId, position);
    this.remove();
  }

  /** stump_burnt. */
  stumpBurnt(): void {
    if (this.isRemoved) return;
    this.world.worldEvents.emit('spawnAsh', this.position.clone());
    this.remove();
  }

  private createGrowable(): void {
    const growable = this.components.growable = new Growable(this.world.scheduler, STAGE_SCALE.map((scale, index) => ({
      time: () => MUSHTREE_GROWTH_TIME[index].base + (Math.random() * 2 - 1) * MUSHTREE_GROWTH_TIME[index].random,
      fn: () => this.setScale(scale),
      growfn: () => this.doGrow((index + 1) as 1 | 2 | 3),
    })));
    growable.loopstages = true; growable.growonly = true;
  }

  /** A new tree's growable: a random stage, then growing. A saved one is loaded by SetPersistData. */
  startGrowth(): void {
    const growable = this.components.growable;
    if (this.loadedGrowth || this.isRemoved || !growable) return;
    growable.SetStage(Math.floor(Math.random() * 3) + 1);
    if (!this.stump) growable.StartGrowing();
  }

  markGrowthLoaded(): void { this.loadedGrowth = true; }

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

  private dropCatalogLoot(loot: readonly string[], position: ReadonlyVector3): void {
    const counts = new Map<string, number>();
    for (const itemId of loot) if (Object.hasOwn(catalog.items, itemId)) counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
    this.world.dropLoot([...counts].map(([itemId, count]) => ({ itemId, count })), position);
  }

  /** makestump. */
  makeStump(decayRemaining?: number): void {
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

  /** bloom_tree / normal_tree(inst, instant). */
  setTreeState(state: MushtreeState, instant: boolean): void {
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

  get inSeason(): boolean { return this.season?.peek().season === this.data.season; }
  get seasonal(): boolean { return this.data.season !== undefined; }
  get growable(): boolean { return this.data.growable; }
}

/** onsave: burnt, stump, treestate; the project's save keeps the stump's decay timer under `mushtree.decay`. */
function onsave(inst: MushtreeInstance, data: Record<string, unknown>): void {
  const decay = inst.components.timer.GetTimeLeft('decay');
  delete data.timer;
  const mushtree: MushtreeSaveState = { ...inst.stump ? { stump: true } : {},
    ...inst.components.burnable?.IsBurning() ? { burnt: true } : {},
    ...inst.growable && !inst.stump ? { treestate: inst.treestate } : {}, ...decay === undefined ? {} : { decay } };
  if (Object.keys(mushtree).length) data.mushtree = mushtree;
}

/** onload. */
function onload(inst: MushtreeInstance, data: MushtreeComponents): void {
  if (data.growable) inst.markGrowthLoaded();
  const state = data.mushtree;
  if (!state) return;
  if (state.burnt) {
    if (state.stump) inst.stumpBurnt(); else inst.treeBurnt();
  } else if (state.stump) inst.makeStump(state.decay);
  else if (inst.seasonal) {
    if (state.treestate === 'normal') {
      inst.setTreeState('normal', true);
      if (inst.inSeason) inst.setTreeState('bloom', false);
    } else if (state.treestate === 'bloom') {
      inst.setTreeState('bloom', true);
      if (!inst.inSeason) inst.setTreeState('normal', false);
    }
  }
}

/** makeburntfx: logical animover plus the source's game-time fallback, without waiting for downloaded art. */
class MushtreeBurntFxInstance extends PrefabInstance {
  private readonly animstate: AnimState;
  private readonly fallback: ComponentTimer;

  constructor(prefab: MushtreeBurntFxId, data: TreeData, bloom: boolean, scheduler: GameTimeScheduler, position: ReadonlyVector3) {
    super(prefab, new SpriteState({ name: 'chop_burnt', billboard: true }));
    this.setPosition(position.x, 0, position.z);
    this.persists = false; this.addTag('FX');
    this.sprite.setBuildArchive(data.buildArchives[bloom ? 1 : 0]);
    this.sprite.playOnce('chop_burnt');
    const clip = animationTiming(data.animationArchive, 'chop_burnt'), duration = clip.frames / clip.frameRate;
    this.animstate = new AnimState(scheduler, new Map([['chop_burnt', duration]]), event => { if (event === 'animover') this.remove(); });
    this.fallback = new ComponentTimer(scheduler, () => this.remove());
    this.onRemove(() => { this.animstate.dispose(); if (this.fallback.snapshot.peek().status !== 'expired') this.fallback.stop(); });
    this.animstate.PlayAnimation('chop_burnt'); this.fallback.start(duration + FRAMES);
    PlaySound('dontstarve/forest/treeCrumble', this.position);
  }
}

const assetsOf = (data: TreeData) => ({ animationArchive: data.animationArchive, buildArchives: data.buildArchives, bank: data.bank, hiddenSymbols: HIDDEN_SYMBOLS });
const ASSET_OPTIONS = { colour: [1, 1, 1], instancedAnimations: ['idle_loop'], staticBillboard: true } as const;

/** The Prefabs mushtree.lua and mushtree_moon.lua return: each tree, its `_stump`, and both burnt fx. */
export function mushtreePrefabs(world: MushtreeWorld): Readonly<Record<MushtreeSpawnId | MushtreeBurntFxId, PrefabEntityDefinition<PrefabInstance>>> {
  const prefabs: Partial<Record<MushtreeSpawnId | MushtreeBurntFxId, PrefabEntityDefinition<PrefabInstance>>> = {};
  for (const id of MUSHTREE_IDS) {
    const data = TREES[id];
    const tree = (stump: boolean): PrefabEntityDefinition<MushtreeInstance> => ({
      fn: position => new MushtreeInstance(id, world, position),
      assets: assetsOf(data), assetOptions: ASSET_OPTIONS,
      physics: { make: MakeObstaclePhysics, radius: .25 },
      minimapIcon: data.icon,
      onSpawned: inst => {
        if (inst.isRemoved) return;
        inst.startGrowth();
        if (stump) inst.makeStump();
        new ToolMouseTarget(actionEntity(inst.transform.model, id), inst, inst.components.workable, world.handEquipment);
      },
    });
    prefabs[id] = tree(false) as unknown as PrefabEntityDefinition<PrefabInstance>;
    prefabs[`${id}_stump`] = tree(true) as unknown as PrefabEntityDefinition<PrefabInstance>;
    for (const bloom of data.buildArchives.length > 1 ? [false, true] : [false]) {
      const fx = `${id}${bloom ? '_bloom' : ''}_burntfx` as MushtreeBurntFxId;
      prefabs[fx] = { fn: position => new MushtreeBurntFxInstance(fx, data, bloom, world.scheduler, position),
        assets: assetsOf(data), assetOptions: ASSET_OPTIONS, targetable: false };
    }
  }
  return prefabs as Record<MushtreeSpawnId | MushtreeBurntFxId, PrefabEntityDefinition<PrefabInstance>>;
}
