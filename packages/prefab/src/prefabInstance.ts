import { MiniMapState } from '../../map/src/minimapState';
import { watchMiniMapEntity } from '../../map/src/minimapEntities';
import type * as CANNON from 'cannon-es';
import type { Object3D, Vector3 } from 'three';
import { createSignal, readonlySignal, type ReadonlySignal } from '@dontstarve-web/signals';
import { LightState, PrefabDisplay, SpriteState, type ArchiveSpriteCommands, type ArchiveSpriteSource, type LoadedSpriteSource, type PrefabDisplayOptions, type PrefabStatus, type SpriteSource } from '@dontstarve-web/display';
import { bindPhysics, type PhysicsBinding } from '../../componets/src/physicsBinding';
import { PhysicsState } from '../../componets/src/physicsState';
import { TileTracker } from '../../componets/src/tileManager';
import type { Brain } from '../../brains/src/brain';
import type { StateGraphInstance } from '../../stategraphs/src/stategraph';
import type { ComponentActionEntity } from '../../stategraphs/src/componentactions';
import type { PlacementSaveRecord } from './saveRecord';
import { WORLD_SCALE } from './tile';
import { refreshMouseTarget } from './mouseTargets';
import type { PrefabWorldContext } from './worldContext';

type ActionComponents = ComponentActionEntity['components'];

