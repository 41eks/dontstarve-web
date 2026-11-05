import { MiniMapState } from '../../map/src/minimapState';
import { watchMiniMapEntity } from '../../map/src/minimapEntities';
import type * as CANNON from 'cannon-es';
import { MathUtils, type Object3D, type Vector3, type Vector3Like } from 'three';
import { createSignal, EventEmitter, readonlySignal, type ReadonlySignal, type TileStateQuery } from '@dontstarve-web/signals';
import { LightState, PrefabDisplay, SpriteResources, SpriteState, type ArchiveSpriteCommands, type PrefabDisplayGroup, type ArchiveSpriteSource, type LoadedSpriteSource, type PrefabDisplayOptions, type PrefabStatus, type SpriteSource } from '@dontstarve-web/display';
import { bindPhysics, type PhysicsBinding } from '../../componets/src/physicsBinding';
import { PhysicsState } from '../../componets/src/physicsState';
import type { TileTracker } from '../../componets/src/tileManager';
import type { Brain } from '../../brains/src/brain';
import type { StateGraphInstance } from '../../stategraphs/src/stategraph';
import type { ComponentActionEntity } from '../../stategraphs/src/componentactions';
import type { PlacementSaveRecord, PrefabSaveRecord } from './saveRecord';
import { newItemEntityId } from '../../inventory/src/entityId';
import { actionEntity } from './actionEntity';
import { watchTileActivity } from './tileActivity';
import { WORLD_SCALE } from './tile';
import { refreshMouseTarget } from './mouseTargets';
import { Transform, type ReadonlyVector3 } from './transform';
import type { PrefabWorldContext } from './worldContext';
import { SoundEmitter } from './soundEmitter';

type ActionComponents = ComponentActionEntity['components'];

/** Components owned by a world prefab, beyond the capabilities used to select actions. */
export interface PrefabComponents extends ActionComponents {
  hunger?: import('../../componets/src/hunger').Hunger;
  sanity?: import('../../componets/src/sanity').Sanity;
  inventory?: import('@dontstarve-web/inventory').InventoryStore;
  playercontroller?: import('../../stategraphs/src/playercontroller').PlayerController;
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
  sanityaura?: import('../../componets/src/sanityaura').SanityAura;
}

/**
 * The logical entity behind a placed prefab: identity, save record, skin, persistence, lifecycle `status` and the
 * `sprite` json. Its Transform owns the stable root borrowed by its display. A `PrefabDisplay` subscribes to `status` and
 * `sprite` and draws them: asleep releases the visual and takes the model out of the scene, removed releases the display’s resources.
 * `physics` is declared the same way; a `PhysicsBinding` keeps its body until the entity is removed.
 */
