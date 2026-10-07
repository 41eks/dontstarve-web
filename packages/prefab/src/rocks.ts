import * as THREE from 'three';
import { createAnimatedSpriteFactory, type AnimatedSpriteFactory } from '@dontstarve-web/animation/sprite';
import { newEntityId } from './saveRecord';
import type { PickaxeTarget } from '@dontstarve-web/stategraphs/pickaxe';

export const ROCK_PREFABS = ['rock1', 'rock2', 'rock_flintless', 'rock_flintless_med', 'rock_flintless_low'] as const;
export type RockPrefabId = typeof ROCK_PREFABS[number];
export function isRockPrefab(value: string): value is RockPrefabId {
  return (ROCK_PREFABS as readonly string[]).includes(value);
}

/** Rocks carry no runtime state yet; the record keeps identity and transform. */
export interface RockRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: Record<string, never>;
}

interface RockDefinition {
  /** Shared anim/build/texture archive; rock_flintless*.zip serve three prefabs. */
  archive: string;
  initialAnimation: 'full' | 'med' | 'low';
}

const ROCK_DEFINITIONS: Readonly<Record<RockPrefabId, RockDefinition>> = {
  rock1: { archive: 'rock.zip', initialAnimation: 'full' },
  rock2: { archive: 'rock2.zip', initialAnimation: 'full' },
  rock_flintless: { archive: 'rock_flintless.zip', initialAnimation: 'full' },
  rock_flintless_med: { archive: 'rock_flintless.zip', initialAnimation: 'med' },
  rock_flintless_low: { archive: 'rock_flintless.zip', initialAnimation: 'low' },
};

const ROCK_HIT_DURATION = 0.2;
const ROCK_HIT_SCALE = 0.08;

/** Animation-only boulder: a static pose plus a brief hit pulse, no work/loot. */
export class RockController {
  private hitElapsed = ROCK_HIT_DURATION;
  private disposed = false;
  private readonly model: THREE.Group;

  constructor(model: THREE.Group) {
    this.model = model;
    Object.assign(model.userData, { tags: ['boulder'], rockController: this });
  }

  get canMine(): boolean { return !this.disposed; }

  playHit(): void {
    if (!this.disposed) this.hitElapsed = 0;
  }

  update(dt: number): void {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0 || this.hitElapsed >= ROCK_HIT_DURATION) return;
    this.hitElapsed = Math.min(ROCK_HIT_DURATION, this.hitElapsed + dt);
    const scale = 1 + ROCK_HIT_SCALE * Math.sin((this.hitElapsed / ROCK_HIT_DURATION) * Math.PI);
    this.model.scale.setScalar(scale);
    if (this.hitElapsed >= ROCK_HIT_DURATION) this.model.scale.setScalar(1);
  }

  dispose(): void {
    this.disposed = true;
    this.model.scale.setScalar(1);
  }
}

interface Rock {
  prefabId: RockPrefabId;
  model: THREE.Group;
  controller: RockController;
  factory: AnimatedSpriteFactory;
}

/** Shared per-archive sprites, independent hit pulses and stable foot points. */
export class RockManager {
  private readonly factories = new Map<string, Promise<AnimatedSpriteFactory>>();
  private readonly rocks = new Set<Rock>();
  private readonly scene: THREE.Scene;
  private readonly assetBaseUrl: string;
  private disposed = false;

  constructor(scene: THREE.Scene, assetBaseUrl: string) {
    this.scene = scene;
    this.assetBaseUrl = assetBaseUrl;
  }

  async spawn(prefabId: RockPrefabId, position: THREE.Vector3, saved?: RockRecord): Promise<THREE.Group> {
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid rock position');
    const definition = ROCK_DEFINITIONS[prefabId];
    let request = this.factories.get(definition.archive);
    if (!request) {
      request = createAnimatedSpriteFactory(this.assetBaseUrl, definition.archive);
      this.factories.set(definition.archive, request);
      void request.catch(() => this.factories.delete(definition.archive));
    }
    const factory = await request;
    if (this.disposed) throw new Error('Rock manager has been disposed');
    const model = factory.create({
      initialAnimation: definition.initialAnimation,
      initialFrame: 'first',
      name: prefabId,
    });
    model.position.set(position.x, 0, position.z);
    model.userData.entityId = saved?.id ?? newEntityId();
    model.userData.prefab = prefabId;
    const controller = new RockController(model);
    this.rocks.add({ prefabId, model, controller, factory });
    this.scene.add(model);
    return model;
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    for (const rock of this.rocks) {
      rock.model.quaternion.copy(cameraQuaternion);
      rock.controller.update(dt);
    }
  }

  get mineTargets(): PickaxeTarget[] {
    return [...this.rocks].filter((rock) => rock.controller.canMine).map((rock) => ({
      id: String(rock.model.userData.entityId),
      model: rock.model,
      position: rock.model.position,
      isValid: () => rock.controller.canMine,
      playHit: () => rock.controller.playHit(),
    }));
  }

  get renderEntities() {
    return [...this.rocks].map(({ model }) => ({ object: model, footPosition: model.position, cameraDepth: 0 }));
  }

  exportRecords(): { prefabId: RockPrefabId; record: RockRecord }[] {
    return [...this.rocks].map(({ prefabId, model }) => ({
      prefabId,
      record: {
        id: String(model.userData.entityId),
        transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
        components: {},
      },
    }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const { model, controller, factory } of this.rocks) {
      controller.dispose();
      factory.disposeSprite(model);
    }
    this.rocks.clear();
    for (const factory of this.factories.values()) void factory.then((value) => value.dispose(), () => undefined);
  }
}