/** Components owned by a world prefab, beyond the capabilities used to select actions. */
export interface PrefabComponents extends ActionComponents {
  hunger?: import('../../componets/src/hunger').Hunger;
  sanity?: import('../../componets/src/sanity').Sanity;
  inventory?: import('@dontstarve-web/inventory').InventoryStore;
  finiteuses?: import('../../componets/src/finiteuses').FiniteUses;
  knownlocations?: import('../../componets/src/knownlocations').KnownLocations;
  lootdropper?: import('../../componets/src/lootdropper').LootDropper;
  growable?: import('../../componets/src/growable').Growable;
  timer?: import('../../componets/src/timer').Timer;
  birdcage?: import('./birdcage').Birdcage;
  shelf?: import('../../componets/src/shelf').Shelf<import('@dontstarve-web/inventory').ItemEntity, PrefabInstance>;
  sleeper?: import('../../componets/src/sleeper').Sleeper;
  phonograph?: import('./phonograph').PhonographController;
  moonbase?: object;
  stafflight?: import('./stafflight').StaffLightState;
}

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
  get skinId(): string | undefined { return this.sprite.sprite.peek().skinId; }
  set skinId(skinId: string | undefined) { this.sprite.setSkinId(skinId); }
  /** inst.persists: false keeps the entity out of the save. */
  persists = true;
  /** inst.Physics: the collider the entity declares. */
  readonly physics = new PhysicsState();
  /** EntityScript components belong to the logical entity, including while its display sleeps. */
  readonly components: PrefabComponents = {};
  /** World services injected when this prefab joins a world; callbacks use the same host and components. */
  worldServices?: PrefabWorldContext;
  private readonly removedState = createSignal(false);
  readonly removal: ReadonlySignal<boolean> = readonlySignal(this.removedState);
  /** inst.Light: the light the entity declares; its display lists it while the entity is active. */
  readonly light = new LightState();
  /** inst.MiniMapEntity: map settings stay declared while the world sprite sleeps. */
  readonly minimap = new MiniMapState();
  private tracker?: TileTracker;
  /** The entity owns its movement notifications; map consumers receive this tracker with its icon declaration. */
  get tileTracker(): TileTracker { return this.tracker ??= new TileTracker(() => this.position); }
  /** inst.physicsradiusoverride, in DST units. */
  physicsRadiusOverride?: number;
  /** Deployable smart spacing, in world units. */
  deploySmartRadius?: number;
  private physicsBinding?: PhysicsBinding;
  /** inst.sg: SetStateGraph's instance, as other code reads and drives it; cleared by ClearStateGraph. */
  sg?: Pick<StateGraphInstance<unknown, string>, 'stateName' | 'hasStateTag' | 'goToState' | 'pushEvent' | 'listenForEvent'>;
  /** inst.brain: SetBrain's brain, cleared by StopBrain. */
  brain?: Brain;
  private readonly tags = new Set<string>();
  private tagView?: readonly string[];
  private readonly tagListeners = new Set<(tag: string) => void>();
  private readonly removalHandlers = new Set<() => void>();

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

  /** Transform:SetScale, on the model owned by the display. */
  get scale(): Vector3 {
    if (!this.model) throw new Error('The entity has no model attached');
    return this.model.scale;
  }

  /** Transform:SetRotation: the heading in degrees, counter-clockwise about +Y, on the model owned by the display. */
  setRotation(degrees: number): void {
    if (!this.model) throw new Error('The entity has no model attached');
    this.model.rotation.y = degrees * Math.PI / 180;
  }

  get isRemoved(): boolean { return this.lifecycle.peek() === 'removed'; }
  getPosition(): Vector3 { return this.position; }
  PushEvent(name: string, data: unknown): void { this.model?.dispatchEvent({ type: name, data } as never); }

  /** The body the binding keeps for `physics`, while one exists. */
  get physicsBody(): CANNON.Body | undefined { return this.physicsBinding?.body; }

  /** Hands `physics` to the host world; `ground` is the collider's origin when the model is drawn above it. */
  bindPhysics(world: CANNON.World, ground: () => Vector3 = () => this.position): void {
    if (this.physicsBinding || this.lifecycle.peek() === 'removed') return;
    this.physicsBinding = bindPhysics(world, this.physics, ground);
  }

  /** EntityScript:GetPhysicsRadius(default), in world units. */
  getPhysicsRadius(): number;
  getPhysicsRadius<T extends number | undefined>(fallback: T): number | T;
  getPhysicsRadius(fallback: number | undefined = 0): number | undefined {
    const radius = this.physicsRadiusOverride ?? this.physics.GetRadius();
    return radius === undefined ? fallback : radius * WORLD_SCALE;
  }

  /** inst:HasTag / AddTag / RemoveTag: the instance is the entity's only tag owner. */
  hasTag(tag: string): boolean {
    for (const component of Object.values(this.components) as { HasTag?(tag: string): boolean | undefined }[]) {
      const value = component?.HasTag?.(tag);
      if (value !== undefined) return value;
    }
    return this.tags.has(tag);
  }
  addTag(tag: string): void {
    if (this.tags.has(tag)) return;
    this.tags.add(tag);
    this.tagsChanged(tag);
  }
  removeTag(tag: string): void { if (this.tags.delete(tag)) this.tagsChanged(tag); }
  /** The current tags as a frozen list. */
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
    if (this.lifecycle.peek() === 'removed') return;
    this.minimap.SetEnabled(false);
    this.removedState.set(true);
    this.lifecycle.set('removed');
    this.physicsBinding?.dispose();
    for (const remove of this.removalHandlers) remove();
    this.removalHandlers.clear();
  }

  /** Entity-owned components and logical controllers stop when the inst is permanently removed. */
  onRemove(remove: () => void): () => void {
    if (this.lifecycle.peek() === 'removed') { remove(); return () => {}; }
    this.removalHandlers.add(remove);
    return () => { this.removalHandlers.delete(remove); };
  }
}

/** The display's model can be looked up without storing its logical entity in userData. */
const instancesByModel = new WeakMap<Object3D, PrefabInstance<ArchiveSpriteCommands>>();

/** Bind the display's model to its logical entity; metadata remains on the instance. */
export function bindInstance(model: Object3D, instance: PrefabInstance<ArchiveSpriteCommands>): void {
  instancesByModel.set(model, instance);
  instance.attach(model);
  instance.onRemove(watchMiniMapEntity(instance));
}

