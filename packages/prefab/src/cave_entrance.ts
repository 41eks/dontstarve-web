import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { preloadSharedArchiveSprite, ArchiveSpriteAssets } from '@dontstarve-web/animation/archiveSprite';
import type { TileStateQuery } from '@dontstarve-web/signals';
import type { PickaxeTarget } from '@dontstarve-web/stategraphs/pickaxe';
import { LootDropper } from '../../componets/src/lootdropper';
import { Workable } from '../../componets/src/workable';
import { WorldMigrator, type WorldMigratorShard } from '../../componets/src/worldmigrator';
import { modelEntries } from './modelRecords';
import { MiniMapEntity } from './minimapEntity';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { MakeObstaclePhysics } from './standardcomponents';
import type { GroundItemDefinition, PreparedGroundSpawn } from './groundPrefab';
import { PlaySound, PreloadSounds } from './sound';
import type { ArchiveSpriteCommands, PrefabDisplay } from '@dontstarve-web/display';
import { createArchiveEntity, type PrefabInstance } from './prefabInstance';
import { watchTileActivity } from './tileActivity';
import catalog from './groundItems.json' with { type: 'json' };

export const CAVE_ENTRANCE_ID = 'cave_entrance' as const;
export const CAVE_ENTRANCE_OPEN_ID = 'cave_entrance_open' as const;
export const CAVE_ENTRANCE_IDS = [CAVE_ENTRANCE_ID, CAVE_ENTRANCE_OPEN_ID] as const;
export type CaveEntranceId = typeof CAVE_ENTRANCE_IDS[number];

/** tuning.lua ROCKS_MINE. */
const ROCKS_MINE = 6;
/** cave_entrance.lua MakeObstaclePhysics(inst, 1). */
const PHYSICS_RADIUS = 1;
/** cave_entrance.lua closed_fn SetLoot. */
const CLOSED_LOOT = ['rocks', 'rocks', 'flint', 'flint', 'flint'] as const;
/** LAYER_BACKGROUND with sort order 3: drawn under the world entities. */
export const CAVE_ENTRANCE_OPEN_RENDER_LAYER = -1;

/** cave_entrance.lua open_fn `worldmigrator.shard_name`. */
export const CAVES_SHARD = 'Caves';

/** workable.savestate defaults to false and worldmigrator is not connected yet: records carry only identity and position. */
export interface CaveEntranceRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: Record<string, never>;
}

export interface CaveEntranceWorld {
  physics?: CANNON.World;
  /** Without it every entrance is active. */
  tickingarea?: TileStateQuery;
  /** The shard link behind `cave_entrance_open`; without it the destination is never available. */
  shard?: WorldMigratorShard;
  prepareSpawn(definition: GroundItemDefinition, fling?: boolean): Promise<PreparedGroundSpawn>;
}

export function isCaveEntranceId(value: string): value is CaveEntranceId {
  return (CAVE_ENTRANCE_IDS as readonly string[]).includes(value);
}

const NO_SHARD: WorldMigratorShard = { isWorldAvailable: () => false, isWorldFull: () => false, migratePlayer: () => {} };

type SpriteSource = Awaited<ReturnType<typeof preloadSharedArchiveSprite>>;

interface Entrance {
  prefab: CaveEntranceId;
  instance: PrefabInstance<ArchiveSpriteCommands>;
  display: PrefabDisplay;
  sprite: ArchiveSpriteCommands;
  minimap: MiniMapEntity;
  workable?: Workable;
  loot: Map<string, PreparedGroundSpawn[]>;
  stopActivity: () => void;
  stopMigration?: () => void;
  removed: boolean;
}

/** cave_entrance.lua: a MINE-able sealed entrance that becomes `cave_entrance_open` (worldmigrator and bats are not connected). */
export class CaveEntranceManager {
  private readonly scene: THREE.Scene;
  private readonly world: CaveEntranceWorld;
  private readonly assets = new ArchiveSpriteAssets();
  /** One archive load serves both prefabs: `cave_entrance_open` replaces the closed entrance synchronously. */
  private factory?: SpriteSource;
  private loading?: Promise<SpriteSource>;
  private readonly entrances = new Map<THREE.Group, Entrance>();
  private disposed = false;