export class PrefabInstance<Sprite extends ArchiveSpriteCommands = SpriteState, Components extends object = PrefabComponents> {
  readonly prefab: string;
  private readonly lifecycle = createSignal<PrefabStatus>('active');
  readonly status: ReadonlySignal<PrefabStatus> = readonlySignal(this.lifecycle);
  /** What the prefab may tell the sprite; an archive entity is narrowed to what an archive can draw. */
  readonly sprite: Sprite;
  readonly transform: Transform;
  entityId?: string;
  saveRecord?: PlacementSaveRecord;
  get skinId(): string | undefined { return this.sprite.sprite.peek().skinId; }
  set skinId(skinId: string | undefined) { this.sprite.setSkinId(skinId); }
  /** inst.persists: false keeps the entity out of the save. */
  private readonly persistsState = createSignal(true);
  readonly persistence = readonlySignal(this.persistsState);
  get persists(): boolean { return this.persistence.peek(); }
  set persists(value: boolean) { this.persistsState.set(value); }
  /** inst.entity:GetParent: the save loop skips a child, whose parent recreates it. */
  entityParent?: PrefabInstance<SpriteState, object>;
  /** inst.Physics: the collider the entity declares. */
  readonly physics = new PhysicsState();
  /** EntityScript components belong to the logical entity, including while its display sleeps. */
  readonly components: Components = {} as Components;
  /** World services injected when this prefab joins a world; callbacks use the same host and components. */
  worldServices?: Partial<PrefabWorldContext>;
  /** inst.OnSave(inst, data): the prefab writes its own state into the record's components. */
  OnSave?(inst: PrefabInstance, data: PlacementSaveRecord['components']): void;
  /** inst.OnLoad(inst, data): the prefab restores its own state from the record's components. */
  OnLoad?(inst: PrefabInstance, data: PlacementSaveRecord['components']): void;
  /** EntityScript:GetPersistData: each component's OnSave under its name, then inst.OnSave. */
  GetPersistData(): PlacementSaveRecord['components'] {
    const data: Record<string, unknown> = {};
    for (const [name, component] of Object.entries(this.components) as [string, { OnSave?(): unknown } | undefined][]) {
      const saved = component?.OnSave?.();
      if (saved && typeof saved === 'object' && Object.keys(saved).length) data[name] = saved;
    }
    this.OnSave?.(this as unknown as PrefabInstance, data);
    return data;
  }
  /** EntityScript:SetPersistData: each saved component's OnLoad, then inst.OnLoad. */
  SetPersistData(data: PlacementSaveRecord['components']): void {
    const components = this.components as Record<string, { OnLoad?(saved: unknown): void } | undefined>;
    for (const [name, saved] of Object.entries(data)) components[name]?.OnLoad?.(saved);
    this.OnLoad?.(this as unknown as PrefabInstance, data);
  }
  private readonly removedState = createSignal(false);
  readonly removal: ReadonlySignal<boolean> = readonlySignal(this.removedState);
  /** inst.Light: the light the entity declares; its display lists it while the entity is active. */
  readonly light = new LightState();
  /** inst.SoundEmitter, once AddSoundEmitter made it. */
  SoundEmitter?: SoundEmitter;
  /** inst.entity:AddSoundEmitter(): sounds keep following the transform while the display sleeps. */
  AddSoundEmitter(): SoundEmitter {
    if (this.SoundEmitter) return this.SoundEmitter;
    const emitter = this.SoundEmitter = new SoundEmitter(this.position);
    this.onRemove(() => emitter.OnRemoveEntity());
    return emitter;
  }
  /** inst.MiniMapEntity: map settings stay declared while the world sprite sleeps. */
  readonly minimap = new MiniMapState();
  /** The entity owns its movement notifications; map consumers receive this tracker with its icon declaration. */
  get tileTracker(): TileTracker { return this.transform.tileTracker; }
  /** inst.physicsradiusoverride, in DST units. */
  physicsRadiusOverride?: number;
  /** Deployable smart spacing, in world units. */
  deploySmartRadius?: number;
  /** inst._groundhole_*: the ring map.lua's IsGroundTargetBlocked refuses, in world units. */
  _groundhole_innerradius?: number;
  _groundhole_outerradius?: number;
  _groundhole_rangeoverride?: number;
  /** A tree blocks placement as a logical entity, including while its visual sleeps out of the scene. */
  logicalPlacement?: boolean;
  private physicsBinding?: PhysicsBinding;
  /** inst.sg: SetStateGraph's instance, as other code reads and drives it; cleared by ClearStateGraph. */
  sg?: Pick<StateGraphInstance<unknown, string>, 'stateName' | 'hasStateTag' | 'goToState' | 'pushEvent' | 'listenForEvent'>;
  /** inst.brain: SetBrain's brain, cleared by StopBrain. */
  brain?: Brain;
  private readonly tags = new Set<string>();
  private tagView?: readonly string[];
  private readonly tagListeners = new Set<(tag: string) => void>();
  private readonly removalHandlers = new Set<() => void>();
  /** inst.event_listeners: entity events belong to the logical entity, not to the model that draws it. */
  private readonly events = new EventEmitter<Record<string, unknown>>();

  /** `sprite` is the entity's sprite state, typed by what its display can draw. */
  constructor(prefab: string, sprite: Sprite, transform = new Transform()) {
    this.prefab = prefab;
    this.sprite = sprite;
    this.transform = transform;
  }

  get position(): ReadonlyVector3 { return this.transform.position; }
  get scale(): Vector3 { return this.transform.scale; }
  get rotation(): number { return this.transform.rotation; }

  /**
   * Transform:SetPosition. Unlike a write through `position`, it marks the transform, which an entity drawn with
   * `staticTransform` requires: its matrices are recomputed only when marked.
   */
  setPosition(x: number, y: number, z: number): void {
    this.transform.setPosition(x, y, z);
  }

  /** Transform:SetPosition(pt:Get()). */
  copyPosition(point: Vector3Like): void { this.transform.copyPosition(point); }

  /** Transform:SetScale, marked as `setPosition()` is. */
  setScale(x: number, y = x, z = x): void {
    this.transform.setScale(x, y, z);
  }

