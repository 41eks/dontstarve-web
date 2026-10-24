import type { Object3D, Vector3 } from 'three';
import { createSignal, readonlySignal, type ReadonlySignal } from '@dontstarve-web/signals';
import { PrefabDisplay, SpriteState, type ArchiveSpriteCommands, type ArchiveSpriteSource, type PrefabStatus, type SpriteSource } from '@dontstarve-web/display';
import type { PlacementSaveRecord } from './saveRecord';

/**
 * The logical entity behind a placed prefab: identity, save record, skin, persistence, lifecycle `status` and the
 * `sprite` json. It holds no model. A `PrefabDisplay` subscribes to `status` and `sprite` and draws them, so the
 * prefab only changes data: asleep releases the visual and the model leaves the scene, removed releases everything.
 */
export class PrefabInstance<Sprite extends ArchiveSpriteCommands = SpriteState> {
  readonly prefab: string;
  private readonly lifecycle = createSignal<PrefabStatus>('active');
  readonly status: ReadonlySignal<PrefabStatus> = readonlySignal(this.lifecycle);
  /** What the prefab may tell the sprite; an archive entity is narrowed to what an archive can draw. */
  readonly sprite: Sprite;
  private model: Object3D | undefined;
  entityId?: string;
  saveRecord?: PlacementSaveRecord;
  skinId?: string;
  /** inst.persists: false keeps the entity out of the save. */
  persists = true;

  /** `sprite` is the entity's sprite state, typed by what its display can draw. */
  constructor(prefab: string, sprite: Sprite) {
    this.prefab = prefab;
    this.sprite = sprite;
  }

  /** The display hands over the model it draws; the instance writes the model's transform directly. */
  attach(model: Object3D): void { this.model = model; }

  /** Where the entity stands: the attached model's own position vector. */
  get position(): Vector3 {
    if (!this.model) throw new Error('The entity has no model attached');
    return this.model.position;
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
export function bindInstance(model: Object3D, instance: PrefabInstance<ArchiveSpriteCommands>): void {
  model.userData.instance = instance;
  instance.attach(model);
  for (const key of ['entityId', 'saveRecord', 'skinId', 'persists'] as const) {
    Object.defineProperty(model.userData, key, {
      enumerable: true, configurable: true,
      get: () => instance[key], set: (value: never) => { instance[key] = value; },
    });
  }
}

export function prefabInstance(model: Object3D): PrefabInstance<ArchiveSpriteCommands> | undefined {
  return model.userData.instance as PrefabInstance<ArchiveSpriteCommands> | undefined;
}

/** A new entity and the display that draws it. The model is the display's; the entity never holds it. */
export function createPrefabEntity(prefab: string, source: SpriteSource, clip: { name: string; held?: boolean }, name?: string,
  /** Sets the entity's appearance before the first sprite is drawn, so it is drawn dressed. */
  initialize?: (instance: PrefabInstance) => void):
  { instance: PrefabInstance; display: PrefabDisplay } {
  const instance = new PrefabInstance(prefab, new SpriteState(clip));
  initialize?.(instance);
  const display = new PrefabDisplay({ name, source, status: instance.status, sprite: instance.sprite });
  bindInstance(display.model, instance);
  display.model.userData.display = display;
  display.model.userData.animationController = instance.sprite;
  return { instance, display };
}

/** A new entity drawn with a shared archive sprite; `clip.held` is a one-shot clip that rests on its last frame. */
export function createArchiveEntity(prefab: string, archive: ArchiveSpriteSource, clip: { name: string; held?: boolean }, name?: string):
  { instance: PrefabInstance<ArchiveSpriteCommands>; display: PrefabDisplay } {
  const state = new SpriteState(clip);
  const instance = new PrefabInstance<ArchiveSpriteCommands>(prefab, state);
  const display = new PrefabDisplay({ name, archive, status: instance.status, sprite: state });
  bindInstance(display.model, instance);
  display.model.userData.display = display;
  return { instance, display };
}
