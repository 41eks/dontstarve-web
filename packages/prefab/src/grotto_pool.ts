import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createSharedArchiveSprite, ArchiveSpriteAssets, type ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
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
import { setPrefabLightOverride, setPrefabLocalLight } from './localLight';
import type { GroundItemDefinition, PreparedGroundSpawn } from './groundPrefab';
import { PlaySound, PreloadSounds, type SoundHandle } from './sound';
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
const LOOT_COUNT = { moonglass_prop: 3, smallfalls: 2 } as const;

/** on_save: the child entity IDs with their prefab_layout index (the small pool's `wf_id` is index 1). */
export interface GrottoPoolSaveState { children: { index: number; id: string }[] }
/** workable.savestate = true on the mineable props. */
export interface GrottoGlassSaveState { workleft: number }
export interface GrottoRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { grottoPool?: GrottoPoolSaveState; grottoGlass?: GrottoGlassSaveState };
}

export interface GrottoPoolWorld {
  physics?: CANNON.World;
  scheduler: GameTimeScheduler;
  /** The listener of the waterfall sound controller (`ThePlayer`). */
  playerPosition: () => THREE.Vector3;
  getWatchWorldContent?: GetWatchWorldContent;
  /** The world's tickingarea query: props outside it are neither drawn, animated nor watching the moon. */
  tickingarea?: TileStateQuery;
  fx: Pick<WorldFx, 'prepare' | 'spawn'>;
  prepareSpawn(definition: GroundItemDefinition, fling?: boolean): Promise<PreparedGroundSpawn>;
}

export function isGrottoId(value: string): value is GrottoId { return (GROTTO_IDS as readonly string[]).includes(value); }
const isPoolId = (value: GrottoId): value is GrottoPoolId => (GROTTO_POOL_IDS as readonly string[]).includes(value);

interface Grotto {
  prefab: GrottoId;
  model: THREE.Group;
  sprite: ArchiveSprite;
  /** makebigmist / makesmallmist: a non-networked child that follows the pool. */
  mist?: ArchiveSprite;
  minimap?: MiniMapEntity;
  body?: CANNON.Body;
  workable?: Workable;
  lootdropper?: LootDropper;
  loot: Map<string, PreparedGroundSpawn[]>;
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
  removed: boolean;
}

/** grottowaterfallsoundcontroller.lua constants; distances are DST units. */
const EMITTER_MAXDSQ = 1600;
const NUM_EMITTERS = 3;
const LARGE_VOLUME = 1;
const SMALL_VOLUME = .8;
const MIN_FADE_VOLUME = .05;
const HALF_FADE_TIME = .2;
const PROCESS_PERIOD = 5 / 30;
const WATERFALL_LOOP = 'grotto/common/waterfall_LP' as const;

interface PoolData { grotto: Grotto; dsq: number; large: boolean }
interface Fade { from: number; to: number; elapsed: number; time: number; done?: () => void }
/** One `grottopool_sfx` emitter with its fader component. */
interface Emitter { handle?: SoundHandle; pool?: PoolData; volume: number; fade?: Fade }

