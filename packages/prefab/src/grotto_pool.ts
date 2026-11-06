import * as THREE from 'three';
import { SpriteState } from '@dontstarve-web/display';
import { createEffect, createMemo, WorldContentKey, type GameTimeScheduler, type GetWatchWorldContent } from '@dontstarve-web/signals';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import type { Worker } from '../../componets/src/workable';
import { actionEntity } from './actionEntity';
import { addComponent } from './components';
import type { SpawnGroundItem } from './groundPrefab';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { PlaySound } from './sound';
import { MakeObstaclePhysics } from './standardcomponents';
import { TILE_SIZE } from './tile';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import { Transform } from './transform';
import type { WorldFx } from './world_fx';
import catalog from './groundItems.json' with { type: 'json' };

const WORLD_SCALE = TILE_SIZE / 4;
export const GROTTO_POOL_BIG_ID = 'grotto_pool_big' as const;
export const GROTTO_POOL_SMALL_ID = 'grotto_pool_small' as const;
export const GROTTO_POOL_IDS = [GROTTO_POOL_BIG_ID, GROTTO_POOL_SMALL_ID] as const;
export const GROTTO_MOONGLASS_IDS = ['grotto_moonglass_1', 'grotto_moonglass_3', 'grotto_moonglass_4'] as const;
export const GROTTO_WATERFALL_IDS = ['grotto_waterfall_big', 'grotto_waterfall_small1', 'grotto_waterfall_small2'] as const;
/** Every persistent prefab of grotto_pool_big.lua / grotto_pool_small.lua / grotto_pool_moonglass.lua / grotto_waterfall_*.lua. */
export const GROTTO_IDS = [...GROTTO_POOL_IDS, ...GROTTO_MOONGLASS_IDS, ...GROTTO_WATERFALL_IDS] as const;
/** makebigmist / makesmallmist: an unnamed, non-networked entity in the source. */
export const GROTTO_POOL_MIST_ID = 'grotto_pool_mist' as const;
export type GrottoPoolId = typeof GROTTO_POOL_IDS[number];
export type GrottoId = typeof GROTTO_IDS[number];
type MineableId = typeof GROTTO_MOONGLASS_IDS[number] | 'grotto_waterfall_small1' | 'grotto_waterfall_small2';
type ChildId = Exclude<GrottoId, GrottoPoolId>;

/** tuning.lua ROCKS_MINE, GROTTO_POOL_BIG_RADIUS / GROTTO_POOL_SMALL_RADIUS / GROTTO_MOONGLASS_REGROW_CHANCE. */
const ROCKS_MINE = 6;
const POOL_RADIUS = { grotto_pool_big: 5.5, grotto_pool_small: 2 } as const;
const REGROW_CHANCE = .1;
/** LAYER_BACKGROUND with sort order 3: drawn under the world entities. */
const BACKGROUND_RENDER_ORDER = -.5;

// grotto_pool_moonglass.lua "moonglass_prop"; grotto_waterfall_small.lua defines "smallfalls" but both falls use "moonglass_prop".
SetSharedLootTable('moonglass_prop', [['moonglass', 1], ['moonglass', 1], ['moonglass', .5]]);
SetSharedLootTable('smallfalls', [['moonglass', 1], ['moonglass', .5]]);

/** grotto_pool_big.lua prefab_layout. */
const BIG_LAYOUT = [
  { name: 'grotto_waterfall_big', x: 0, z: 0 },
  { name: 'grotto_moonglass_1', x: 1.15, z: -2.77 },
  { name: 'grotto_moonglass_3', x: -1.15, z: 2.77 },
  { name: 'grotto_moonglass_4', x: 2.49, z: 1.16 },
  { name: 'grotto_moonglass_4', x: -2.49, z: -1.16 },
] as const satisfies readonly { name: ChildId; x: number; z: number }[];

const POOLS = {
  grotto_pool_big: { animation: 'idle', light: { radius: .9, intensity: .5 }, smartRadius: 5 },
  grotto_pool_small: { animation: 'smallpool_idle', light: { radius: .6, intensity: .3 }, smartRadius: 2.5 },
} as const satisfies Record<GrottoPoolId, unknown>;
const POOL_LIGHT_COLOUR = [227 / 255, 227 / 255, 227 / 255] as const;

