import * as THREE from 'three';
import { createAnimatedSpriteFactory, type AnimatedSpriteFactory, type SpriteAnimationController } from '@dontstarve-web/animation/sprite';
import { newEntityId } from './saveRecord';

export const POND_ID = 'pond' as const;

export interface PondRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: Record<string, never>;
}

/** pond.lua: marsh_tile bank/build, looping idle, OnGround background layer. */
export class PondManager {
  private factoryRequest?: Promise<AnimatedSpriteFactory>;
  private readonly ponds = new Set<THREE.Group>();
  private readonly scene: THREE.Scene;
  private readonly assetBaseUrl: string;
  private disposed = false;

  constructor(scene: THREE.Scene, assetBaseUrl: string) {
    this.scene = scene;
    this.assetBaseUrl = assetBaseUrl;
  }

  async spawn(position: THREE.Vector3, saved?: PondRecord): Promise<THREE.Group> {
    if (this.disposed) throw new Error('Pond manager has been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid pond position');
    if (!this.factoryRequest) {
      this.factoryRequest = createAnimatedSpriteFactory(this.assetBaseUrl, 'marsh_tile.zip');
      void this.factoryRequest.catch(() => { this.factoryRequest = undefined; });
    }
    const factory = await this.factoryRequest;
    if (this.disposed) throw new Error('Pond manager has been disposed');
    const model = factory.create({ initialAnimation: 'idle', name: POND_ID });
    model.position.set(position.x, 0, position.z);
    model.rotation.x = -Math.PI / 2;
    // Lift only the artwork above terrain; the entity/save origin stays grounded.
    const visual = model.children[0];
    visual.position.z = 0.01;
    // Ground layers share group order 0 and use mesh order. A negative group
    // order would draw the pond before transparent turf, which covers it up.
    visual.children[0].renderOrder = -0.5;
    Object.assign(model.userData, {
      billboard: false, prefab: POND_ID, entityId: saved?.id ?? newEntityId(),
    });
    this.ponds.add(model);
    this.scene.add(model);
    return model;
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (const model of this.ponds) {
      (model.userData.animationController as SpriteAnimationController).update(dt);
    }
  }

  exportRecords(): PondRecord[] {
    return [...this.ponds].map((model) => ({
      id: String(model.userData.entityId),
      transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
      components: {},
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of this.ponds) model.removeFromParent();
    this.ponds.clear();
    void this.factoryRequest?.then((factory) => factory.dispose(), () => undefined);
  }
}
