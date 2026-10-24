import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createArchiveSprite, ArchiveSpriteAssets, type ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { MiniMapEntity } from './minimapEntity';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { MakeObstaclePhysics } from './standardcomponents';

export const CAVE_EXIT_ID = 'cave_exit' as const;
export const CAVE_EXIT_IDS = [CAVE_EXIT_ID] as const;

/** cave_exit.lua MakeObstaclePhysics(inst, 2). */
const PHYSICS_RADIUS = 2;

/** worldmigrator is not connected yet: records carry only identity and position. */
export interface CaveExitRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: Record<string, never>;
}

export interface CaveExitWorld {
  physics?: CANNON.World;
}

interface Exit {
  sprite: ArchiveSprite;
  minimap: MiniMapEntity;
  body?: CANNON.Body;
}

/** cave_exit.lua: the staircase back to the surface; static `open` art (worldmigrator events are not connected). */
export class CaveExitManager {
  private readonly scene: THREE.Scene;
  private readonly world: CaveExitWorld;
  private readonly assets = new ArchiveSpriteAssets();
  private readonly exits = new Map<THREE.Group, Exit>();
  private disposed = false;

  constructor(scene: THREE.Scene, world: CaveExitWorld) {
    this.scene = scene; this.world = world;
  }

  async spawn(position: THREE.Vector3, saved?: CaveExitRecord): Promise<THREE.Group> {
    if (this.disposed) throw new Error('Cave exits have been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid cave exit position');
    const sprite = await createArchiveSprite(this.assets, { animationArchive: 'cave_exit.zip', buildArchives: ['cave_exit.zip'],
      bank: 'cave_stairs', animation: 'open', loop: true }, { name: CAVE_EXIT_ID });
    if (this.disposed) { sprite.dispose(); throw new Error('Cave exits have been disposed'); }
    const model = sprite.model;
    model.position.set(position.x, 0, position.z);
    Object.assign(model.userData, { entityId: saved?.id ?? newEntityId(), prefab: CAVE_EXIT_ID, tags: [], physicsRadius: PHYSICS_RADIUS });
    actionEntity(model, CAVE_EXIT_ID);
    const exit: Exit = { sprite, minimap: new MiniMapEntity(model.position) };
    exit.minimap.SetIcon('cave_open2.png');
    if (this.world.physics) {
      exit.body = MakeObstaclePhysics(model.position, PHYSICS_RADIUS);
      model.userData.physicsBody = exit.body;
      this.world.physics.addBody(exit.body);
    }
    this.exits.set(model, exit);
    this.scene.add(model);
    return model;
  }

  update(dt: number, quaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    for (const { sprite } of this.exits.values()) { sprite.model.quaternion.copy(quaternion); sprite.update(dt); }
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
      exit.minimap.dispose(); exit.sprite.dispose();
    }
    this.exits.clear();
    this.assets.dispose();
  }
}