/** mineable_glass(name, anim) and falls1 / falls2: the anim, SetDeploySmartRadius, the whole prop's SetPhysicsRadiusOverride and SetLightOverride. */
const MINEABLES = {
  grotto_moonglass_1: { animation: 'moonglass_1', smartRadius: 2, physicsRadius: 2 },
  grotto_moonglass_3: { animation: 'moonglass_3', smartRadius: 2, physicsRadius: 2 },
  grotto_moonglass_4: { animation: 'moonglass_4', smartRadius: 2, physicsRadius: 2 },
  grotto_waterfall_small1: { animation: 'water_small1', smartRadius: 1.5, physicsRadius: 2.5, lightOverride: .1 },
  grotto_waterfall_small2: { animation: 'water_small2', smartRadius: 1, physicsRadius: 2.5, lightOverride: .1 },
} as const satisfies Record<MineableId, { animation: string; smartRadius: number; physicsRadius: number; lightOverride?: number }>;

const POOL_ASSETS = { animationArchive: 'moonglasspool_tile.zip', buildArchives: ['moonglasspool_tile.zip'], bank: 'moonglasspool_tile' };
const PROP_ASSETS = { animationArchive: 'moonglass_bigwaterfall.zip', buildArchives: ['moonglass_bigwaterfall.zip'], bank: 'moonglass_bigwaterfall' };
const MIST_ASSETS = { animationArchive: 'moonglass_bigwaterfall_steam.zip', buildArchives: ['moonglass_bigwaterfall_steam.zip'], bank: 'moonglass_bigwaterfall_steam' };
const INSTANCED = { instancedAnimations: 'all', staticBillboard: true } as const;

/** on_save: the child entity IDs with their prefab_layout index (the small pool's `wf_id` is index 1). */
export interface GrottoPoolSaveState { children: { index: number; id: string }[] }
/** workable.savestate = true on the mineable props, saved under this project's `grottoGlass` key. */
export interface GrottoGlassSaveState { workleft: number }

export interface GrottoPoolWorld extends ToolMouseTargetWorld {
  scheduler: GameTimeScheduler;
  /** World sound presentation owns nearest-pool selection, fading and playback (ms_registergrottopool). */
  registerWaterfallPool(position: THREE.Vector3, radius: number, large: boolean): () => void;
  getWatchWorldContent?: GetWatchWorldContent;
  fx: Pick<WorldFx, 'spawn'>;
  /** lootdropper:SpawnLootPrefab when a prop is mined; the loot's display loads its art. */
  spawnGroundItem: SpawnGroundItem;
  /** SpawnPrefab for the layout children and the mist. */
  spawnPrefab(prefab: ChildId | typeof GROTTO_POOL_MIST_ID, position: ReadonlyVector3): PrefabInstance;
  /** OnLoadPostPass's `newents`, by saved entity ID. */
  getEntity(entityId: string): PrefabInstance | undefined;
}

export function isGrottoId(value: string): value is GrottoId { return (GROTTO_IDS as readonly string[]).includes(value); }

/** grotto_pool_big.lua / grotto_pool_small.lua poolfn. */
export class GrottoPoolInstance extends PrefabInstance {
  declare readonly prefab: GrottoPoolId;
  readonly no_wet_prefix = true;
  /** `_children` in prefab_layout order; the small pool's `_waterfall` is slot 0. */
  readonly _children: (PrefabInstance | undefined)[] = [];
  /** OnLoadPostPass data until the 0-frame task resolves it. */
  private savedChildren?: GrottoPoolSaveState['children'];

