import type * as THREE from 'three';
import { createSignal, readonlySignal, type ReadonlySignal } from '@dontstarve-web/signals';
import { PrefabDisplay, SpriteState, type PrefabStatus, type SpriteSource } from '@dontstarve-web/display';
import type { PlacementSaveRecord } from './saveRecord';

/**
 * The logical entity behind a placed prefab: identity, save record, skin, persistence, lifecycle `status` and the
 * `sprite` json. It holds no model. A `PrefabDisplay` subscribes to `status` and `sprite` and draws them, so the
 * prefab only changes data: asleep releases the visual and the model leaves the scene, removed releases everything.
 */
export class PrefabInstance {
  readonly prefab: string;
  private readonly lifecycle = createSignal<PrefabStatus>('active');
  readonly status: ReadonlySignal<PrefabStatus> = readonlySignal(this.lifecycle);
  readonly sprite: SpriteState;
  entityId?: string;
  saveRecord?: PlacementSaveRecord;
  skinId?: string;
  /** inst.persists: false keeps the entity out of the save. */
  persists = true;

  /** `clip` is the sprite's first clip; `held` shows it on its last frame. */
  constructor(prefab: string, clip: { name: string; held?: boolean }) {
    this.prefab = prefab;
    this.sprite = new SpriteState(clip);
  }

  /** OnEntitySleep / OnEntityWake: follows the entity's tile; a removed entity stays removed. */
  setActive(active: boolean): void {
    if (this.lifecycle.peek() === 'removed') return;
    this.sprite.setAwake(active);
    this.lifecycle.set(active ? 'active' : 'asleep');
  }

  remove(): void { this.lifecycle.set('removed'); }
}

/**
 * Transitional: readers that still look at `userData` keep working while the entity's data lives on the instance.
 * `instance` is how a model finds its entity.
 */
export function bindInstance(model: THREE.Object3D, instance: PrefabInstance): void {
  model.userData.instance = instance;
  for (const key of ['entityId', 'saveRecord', 'skinId', 'persists'] as const) {
    Object.defineProperty(model.userData, key, {
      enumerable: true, configurable: true,
      get: () => instance[key], set: (value: never) => { instance[key] = value; },
    });
  }
}

export function prefabInstance(model: THREE.Object3D): PrefabInstance | undefined {
  return model.userData.instance as PrefabInstance | undefined;
}

/** A new entity and the display that draws it. The model is the display's; the entity never holds it. */
export function createPrefabEntity(prefab: string, source: SpriteSource, clip: { name: string; held?: boolean }, name?: string,
  /** Sets the entity's appearance before the first sprite is drawn, so it is drawn dressed. */
  initialize?: (instance: PrefabInstance) => void):
  { instance: PrefabInstance; display: PrefabDisplay } {
  const instance = new PrefabInstance(prefab, clip);
  initialize?.(instance);
  const display = new PrefabDisplay({ name, source, status: instance.status, sprite: instance.sprite });
  bindInstance(display.model, instance);
  display.model.userData.display = display;
  display.model.userData.animationController = instance.sprite;
  return { instance, display };
}
