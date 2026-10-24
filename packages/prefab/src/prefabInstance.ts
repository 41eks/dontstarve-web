import type * as CANNON from 'cannon-es';
import type { Object3D, Vector3 } from 'three';
import { createSignal, readonlySignal, type ReadonlySignal } from '@dontstarve-web/signals';
import { PrefabDisplay, SpriteState, type ArchiveSpriteCommands, type ArchiveSpriteSource, type PrefabStatus, type SpriteSource } from '@dontstarve-web/display';
import { bindPhysics, type PhysicsBinding } from '../../componets/src/physicsBinding';
import { PhysicsState } from '../../componets/src/physicsState';
import type { PlacementSaveRecord } from './saveRecord';
import { WORLD_SCALE } from './tile';

/**
 * The logical entity behind a placed prefab: identity, save record, skin, persistence, lifecycle `status` and the
 * `sprite` json. It holds no model. A `PrefabDisplay` subscribes to `status` and `sprite` and draws them, so the
 * prefab only changes data: asleep releases the visual and the model leaves the scene, removed releases everything.
 * `physics` is declared the same way; a `PhysicsBinding` keeps its body until the entity is removed.
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
  /** inst.Physics: the collider the entity declares. */
  readonly physics = new PhysicsState();
  /** inst.physicsradiusoverride, in DST units. */
  physicsRadiusOverride?: number;
  private physicsBinding?: PhysicsBinding;
  private readonly tags = new Set<string>();
  private tagView?: readonly string[];
  private readonly tagListeners = new Set<(tag: string) => void>();

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

  /** The body the binding keeps for `physics`, while one exists. */
  get physicsBody(): CANNON.Body | undefined { return this.physicsBinding?.body; }

  /** Hands `physics` to the host world; `ground` is the collider's origin when the model is drawn above it. */
  bindPhysics(world: CANNON.World, ground: () => Vector3 = () => this.position): void {
    if (this.physicsBinding || this.lifecycle.peek() === 'removed') return;
    this.physicsBinding = bindPhysics(world, this.physics, ground);
  }

  /** EntityScript:GetPhysicsRadius(default), in world units. */
  getPhysicsRadius<T extends number | undefined>(fallback: T): number | T {
    const radius = this.physicsRadiusOverride ?? this.physics.GetRadius();
    return radius === undefined ? fallback : radius * WORLD_SCALE;
  }

  /** inst:HasTag / AddTag / RemoveTag: the instance is the entity's only tag owner. */
  hasTag(tag: string): boolean { return this.tags.has(tag); }
  addTag(tag: string): void {
    if (this.tags.has(tag)) return;
    this.tags.add(tag);
    this.tagsChanged(tag);
  }
  removeTag(tag: string): void { if (this.tags.delete(tag)) this.tagsChanged(tag); }
  /** The current tags as a frozen list, for readers that still look at `userData.tags`. */
  listTags(): readonly string[] { return this.tagView ??= Object.freeze([...this.tags]); }
  /** Called with each added or removed tag, e.g. to refresh the placement index. */
  onTagChanged(listener: (tag: string) => void): () => void {
    this.tagListeners.add(listener);
    return () => { this.tagListeners.delete(listener); };
  }
  private tagsChanged(tag: string): void {
    this.tagView = undefined;
    for (const listener of this.tagListeners) listener(tag);
  }

  /** OnEntitySleep / OnEntityWake: follows the entity's tile; a removed entity stays removed. */
  setActive(active: boolean): void {
    if (this.lifecycle.peek() === 'removed') return;
    this.sprite.setAwake(active);
    this.lifecycle.set(active ? 'active' : 'asleep');
  }

  remove(): void {
    this.lifecycle.set('removed');
    this.physicsBinding?.dispose();
  }
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
  // Tags are the instance's; `userData.tags` is a read-only view and writers must use addTag/removeTag.
  Object.defineProperty(model.userData, 'tags', {
    enumerable: true, configurable: true,
    get: () => instance.listTags(),
    set: () => { throw new Error(`${instance.prefab}: write tags through the PrefabInstance`); },
  });
  // Entities that declare no physics still set a plain radius here.
  let physicsRadius: number | undefined = model.userData.physicsRadius;
  Object.defineProperty(model.userData, 'physicsRadius', {
    enumerable: true, configurable: true,
    get: () => instance.getPhysicsRadius(physicsRadius), set: (value: number | undefined) => { physicsRadius = value; },
  });
}

export function prefabInstance(model: Object3D): PrefabInstance<ArchiveSpriteCommands> | undefined {
  return model.userData.instance as PrefabInstance<ArchiveSpriteCommands> | undefined;
}

/** Transitional: a model's tag write goes to its instance; a model without one keeps its own `userData.tags`. */
export function setModelTag(model: Object3D, tag: string, present: boolean): void {
  const instance = prefabInstance(model);
  if (instance) { if (present) instance.addTag(tag); else instance.removeTag(tag); return; }
  const tags: string[] = model.userData.tags ??= [];
  const index = tags.indexOf(tag);
  if (present) { if (index < 0) tags.push(tag); }
  else if (index >= 0) tags.splice(index, 1);
}

/** A new entity and the display that draws it. The model is the display's; the entity never holds it. */
export function createPrefabEntity(prefab: string, source: SpriteSource, clip: ConstructorParameters<typeof SpriteState>[0], name?: string,
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
export function createArchiveEntity(prefab: string, archive: ArchiveSpriteSource, clip: ConstructorParameters<typeof SpriteState>[0], name?: string,
  initialize?: (instance: PrefabInstance<ArchiveSpriteCommands>) => void):
  { instance: PrefabInstance<ArchiveSpriteCommands>; display: PrefabDisplay } {
  const state = new SpriteState(clip);
  const instance = new PrefabInstance<ArchiveSpriteCommands>(prefab, state);
  initialize?.(instance);
  const display = new PrefabDisplay({ name, archive, status: instance.status, sprite: state });
  bindInstance(display.model, instance);
  display.model.userData.display = display;
  display.model.userData.animationController = instance.sprite;
  return { instance, display };
}

/** Transform-only prefab, with the same display-owned model and lifecycle as drawn entities. */
export function createEmptyEntity(prefab: string): { instance: PrefabInstance; display: PrefabDisplay } {
  const instance = new PrefabInstance(prefab, new SpriteState({ name: '' }));
  const display = new PrefabDisplay({ name: prefab, empty: true, status: instance.status, sprite: instance.sprite });
  bindInstance(display.model, instance);
  display.model.userData.display = display;
  return { instance, display };
}