  constructor(world: GrottoPoolWorld, prefab: GrottoPoolId, position: ReadonlyVector3) {
    super(prefab, new SpriteState({ name: POOLS[prefab].animation }), Transform.stationary());
    const definition = POOLS[prefab], big = prefab === GROTTO_POOL_BIG_ID;
    this.setPosition(position.x, 0, position.z);
    // SetOrientation(OnGround), SetLayer(LAYER_BACKGROUND), SetSortOrder(3).
    this.sprite.setGround(0);
    this.sprite.setMeshOrder(BACKGROUND_RENDER_ORDER);
    this.sprite.setLightOverride(.25);
    this.light.set({ radius: definition.light.radius * WORLD_SCALE, falloff: .6, intensity: definition.light.intensity, colour: POOL_LIGHT_COLOUR });
    this.addTag('blocker'); // MakeObstaclePhysics
    for (const tag of ['antlion_sinkhole_blocker', 'birdblocker', 'watersource']) this.addTag(tag);
    this.deploySmartRadius = definition.smartRadius * WORLD_SCALE;
    this.addTag('inspectable');
    Object.assign(this.components, { inspectable: new Inspectable(this) });

    let mist: PrefabInstance | undefined, stopSound: (() => void) | undefined;
    // DoTaskInTime(0, makebigmist / makesmallmist), DoTaskInTime(0, register_pool), and after OnLoadPostPass DoTaskInTime(0, setup_children).
    const cancelSetup = world.scheduler.schedule(0, () => {
      if (this.isRemoved) return;
      mist = world.spawnPrefab(GROTTO_POOL_MIST_ID, this.position);
      mist.entityParent = this as PrefabInstance;
      mist.sprite.start(big ? 'steam_big' : `steam_small${1 + Math.floor(Math.random() * 2)}`);
      stopSound = world.registerWaterfallPool(this.transform.model.position, POOL_RADIUS[prefab], big);
      on_load_postpass(this, world);
      setup_children(this, world, big);
    });

    this.OnSave = (_inst, data) => { data.grottoPool = on_save(this); };
    this.OnLoad = (_inst, data) => { this.savedChildren = data.grottoPool?.children.map(child => ({ ...child })); };
    // ListenForEvent("onremove", on_removed): children go from the last slot to the first.
    this.onRemove(() => {
      cancelSetup();
      stopSound?.();
      for (const child of [...this._children].reverse()) if (child && !child.isRemoved) child.remove();
      mist?.remove();
    });
  }

  takeSavedChildren(): GrottoPoolSaveState['children'] {
    const saved = this.savedChildren ?? [];
    this.savedChildren = undefined;
    return saved;
  }

  /** Children not yet resolved by the 0-frame task are still the saved ones. */
  get pendingChildren(): readonly GrottoPoolSaveState['children'][number][] { return this.savedChildren ?? []; }
}

function on_save(inst: GrottoPoolInstance): GrottoPoolSaveState {
  const children = inst._children.flatMap((child, slot) => child ? [{ index: slot + 1, id: String(child.entityId) }] : []);
  return { children: [...children, ...inst.pendingChildren] };
}

function on_load_postpass(inst: GrottoPoolInstance, world: GrottoPoolWorld): void {
  for (const { index, id } of inst.takeSavedChildren()) {
    const child = world.getEntity(id);
    if (child && !child.isRemoved && index >= 1 && inst._children[index - 1] === undefined) adopt(inst, index - 1, child);
  }
}

function setup_children(inst: GrottoPoolInstance, world: GrottoPoolWorld, big: boolean): void {
  const layout: readonly { name: ChildId; x: number; z: number }[] = big ? BIG_LAYOUT
    : [{ name: `grotto_waterfall_small${1 + Math.floor(Math.random() * 2)}` as ChildId, x: 0, z: 0 }];
  layout.forEach(({ name, x, z }, slot) => {
    if (inst._children[slot] !== undefined) return;
    adopt(inst, slot, world.spawnPrefab(name, new THREE.Vector3(inst.position.x + x * WORLD_SCALE, 0, inst.position.z + z * WORLD_SCALE)));
  });
}

/** _children[i]:ListenForEvent("onremove", function() inst._children[i] = nil end). */
function adopt(inst: GrottoPoolInstance, slot: number, child: PrefabInstance): void {
  inst._children[slot] = child;
  child.onRemove(() => { if (inst._children[slot] === child) inst._children[slot] = undefined; });
}