/** The grotto pools, their props and the shared waterfall sound controller (`ms_registergrottopool`). */
export class GrottoPoolManager {
  private readonly scene: THREE.Scene;
  private readonly world: GrottoPoolWorld;
  private readonly assets = new ArchiveSpriteAssets();
  private readonly grottos = new Map<THREE.Group, Grotto>();
  private readonly byId = new Map<string, THREE.Group>();
  private readonly emitters: Emitter[] = Array.from({ length: NUM_EMITTERS }, () => ({ volume: 0 }));
  private soundTime = 0;
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
    // A prop saved mined out has nothing to drop until it regrows.
    const lootItems = table && saved?.components.grottoGlass?.workleft !== 0 ? Array.from({ length: LOOT_COUNT[table] }, () => 'moonglass' as const) : [];
    const mistAnimation = prefab === GROTTO_POOL_BIG_ID ? 'steam_big' : `steam_small${1 + Math.floor(Math.random() * 2)}`;
    const resources = await Promise.allSettled([
      pool
        ? createSharedArchiveSprite(this.assets, { animationArchive: 'moonglasspool_tile.zip', buildArchives: ['moonglasspool_tile.zip'],
          bank: 'moonglasspool_tile', animation: POOLS[prefab].animation, loop: true },
        { name: prefab })
        : createSharedArchiveSprite(this.assets, { animationArchive: 'moonglass_bigwaterfall.zip', buildArchives: ['moonglass_bigwaterfall.zip'],
          bank: 'moonglass_bigwaterfall', animation: definition!.animation, loop: true },
        { name: prefab }),
      pool ? createSharedArchiveSprite(this.assets, { animationArchive: 'moonglass_bigwaterfall_steam.zip',
        buildArchives: ['moonglass_bigwaterfall_steam.zip'], bank: 'moonglass_bigwaterfall_steam', animation: mistAnimation, loop: true },
      { name: `${prefab}_mist` }) : undefined,
      pool ? PreloadSounds(WATERFALL_LOOP) : undefined,
      table ? Promise.all([PreloadSounds('dontstarve/wilson/rock_break'), this.world.fx.prepare('halloween_moonpuff')]) : undefined,
      ...lootItems.map(itemId => this.world.prepareSpawn({ ...catalog.items[itemId], itemId, count: 1 }, true)),
    ] as const);
    const sprite = resources[0].status === 'fulfilled' ? resources[0].value : undefined;
    const mist = resources[1].status === 'fulfilled' ? resources[1].value : undefined;
    const loot = new Map<string, PreparedGroundSpawn[]>();
    for (const result of resources.slice(4)) {
      if (result.status === 'fulfilled') loot.set('moonglass', [...loot.get('moonglass') ?? [], result.value as PreparedGroundSpawn]);
    }
    const failed = resources.find(result => result.status === 'rejected');
    if (failed || this.disposed || !sprite) {
      sprite?.dispose(); mist?.dispose();
      for (const outputs of loot.values()) outputs.forEach(output => output.dispose());
      throw failed?.status === 'rejected' ? failed.reason : new Error('Grotto pools have been disposed');
    }
    return this.create(prefab, sprite, mist, loot, position, saved);
  }

  private create(prefab: GrottoId, sprite: ArchiveSprite, mist: ArchiveSprite | undefined, loot: Map<string, PreparedGroundSpawn[]>,
    position: THREE.Vector3, saved: GrottoRecord | undefined): THREE.Group {
    const model = sprite.model;
    model.position.set(position.x, 0, position.z);
    const id = saved?.id ?? newEntityId();
    Object.assign(model.userData, { entityId: id, prefab, noWetPrefix: true, remove: () => this.remove(model) });
    const grotto: Grotto = { prefab, model, sprite, mist, loot, children: [], savedChildren: [], stopMoonWatch: [], stopArea: [], removed: false,
      tracker: new TileTracker(() => model.position) };
    const inst = actionEntity(model, prefab);
    if (isPoolId(prefab)) this.createPool(grotto, prefab, inst, saved?.components.grottoPool);
    else this.createChild(grotto, prefab as ChildId, inst, saved?.components.grottoGlass);
    const area = this.world.tickingarea?.(grotto.tracker.tile);
    if (area) {
      // The gate is this prop's own memo: leaving the area hides it and stops its animation until it returns.
      const awake = watchSignal(area, stop => grotto.stopArea.push(stop));
      grotto.awake = awake;
      createEffect(() => { model.visible = awake.get(); });
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
    Object.assign(model.userData, { tags, billboard: false, deploySmartRadius: definition.smartRadius * WORLD_SCALE,
      physicsRadius: POOL_RADIUS[prefab] * WORLD_SCALE });
    const visual = model.children[0];
    visual.rotation.x = -Math.PI / 2; visual.position.y = .01;
    (visual.children[0] as THREE.Object3D).renderOrder = BACKGROUND_RENDER_ORDER;
    setPrefabLightOverride(model, .25);
    setPrefabLocalLight(model, { radius: definition.light.radius * WORLD_SCALE, falloff: .6, intensity: definition.light.intensity,
      colour: POOL_LIGHT_COLOUR });
    if (mist) {
      // makebigmist / makesmallmist: FX + NOCLICK, so the steam never intercepts the mouse over the props.
      mist.model.userData.tags = ['FX', 'NOCLICK'];
      setPrefabLightOverride(mist.model, .5); model.add(mist.model);
    }
    grotto.minimap = new MiniMapEntity(model.position);
    grotto.minimap.SetIcon(`${prefab}.png`);
    if (this.world.physics) {
      grotto.body = MakeObstaclePhysics(model.position, POOL_RADIUS[prefab]);
      model.userData.physicsBody = grotto.body;
      this.world.physics.addBody(grotto.body);
    }
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
    Object.assign(model.userData, { tags, deploySmartRadius: definition.smartRadius * WORLD_SCALE, ...definition.physicsRadius === undefined ? {}
      : { physicsRadius: definition.physicsRadius * WORLD_SCALE },
    ...definition.lootTable ? { prefabNameOverride: 'moonglass_rock' } : {} });
    if (definition.lightOverride !== undefined) setPrefabLightOverride(model, definition.lightOverride);
    sprite.setFrame(Math.floor(Math.random() * sprite.frameCount));
    if (!definition.lootTable) return;
    const workable = new Workable(inst);
    grotto.workable = workable;
    workable.savestate = true;
    workable.SetWorkAction('MINE');
    workable.SetWorkLeft(ROCKS_MINE);
    const lootdropper = new LootDropper(inst, (itemId, point) => {
      const prepared = grotto.loot.get(itemId)?.shift();
      if (!prepared) return undefined;
      const spawned = prepared.spawn(new THREE.Vector3(point.x, point.y, point.z));
      if (!spawned) prepared.dispose();
      return spawned ? prepared.spawnedEntity : undefined;
    });
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
  }

  private setMined(grotto: Grotto, definition: ChildDefinition): void {
    const { model } = grotto;
    delete model.userData.physicsRadius;
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
    model.userData.physicsRadius = definition.physicsRadius! * WORLD_SCALE;
    actionEntity(model, grotto.prefab).removeTag('NOCLICK');
    grotto.workable!.SetWorkLeft(ROCKS_MINE);
    this.world.fx.spawn('halloween_moonpuff', model.position);
    grotto.sprite.start(definition.animation);
    this.prepareLoot(grotto, definition);
  }

  /** The prepared drops of the next mining; the previous ones were consumed by DropLoot. */
  private prepareLoot(grotto: Grotto, definition: ChildDefinition): void {
    const missing = LOOT_COUNT[definition.lootTable!] - (grotto.loot.get('moonglass')?.length ?? 0);
    for (let i = 0; i < missing; i++) {
      void this.world.prepareSpawn({ ...catalog.items.moonglass, itemId: 'moonglass', count: 1 }, true).then(prepared => {
        if (grotto.removed || this.disposed) { prepared.dispose(); return; }
        grotto.loot.set('moonglass', [...grotto.loot.get('moonglass') ?? [], prepared]);
      }, (error: unknown) => console.error('Unable to prepare moonglass', error));
    }
  }

  update(dt: number, quaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    const focus = this.world.playerPosition();
    for (const { model, sprite, mist, awake } of this.grottos.values()) {
      if (!awake) model.visible = model.position.distanceToSquared(focus) <= ACTIVE_RADIUS_SQUARED;
      if (!model.visible) continue;
      if (model.userData.billboard !== false) model.quaternion.copy(quaternion);
      sprite.update(dt);
      if (mist) { mist.model.quaternion.copy(quaternion); mist.update(dt); }
    }
    this.updateSound(dt);
  }

  /** Only upright art needs depth sorting; the pool surface is a background decal. */
  get renderEntities() {
    return [...this.grottos.values()].filter(({ model }) => model.visible).flatMap(({ model, mist }) => [
      ...model.userData.billboard !== false ? [{ object: model, footPosition: model.position, cameraDepth: 0 }] : [],
      ...mist ? [{ object: mist.model, footPosition: model.position, cameraDepth: 0 }] : [],
    ]);
  }

  get miniMapEntities(): MiniMapEntity[] {
    return [...this.grottos.values()].flatMap(({ minimap }) => minimap ? [minimap] : []);
  }

  get mineTargets(): PickaxeTarget[] { return this.getMineTargets(); }

  getMineTargets(model?: THREE.Object3D): PickaxeTarget[] {
    return modelEntries(this.grottos, model).filter(([, grotto]) => grotto.workable?.CanBeWorked()).map(([model, grotto]) => ({
      id: String(model.userData.entityId), model, position: model.position, entity: actionEntity(model, grotto.prefab),
      isValid: () => this.grottos.get(model) === grotto && !!grotto.workable?.CanBeWorked(),
    }));
  }

  /** on_save: a pool lists its live children; a prop saves its work left. */
  exportRecords(): { prefabId: GrottoId; record: GrottoRecord }[] {
    return [...this.grottos].map(([model, grotto]) => {
      const children = grotto.children.flatMap((child, slot) => child ? [{ index: slot + 1, id: String(child.userData.entityId) }] : []);
      return { prefabId: grotto.prefab, record: {
        id: String(model.userData.entityId),
        transform: { position: [model.position.x, 0, model.position.z] as [number, number, number], rotationY: 0 },
        components: isPoolId(grotto.prefab) ? { grottoPool: { children: [...children, ...grotto.savedChildren] } }
          : grotto.workable ? { grottoGlass: { workleft: grotto.workable.workleft.peek() } } : {},
      } };
    });
  }

  /** grottowaterfallsoundcontroller.lua ProcessPlayer, every 5 frames, plus the emitters' faders. */
  private updateSound(dt: number): void {
    for (const emitter of this.emitters) {
      const fade = emitter.fade;
      if (!fade) continue;
      fade.elapsed += dt;
      const finished = fade.elapsed >= fade.time;
      this.setEmitterVolume(emitter, finished ? fade.to : fade.from + (fade.to - fade.from) * fade.elapsed / fade.time);
      if (finished) { emitter.fade = undefined; fade.done?.(); }
    }
    this.soundTime += dt;
    if (this.soundTime < PROCESS_PERIOD) return;
    this.soundTime %= PROCESS_PERIOD;
    this.processPlayer();
  }

  private setEmitterVolume(emitter: Emitter, volume: number): void {
    emitter.handle?.setVolume(volume); emitter.volume = volume;
  }

  private startFade(emitter: Emitter, from: number, to: number, done?: () => void): void {
    emitter.fade = { from, to, elapsed: 0, time: HALF_FADE_TIME, done };
    this.setEmitterVolume(emitter, from);
  }

  private processPlayer(): void {
    const player = this.world.playerPosition();
    const pools: PoolData[] = [];
    for (const grotto of this.grottos.values()) {
      if (!isPoolId(grotto.prefab)) continue;
      const radius = POOL_RADIUS[grotto.prefab];
      const dsq = grotto.model.position.distanceToSquared(player) / (WORLD_SCALE * WORLD_SCALE) - radius * radius;
      if (dsq < EMITTER_MAXDSQ) pools.push({ grotto, dsq, large: grotto.prefab === GROTTO_POOL_BIG_ID });
    }
    pools.sort((a, b) => a.dsq - b.dsq);
    // Pair the closest pools with the emitters already playing on them; the rest are unclaimed.
    const paired = new Set<Emitter>(), unclaimed: PoolData[] = [];
    pools.slice(0, NUM_EMITTERS).forEach(data => {
      const emitter = this.emitters.find(candidate => candidate.pool?.grotto === data.grotto);
      if (emitter) paired.add(emitter); else unclaimed.push(data);
    });
    for (const emitter of this.emitters) {
      if (paired.has(emitter)) continue;
      const data = unclaimed.pop();
      if (!data) {
        emitter.fade = undefined;
        emitter.handle?.stop(); emitter.handle = undefined; emitter.pool = undefined; emitter.volume = 0;
      } else if (!emitter.handle?.isPlaying() || !emitter.pool || emitter.pool.grotto.removed) {
        const volume = data.large ? LARGE_VOLUME : SMALL_VOLUME;
        emitter.fade = undefined;
        emitter.handle?.stop();
        emitter.handle = PlaySound(WATERFALL_LOOP, data.grotto.model.position);
        this.setEmitterVolume(emitter, volume);
        emitter.pool = data;
      } else {
        // Move a playing emitter: fade out, hop to the new pool, fade in.
        const oldVolume = emitter.volume;
        emitter.pool = data;
        this.startFade(emitter, oldVolume, MIN_FADE_VOLUME, () => {
          const target = emitter.pool;
          if (!target || target.grotto.removed) return;
          emitter.handle?.stop();
          emitter.handle = PlaySound(WATERFALL_LOOP, target.grotto.model.position);
          this.startFade(emitter, MIN_FADE_VOLUME, target.large ? LARGE_VOLUME : SMALL_VOLUME);
        });
      }
    }
  }

  /** on_removed: a pool removes its children from the last slot to the first; a prop leaves its owner's slot. */
  private remove(model: THREE.Group): void {
    const grotto = this.grottos.get(model); if (!grotto) return;
    this.grottos.delete(model); this.byId.delete(String(model.userData.entityId));
    model.userData.removed = true; grotto.removed = true;
    if (grotto.owner) grotto.owner.grotto.children[grotto.owner.index] = undefined;
    for (const child of [...grotto.children].reverse()) if (child) this.remove(child);
    if (grotto.setup?.snapshot.peek().status === 'scheduled') grotto.setup.stop();
    grotto.stopMoonWatch.splice(0).forEach(stop => stop());
    grotto.stopArea.splice(0).forEach(stop => stop());
    for (const emitter of this.emitters) if (emitter.pool?.grotto === grotto) {
      emitter.fade = undefined; emitter.handle?.stop(); emitter.handle = undefined; emitter.pool = undefined; emitter.volume = 0;
    }
    if (grotto.body) this.world.physics?.removeBody(grotto.body);
    setPrefabLocalLight(model, null);
    grotto.minimap?.dispose(); grotto.workable?.dispose();
    for (const outputs of grotto.loot.values()) outputs.forEach(output => output.dispose());
    grotto.loot.clear(); grotto.mist?.dispose(); grotto.sprite.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    for (const model of [...this.grottos.keys()]) this.remove(model);
    this.disposed = true;
    this.assets.dispose();
  }
}
