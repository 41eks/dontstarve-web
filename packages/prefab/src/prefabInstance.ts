import type * as THREE from 'three';
import { ResidentSpriteController } from '@dontstarve-web/animation/residentSprite';
import type { PlacementSaveRecord } from './saveRecord';

/** What the instance's resident visual is built from: the shared source and the sprite first drawn. */
export interface PrefabVisualSource {
  /** Builds a sprite from the entity's shared source, directly in the given animation. */
  create(animation: string): THREE.Group;
  /** Returns a drawn sprite to that source. */
  release(sprite: THREE.Group): void;
  initial: THREE.Group;
  clip: { name: string; held?: boolean };
}

/**
 * The entity behind a placed prefab: identity, save record, skin and persistence belong here, not to the model.
 * The model is the entity's anchor in the scene and the key other owners register it under. It is held in the scene
 * only while the tile is active; `animation` owns the sprite under it, which is built and released with it. `userData` keeps accessors
 * to the fields below for readers that have not moved to the instance yet.
 */
export class PrefabInstance {
  readonly prefab: string;
  readonly model: THREE.Group;
  entityId?: string;
  saveRecord?: PlacementSaveRecord;
  skinId?: string;
  /** inst.persists: false keeps the entity out of the save. */
  persists = true;
  /** The drawn sprite, present only while the tile is active; the model is its stable root. */
  readonly animation: ResidentSpriteController;
  private asleep = false;
  private home: THREE.Object3D | undefined;
  // The owner may add the model to the scene after its tile was already found inactive.
  private readonly onAdded = () => { if (this.asleep) this.sleep(); };

  constructor(prefab: string, model: THREE.Group, source: PrefabVisualSource) {
    this.prefab = prefab;
    this.model = model;
    this.animation = new ResidentSpriteController(model, source.create, source.release, source.initial, source.clip);
    model.userData.instance = this;
    for (const key of ['entityId', 'saveRecord', 'skinId', 'persists'] as const) {
      Object.defineProperty(model.userData, key, {
        enumerable: true, configurable: true,
        get: () => this[key], set: (value: never) => { this[key] = value; },
      });
    }
    model.addEventListener('added', this.onAdded);
  }

  /** OnEntitySleep / OnEntityWake: the visual is released and the anchor leaves the scene, or both return. */
  setActive(active: boolean): void {
    if (active) { this.wake(); this.animation.setActive(true); return; }
    this.animation.setActive(false);
    this.asleep = true;
    this.sleep();
  }

  private sleep(): void {
    const parent = this.model.parent;
    if (!parent) return;
    this.home = parent;
    this.model.removeFromParent();
  }

  private wake(): void {
    this.asleep = false;
    const home = this.home;
    this.home = undefined;
    if (home && !this.model.parent) home.add(this.model);
  }

  /** Releases the visual and leaves the scene; shared sources stay with their owner. */
  dispose(): void {
    this.asleep = false;
    this.home = undefined;
    this.model.removeEventListener('added', this.onAdded);
    this.animation.dispose();
    this.model.removeFromParent();
    if (this.model.userData.instance === this) delete this.model.userData.instance;
  }
}

export function prefabInstance(model: THREE.Object3D): PrefabInstance | undefined {
  return model.userData.instance as PrefabInstance | undefined;
}