/** makebigmist / makesmallmist: FX and NOCLICK, never asleep and never saved. */
function createMist(position: ReadonlyVector3): PrefabInstance {
  const inst = new PrefabInstance(GROTTO_POOL_MIST_ID, new SpriteState({ name: 'steam_big', billboard: true }), Transform.stationary());
  inst.setPosition(position.x, 0, position.z);
  inst.addTag('FX');
  inst.addTag('NOCLICK');
  inst.persists = false;
  inst.sprite.setLightOverride(.5);
  return inst;
}

/** grotto_waterfall_big.lua fn. */
function createBigWaterfall(position: ReadonlyVector3): PrefabInstance {
  const inst = new PrefabInstance('grotto_waterfall_big', new SpriteState({ name: 'water_big', billboard: true }), Transform.stationary());
  inst.setPosition(position.x, 0, position.z);
  inst.addTag('NOCLICK');
  Object.assign(inst, { no_wet_prefix: true });
  inst.deploySmartRadius = 3.5 * WORLD_SCALE;
  inst.sprite.setFrameAt(Math.random());
  return inst;
}

/** grotto_pool_moonglass.lua mineable_glass and grotto_waterfall_small.lua falls1 / falls2. */
export class GrottoGlassInstance extends PrefabInstance {
  declare readonly prefab: MineableId;
  readonly no_wet_prefix = true;
  /** SetPrefabNameOverride. */
  readonly prefabNameOverride = 'moonglass_rock';
  /** `_anim`, or `"water_small".._type`. */
  readonly _anim: string;
  readonly world: GrottoGlassWorld;
  private readonly stopMoonWatch: (() => void)[] = [];

  constructor(world: GrottoGlassWorld, prefab: MineableId, position: ReadonlyVector3) {
    const definition = MINEABLES[prefab];
    super(prefab, new SpriteState({ name: definition.animation, billboard: true }), Transform.stationary());
    this.world = world;
    this._anim = definition.animation;
    this.setPosition(position.x, 0, position.z);
    if ('lightOverride' in definition) this.sprite.setLightOverride(definition.lightOverride);
    this.deploySmartRadius = definition.smartRadius * WORLD_SCALE;
    this.physicsRadiusOverride = definition.physicsRadius;
    this.addTag('moonglass');

    const workable = addComponent(this as GrottoGlassInstance, 'workable');
    workable.savestate = true;
    workable.SetWorkAction('MINE');
    workable.SetWorkLeft(ROCKS_MINE);
    workable.SetOnWorkCallback((_inst, worker, workleft) => on_mined(this, worker, workleft));
    workable.SetOnLoadFn(() => { if (workable.workleft.peek() <= 0) set_mined(this); });
    const lootdropper = new LootDropper(this, (itemId, point) => world.spawnGroundItem(
      { ...catalog.items[itemId as keyof typeof catalog.items], itemId, count: 1 }, new THREE.Vector3(point.x, point.y, point.z), { fling: true }));
    lootdropper.SetChanceLootTable('moonglass_prop');
    Object.assign(this.components, { lootdropper });
    this.sprite.setFrameAt(Math.random());

    // The project's save keeps workable's OnSave under `grottoGlass`.
    this.OnSave = (_inst, data) => {
      const saved = data as Record<string, unknown>, work = saved.workable as { workleft?: number } | undefined;
      delete saved.workable;
      if (work?.workleft !== undefined) data.grottoGlass = { workleft: work.workleft };
    };
    this.OnLoad = (_inst, data) => { if (data.grottoGlass) workable.OnLoad({ workleft: data.grottoGlass.workleft }); };
    this.onRemove(() => this.stopMoonWatch.splice(0).forEach(stop => stop()));
  }

  /** WatchWorldState("iscavefullmoon", OnCaveFullMoon): worldstate.lua's night + full moon; the cave clock is not separate yet. */
  watchCaveFullMoon(): void {
    this.stopWatchingCaveFullMoon();
    const active = createMemo(() => this.status.get() === 'active');
    this.stopMoonWatch.push(() => active.dispose());
    const moon = this.world.getWatchWorldContent?.(WorldContentKey.Moon, stop => this.stopMoonWatch.push(stop), { active });
    const cycle = this.world.getWatchWorldContent?.(WorldContentKey.Cycle, stop => this.stopMoonWatch.push(stop), { active });
    if (!moon || !cycle) return;
    const fullMoon = createMemo(() => moon.get().phase === 'full' && cycle.get() === 'night');
    this.stopMoonWatch.push(() => fullMoon.dispose());
    let previous = fullMoon.peek();
    this.stopMoonWatch.push(createEffect(() => {
      const value = fullMoon.get();
      if (value === previous) return;
      previous = value;
      OnCaveFullMoon(this);
    }));
  }