  /** Transform:SetRotation: the heading in degrees, counter-clockwise about +Y, on the entity-owned root. */
  setRotation(degrees: number): void {
    this.transform.setRotation(degrees);
  }

  get isRemoved(): boolean { return this.lifecycle.peek() === 'removed'; }
  getPosition(): Vector3 { return this.transform.model.position; }
  /** inst:PushEvent: listeners run synchronously with `data`, whether or not a display draws the entity. */
  PushEvent(name: string, data?: unknown): void { this.events.emit(name, data); }
  /** inst:ListenForEvent on the entity itself; the returned function removes the listener. */
  ListenForEvent(name: string, listener: (data: unknown) => void): () => void { return this.events.on(name, listener); }
  /** inst:RemoveEventCallback. */
  RemoveEventCallback(name: string, listener: (data: unknown) => void): void { this.events.off(name, listener); }

  /** The body the binding keeps for `physics`, while one exists. */
  get physicsBody(): CANNON.Body | undefined { return this.physicsBinding?.body; }

  /** Hands `physics` to the host world; `ground` is the collider's origin when the model is drawn above it. */
  bindPhysics(world: CANNON.World, ground: () => Vector3Like = () => this.position): void {
    if (this.physicsBinding || this.lifecycle.peek() === 'removed') return;
    this.physicsBinding = bindPhysics(world, this.physics, ground, this.transform);
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
    this.PushEvent('tagchanged', tag);
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
    this.transform.dispose();
  }

  /** Entity-owned components and logical controllers stop when the inst is permanently removed. */
  onRemove(remove: () => void): () => void {
    if (this.lifecycle.peek() === 'removed') { remove(); return () => {}; }
    this.removalHandlers.add(remove);
    return () => { this.removalHandlers.delete(remove); };
  }
}

/** The display's model can be looked up without storing its logical entity in userData. */
type AnyPrefabInstance = PrefabInstance<ArchiveSpriteCommands, object>;
const instancesByModel = new WeakMap<Object3D, AnyPrefabInstance>();

/** Bind the display's model to its logical entity; metadata remains on the instance. */
export function bindInstance(model: Object3D, instance: AnyPrefabInstance): void {
  if (model !== instance.transform.model) throw new Error('Display must use the prefab transform root');
  instancesByModel.set(model, instance);
  instance.onRemove(watchMiniMapEntity(instance));
}

