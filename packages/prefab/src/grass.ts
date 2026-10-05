import * as THREE from 'three';
import { loadAnim, loadBuild } from '@dontstarve-web/animation/animationAssets';
import {
  createSpriteFactory,
  type AnimatedSpriteFactory,
  type SpriteAnimationController,
} from '@dontstarve-web/animation/sprite';
import { newEntityId } from './saveRecord';

export const GRASS_ID = 'grass' as const;

/** grass.lua ships no interactive state yet; the record keeps identity and transform. */
export interface GrassRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: Record<string, never>;
}

/** grass.lua: bank `grass`, build `grass1`, looping `idle`; no picking or digging yet. */
export class GrassManager {
  private factoryRequest?: Promise<AnimatedSpriteFactory>;
  private readonly grasses = new Set<THREE.Group>();
  private readonly scene: THREE.Scene;
  private readonly assetBaseUrl: string;
  private disposed = false;

  constructor(scene: THREE.Scene, assetBaseUrl: string) {
    this.scene = scene;
    this.assetBaseUrl = assetBaseUrl;
  }

  async spawn(position: THREE.Vector3, saved?: GrassRecord): Promise<THREE.Group> {
    if (this.disposed) throw new Error('Grass manager has been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid grass position');
    if (!this.factoryRequest) {
      // The bank and the build live in separate source archives.
      this.factoryRequest = Promise.all([
        loadBuild('grass1.zip', this.assetBaseUrl),
        loadAnim('grass.zip', this.assetBaseUrl),
      ]).then(([buildPackage, animations]) => createSpriteFactory(buildPackage, animations));
      void this.factoryRequest.catch(() => { this.factoryRequest = undefined; });
    }
    const factory = await this.factoryRequest;
    if (this.disposed) throw new Error('Grass manager has been disposed');
    const model = factory.create({ initialAnimation: 'idle', name: GRASS_ID });
    model.position.set(position.x, 0, position.z);
    Object.assign(model.userData, { prefab: GRASS_ID, entityId: saved?.id ?? newEntityId() });
    this.grasses.add(model);
    this.scene.add(model);
    return model;
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    for (const model of this.grasses) {
      model.quaternion.copy(cameraQuaternion);
      (model.userData.animationController as SpriteAnimationController).update(dt);
    }
  }

  get renderEntities() {
    return [...this.grasses].map((model) => ({ object: model, footPosition: model.position, cameraDepth: 0 }));
  }

  exportRecords(): GrassRecord[] {
    return [...this.grasses].map((model) => ({
      id: String(model.userData.entityId),
      transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
      components: {},
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of this.grasses) model.removeFromParent();
    this.grasses.clear();
    void this.factoryRequest?.then((factory) => factory.dispose(), () => undefined);
  }
}