  stopWatchingCaveFullMoon(): void { this.stopMoonWatch.splice(0).forEach(stop => stop()); }
}

type GrottoGlassWorld = Pick<GrottoPoolWorld, 'getWatchWorldContent' | 'fx' | 'spawnGroundItem'>;

function on_mined(inst: GrottoGlassInstance, worker: Worker | undefined, workleft: number): void {
  if (workleft > 0) return;
  // rock_break_fx.lua has no art: its local proxy only plays this sound.
  PlaySound('dontstarve/wilson/rock_break', inst.position);
  inst.components.lootdropper!.DropLoot(worker?.getPosition?.() ?? inst.position);
  set_mined(inst);
}

function set_mined(inst: GrottoGlassInstance): void {
  inst.physicsRadiusOverride = undefined;
  inst.addTag('NOCLICK');
  inst.sprite.start(`${inst._anim}_mined`);
  inst.watchCaveFullMoon();
}

function OnCaveFullMoon(inst: GrottoGlassInstance): void {
  // Assume we only ran this function if we're mined out.
  if (REGROW_CHANCE > Math.random()) {
    set_full(inst);
    inst.stopWatchingCaveFullMoon();
  }
}

function set_full(inst: GrottoGlassInstance): void {
  inst.physicsRadiusOverride = MINEABLES[inst.prefab].physicsRadius;
  inst.removeTag('NOCLICK');
  inst.components.workable!.SetWorkLeft(ROCKS_MINE);
  inst.world.fx.spawn('halloween_moonpuff', inst.transform.model.position);
  inst.sprite.start(inst._anim);
}

/** The Prefabs of grotto_pool_big.lua, grotto_pool_small.lua, grotto_pool_moonglass.lua, grotto_waterfall_*.lua and the pools' mist. */
export function grottoPoolPrefabs(world: GrottoPoolWorld): Readonly<Record<GrottoId | typeof GROTTO_POOL_MIST_ID, PrefabEntityDefinition<PrefabInstance>>> {
  const pool = (prefab: GrottoPoolId): PrefabEntityDefinition<PrefabInstance> => ({
    fn: position => new GrottoPoolInstance(world, prefab, position),
    // LAYER_BACKGROUND ground art stays out of the upright instanced batches.
    assets: POOL_ASSETS,
    physics: { make: MakeObstaclePhysics, radius: POOL_RADIUS[prefab] },
    minimapIcon: `${prefab}.png`,
  });
  const mineable = (prefab: MineableId): PrefabEntityDefinition<PrefabInstance> => ({
    fn: position => new GrottoGlassInstance(world, prefab, position),
    assets: PROP_ASSETS, assetOptions: INSTANCED,
    onSpawned: inst => {
      new ToolMouseTarget(actionEntity(inst.transform.model, prefab), inst, inst.components.workable!, world.handEquipment);
    },
  });
  return {
    grotto_pool_big: pool('grotto_pool_big'),
    grotto_pool_small: pool('grotto_pool_small'),
    grotto_moonglass_1: mineable('grotto_moonglass_1'),
    grotto_moonglass_3: mineable('grotto_moonglass_3'),
    grotto_moonglass_4: mineable('grotto_moonglass_4'),
    grotto_waterfall_small1: mineable('grotto_waterfall_small1'),
    grotto_waterfall_small2: mineable('grotto_waterfall_small2'),
    grotto_waterfall_big: { fn: createBigWaterfall, assets: PROP_ASSETS, assetOptions: INSTANCED },
    // SetCanSleep(false): the mist draws wherever its pool is.
    [GROTTO_POOL_MIST_ID]: { fn: createMist, assets: MIST_ASSETS, assetOptions: INSTANCED, targetable: false, alwaysActive: true },
  };
}
