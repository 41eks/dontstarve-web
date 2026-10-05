import * as THREE from 'three';
import { createAnimatedSpriteFactory, type AnimatedSpriteFactory } from '@dontstarve-web/animation/sprite';
import { newEntityId } from './saveRecord';

export const NIGHTMAREGROWTH_ID = 'nightmaregrowth' as const;

export interface NightmareGrowthSaveState {
  crackRotation: number;
}

export interface NightmareGrowthRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { nightmareGrowth: NightmareGrowthSaveState };
}

interface NightmareGrowth {
  model: THREE.Group;
  crack: THREE.Group;
  crackRotation: number;
}

/** nightmaregrowth.lua: upright idle plus its independently rotated OnGround crack. */
export class NightmareGrowthManager {
  private factoryRequest?: Promise<AnimatedSpriteFactory>;
  private readonly growths = new Set<NightmareGrowth>();
  private readonly scene: THREE.Scene;
  private readonly assetBaseUrl: string;
  private disposed = false;

  constructor(scene: THREE.Scene, assetBaseUrl: string) {
    this.scene = scene;
    this.assetBaseUrl = assetBaseUrl;
  }

  async spawn(position: THREE.Vector3, saved?: NightmareGrowthRecord): Promise<THREE.Group> {
    if (this.disposed) throw new Error('Nightmare growth manager has been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid nightmare growth position');
    const crackRotation = saved?.components.nightmareGrowth.crackRotation ?? Math.random() * 360;
    if (!Number.isFinite(crackRotation) || crackRotation < 0 || crackRotation > 360) throw new RangeError('Invalid crack rotation');
    if (!this.factoryRequest) {
      this.factoryRequest = createAnimatedSpriteFactory(this.assetBaseUrl, 'nightmaregrowth.zip');
      void this.factoryRequest.catch(() => { this.factoryRequest = undefined; });
    }
    const factory = await this.factoryRequest;
    if (this.disposed) throw new Error('Nightmare growth manager has been disposed');
    // Both idle clips are non-looping in Lua. Hold their settled appearance.
    const model = factory.create({ initialAnimation: 'idle', initialFrame: 'last', name: NIGHTMAREGROWTH_ID });
    const crack = factory.create({ initialAnimation: 'crack_idle', initialFrame: 'last', name: 'nightmaregrowth_crack' });
    model.position.set(position.x, 0, position.z);
    crack.position.copy(model.position);
    crack.rotation.set(-Math.PI / 2, 0, THREE.MathUtils.degToRad(crackRotation));
    crack.userData.billboard = false;
    // Match pond/terrain layering without changing the persistent ground origin.
    crack.children[0].position.z = 0.01;
    crack.children[0].children[0].renderOrder = -0.5;
    Object.assign(model.userData, {
      prefab: NIGHTMAREGROWTH_ID, entityId: saved?.id ?? newEntityId(), nightmareGrowthCrack: crack,
    });
    this.growths.add({ model, crack, crackRotation });
    this.scene.add(crack, model);
    return model;
  }

  update(cameraQuaternion: THREE.Quaternion): void {
    for (const { model } of this.growths) model.quaternion.copy(cameraQuaternion);
  }

  get renderEntities() {
    return [...this.growths].map(({ model }) => ({ object: model, footPosition: model.position, cameraDepth: 0 }));
  }

  exportRecords(): NightmareGrowthRecord[] {
    return [...this.growths].map(({ model, crackRotation }) => ({
      id: String(model.userData.entityId),
      transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
      components: { nightmareGrowth: { crackRotation } },
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const { model, crack } of this.growths) { model.removeFromParent(); crack.removeFromParent(); }
    this.growths.clear();
    void this.factoryRequest?.then((factory) => factory.dispose(), () => undefined);
  }
}