  constructor(scene: THREE.Scene, world: CaveEntranceWorld) {
    this.scene = scene; this.world = world;
  }

  async spawn(prefab: CaveEntranceId, position: THREE.Vector3, saved?: CaveEntranceRecord): Promise<THREE.Group> {
    if (this.disposed) throw new Error('Cave entrances have been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid cave entrance position');
    const closed = prefab === CAVE_ENTRANCE_ID;
    const loot = new Map<string, PreparedGroundSpawn[]>();
    const resources = await Promise.allSettled([
      this.loadSource(),
      PreloadSounds('dontstarve/wilson/rock_break'),
      ...closed ? CLOSED_LOOT.map(itemId => this.world.prepareSpawn({ ...catalog.items[itemId], itemId, count: 1 }, true)) : [],
    ]);
    resources.slice(2).forEach((result, index) => {
      if (result.status !== 'fulfilled') return;
      const itemId = CLOSED_LOOT[index];
      loot.set(itemId, [...loot.get(itemId) ?? [], result.value as PreparedGroundSpawn]);
    });
    const failed = resources.find(result => result.status === 'rejected');
    if (failed || this.disposed || !this.factory) {
      for (const outputs of loot.values()) outputs.forEach(output => output.dispose());
      throw failed?.status === 'rejected' ? failed.reason : new Error('Cave entrances have been disposed');
    }
    return this.create(prefab, loot, position, saved);
  }

  private loadSource() {
    return this.loading ??= preloadSharedArchiveSprite(this.assets, { animationArchive: 'cave_entrance.zip', buildArchives: ['cave_entrance.zip'], bank: 'cave_entrance' })
      .then(factory => this.factory = factory);
  }

  /** closed: idle_closed; open: `no_access` until its worldmigrator reports an available destination. */
  private createSprite(source: SpriteSource, prefab: CaveEntranceId): ReturnType<typeof createArchiveEntity> {
    const open = prefab === CAVE_ENTRANCE_OPEN_ID;
    const clip = { name: open ? 'no_access' : 'idle_closed', loop: open };
    const create = (current: { name: string; loop: boolean }) => source(current.name, current.loop, prefab);
    const entity = createArchiveEntity(prefab, { create, initial: create(clip) }, { name: clip.name, held: !open, billboard: true }, prefab);
    // PlayAnimation("idle_closed") plays once rather than resting on its last frame.
    if (!open) entity.instance.sprite.playOnce(clip.name);
    return entity;
  }

  private create(prefab: CaveEntranceId, loot: Map<string, PreparedGroundSpawn[]>, position: THREE.Vector3,
    saved: CaveEntranceRecord | undefined): THREE.Group {
    const { instance, display } = this.createSprite(this.factory!, prefab);
    const model = display.model, sprite = instance.sprite;
    model.position.set(position.x, 0, position.z);
    Object.assign(model.userData, { entityId: saved?.id ?? newEntityId(), prefab });
    instance.addTag('antlion_sinkhole_blocker');
    const inst = actionEntity(model, prefab);
    const entrance: Entrance = { prefab, instance, display, sprite, loot, removed: false, stopActivity: () => {},
      minimap: new MiniMapEntity(model.position) };
    entrance.minimap.SetIcon(prefab === CAVE_ENTRANCE_ID ? 'cave_closed.png' : 'cave_open.png');
    MakeObstaclePhysics(instance, PHYSICS_RADIUS);
    if (this.world.physics) instance.bindPhysics(this.world.physics);
    if (prefab === CAVE_ENTRANCE_ID) this.createWorkable(entrance, inst);
    else this.createMigrator(entrance, inst);
    this.entrances.set(model, entrance);
    this.scene.add(model);
    entrance.stopActivity = watchTileActivity(model, this.world.tickingarea, active => instance.setActive(active));
    return model;
  }

