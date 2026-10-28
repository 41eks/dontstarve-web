import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createSharedArchiveSprite, ArchiveSpriteAssets } from '@dontstarve-web/animation/archiveSprite';
import type { ArchiveSpriteCommands, PrefabDisplay } from '@dontstarve-web/display';
import { createArchiveEntity, type PrefabInstance, prefabInstance } from './prefabInstance';
import type { PickaxeTarget } from '@dontstarve-web/stategraphs/pickaxe';
import { createEffect, createMemo, watchSignal, WorldContentKey, type GetWatchWorldContent, type TileStateQuery } from '@dontstarve-web/signals';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { TileTracker } from '../../componets/src/tileManager';
import { Workable } from '../../componets/src/workable';
import { ComponentTimer } from '../../componets/src/timer';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { modelEntries } from './modelRecords';
import { MiniMapEntity } from './minimapEntity';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { MakeObstaclePhysics } from './standardcomponents';
import type { SpawnGroundItem } from './groundPrefab';
import { PlaySound } from './sound';
import type { WorldFx } from './world_fx';
import { TILE_SIZE } from './tile';
import catalog from './groundItems.json' with { type: 'json' };

const WORLD_SCALE = TILE_SIZE / 4;
export const GROTTO_POOL_BIG_ID = 'grotto_pool_big' as const;
export const GROTTO_POOL_SMALL_ID = 'grotto_pool_small' as const;
export const GROTTO_POOL_IDS = [GROTTO_POOL_BIG_ID, GROTTO_POOL_SMALL_ID] as const;
export const GROTTO_MOONGLASS_IDS = ['grotto_moonglass_1', 'grotto_moonglass_3', 'grotto_moonglass_4'] as const;
export const GROTTO_WATERFALL_IDS = ['grotto_waterfall_big', 'grotto_waterfall_small1', 'grotto_waterfall_small2'] as const;
/** Every persistent prefab of grotto_pool_big.lua / grotto_pool_small.lua / grotto_pool_moonglass.lua / grotto_waterfall_*.lua. */
export const GROTTO_IDS = [...GROTTO_POOL_IDS, ...GROTTO_MOONGLASS_IDS, ...GROTTO_WATERFALL_IDS] as const;
export type GrottoPoolId = typeof GROTTO_POOL_IDS[number];
export type GrottoId = typeof GROTTO_IDS[number];
type ChildId = Exclude<GrottoId, GrottoPoolId>;

/** tuning.lua ROCKS_MINE, GROTTO_POOL_BIG_RADIUS / GROTTO_POOL_SMALL_RADIUS / GROTTO_MOONGLASS_REGROW_CHANCE. */
const ROCKS_MINE = 6;
const POOL_RADIUS = { grotto_pool_big: 5.5, grotto_pool_small: 2 } as const;
const REGROW_CHANCE = .1;
/** LAYER_BACKGROUND with sort order 3: drawn under the world entities. */
const BACKGROUND_RENDER_ORDER = -.5;
/** Without a tickingarea query, props farther than this from the player are neither drawn nor animated. */
const ACTIVE_RADIUS_SQUARED = (12 * TILE_SIZE) ** 2;

// grotto_pool_moonglass.lua "moonglass_prop" and grotto_waterfall_small.lua "smallfalls".
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

interface PoolDefinition {
  animation: string;
  light: { radius: number; intensity: number };
  smartRadius: number;
}
const POOLS: Readonly<Record<GrottoPoolId, PoolDefinition>> = {
  grotto_pool_big: { animation: 'idle', light: { radius: .9, intensity: .5 }, smartRadius: 5 },
  grotto_pool_small: { animation: 'smallpool_idle', light: { radius: .6, intensity: .3 }, smartRadius: 2.5 },
};
const POOL_LIGHT_COLOUR = [227 / 255, 227 / 255, 227 / 255] as const;

