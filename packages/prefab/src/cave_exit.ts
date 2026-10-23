import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { preloadSharedArchiveSprite, ArchiveSpriteAssets } from '@dontstarve-web/animation/archiveSprite';
import type { TileStateQuery } from '@dontstarve-web/signals';
import { WorldMigrator, type WorldMigratorShard } from '../../componets/src/worldmigrator';
import { MiniMapEntity } from './minimapEntity';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { MakeObstaclePhysics, WORLD_SCALE } from './standardcomponents';
import { ResidentSprite } from '@dontstarve-web/animation/residentSprite';
import { watchTileActivity } from './tileActivity';

export const CAVE_EXIT_ID = 'cave_exit' as const;
export const CAVE_EXIT_IDS = [CAVE_EXIT_ID] as const;

/** cave_exit.lua MakeObstaclePhysics(inst, 2). */
const PHYSICS_RADIUS = 2;
/** cave_exit.lua `worldmigrator.shard_name`. */
export const MASTER_SHARD = 'Master';
const NO_SHARD: WorldMigratorShard = { isWorldAvailable: () => false, isWorldFull: () => false, migratePlayer: () => {} };

/** worldmigrator is not connected yet: records carry only identity and position. */
export interface CaveExitRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: Record<string, never>;
}

export interface CaveExitWorld {
  physics?: CANNON.World;
  /** Without it every exit is active. */
  tickingarea?: TileStateQuery;
  /** The shard link behind the stairs; without it the destination is never available. */
  shard?: WorldMigratorShard;
}

interface Exit {
  sprite: ResidentSprite;
  minimap: MiniMapEntity;
  body?: CANNON.Body;
  stopActivity: () => void;
  stopMigration: () => void;
}

/** cave_exit.lua: the staircase back to the surface; `open` while the Master shard is available. */
export class CaveExitManager {
  private readonly scene: THREE.Scene;
  private readonly world: CaveExitWorld;
  private readonly assets = new ArchiveSpriteAssets();
  private loading?: ReturnType<typeof preloadSharedArchiveSprite>;
  private readonly exits = new Map<THREE.Group, Exit>();
  private disposed = false;

  constructor(scene: THREE.Scene, world: CaveExitWorld) {
    this.scene = scene; this.world = world;
  }

  async spawn(position: THREE.Vector3, saved?: CaveExitRecord): Promise<THREE.Group> {
    if (this.disposed) throw new Error('Cave exits have been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid cave exit position');
    const source = await (this.loading ??= preloadSharedArchiveSprite(this.assets, { animationArchive: 'cave_exit.zip',
      buildArchives: ['cave_exit.zip'], bank: 'cave_stairs' }));
    if (this.disposed) throw new Error('Cave exits have been disposed');
    const create = (clip: { name: string; loop: boolean }) => source(clip.name, clip.loop, CAVE_EXIT_ID);
    const clip = { name: 'open', loop: true };
    const sprite = new ResidentSprite(create, clip, create(clip), CAVE_EXIT_ID);
    const model = sprite.model;
    model.position.set(position.x, 0, position.z);
    Object.assign(model.userData, { entityId: saved?.id ?? newEntityId(), prefab: CAVE_EXIT_ID, tags: [],
      physicsRadius: PHYSICS_RADIUS * WORLD_SCALE });
    const inst = actionEntity(model, CAVE_EXIT_ID);
    const exit: Exit = { sprite, minimap: new MiniMapEntity(model.position), stopActivity: () => {}, stopMigration: () => {} };
    exit.minimap.SetIcon('cave_open2.png');
    if (this.world.physics) {
      exit.body = MakeObstaclePhysics(model.position, PHYSICS_RADIUS);
      model.userData.physicsBody = exit.body;
      this.world.physics.addBody(exit.body);
    }
    // fn: the migration events pick the loop; the destination is the Master shard.
    const migrator = new WorldMigrator(inst, this.world.shard ?? NO_SHARD);
    const listeners = { migration_available: 'open', migration_unavailable: 'no_access', migration_full: 'over_capacity' } as const;
    const handlers = Object.entries(listeners).map(([event, animation]) => {
      const handler = () => sprite.start(animation);
      model.addEventListener(event as never, handler);
      return () => model.removeEventListener(event as never, handler);
    });
    exit.stopMigration = () => handlers.forEach(stop => stop());
    model.userData.components.worldmigrator = migrator;
    this.exits.set(model, exit);
    this.scene.add(model);
    exit.stopActivity = watchTileActivity(model, this.world.tickingarea, active => sprite.setActive(active));
    migrator.SetDestinationWorld(MASTER_SHARD);
    return model;
  }

  update(dt: number, quaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    for (const { sprite } of this.exits.values()) { sprite.faceCamera(quaternion); sprite.update(dt); }
  }

  get renderEntities() {
    return [...this.exits.values()].map(({ sprite }) => ({ object: sprite.model, footPosition: sprite.model.position, cameraDepth: 0 }));
  }

  get miniMapEntities(): MiniMapEntity[] { return [...this.exits.values()].map(({ minimap }) => minimap); }

  exportRecords(): { prefabId: typeof CAVE_EXIT_ID; record: CaveExitRecord }[] {
    return [...this.exits.keys()].map(model => ({ prefabId: CAVE_EXIT_ID, record: {
      id: String(model.userData.entityId),
      transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
      components: {},
    } }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [model, exit] of this.exits) {
      model.userData.removed = true;
      if (exit.body) this.world.physics?.removeBody(exit.body);
      exit.minimap.dispose(); exit.stopActivity(); exit.stopMigration(); exit.sprite.dispose();
    }
    this.exits.clear();
    this.assets.dispose();
  }
}