  /** open_fn: the migration events pick the loop (`open`, `no_access`, `over_capacity`); the destination is the Caves shard. */
  private createMigrator(entrance: Entrance, inst: ReturnType<typeof actionEntity>): void {
    const { sprite } = entrance, model = entrance.display.model;
    const migrator = new WorldMigrator(inst, this.world.shard ?? NO_SHARD);
    const listeners = { migration_available: 'open', migration_unavailable: 'no_access', migration_full: 'over_capacity' } as const;
    const handlers = Object.entries(listeners).map(([event, animation]) => {
      const handler = () => sprite.start(animation);
      model.addEventListener(event as never, handler);
      return () => model.removeEventListener(event as never, handler);
    });
    entrance.stopMigration = () => handlers.forEach(stop => stop());
    model.userData.components.worldmigrator = migrator;
    migrator.SetDestinationWorld(CAVES_SHARD);
  }

  /** closed_fn: MINE for ROCKS_MINE work, OnWork shows low/med/idle_closed and finally drops the loot and opens. */
  private createWorkable(entrance: Entrance, inst: ReturnType<typeof actionEntity>): void {
    const { sprite } = entrance, model = entrance.display.model;
    const workable = new Workable(inst);
    entrance.workable = workable;
    workable.SetWorkAction('MINE');
    workable.SetWorkLeft(ROCKS_MINE);
    const lootdropper = new LootDropper(inst, (itemId, point) => {
      const prepared = entrance.loot.get(itemId)?.shift();
      if (!prepared) return undefined;
      const spawned = prepared.spawn(new THREE.Vector3(point.x, point.y, point.z));
      if (!spawned) prepared.dispose();
      return spawned ? prepared.spawnedEntity : undefined;
    });
    lootdropper.SetLoot(CLOSED_LOOT);
    workable.SetOnWorkCallback((_worker, workleft) => {
      if (workleft > 0) {
        sprite.playOnce(workleft < ROCKS_MINE / 3 ? 'low' : workleft < ROCKS_MINE * 2 / 3 ? 'med' : 'idle_closed');
        return;
      }
      // rock_break_fx, DropLoot, then cave_entrance_open takes the closed entrance's place.
      PlaySound('dontstarve/wilson/rock_break', model.position);
      lootdropper.DropLoot();
      const record: CaveEntranceRecord = { id: newEntityId(), transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 }, components: {} };
      this.remove(model);
      this.create(CAVE_ENTRANCE_OPEN_ID, new Map(), model.position, record);
    });
    Object.assign(model.userData.components, { workable, lootdropper });
  }

  update(dt: number, _quaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    for (const { sprite } of this.entrances.values()) sprite.update(dt);
  }

  get renderEntities() {
    return [...this.entrances.values()].map(({ prefab, display }) => ({
      object: display.model, footPosition: display.model.position, cameraDepth: 0,
      ...prefab === CAVE_ENTRANCE_OPEN_ID ? { renderLayer: CAVE_ENTRANCE_OPEN_RENDER_LAYER } : {},
    }));
  }

  get miniMapEntities(): MiniMapEntity[] { return [...this.entrances.values()].map(({ minimap }) => minimap); }

  get mineTargets(): PickaxeTarget[] { return this.getMineTargets(); }

  getMineTargets(model?: THREE.Object3D): PickaxeTarget[] {
    return modelEntries(this.entrances, model).filter(([, entrance]) => entrance.workable?.CanBeWorked()).map(([model, entrance]) => ({
      id: String(model.userData.entityId), model, position: model.position, entity: actionEntity(model, entrance.prefab),
      isValid: () => this.entrances.get(model) === entrance && !!entrance.workable?.CanBeWorked(),
    }));
  }

  exportRecords(): { prefabId: CaveEntranceId; record: CaveEntranceRecord }[] {
    return [...this.entrances].map(([model, { prefab }]) => ({ prefabId: prefab, record: {
      id: String(model.userData.entityId),
      transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
      components: {},
    } }));
  }

  private remove(model: THREE.Group): void {
    const entrance = this.entrances.get(model); if (!entrance) return;
    this.entrances.delete(model); model.userData.removed = true; entrance.removed = true;
    entrance.minimap.dispose(); entrance.workable?.dispose();
    for (const outputs of entrance.loot.values()) outputs.forEach(output => output.dispose());
    entrance.loot.clear(); entrance.stopActivity(); entrance.stopMigration?.(); entrance.instance.remove(); entrance.display.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of [...this.entrances.keys()]) this.remove(model);
    this.assets.dispose();
  }
}