export function prefabInstance(model: Object3D | null | undefined): PrefabInstance<ArchiveSpriteCommands> | undefined {
  return model ? instancesByModel.get(model) : undefined;
}

/** inst:HasTag on a model: its instance owns the tags; a model without one (bare FX) keeps its own `userData.tags`. */
export function modelHasTag(model: Object3D, tag: string): boolean {
  const instance = prefabInstance(model);
  return instance ? instance.hasTag(tag) : (model.userData.tags as readonly string[] | undefined)?.includes(tag) ?? false;
}

/** Transitional: a model's tag write goes to its instance; a model without one keeps its own `userData.tags`. */
export function setModelTag(model: Object3D, tag: string, present: boolean): void {
  const instance = prefabInstance(model);
  if (instance) { if (present) instance.addTag(tag); else instance.removeTag(tag); return; }
  const tags: string[] = model.userData.tags ??= [];
  const index = tags.indexOf(tag);
  if (present) { if (index < 0) tags.push(tag); }
  else if (index >= 0) tags.splice(index, 1);
  refreshMouseTarget(model);
}

/** A new entity and the display that draws it. The model is the display's; the entity never holds it. */
/**
 * The first clip of a new entity's sprite. `sprite` is an existing entity's own sprite json, such as an item's
 * inst.AnimState that outlives each of its ground visuals: it is presented anew in this clip, keeping its skin.
 */
export type EntityClip = ConstructorParameters<typeof SpriteState>[0] & { readonly sprite?: SpriteState };

function entitySprite(clip: EntityClip): SpriteState {
  if (!clip.sprite) return new SpriteState(clip);
  clip.sprite.resetPresentation(clip);
  return clip.sprite;
}

export function createPrefabEntity(prefab: string, source: SpriteSource | LoadedSpriteSource, clip: EntityClip, name?: string,
  /** Sets the entity's appearance before the first sprite is drawn, so it is drawn dressed. */
  initialize?: (instance: PrefabInstance) => void, parentStatus?: ReadonlySignal<PrefabStatus>, displayOptions?: Pick<PrefabDisplayOptions, 'alignBottom' | 'dependencies'>):
  { instance: PrefabInstance; display: PrefabDisplay } {
  const instance = new PrefabInstance(prefab, entitySprite(clip));
  initialize?.(instance);
  const display = new PrefabDisplay({ ...displayOptions, name, source, status: instance.status, parentStatus, sprite: instance.sprite, light: instance.light });
  bindInstance(display.model, instance);
  return { instance, display };
}

/** A new entity drawn with a shared archive sprite; `clip.held` is a one-shot clip that rests on its last frame. */
export function createArchiveEntity(prefab: string, archive: ArchiveSpriteSource, clip: EntityClip, name?: string,
  initialize?: (instance: PrefabInstance<ArchiveSpriteCommands>) => void, parentStatus?: ReadonlySignal<PrefabStatus>):
  { instance: PrefabInstance<ArchiveSpriteCommands>; display: PrefabDisplay } {
  const state = entitySprite(clip);
  const instance = new PrefabInstance<ArchiveSpriteCommands>(prefab, state);
  initialize?.(instance);
  const display = new PrefabDisplay({ name, archive, status: instance.status, parentStatus, sprite: state, light: instance.light });
  bindInstance(display.model, instance);
  return { instance, display };
}

/** Transform-only prefab, with the same display-owned model and lifecycle as drawn entities; a billboard's display turns it to the camera. */
export function createEmptyEntity(prefab: string, parentStatus?: ReadonlySignal<PrefabStatus>, { billboard = false } = {}):
  { instance: PrefabInstance; display: PrefabDisplay } {
  const instance = new PrefabInstance(prefab, new SpriteState({ name: '', billboard }));
  const display = new PrefabDisplay({ name: prefab, empty: true, status: instance.status, parentStatus, sprite: instance.sprite, light: instance.light });
  bindInstance(display.model, instance);
  return { instance, display };
}