interface ChildDefinition {
  animation: string;
  smartRadius: number;
  /** SetPhysicsRadiusOverride while the prop is whole. */
  physicsRadius?: number;
  lightOverride?: number;
  /** Mineable props: their chance loot table. */
  lootTable?: 'moonglass_prop' | 'smallfalls';
}
const CHILDREN: Readonly<Record<ChildId, ChildDefinition>> = {
  grotto_moonglass_1: { animation: 'moonglass_1', smartRadius: 2, physicsRadius: 2, lootTable: 'moonglass_prop' },
  grotto_moonglass_3: { animation: 'moonglass_3', smartRadius: 2, physicsRadius: 2, lootTable: 'moonglass_prop' },
  grotto_moonglass_4: { animation: 'moonglass_4', smartRadius: 2, physicsRadius: 2, lootTable: 'moonglass_prop' },
  grotto_waterfall_big: { animation: 'water_big', smartRadius: 3.5 },
  grotto_waterfall_small1: { animation: 'water_small1', smartRadius: 1.5, physicsRadius: 2.5, lightOverride: .1, lootTable: 'smallfalls' },
  grotto_waterfall_small2: { animation: 'water_small2', smartRadius: 1, physicsRadius: 2.5, lightOverride: .1, lootTable: 'smallfalls' },
};

/** on_save: the child entity IDs with their prefab_layout index (the small pool's `wf_id` is index 1). */
export interface GrottoPoolSaveState { children: { index: number; id: string }[] }
/** workable.savestate = true on the mineable props. */
export interface GrottoGlassSaveState { workleft: number }
export interface GrottoRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { grottoPool?: GrottoPoolSaveState; grottoGlass?: GrottoGlassSaveState };
}

export interface GrottoPoolWorld extends ToolMouseTargetWorld {
  physics?: CANNON.World;
  scheduler: GameTimeScheduler;
  /** Standalone visual activity fallback when the world has no tickingarea query. */
  playerPosition: () => THREE.Vector3;
  /** World sound presentation owns nearest-pool selection, fading and playback. */
  registerWaterfallPool(position: THREE.Vector3, radius: number, large: boolean): () => void;
  getWatchWorldContent?: GetWatchWorldContent;
  /** The world's tickingarea query: props outside it are neither drawn, animated nor watching the moon. */
  tickingarea?: TileStateQuery;
  fx: Pick<WorldFx, 'prepare' | 'spawn'>;
  /** lootdropper:SpawnLootPrefab when a prop is mined; the loot's display loads its art. */
  spawnGroundItem: SpawnGroundItem;
}

export function isGrottoId(value: string): value is GrottoId { return (GROTTO_IDS as readonly string[]).includes(value); }
const isPoolId = (value: GrottoId): value is GrottoPoolId => (GROTTO_POOL_IDS as readonly string[]).includes(value);

interface Grotto {
  prefab: GrottoId;
  model: THREE.Group;
  instance: PrefabInstance<ArchiveSpriteCommands>;
  display: PrefabDisplay;
  sprite: ArchiveSpriteCommands;
  /** makebigmist / makesmallmist: a non-networked child that follows the pool. */
  mist?: ReturnType<typeof createArchiveEntity>;
  /** Drawn: inside the tickingarea, or near the player in a world without one. */
  visible: boolean;
  minimap?: MiniMapEntity;
  workable?: Workable;
  lootdropper?: LootDropper;
  /** `_children` (prefab_layout order) / `_waterfall`. */
  children: (THREE.Group | undefined)[];
  savedChildren: { index: number; id: string }[];
  setup?: ComponentTimer;
  /** The pool or small waterfall that spawned this prop, with its layout slot. */
  owner?: { grotto: Grotto; index: number };
  /** WatchWorldState("iscavefullmoon") bridges while mined out. */
  stopMoonWatch: (() => void)[];
  /** Private tile key and the cleanup of its tickingarea view; undefined in standalone worlds (distance gating applies). */
  tracker: TileTracker;
  awake?: { get(): boolean; peek(): boolean };
  stopArea: (() => void)[];
  stopSound?: () => void;
  removed: boolean;
}

/** The grotto pools and their props; sound sources are registered with the world presentation scheduler. */
export class GrottoPoolManager {
  private readonly scene: THREE.Scene;
  private readonly world: GrottoPoolWorld;
  private readonly assets = new ArchiveSpriteAssets();
  private readonly grottos = new Map<THREE.Group, Grotto>();
  private readonly byId = new Map<string, THREE.Group>();
  private disposed = false;

