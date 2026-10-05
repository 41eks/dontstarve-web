import * as THREE from 'three';
import {
  createAnimatedSpriteFactory,
  type AnimatedSpriteFactory,
  type SpriteAnimationController,
} from '@dontstarve-web/animation/sprite';
import { newEntityId } from './saveRecord';

export const SAPLING_PREFABS = ['sapling', 'sapling_moon'] as const;
export type SaplingPrefabId = typeof SAPLING_PREFABS[number];

/** sapling.lua keeps no runtime state yet; the record holds identity and transform. */
export interface SaplingRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: Record<string, never>;
}

/** sapling.lua: bank and build share the prefab name, and the resting clip is `sway`. */
const SAPLING_ARCHIVES: Readonly<Record<SaplingPrefabId, string>> = {
  sapling: 'sapling.zip',
  sapling_moon: 'sapling_moon.zip',
};

const SAPLING_ANIMATION = 'sway';

/** sapling.lua: swaying plants, with no planting, harvesting or digging yet. */
export class SaplingManager {
  private readonly factories = new Map<SaplingPrefabId, Promise<AnimatedSpriteFactory>>();
  private readonly saplings = new Map<SaplingPrefabId, Set<THREE.Group>>();
  private readonly scene: THREE.Scene;
  private readonly assetBaseUrl: string;
  private disposed = false;

  constructor(scene: THREE.Scene, assetBaseUrl: string) {
    this.scene = scene;
    this.assetBaseUrl = assetBaseUrl;
    for (const prefabId of SAPLING_PREFABS) this.saplings.set(prefabId, new Set());
  }

  async spawn(prefabId: SaplingPrefabId, position: THREE.Vector3, saved?: SaplingRecord): Promise<THREE.Group> {
    if (this.disposed) throw new Error('Sapling manager has been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid sapling position');
    let request = this.factories.get(prefabId);
    if (!request) {
      request = createAnimatedSpriteFactory(this.assetBaseUrl, SAPLING_ARCHIVES[prefabId]);
      this.factories.set(prefabId, request);
      void request.catch(() => this.factories.delete(prefabId));
    }
    const factory = await request;
    if (this.disposed) throw new Error('Sapling manager has been disposed');
    const model = factory.create({ initialAnimation: SAPLING_ANIMATION, name: prefabId });
    model.position.set(position.x, 0, position.z);
    Object.assign(model.userData, { prefab: prefabId, entityId: saved?.id ?? newEntityId() });
    this.saplings.get(prefabId)!.add(model);
    this.scene.add(model);
    return model;
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    for (const models of this.saplings.values()) {
      for (const model of models) {
        model.quaternion.copy(cameraQuaternion);
        (model.userData.animationController as SpriteAnimationController).update(dt);
      }
    }
  }

  get renderEntities() {
    return [...this.saplings.values()].flatMap((models) => [...models]
      .map((model) => ({ object: model, footPosition: model.position, cameraDepth: 0 })));
  }

  exportRecords(): { prefabId: SaplingPrefabId; record: SaplingRecord }[] {
    return [...this.saplings].flatMap(([prefabId, models]) => [...models].map((model) => ({
      prefabId,
      record: {
        id: String(model.userData.entityId),
        transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
        components: {},
      },
    })));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const models of this.saplings.values()) {
      for (const model of models) model.removeFromParent();
      models.clear();
    }
    for (const factory of this.factories.values()) void factory.then((value) => value.dispose(), () => undefined);
  }
}