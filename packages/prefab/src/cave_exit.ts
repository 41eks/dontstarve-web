import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import type { TileStateQuery } from '@dontstarve-web/signals';
import { WorldMigrator, type WorldMigratorShard } from '../../componets/src/worldmigrator';
import type { MiniMapState } from '../../map/src/minimapState';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { MakeObstaclePhysics } from './standardcomponents';
import { SpriteResources, type ArchiveSpriteCommands, type PrefabDisplay } from '@dontstarve-web/display';
import { createArchiveEntity, type PrefabInstance, prefabInstance } from './prefabInstance';
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
  instance: PrefabInstance<ArchiveSpriteCommands>;
  display: PrefabDisplay;
  minimap: MiniMapState;
  stopActivity: () => void;
  stopMigration: () => void;
}

/** cave_exit.lua: the staircase back to the surface; `open` while the Master shard is available. */
export class CaveExitManager {
  private readonly displays: PrefabDisplayGroup;
  private readonly world: CaveExitWorld;
  private readonly resources = new SpriteResources();
  private readonly exits = new Map<THREE.Group, Exit>();
  private disposed = false;

  constructor(scene: THREE.Scene, world: CaveExitWorld) {
    this.displays = new PrefabDisplayGroup(scene); this.world = world;
  }

  spawn(position: THREE.Vector3, saved?: CaveExitRecord): THREE.Group {
    if (this.disposed) throw new Error('Cave exits have been disposed');
    const clip = { name: 'open', loop: true };
    const { instance, display } = createArchiveEntity(CAVE_EXIT_ID, this.resources.archive({ animationArchive: 'cave_exit.zip',
      buildArchives: ['cave_exit.zip'], bank: 'cave_stairs' }), { name: clip.name, billboard: true }, CAVE_EXIT_ID);
    const model = display.model, sprite = instance.sprite;
    model.position.set(position.x, 0, position.z);
    instance.entityId = saved?.id ?? newEntityId();
    const inst = actionEntity(model, CAVE_EXIT_ID);
    const exit: Exit = { instance, display, minimap: instance.minimap, stopActivity: () => {}, stopMigration: () => {} };
    exit.minimap.SetIcon('cave_open2.png');
    MakeObstaclePhysics(instance, PHYSICS_RADIUS);
    if (this.world.physics) instance.bindPhysics(this.world.physics);
    // fn: the migration events pick the loop; the destination is the Master shard.
    const migrator = new WorldMigrator(inst, this.world.shard ?? NO_SHARD);
    const listeners = { migration_available: 'open', migration_unavailable: 'no_access', migration_full: 'over_capacity' } as const;
    const handlers = Object.entries(listeners).map(([event, animation]) => {
      const handler = () => sprite.start(animation);
      model.addEventListener(event as never, handler);
      return () => model.removeEventListener(event as never, handler);
    });
    exit.stopMigration = () => handlers.forEach(stop => stop());
    prefabInstance(model)!.components.worldmigrator = migrator;
    this.exits.set(model, exit);
    this.displays.mount(prefabDisplay(model)!);
    exit.stopActivity = watchTileActivity(model, this.world.tickingarea, active => instance.setActive(active));
    migrator.SetDestinationWorld(MASTER_SHARD);
    return model;
  }

  update(dt: number, _quaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    this.displays.update(dt);
  }

  get renderEntities() {
    return [...this.exits.values()].map(({ display }) => ({ object: display.model, footPosition: display.model.position, cameraDepth: 0 }));
  }


  exportRecords(): { prefabId: typeof CAVE_EXIT_ID; record: CaveExitRecord }[] {
    return [...this.exits].map(([model, { instance }]) => ({ prefabId: CAVE_EXIT_ID, record: {
      id: String(instance.entityId),
      transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
      components: {},
    } }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [model, exit] of this.exits) {
      model.userData.removed = true;
      exit.stopActivity(); exit.stopMigration(); exit.instance.remove(); exit.display.dispose();
    }
    this.exits.clear();
    this.displays.dispose();
    this.resources.dispose();
  }
}