  constructor(scene: THREE.Scene, world: GrottoPoolWorld) {
    this.scene = scene; this.world = world;
  }

  async spawn(prefab: GrottoId, position: THREE.Vector3, saved?: GrottoRecord): Promise<THREE.Group> {
    if (this.disposed) throw new Error('Grotto pools have been disposed');
    if (!isGrottoId(prefab) || ![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid grotto prefab');
    const pool = isPoolId(prefab);
    const definition = pool ? undefined : CHILDREN[prefab as ChildId];
    const table = definition?.lootTable;
    const mistAnimation = prefab === GROTTO_POOL_BIG_ID ? 'steam_big' : `steam_small${1 + Math.floor(Math.random() * 2)}`;
    const spriteArchive = pool ? 'moonglasspool_tile' : 'moonglass_bigwaterfall';
    const spriteClip = { name: pool ? POOLS[prefab].animation : definition!.animation, loop: true };
    const createSprite = (clip: { name: string; loop: boolean }) => createSharedArchiveSprite(this.assets, { animationArchive: `${spriteArchive}.zip`,
      buildArchives: [`${spriteArchive}.zip`], bank: spriteArchive, animation: clip.name, loop: clip.loop }, { name: prefab });
    const createMist = (clip: { name: string; loop: boolean }) => createSharedArchiveSprite(this.assets, { animationArchive: 'moonglass_bigwaterfall_steam.zip',
      buildArchives: ['moonglass_bigwaterfall_steam.zip'], bank: 'moonglass_bigwaterfall_steam', animation: clip.name, loop: clip.loop }, { name: `${prefab}_mist` });
    const resources = await Promise.allSettled([
      createSprite(spriteClip),
      pool ? createMist({ name: mistAnimation, loop: true }) : undefined,
      table ? this.world.fx.prepare('halloween_moonpuff') : undefined,
    ] as const);
    const created = resources[0].status === 'fulfilled' ? resources[0].value : undefined;
    const createdMist = resources[1].status === 'fulfilled' ? resources[1].value : undefined;
    const failed = resources.find(result => result.status === 'rejected');
    if (failed || this.disposed || !created) {
      created?.dispose(); createdMist?.dispose();
      throw failed?.status === 'rejected' ? failed.reason : new Error('Grotto pools have been disposed');
    }
    // The pool surface is OnGround; the props and the mist are billboards.
    const entity = createArchiveEntity(prefab, { create: createSprite, initial: created }, { name: spriteClip.name, billboard: !pool }, prefab);
    const mist = createdMist && createArchiveEntity(`${prefab}_mist`, { create: createMist, initial: createdMist }, { name: mistAnimation, billboard: true }, `${prefab}_mist`);
    return this.create(prefab, entity, mist, position, saved);
  }

  private create(prefab: GrottoId, { instance, display }: ReturnType<typeof createArchiveEntity>, mist: Grotto['mist'],
    position: THREE.Vector3, saved: GrottoRecord | undefined): THREE.Group {
    const model = display.model, sprite = instance.sprite;
    model.position.set(position.x, 0, position.z);
    const id = saved?.id ?? newEntityId();
    instance.entityId = id;
    Object.assign(model.userData, { noWetPrefix: true, remove: () => this.remove(model) });
    const grotto: Grotto = { prefab, model, instance, display, sprite, mist, visible: true, children: [], savedChildren: [], stopMoonWatch: [], stopArea: [], removed: false,
      tracker: new TileTracker(() => model.position) };
    const inst = actionEntity(model, prefab);
    if (isPoolId(prefab)) this.createPool(grotto, prefab, inst, saved?.components.grottoPool);
    else this.createChild(grotto, prefab as ChildId, inst, saved?.components.grottoGlass);
    const area = this.world.tickingarea?.(grotto.tracker.tile);
    if (area) {
      // The gate is this prop's own memo: leaving the area hides it and stops its animation until it returns.
      const awake = watchSignal(area, stop => grotto.stopArea.push(stop));
      grotto.awake = awake;
      // OnEntitySleep/OnEntityWake: frames and instance entries exist only while the tile is active.
      createEffect(() => { grotto.visible = awake.get(); instance.setActive(awake.get()); mist?.instance.setActive(awake.get()); });
    }
    this.grottos.set(model, grotto); this.byId.set(id, model);
    this.scene.add(model);
    return model;
  }

  /** poolfn: OnGround BACKGROUND art, light, obstacle physics, minimap icon, watersource tags and the 0-frame child setup. */
  private createPool(grotto: Grotto, prefab: GrottoPoolId, inst: ReturnType<typeof actionEntity>, saved: GrottoPoolSaveState | undefined): void {
    const { model, mist } = grotto, definition = POOLS[prefab];
    const tags = ['antlion_sinkhole_blocker', 'birdblocker', 'watersource'];
    for (const tag of tags) inst.addTag(tag);
    Object.assign(model.userData, { billboard: false, deploySmartRadius: definition.smartRadius * WORLD_SCALE });
    // OnGround: the group keeps its order; the pool surface draws by mesh order among the ground layers.
    grotto.sprite.setGround(0); grotto.sprite.setMeshOrder(BACKGROUND_RENDER_ORDER);
    grotto.sprite.setLightOverride(.25);
    prefabInstance(model)!.light.set({ radius: definition.light.radius * WORLD_SCALE, falloff: .6, intensity: definition.light.intensity,
      colour: POOL_LIGHT_COLOUR });
    if (mist) {
      // makebigmist / makesmallmist: FX + NOCLICK, so the steam never intercepts the mouse over the props.
      const mistModel = mist.display.model;
      mist.instance.persists = false;
      for (const tag of ['FX', 'NOCLICK']) mist.instance.addTag(tag);
      mist.instance.sprite.setLightOverride(.5); model.add(mistModel);
    }
    grotto.minimap = new MiniMapEntity(model.position);
    grotto.minimap.SetIcon(`${prefab}.png`);
    MakeObstaclePhysics(grotto.instance, POOL_RADIUS[prefab]);
    if (this.world.physics) grotto.instance.bindPhysics(this.world.physics);
    grotto.stopSound = this.world.registerWaterfallPool(model.position, POOL_RADIUS[prefab], prefab === GROTTO_POOL_BIG_ID);
    grotto.savedChildren = saved?.children.map(child => ({ ...child })) ?? [];
    // inst:DoTaskInTime(0, setup_children): after every saved entity has been restored.
    grotto.setup = new ComponentTimer(this.world.scheduler, () => void this.setupChildren(grotto).catch((error: unknown) =>
      console.error('Unable to set up grotto pool children', error)));
    grotto.setup.start(0);
  }

  /** setup_children / OnLoadPostPass: link the saved children, then spawn every missing slot. */
  private async setupChildren(grotto: Grotto): Promise<void> {
    if (grotto.removed) return;
    const big = grotto.prefab === GROTTO_POOL_BIG_ID;
    for (const { index, id } of grotto.savedChildren.splice(0)) {
      const child = this.byId.get(id);
      if (child && index >= 1 && grotto.children[index - 1] === undefined && !this.grottos.get(child)?.owner) this.adopt(grotto, index - 1, child);
    }
    const layout: readonly { name: ChildId; x: number; z: number }[] = big ? BIG_LAYOUT
      : [{ name: `grotto_waterfall_small${1 + Math.floor(Math.random() * 2)}` as ChildId, x: 0, z: 0 }];
    await Promise.all(layout.map(async ({ name, x, z }, slot) => {
      if (grotto.children[slot] !== undefined) return;
      const child = await this.spawn(name, new THREE.Vector3(grotto.model.position.x + x * WORLD_SCALE, 0, grotto.model.position.z + z * WORLD_SCALE));
      if (grotto.removed || this.disposed) { this.remove(child); return; }
      this.adopt(grotto, slot, child);
    }));
  }

  private adopt(grotto: Grotto, slot: number, child: THREE.Group): void {
    grotto.children[slot] = child;
    this.grottos.get(child)!.owner = { grotto, index: slot };
  }

  /** The three prop prefabs: whole-prop physics radius, NOCLICK scenery and the MINE workable of the glass. */
  private createChild(grotto: Grotto, prefab: ChildId, inst: ReturnType<typeof actionEntity>, saved: GrottoGlassSaveState | undefined): void {
    const { model, sprite } = grotto, definition = CHILDREN[prefab];
    const tags = prefab === 'grotto_waterfall_big' ? ['NOCLICK'] : ['moonglass'];
    for (const tag of tags) inst.addTag(tag);
    grotto.instance.physicsRadiusOverride = definition.physicsRadius;
    Object.assign(model.userData, { deploySmartRadius: definition.smartRadius * WORLD_SCALE,
    ...definition.lootTable ? { prefabNameOverride: 'moonglass_rock' } : {} });
    if (definition.lightOverride !== undefined) sprite.setLightOverride(definition.lightOverride);
    sprite.setFrame(Math.floor(Math.random() * sprite.numFrames));
    if (!definition.lootTable) return;
    const workable = new Workable(inst);
    grotto.workable = workable;
    workable.savestate = true;
    workable.SetWorkAction('MINE');
    workable.SetWorkLeft(ROCKS_MINE);
    const lootdropper = new LootDropper(inst, (itemId, point) => this.world.spawnGroundItem(
      { ...catalog.items[itemId as keyof typeof catalog.items], itemId, count: 1 }, new THREE.Vector3(point.x, point.y, point.z), { fling: true }));
    grotto.lootdropper = lootdropper;
    lootdropper.SetChanceLootTable(definition.lootTable);
    // on_mined: rock_break_fx, then the loot drops at the worker, then the prop sits mined out.
    workable.SetOnWorkCallback((worker, workleft) => {
      if (workleft > 0) return;
      PlaySound('dontstarve/wilson/rock_break', model.position);
      const at = worker.getPosition?.() ?? model.position;
      for (const itemId of lootdropper.GenerateLoot()) lootdropper.SpawnLootPrefab(itemId, at);
      this.setMined(grotto, definition);
    });
    // on_minable_load: a prop saved with no work left comes back mined out.
    workable.SetOnLoadFn(() => { if (workable.workleft.peek() <= 0) this.setMined(grotto, definition); });
    if (saved) workable.OnLoad({ workleft: saved.workleft });
    Object.assign(model.userData.components, { workable, lootdropper });
    new ToolMouseTarget(inst, grotto.instance, workable, this.world.handEquipment);
  }

  private setMined(grotto: Grotto, definition: ChildDefinition): void {
    const { model } = grotto;
    grotto.instance.physicsRadiusOverride = undefined;
    actionEntity(model, grotto.prefab).addTag('NOCLICK');
    grotto.sprite.start(`${definition.animation}_mined`);
    grotto.stopMoonWatch.splice(0).forEach(stop => stop());
    const moon = this.world.getWatchWorldContent?.(WorldContentKey.Moon, stop => grotto.stopMoonWatch.push(stop), { tile: grotto.tracker.tile });
    const cycle = this.world.getWatchWorldContent?.(WorldContentKey.Cycle, stop => grotto.stopMoonWatch.push(stop), { tile: grotto.tracker.tile });
    if (!moon || !cycle) return;
    // WatchWorldState("iscavefullmoon"): worldstate.lua's night + full moon, rolled on every change; the cave clock is not separate yet.
    const fullMoon = createMemo(() => moon.get().phase === 'full' && cycle.get() === 'night');
    let previous = fullMoon.peek();
    createEffect(() => {
      const value = fullMoon.get();
      if (value === previous) return;
      previous = value;
      // OnCaveFullMoon.
      if (REGROW_CHANCE > Math.random()) this.setFull(grotto, definition);
    });
  }

  /** set_full: whole prop again, the work refilled and a halloween_moonpuff. */
  private setFull(grotto: Grotto, definition: ChildDefinition): void {
    if (grotto.removed) return;
    const { model } = grotto;
    grotto.stopMoonWatch.splice(0).forEach(stop => stop());
    grotto.instance.physicsRadiusOverride = definition.physicsRadius;
    actionEntity(model, grotto.prefab).removeTag('NOCLICK');
    grotto.workable!.SetWorkLeft(ROCKS_MINE);
    this.world.fx.spawn('halloween_moonpuff', model.position);
    grotto.sprite.start(definition.animation);
  }

  update(dt: number, _quaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    const focus = this.world.playerPosition();
    for (const grotto of this.grottos.values()) {
      const { model, sprite, mist } = grotto;
      if (!grotto.awake) {
        const visible = model.position.distanceToSquared(focus) <= ACTIVE_RADIUS_SQUARED;
        if (visible !== grotto.visible) { grotto.visible = visible; sprite.setVisible(visible); }
      }
      if (!grotto.visible) continue;
      sprite.update(dt);
      mist?.instance.sprite.update(dt);
    }
  }

  /** Only upright art needs depth sorting; the pool surface is a background decal. */
  get renderEntities() {
    return [...this.grottos.values()].filter(({ visible }) => visible).flatMap(({ model, mist }) => [
      ...model.userData.billboard !== false ? [{ object: model, footPosition: model.position, cameraDepth: 0 }] : [],
      ...mist ? [{ object: mist.display.model, footPosition: model.position, cameraDepth: 0 }] : [],
    ]);
  }

  get miniMapEntities(): MiniMapEntity[] {
    return [...this.grottos.values()].flatMap(({ minimap }) => minimap ? [minimap] : []);
  }

  get mineTargets(): PickaxeTarget[] { return this.getMineTargets(); }

  getMineTargets(model?: THREE.Object3D): PickaxeTarget[] {
    return modelEntries(this.grottos, model).filter(([, grotto]) => grotto.workable?.CanBeWorked()).map(([model, grotto]) => ({
      id: String(grotto.instance.entityId), model, position: model.position, entity: actionEntity(model, grotto.prefab),
      isValid: () => this.grottos.get(model) === grotto && !!grotto.workable?.CanBeWorked(),
    }));
  }

  /** on_save: a pool lists its live children; a prop saves its work left. */
  exportRecords(): { prefabId: GrottoId; record: GrottoRecord }[] {
    return [...this.grottos].map(([model, grotto]) => {
      const children = grotto.children.flatMap((child, slot) => child ? [{ index: slot + 1, id: String(this.grottos.get(child)!.instance.entityId) }] : []);
      return { prefabId: grotto.prefab, record: {
        id: String(grotto.instance.entityId),
        transform: { position: [model.position.x, 0, model.position.z] as [number, number, number], rotationY: 0 },
        components: isPoolId(grotto.prefab) ? { grottoPool: { children: [...children, ...grotto.savedChildren] } }
          : grotto.workable ? { grottoGlass: { workleft: grotto.workable.workleft.peek() } } : {},
      } };
    });
  }

  /** on_removed: a pool removes its children from the last slot to the first; a prop leaves its owner's slot. */
  private remove(model: THREE.Group): void {
    const grotto = this.grottos.get(model); if (!grotto) return;
    this.grottos.delete(model); this.byId.delete(String(grotto.instance.entityId));
    model.userData.removed = true; grotto.removed = true;
    if (grotto.owner) grotto.owner.grotto.children[grotto.owner.index] = undefined;
    for (const child of [...grotto.children].reverse()) if (child) this.remove(child);
    if (grotto.setup?.snapshot.peek().status === 'scheduled') grotto.setup.stop();
    grotto.stopMoonWatch.splice(0).forEach(stop => stop());
    grotto.stopArea.splice(0).forEach(stop => stop());
    grotto.stopSound?.();
    prefabInstance(model)!.light.set(null);
    grotto.minimap?.dispose(); grotto.workable?.dispose();
    grotto.mist?.instance.remove(); grotto.mist?.display.dispose();
    grotto.instance.remove(); grotto.display.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    for (const model of [...this.grottos.keys()]) this.remove(model);
    this.disposed = true;
    this.assets.dispose();
  }
}
