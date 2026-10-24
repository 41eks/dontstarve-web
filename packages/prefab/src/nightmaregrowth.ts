import * as THREE from 'three';
import { createAnimatedSpriteFactory, type AnimatedSpriteFactory } from '@dontstarve-web/animation/sprite';
import { newEntityId } from './saveRecord';
import { createPrefabEntity } from './prefabInstance';

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
  growth: ReturnType<typeof createPrefabEntity>;
  crack: ReturnType<typeof createPrefabEntity>;
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
    const growth = createPrefabEntity(NIGHTMAREGROWTH_ID, { create: (animation, frame) => factory.create({ initialAnimation: animation, initialFrame: frame, name: NIGHTMAREGROWTH_ID }),
      release: sprite => factory.disposeSprite(sprite) }, { name: 'idle', held: true, billboard: true }, NIGHTMAREGROWTH_ID);
    growth.instance.addTag('ancient_text');
    // nightmaregrowth_crack: OnGround LAYER_BACKGROUND, FX | NOCLICK | DECOR, not persistent.
    const crack = createPrefabEntity('nightmaregrowth_crack', { create: (animation, frame) => {
      const drawn = factory.create({ initialAnimation: animation, initialFrame: frame, name: 'nightmaregrowth_crack' });
      // Match pond/terrain layering without changing the persistent ground origin.
      drawn.children[0].position.z = 0.01;
      drawn.children[0].children[0].renderOrder = -0.5;
      return drawn;
    }, release: sprite => factory.disposeSprite(sprite) }, { name: 'crack_idle', held: true }, 'nightmaregrowth_crack');
    for (const tag of ['FX', 'NOCLICK', 'DECOR']) crack.instance.addTag(tag);
    crack.instance.persists = false;
    const model = growth.display.model, crackModel = crack.display.model;
    growth.instance.position.set(position.x, 0, position.z);
    crack.instance.position.copy(model.position);
    crackModel.rotation.set(-Math.PI / 2, 0, THREE.MathUtils.degToRad(crackRotation));
    Object.assign(crackModel.userData, { prefab: 'nightmaregrowth_crack', billboard: false });
    Object.assign(model.userData, {
      prefab: NIGHTMAREGROWTH_ID, entityId: saved?.id ?? newEntityId(), nightmareGrowthCrack: crackModel,
    });
    this.growths.add({ model, growth, crack, crackRotation });
    this.scene.add(crackModel, model);
    return model;
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
    for (const { growth, crack } of this.growths) for (const { instance, display } of [growth, crack]) { instance.remove(); display.dispose(); }
    this.growths.clear();
    void this.factoryRequest?.then((factory) => factory.dispose(), () => undefined);
  }
}