export function prefabInstance<Instance extends AnyPrefabInstance = PrefabInstance<ArchiveSpriteCommands>>(model: Object3D | null | undefined): Instance | undefined {
  return (model ? instancesByModel.get(model) : undefined) as Instance | undefined;
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

/** A new entity and the display that borrows its transform root. */
/**
 * The first clip drawn by a display. `instance` reuses a logical entity, including its identity, components, tags,
 * events and sprite declarations; creating another ground display does not create another logical entity.
 */
export type EntityClip<Instance extends PrefabInstance<SpriteState, object> = PrefabInstance> =
  ConstructorParameters<typeof SpriteState>[0] & { readonly instance?: Instance };

function entityInstance<Instance extends PrefabInstance<SpriteState, object>>(prefab: string, clip: EntityClip<Instance>, staticTransform = false): Instance {
  if (clip.instance) {
    if (clip.instance.isRemoved || clip.instance.prefab !== prefab) throw new Error('Cannot display a removed or different prefab instance');
    clip.instance.sprite.resetPresentation(clip);
    return clip.instance;
  }
  return new PrefabInstance(prefab, new SpriteState(clip), staticTransform ? Transform.stationary() : new Transform()) as Instance;
}

export function createPrefabEntity<Instance extends PrefabInstance<SpriteState, object> = PrefabInstance>(prefab: string, source: SpriteSource | LoadedSpriteSource, clip: EntityClip<Instance>, name?: string,
  /** Sets the entity's appearance before the first sprite is drawn, so it is drawn dressed. */
  initialize?: (instance: Instance) => void, parentStatus?: ReadonlySignal<PrefabStatus>, displayOptions?: Pick<PrefabDisplayOptions, 'alignBottom' | 'dependencies'>):
  { instance: Instance; display: PrefabDisplay } {
  const instance = entityInstance(prefab, clip);
  initialize?.(instance);
  const display = new PrefabDisplay({ root: instance.transform.model, ...displayOptions, name, source, status: instance.status, parentStatus, sprite: instance.sprite, light: instance.light });
  bindInstance(display.model, instance);
  return { instance, display };
}

/** A new entity drawn with a shared archive sprite; `clip.held` is a one-shot clip that rests on its last frame. */
export function createArchiveEntity<Instance extends PrefabInstance<SpriteState, object> = PrefabInstance>(prefab: string, archive: ArchiveSpriteSource, clip: EntityClip<Instance>, name?: string,
  initialize?: (instance: Instance) => void, parentStatus?: ReadonlySignal<PrefabStatus>,
  displayOptions?: { readonly staticTransform?: boolean }):
  { instance: Instance; display: PrefabDisplay } {
  const instance = entityInstance(prefab, clip, displayOptions?.staticTransform), state = instance.sprite;
  initialize?.(instance);
  const display = new PrefabDisplay({ root: instance.transform.model, name, archive, status: instance.status, parentStatus, sprite: state, light: instance.light });
  bindInstance(display.model, instance);
  return { instance, display };
}

/** Transform-only prefab with the same entity-owned root and display lifecycle; a billboard display turns its visual to the camera. */
export function createEmptyEntity<Instance extends PrefabInstance<SpriteState, object> = PrefabInstance>(prefab: string, parentStatus?: ReadonlySignal<PrefabStatus>,
  { billboard = false, instance: original }: { billboard?: boolean; instance?: Instance } = {}):
  { instance: Instance; display: PrefabDisplay } {
  const instance = entityInstance(prefab, { name: '', billboard, instance: original });
  const display = new PrefabDisplay({ root: instance.transform.model, name: prefab, empty: true, status: instance.status, parentStatus, sprite: instance.sprite, light: instance.light });
  bindInstance(display.model, instance);
  return { instance, display };
}

/** Prefab(name, fn, assets): how one source prefab is built and which art its display declares. */
export interface PrefabEntityDefinition<Instance extends PrefabInstance> {
  fn(position: ReadonlyVector3): Instance;
  /** Source skin names and their shared build archives; the display loads the selected one. */
  skins?: Readonly<Record<string, string>>;
  /** A prefab without assets has only a transform and what it declares on it, as FX lights do: nothing to draw or click. */
  assets?: Parameters<SpriteResources['archive']>[0];
  /** In place of `assets`: an instance's own SetBank / SetBuild, which its OnLoad may still change as it spawns. */
  instanceAssets?(instance: Instance): Parameters<SpriteResources['archive']>[0];
  /** How the display builds this art's sprites, such as a plant's instanced batches. */
  assetOptions?: Parameters<SpriteResources['archive']>[1];
  /** Stands the sprite's lowest point on the ground, as this project draws its buildings and their placers. */
  alignBottom?: boolean;
  /** False for what is only ever looked at, such as a transient effect: not a mouse target or an entity that queries find. */
  targetable?: boolean;
  /** Transient effects which must draw even outside the ticking area. */
  alwaysActive?: boolean;
  /** Make*Physics(inst, radius, height) in DST units; the body is bound when the world has physics. */
  physics?: { make(inst: Instance, radius: number, height?: number): unknown; radius: number; height?: number };
  /** MiniMapEntity:SetIcon. */
  minimapIcon?: string;
  /** Runs once the entity has its position and saved state, for what the source starts from there. */
  onSpawned?(instance: Instance): void;
}

/**
 * The application's shared SpawnPrefab owner and save loop over Ents: one collection and shared texture cache
 * and each entity's display, tile activity and save record. What a prefab is stays in its `fn` and its components.
 * The entities stand on the ground: a position's height is dropped.
 */
export class PrefabEntityManager<Id extends string, Instance extends PrefabInstance> {
  private readonly resources: SpriteResources;
  private readonly entities = new Set<Instance>();
  private disposed = false;
  private readonly displays: PrefabDisplayGroup;
  private readonly tickingarea?: TileStateQuery;
  private readonly physicsWorld?: CANNON.World;
  private readonly prefabs: Record<Id, PrefabEntityDefinition<Instance>>;

  /** `displays` is the display-layer owner of the entities' scene membership, injected and disposed by the application. */
  constructor(displays: PrefabDisplayGroup, animationBaseUrl: string | undefined, world: { readonly tickingarea?: TileStateQuery; readonly physics?: CANNON.World },
    prefabs: Readonly<Record<Id, PrefabEntityDefinition<Instance>>> = {} as Record<Id, PrefabEntityDefinition<Instance>>) {
    this.displays = displays;
    this.resources = new SpriteResources(animationBaseUrl);
    this.tickingarea = world.tickingarea;
    this.physicsWorld = world.physics;
    this.prefabs = { ...prefabs };
  }

  /** Register source prefab declarations in this world's one collection and resource cache. */
  register(prefabs: Readonly<Record<Id, PrefabEntityDefinition<Instance>>>): void {
    if (this.disposed) throw new Error('Cannot register prefabs after disposal');
    for (const id of Object.keys(prefabs)) if (Object.hasOwn(this.prefabs, id)) throw new Error(`Duplicate prefab: ${id}`);
    Object.assign(this.prefabs, prefabs);
  }

  has(prefabId: string): boolean { return Object.hasOwn(this.prefabs, prefabId); }

  /** SpawnPrefab, then SpawnSaveRecord's SetPosition and SetPersistData: the entity exists now and its display loads the art. */
  spawn(prefabId: Id, position: ReadonlyVector3, saved?: Pick<PlacementSaveRecord, 'id' | 'components'> & Partial<Pick<PlacementSaveRecord, 'transform'>>, skinId?: string): Instance {
    if (this.disposed) throw new Error(`Cannot spawn ${prefabId}: its manager has been disposed`);
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError(`Invalid ${prefabId} position`);
    if (!this.has(prefabId)) throw new Error(`Unknown prefab: ${prefabId}`);
    const { fn, assets, instanceAssets, assetOptions, alignBottom, targetable = true, physics, minimapIcon, onSpawned, skins, alwaysActive } = this.prefabs[prefabId];
    if (skinId !== undefined && !skins?.[skinId]) throw new Error(`Unsupported ${prefabId} skin: ${skinId}`);
    const instance = fn(position);
    if (skins) instance.sprite.setSkinSource({ art: this.resources.archives, archives: skins });
    physics?.make(instance, physics.radius, physics.height);
    if (minimapIcon) instance.minimap.SetIcon(minimapIcon);
    // A shared archive holds a first one-shot clip while its art loads, so a new entity is drawn from its first frame.
    const display = this.displays.add({ root: instance.transform.model, name: prefabId, alignBottom, status: instance.status, sprite: instance.sprite, light: instance.light,
      // Spawning is synchronous, so instanceAssets runs after the SetPersistData below however early the display starts its sprite.
      ...(instanceAssets ? { archive: { create: clip => Promise.resolve().then(() => this.resources.archive(instanceAssets(instance), assetOptions).create(clip)) } }
        : assets ? { archive: this.resources.archive(assets, assetOptions) } : { empty: true }) });
    bindInstance(display.model, instance);
    instance.setPosition(position.x, 0, position.z);
    if (saved?.transform?.rotationY) instance.setRotation(MathUtils.radToDeg(saved.transform.rotationY));
    if (physics && this.physicsWorld) instance.bindPhysics(this.physicsWorld);
    instance.entityId = saved?.id ?? newItemEntityId();
    if (saved) {
      instance.saveRecord = { ...saved, transform: { position: [position.x, 0, position.z], rotationY: saved.transform?.rotationY ?? 0 } };
      instance.SetPersistData(saved.components);
    }
    if (skinId !== undefined) instance.skinId = skinId;
    onSpawned?.(instance);
    if ((assets || instanceAssets) && targetable) actionEntity(display.model, prefabId);
    this.entities.add(instance);
    const stopActivity = watchTileActivity(display.model, alwaysActive ? undefined : this.tickingarea, active => instance.setActive(active));
    instance.onRemove(() => { stopActivity(); this.entities.delete(instance); });
    return instance;
  }

  /** The awake entities' displays, as the display group lists those in the scene. */
  get renderEntities() { return this.displays.renderEntities; }

  /** The save loop's `persists` and GetParent checks, and GetSaveRecord. */
  exportRecords(): { prefabId: Id; record: PrefabSaveRecord }[] {
    return [...this.entities].filter(entity => entity.persists && !entity.entityParent).map(entity => ({ prefabId: entity.prefab as Id, record: {
      id: String(entity.entityId),
      transform: { position: [entity.position.x, 0, entity.position.z], rotationY: entity.transform.model.rotation.y },
      components: entity.GetPersistData(),
    } }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entity of [...this.entities]) entity.remove();
    // Every entity's display is released above, before the shared resources.
    this.resources.dispose();
  }
}
