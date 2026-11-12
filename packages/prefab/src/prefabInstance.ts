import { MiniMapState } from '../../map/src/minimapState';
import { watchMiniMapEntity } from '../../map/src/minimapEntities';
import type * as CANNON from 'cannon-es';
import { type Object3D, type Vector3, type Vector3Like } from 'three';
import { createSignal, readonlySignal, type GameTimeScheduler, type ReadonlySignal, type TileStateQuery } from '@dontstarve-web/signals';
import { IconSpriteAtlases, LightState, PrefabDisplay, SpriteResources, SpriteState, type ArchiveSpriteCommands, type PrefabDisplayGroup, type ArchiveSpriteSource, type LoadedSpriteSource, type PrefabDisplayOptions, type PrefabStatus, type SpriteSource } from '@dontstarve-web/display';
import { bindPhysics, type PhysicsBinding } from '../../componets/src/physicsBinding';
import { PhysicsState } from '../../componets/src/physicsState';
import type { TileTracker } from '../../componets/src/tileManager';
import type { Brain } from '../../brains/src/brain';
import type { BehaviourContext } from '../../brains/src/behaviourtree';
import type { StateGraphInstance } from '../../stategraphs/src/stategraph';
import type { BufferedAction } from '../../stategraphs/src/bufferedaction';
import type { ComponentActionEntity } from '../../stategraphs/src/componentactions';
import type { PlacementSaveRecord, PrefabSaveRecord } from './saveRecord';
import type { EventData, EventDataArgs } from '../../componets/src/entityEvents';
import { newItemEntityId } from '../../inventory/src/entityId';
import { registerActionEntity } from './actionEntity';
import { watchTileActivity } from './tileActivity';
import { WORLD_SCALE } from './tile';
import { Transform, type ReadonlyVector3 } from './transform';
import { EntityGrid } from './entityGrid';
import type { PrefabWorldContext } from './worldContext';
import { SoundEmitter } from './soundEmitter';
import { InstanceAnimState } from './instanceAnimState';

export type ActionComponents = ComponentActionEntity['components'];
/** An entity the player can act on: what action selection reads of it, whichever prefab it is. */
export type ActionEntity = PrefabInstance<ArchiveSpriteCommands, ActionComponents>;

/** Components owned by a world prefab, beyond the capabilities used to select actions. */
export interface PrefabComponents extends ActionComponents {
  hunger?: import('../../componets/src/hunger').Hunger;
  sanity?: import('../../componets/src/sanity').Sanity;
  /** The player's store, or a creature's or structure's Lua inventory component. */
  inventory?: import('@dontstarve-web/inventory').InventoryStore | import('../../componets/src/inventory').Inventory;
  playercontroller?: import('../../stategraphs/src/playercontroller').PlayerController;
  /** finiteuses.lua: a structure's, or an item's (whose uses are part of its stack record). */
  finiteuses?: import('../../componets/src/finiteuses').FiniteUses | import('../../inventory/src/entity').FiniteUsesComponent;
  knownlocations?: import('../../componets/src/knownlocations').KnownLocations;
  lootdropper?: import('../../componets/src/lootdropper').LootDropper;
  growable?: import('../../componets/src/growable').Growable;
  pickable?: import('./components/pickable').Pickable;
  timer?: import('../../componets/src/timer').Timer;
  shelf?: import('../../componets/src/shelf').Shelf<import('@dontstarve-web/inventory').ItemEntity, PrefabInstance>;
  sleeper?: import('../../componets/src/sleeper').Sleeper;
  phonograph?: import('./phonograph').PhonographController;
  sanityaura?: import('../../componets/src/sanityaura').SanityAura;
  inspectable?: import('../../componets/src/inspectable').Inspectable;
  talker?: import('../../componets/src/talker').Talker;
  playerprox?: import('../../componets/src/playerprox').PlayerProx;
  leader?: import('../../componets/src/statueglommerSignatures').Leader;
  pointofinterest?: import('../../componets/src/statueglommerSignatures').PointOfInterest;
  objectspawner?: import('../../componets/src/objectspawner').ObjectSpawner;
  heavyobstaclephysics?: import('../../componets/src/heavyobstaclephysics').HeavyObstaclePhysics;
  submersible?: import('../../componets/src/submersible').Submersible;
  symbolswapdata?: import('../../componets/src/symbolswapdata').SymbolSwapData;
  lunarhailbuildup?: import('../../componets/src/pandoraschestSignatures').LunarHailBuildup;
  roseinspectable?: import('../../componets/src/pandoraschestSignatures').RoseInspectable;
  floater?: import('../../componets/src/ruinsrelicSignatures').Floater;
  furnituredecor?: import('../../componets/src/ruinsrelicSignatures').FurnitureDecor;
  inventoryitemmoisture?: import('../../componets/src/ruinsrelicSignatures').InventoryItemMoisture;
  /** firefx.lua on a fire fx entity (fire, campfirefire), which its owner's burnable or fueled drives. */
  firefx?: import('../../componets/src/firefx').FireFX;
  /** armor.lua, whose condition staff.lua destroystructure reads from an armor item. */
  armor?: import('../../componets/src/armor').Armor;
  /** stackable.lua on an item inst, of which destroystructure removes one. */
  stackable?: import('../../inventory/src/entity').StackableComponent;
  /** What slipperyfeet's TheSim:FindEntities reads from each surface it finds, such as a frozen pond. */
  slipperyfeettarget?: import('../../componets/src/slipperyfeettarget').SlipperyFeetTarget;
}

/**
 * inst.sg as other code reads and drives it, and the lifecycle EntityScript runs on it: stopped in limbo (pause),
 * started again on ReturnToScene (resume), and released with the entity (dispose).
 */
type EntityStateGraph = Pick<StateGraphInstance<unknown, string>, 'stateName' | 'hasStateTag' | 'pushEvent' | 'listenForEvent' | 'isListeningForEvent'>
  & Partial<Pick<StateGraphInstance<unknown, string>, 'pause' | 'resume' | 'dispose' | 'startAction'>> & {
    /** inst.sg:GoToState(name, data) from outside the graph, which does not know the graph's declared state data. */
    goToState(name: string, data?: unknown): void;
  };

/** What EntityScript's distance methods read from the other inst: whether it is valid, and where it is. */
type PositionedEntity = { readonly prefab?: string; isValid(): boolean; getPosition(): Vector3Like };

/** A buffered action's target has a Transform when it is an entity with a position, as PerformBufferedAction checks. */
function hasTransform(target: object): target is PositionedEntity {
  return 'isValid' in target && typeof target.isValid === 'function' && 'getPosition' in target && typeof target.getPosition === 'function';
}

/** An entity whose events others listen for. */
type EventEntity = PrefabInstance<ArchiveSpriteCommands, object>;
/**
 * EntityScript:ListenForEvent's fn(inst, data): `inst` is the entity that pushed the event. Method-typed, as Lua does not
 * check it, so a listener written for a narrower inst can be registered.
 */
export type EntityEventListener<Inst = EventEntity, Data = unknown> = { call(inst: Inst, data: Data): void }['call'];
type StoredListener = EntityEventListener;
/** event_listeners / event_listening: per event, per entity on the other side, its fns in registration order. */
type ListenerTable = Map<string, Map<EventEntity, StoredListener[]>>;

function addListener(table: ListenerTable, event: string, entity: EventEntity, fn: StoredListener): void {
  let listeners = table.get(event);
  if (!listeners) table.set(event, listeners = new Map());
  let fns = listeners.get(entity);
  if (!fns) listeners.set(entity, fns = []);
  fns.push(fn);
}

function removeListener(table: ListenerTable | undefined, event: string, entity: EventEntity, fn: StoredListener): void {
  const listeners = table?.get(event);
  if (!listeners) return;
  const fns = listeners.get(entity);
  if (fns) {
    // RemoveByValue: one registration of fn.
    const index = fns.indexOf(fn);
    if (index >= 0) fns.splice(index, 1);
    if (!fns.length) listeners.delete(entity);
  }
  if (!listeners.size) table!.delete(event);
}

/** The game-time scheduler an entity's tasks run on. */
type TaskScheduler = Pick<GameTimeScheduler, 'now' | 'schedule'>;

/**
 * scheduler.lua's Periodic as DoTaskInTime / DoPeriodicTask / PushEventInTime return it: `Cancel()` and `NextTime()`.
 * It runs on its entity's scheduler and moves with it when the entity joins another world's (BindScheduler).
 */
export class EntityTask {
  /** Periodic.period: the repeat interval of a DoPeriodicTask, undefined for a one-shot task. */
  readonly period: number | undefined;
  private readonly fn: () => void;
  private readonly finish: (task: EntityTask) => void;
  private scheduler: TaskScheduler;
  private cancelScheduled?: () => void;
  private nextTime?: number;

  /** @internal Made by the entity's DoTaskInTime / DoPeriodicTask. */
  constructor(scheduler: TaskScheduler, delay: number, period: number | undefined, fn: () => void, finish: (task: EntityTask) => void) {
    this.scheduler = scheduler; this.period = period; this.fn = fn; this.finish = finish;
    this.arm(delay);
  }

  /** Periodic:NextTime: the game time it next runs, undefined once it has finished or been cancelled. */
  NextTime(): number | undefined { return this.nextTime; }

  /** Periodic:Cancel. */
  Cancel(): void {
    if (this.nextTime === undefined) return;
    this.cancelScheduled?.();
    this.cancelScheduled = this.nextTime = undefined;
    this.finish(this);
  }

  /** @internal The entity's tasks keep their remaining time on the scheduler it joins. */
  rebind(scheduler: TaskScheduler): void {
    if (scheduler === this.scheduler || this.nextTime === undefined) { this.scheduler = scheduler; return; }
    const remaining = Math.max(0, this.nextTime - this.scheduler.now);
    this.cancelScheduled?.();
    this.scheduler = scheduler;
    this.arm(remaining);
  }

  private arm(delay: number): void {
    this.nextTime = this.scheduler.now + delay;
    // conventions-allow prefab-timer: EntityTask is the scheduler.lua Periodic that DoTaskInTime / DoPeriodicTask hand out.
    this.cancelScheduled = this.scheduler.schedule(delay, () => {
      if (this.period === undefined) { this.cancelScheduled = this.nextTime = undefined; this.finish(this); }
      else this.arm(this.period);
      this.fn();
    });
  }
}

/** util.lua GetTaskRemaining(task): the game seconds until it runs, or -1 without a pending task. */
export function GetTaskRemaining(task: EntityTask | undefined, now: number): number {
  const next = task?.NextTime();
  return next === undefined || next < now ? -1 : next - now;
}

/** A component as EntityScript's persist loops see it: OnSave and OnLoad looked up by the component's name. */
interface PersistentComponent { OnSave?(): unknown; OnLoad?(saved: unknown): void }
function persistentComponent(component: unknown): PersistentComponent | undefined {
  return component !== null && typeof component === 'object' ? component : undefined;
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
  private engineParent?: EventEntity;
  /** The entities parented to this one with entity:SetParent, which retire with it. */
  private engineChildren?: Set<EventEntity>;
  /**
   * inst.entity:GetParent / SetParent: the save loop skips a child, whose parent recreates it, and the child retires with
   * its parent. The engine's own removal is not in the scripts; that it removes parented entities is read from them:
   * vault_pillar's CreateBottom, pond's plants and lava_pond's rocks are parented and never removed by script.
   */
  get entityParent(): EventEntity | undefined { return this.engineParent; }
  set entityParent(parent: EventEntity | undefined) {
    this.engineParent?.engineChildren?.delete(this);
    this.engineParent = parent;
    if (parent) (parent.engineChildren ??= new Set()).add(this);
  }
  /** inst.parent: the entity whose AddChild made this one its child; its Remove removes this one. */
  parent?: EventEntity;
  /** inst.children: AddChild's children. */
  private children?: Set<EventEntity>;
  /** inst.Physics: the collider the entity declares. */
  readonly physics = new PhysicsState();
  /** EntityScript components belong to the logical entity, including while its display sleeps. */
  readonly components: Components = {} as Components;
  /** World services injected when this prefab joins a world; callbacks use the same host and components. */
  worldServices?: Partial<PrefabWorldContext>;
  /** inst.OnSave(inst, data): the prefab writes its own state into the record's components. */
  OnSave?(inst: this, data: PlacementSaveRecord['components']): void;
  /** inst.OnLoad(inst, data): the prefab restores its own state from the record's components. */
  OnLoad?(inst: this, data: PlacementSaveRecord['components']): void;
  /** EntityScript:GetPersistData: each component's OnSave under its name, then inst.OnSave. */
  GetPersistData(): PlacementSaveRecord['components'] {
    const data: Record<string, unknown> = {};
    for (const [name, component] of Object.entries(this.components)) {
      const saved = persistentComponent(component)?.OnSave?.();
      if (saved && typeof saved === 'object' && Object.keys(saved).length) data[name] = saved;
    }
    this.OnSave?.(this, data);
    return data;
  }
  /** EntityScript:SetPersistData: each saved component's OnLoad, then inst.OnLoad. */
  SetPersistData(data: PlacementSaveRecord['components']): void {
    for (const [name, saved] of Object.entries(data)) persistentComponent(Reflect.get(this.components, name))?.OnLoad?.(saved);
    this.OnLoad?.(this, data);
  }
  private readonly removedState = createSignal(false);
  readonly removal: ReadonlySignal<boolean> = readonlySignal(this.removedState);
  /** inst.Light: the light the entity declares; its display lists it while the entity is active. */
  readonly light = new LightState();
  /** inst.SoundEmitter, once AddSoundEmitter made it. */
  SoundEmitter?: SoundEmitter;
  /**
   * inst.entity:AddSoundEmitter(): sounds keep following the transform while the display sleeps. The player passes
   * `atListener`: the listener is at the player in the source, while here it is published once per 60 frames.
   */
  AddSoundEmitter({ atListener = false }: { atListener?: boolean } = {}): SoundEmitter {
    if (this.SoundEmitter) return this.SoundEmitter;
    const emitter = this.SoundEmitter = new SoundEmitter(atListener ? undefined : this.position);
    this.onRemove(() => emitter.OnRemoveEntity());
    return emitter;
  }
  /** EntityScript:Hide(): entity:Hide() stops drawing the entity until Show(). */
  Hide(): void { this.sprite.setVisible(false); }
  /** EntityScript:Show() */
  Show(): void { this.sprite.setVisible(true); }
  /** inst.entity:IsVisible(): false while inst:Hide() holds. */
  IsVisible(): boolean { return this.sprite.sprite.peek().visible !== false; }
  /** inst.MiniMapEntity: map settings stay declared while the world sprite sleeps. */
  readonly minimap = new MiniMapState();
  /** The entity owns its movement notifications; map consumers receive this tracker with its icon declaration. */
  get tileTracker(): TileTracker { return this.transform.tileTracker; }
  /** inst.physicsradiusoverride, in DST units. */
  physicsRadiusOverride?: number;
  /** Deployable smart spacing, in world units. */
  deploySmartRadius?: number;
  /** inst.ground_target_blocker_radius (EntityScript:SetGroundTargetBlockerRadius), in world units. */
  ground_target_blocker_radius?: number;
  /** inst._groundhole_*: the ring map.lua's IsGroundTargetBlocked refuses, in world units. */
  _groundhole_innerradius?: number;
  _groundhole_outerradius?: number;
  _groundhole_rangeoverride?: number;
  /** A tree blocks placement as a logical entity, including while its visual sleeps out of the scene. */
  logicalPlacement?: boolean;
  private physicsBinding?: PhysicsBinding;
  /** inst.sg: SetStateGraph's instance, as other code reads and drives it; cleared by ClearStateGraph. */
  sg?: EntityStateGraph;

  /**
   * EntityScript:SetStateGraph: the previous stategraph stops and `create` makes the new one for the inst. The new
   * graph enters its first state itself, as each SG module's constructor does in place of Lua's `defaultstate`; in
   * limbo it starts stopped.
   */
  SetStateGraph<SG extends EntityStateGraph>(create: (inst: this) => SG): SG {
    this.ClearStateGraph();
    const sg = create(this);
    this.sg = sg;
    if (this.inlimbo) sg.pause?.();
    return sg;
  }

  /** EntityScript:ClearStateGraph: the stategraph stops and leaves the inst. */
  ClearStateGraph(): void {
    const sg = this.sg;
    this.sg = undefined;
    sg?.dispose?.();
  }
  /** inst.bufferedaction: the action PushBufferedAction handed to the stategraph, until it is done or fails. */
  bufferedaction?: BufferedAction;

  /**
   * EntityScript:PushBufferedAction: the same action again is ignored unless the stategraph is idle, any other one fails,
   * and the new one starts in the stategraph. WALKTO and instant actions are not pushed by a ported caller yet.
   */
  PushBufferedAction(bufferedaction: BufferedAction): void {
    const current = this.bufferedaction;
    if (current && bufferedaction.target === current.target && bufferedaction.action === current.action
      && bufferedaction.invobject === current.invobject && !this.sg?.hasStateTag('idle')) return;
    this.ClearBufferedAction();
    // bufferedaction:TestForStart
    if (!bufferedaction.isValid()) {
      this.PushEvent('actionfailed', { action: bufferedaction });
      return;
    }
    this.bufferedaction = bufferedaction;
    if (!this.sg) this.PushEvent('startaction', { action: bufferedaction });
    // A stategraph without StartAction (the player's controller takes its actions itself) takes none.
    else if (!this.sg.startAction?.(bufferedaction)) {
      this.PushEvent('performaction', { action: bufferedaction });
      this.ClearBufferedAction();
    }
  }

  /** EntityScript:PerformBufferedAction: face the target, do the action, and fail it if it does not succeed. */
  PerformBufferedAction(): true | undefined {
    const bufferedaction = this.bufferedaction;
    if (!bufferedaction) return undefined;
    const { target } = bufferedaction;
    if (target && hasTransform(target) && target.isValid()) this.FacePoint(target.getPosition());
    this.PushEvent('performaction', { action: bufferedaction });
    // Cached, as the source does: inst.bufferedaction may change during Do().
    if (bufferedaction.do()) {
      if (this.bufferedaction === bufferedaction) this.bufferedaction = undefined;
      return true;
    }
    this.PushEvent('actionfailed', { action: bufferedaction });
    bufferedaction.fail();
    if (this.bufferedaction === bufferedaction) this.bufferedaction = undefined;
    return undefined;
  }

  /** EntityScript:ClearBufferedAction: the pending action fails. */
  ClearBufferedAction(): void {
    const bufferedaction = this.bufferedaction;
    if (!bufferedaction) return;
    bufferedaction.fail();
    this.bufferedaction = undefined;
  }

  /** inst.brain: the brain SetBrain made, absent while the entity sleeps or is in limbo. */
  brain?: Brain<BehaviourContext>;
  /** inst.brainfn: SetBrain's constructor, which makes a new brain each time the entity wakes. */
  private brainfn?: () => Brain<BehaviourContext>;
  /** inst._braindisabled: the entity has a brainfn but no brain while it sleeps or is in limbo. */
  private braindisabled = false;
  /** inst._brainstopped: the reasons StopBrain holds the brain stopped for. */
  private brainstopped?: Set<string>;

  /**
   * EntityScript:SetBrain(brainfn): the brain is made now unless the entity sleeps or is in limbo, and started unless
   * StopBrain holds it. `brainfn` constructs the brain for the inst, as Lua's brainfn() followed by brain.inst = inst.
   */
  SetBrain(brainfn: ((inst: this) => Brain<BehaviourContext>) | undefined): void {
    const make = brainfn && (() => brainfn(this));
    this.brainfn = make;
    this.braindisabled = !!make && (this.inlimbo || this.IsAsleep());
    this.brain?.Stop();
    this.brain = make && !this.braindisabled ? make() : undefined;
    if (this.brain && !this.brainstopped) this.brain.Start();
  }

  /** EntityScript:StopBrain(reason): the brain stops until every reason given here has been restarted. */
  StopBrain(reason = ''): void {
    if (this.brainstopped) { this.brainstopped.add(reason); return; }
    this.brainstopped = new Set([reason]);
    this.brain?.Stop();
  }

  /** EntityScript:RestartBrain(reason): drops `reason`; the brain starts again once no reason holds it. */
  RestartBrain(reason = ''): void {
    if (!this.brainstopped?.delete(reason) || this.brainstopped.size) return;
    this.brainstopped = undefined;
    this.brain?.Start();
  }

  /** EntityScript:_DisableBrain_Internal, as OnEntitySleep and RemoveFromScene call it: the brain is dropped. */
  private disableBrain(): void {
    if (!this.brainfn) return;
    this.braindisabled = true;
    this.brain?.Stop();
    this.brain = undefined;
  }

  /** EntityScript:_EnableBrain_Internal, as OnEntityWake and ReturnToScene call it: a new brain from brainfn. */
  private enableBrain(): void {
    if (!this.braindisabled || !this.brainfn) return;
    this.braindisabled = false;
    this.brain = this.brainfn();
    if (!this.brainstopped) this.brain.Start();
  }
  private readonly tags = new Set<string>();
  private tagView?: readonly string[];
  private readonly tagListeners = new Set<(tag: string) => void>();
  private readonly removalHandlers = new Set<() => void>();
  /** inst.event_listeners: who listens for this entity's events. Events belong to the logical entity, not to its model. */
  private event_listeners?: ListenerTable;
  /** inst.event_listening: the entities whose events this one listens for, so Remove can drop both sides. */
  private event_listening?: ListenerTable;
  /** inst.pendingtasks: DoTaskInTime / DoPeriodicTask tasks Remove cancels. */
  private pendingtasks?: Set<EntityTask>;
  /** Set as Remove starts; the entity stays valid until it retires at the end, as in EntityScript:Remove. */
  private removing = false;

  private animState?: InstanceAnimState;
  /** inst.AnimState: playback on `sprite`, and the symbol overrides and layers the entity declares with `sprite.setAnimState`. */
  get AnimState(): InstanceAnimState { return this.animState ??= new InstanceAnimState(this.sprite); }

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

  /** EntityScript:IsValid: the entity has not been removed. */
  isValid(): boolean { return !this.isRemoved; }
  get isRemoved(): boolean { return this.lifecycle.peek() === 'removed'; }
  getPosition(): Vector3 { return this.transform.model.position; }

  /** EntityScript:GetDistanceSqToInst: both entities must be valid, as the source asserts. */
  GetDistanceSqToInst(inst: PositionedEntity): number {
    if (!this.isValid() || !inst.isValid()) throw new Error(`GetDistanceSqToInst between ${this.prefab} and ${inst.prefab} needs two valid entities`);
    return this.GetDistanceSqToPoint(inst.getPosition());
  }
  /** EntityScript:GetDistanceSqToPoint. */
  GetDistanceSqToPoint(point: Vector3Like): number { return this.getPosition().distanceToSquared(point); }
  /** EntityScript:IsNear: closer than `dist`. */
  IsNear(otherinst: PositionedEntity | undefined, dist: number): boolean {
    return otherinst !== undefined && this.GetDistanceSqToInst(otherinst) < dist * dist;
  }
  /** EntityScript:GetAngleToPoint in degrees; at the entity's own position it is the current rotation. */
  GetAngleToPoint(x: number, y: number, z: number): number;
  GetAngleToPoint(point: Vector3Like): number;
  GetAngleToPoint(x: number | Vector3Like, _y?: number, z?: number): number {
    const target = typeof x === 'number' ? { x, z: z! } : x;
    const { x: x1, z: z1 } = this.position;
    return x1 === target.x && z1 === target.z ? this.rotation : Math.atan2(z1 - target.z, target.x - x1) * 180 / Math.PI;
  }
  /** EntityScript:ForceFacePoint. */
  ForceFacePoint(x: number, y: number, z: number): void;
  ForceFacePoint(point: Vector3Like): void;
  ForceFacePoint(x: number | Vector3Like, y?: number, z?: number): void {
    this.setRotation(typeof x === 'number' ? this.GetAngleToPoint(x, y!, z!) : this.GetAngleToPoint(x));
  }
  /** EntityScript:FacePoint: as ForceFacePoint, except while the stategraph is busy. */
  FacePoint(x: number, y: number, z: number): void;
  FacePoint(point: Vector3Like): void;
  FacePoint(x: number | Vector3Like, y?: number, z?: number): void {
    if (this.sg?.hasStateTag('busy')) return;
    if (typeof x === 'number') this.ForceFacePoint(x, y!, z!); else this.ForceFacePoint(x);
  }
  /**
   * EntityScript:PushEvent: every fn listening for it, called fn(inst, data) from a copy of the list, then the stategraph
   * when it listens for the event, then the brain. Listeners run whether or not a display draws the entity.
   */
  PushEvent<E extends string>(event: E, ...[data]: EventDataArgs<E>): void {
    const listeners = this.event_listeners?.get(event);
    if (listeners) for (const fn of [...listeners.values()].flat()) fn(this, data);
    // conventions-allow sg-forward: EntityScript:PushEvent's own forward to inst.sg.
    if (this.sg?.isListeningForEvent(event)) this.sg.pushEvent(event, data);
    this.brain?.PushEvent(event, data);
  }

  /**
   * EntityScript:ListenForEvent(event, fn, source): fn(source, data) whenever `source` (this entity by default) pushes the
   * event. Both entities record it, so removing either drops it. The returned function is RemoveEventCallback for it.
   */
  ListenForEvent<E extends string>(event: E, fn: EntityEventListener<this, EventData<E>>): () => void;
  ListenForEvent<E extends string, Source extends EventEntity>(event: E, fn: EntityEventListener<Source, EventData<E>>, source: Source): () => void;
  ListenForEvent(event: string, fn: EntityEventListener<never>, source: EventEntity = this): () => void {
    addListener(source.event_listeners ??= new Map(), event, this, fn);
    addListener(this.event_listening ??= new Map(), event, source, fn);
    return () => this.RemoveEventCallback(event, fn, source);
  }

  /** EntityScript:RemoveEventCallback(event, fn, source). */
  RemoveEventCallback(event: string, fn: EntityEventListener<never>, source: EventEntity = this): void {
    removeListener(source.event_listeners, event, this, fn);
    removeListener(this.event_listening, event, source, fn);
  }

  /** EntityScript:RemoveAllEventCallbacks: what this entity listens for elsewhere, and what listens for it. */
  RemoveAllEventCallbacks(): void {
    for (const [event, sources] of this.event_listening ?? []) {
      for (const source of sources.keys()) source.event_listeners?.get(event)?.delete(this);
    }
    this.event_listening = undefined;
    for (const [event, listeners] of this.event_listeners ?? []) {
      for (const listener of listeners.keys()) listener.event_listening?.get(event)?.delete(this);
    }
    this.event_listeners = undefined;
  }

  /** EntityScript:DoTaskInTime(time, fn): fn(inst) after `time` game seconds on the world's scheduler; Remove cancels it. */
  DoTaskInTime(time: number, fn: (inst: this) => void): EntityTask {
    return this.addTask(time, undefined, fn);
  }

  /** EntityScript:DoPeriodicTask(time, fn, initialdelay): fn(inst) every `time` game seconds, first after `initialdelay`. */
  DoPeriodicTask(time: number, fn: (inst: this) => void, initialdelay = time): EntityTask {
    return this.addTask(initialdelay, time, fn);
  }

  /** EntityScript:PushEventInTime(time, eventname, data): inst:PushEvent(eventname, data) after `time`; Remove cancels it. */
  PushEventInTime(time: number, eventname: string, data?: unknown): EntityTask {
    return this.addTask(time, undefined, inst => inst.PushEvent(eventname, data));
  }

  /** EntityScript:CancelAllPendingTasks. */
  CancelAllPendingTasks(): void {
    const tasks = this.pendingtasks;
    this.pendingtasks = undefined;
    for (const task of tasks ?? []) task.Cancel();
  }

  /** GetTime() on the scheduler this entity's tasks run on. */
  GetTime(): number { return this.taskScheduler().now; }

  /** inst.spawntime: CreateEntity's GetTime(), taken when the entity first joins a world's scheduler. */
  private spawntime?: number;
  /** EntityScript:GetTimeAlive. */
  GetTimeAlive(): number {
    if (this.spawntime === undefined) throw new Error(`${this.prefab} has no world scheduler for its spawn time`);
    return this.GetTime() - this.spawntime;
  }

  /**
   * The entity joins a world's game-time scheduler, as an item does when its registry binds it: its pending tasks
   * keep their remaining time there.
   */
  BindScheduler(scheduler: GameTimeScheduler): void {
    const previous = this.worldServices?.scheduler;
    // The entity keeps its age on the scheduler it joins.
    this.spawntime = this.spawntime === undefined ? scheduler.now : this.spawntime + scheduler.now - (previous?.now ?? scheduler.now);
    if (previous === scheduler) return;
    this.worldServices = { ...this.worldServices, scheduler };
    for (const task of this.pendingtasks ?? []) task.rebind(scheduler);
  }

  private sim?: EntityQuery;
  /**
   * TheSim's entity queries for the world this entity is in, bound by the PrefabEntityManager that spawns or tracks it.
   * An entity outside any world has no TheSim to ask.
   */
  get TheSim(): EntityQuery {
    if (!this.sim) throw new Error(`${this.prefab} is not in a world: it has no TheSim to query`);
    return this.sim;
  }
  BindSim(sim: EntityQuery): void { this.sim = sim; }

  private taskScheduler(): TaskScheduler {
    const scheduler = this.worldServices?.scheduler;
    if (!scheduler) throw new Error(`${this.prefab} has no world scheduler for its tasks`);
    return scheduler;
  }

  private addTask(delay: number, period: number | undefined, fn: (inst: this) => void): EntityTask {
    const tasks = this.pendingtasks ??= new Set();
    // task_finish: a finished or cancelled task leaves inst.pendingtasks.
    const task = new EntityTask(this.taskScheduler(), delay, period, () => fn(this), done => this.pendingtasks?.delete(done));
    tasks.add(task);
    return task;
  }

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
  /** EntityScript:AddOrRemoveTag. */
  AddOrRemoveTag(tag: string, condition: boolean): void { if (condition) this.addTag(tag); else this.removeTag(tag); }
  /** EntityScript:HasTags (HasAllTags): every one of the tags. */
  HasTags(tags: readonly string[]): boolean { return tags.every(tag => this.hasTag(tag)); }
  /** EntityScript:HasOneOfTags (HasAnyTag): at least one of the tags. */
  HasOneOfTags(tags: readonly string[]): boolean { return tags.some(tag => this.hasTag(tag)); }
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

  /** Whether the entity's tile is in the ticking area; the entity is awake while it is and the entity is not in limbo. */
  private tileAwake = true;
  /** inst.inlimbo: set by RemoveFromScene, cleared by ReturnToScene. */
  get inlimbo(): boolean { return this.hasTag('INLIMBO'); }

  /** EntityScript:IsAsleep: the entity's tile is outside the ticking area or it is in limbo. */
  IsAsleep(): boolean { return this.lifecycle.peek() === 'asleep'; }

  /** OnEntitySleep / OnEntityWake: follows the entity's tile; a removed entity stays removed. */
  setActive(active: boolean): void {
    this.tileAwake = active;
    this.syncAwake();
  }

  /** EntityScript:RemoveFromScene: INLIMBO, hidden with its art and minimap icon, then `enterlimbo`. */
  RemoveFromScene(): void {
    if (this.isRemoved || this.tags.has('INLIMBO')) return;
    this.addTag('INLIMBO');
    this.minimap.SetEnabled(false);
    this.syncAwake();
    // sg:Stop(): stategraph time stands still in limbo.
    this.sg?.pause?.();
    this.PushEvent('enterlimbo');
  }

  /** EntityScript:ReturnToScene: shown again where its tile lets it wake, then `exitlimbo`. */
  ReturnToScene(): void {
    if (this.isRemoved || !this.tags.has('INLIMBO')) return;
    this.removeTag('INLIMBO');
    this.minimap.SetEnabled(true);
    this.syncAwake();
    // sg:Start()
    this.sg?.resume?.();
    this.PushEvent('exitlimbo');
  }

  private syncAwake(): void {
    if (this.lifecycle.peek() === 'removed') return;
    const awake = this.tileAwake && !this.tags.has('INLIMBO');
    this.sprite.setAwake(awake);
    this.lifecycle.set(awake ? 'active' : 'asleep');
    // After the entity's own sleep and wake handlers, as OnEntitySleep / OnEntityWake order them.
    if (awake) this.enableBrain(); else this.disableBrain();
  }

  /** inst.OnRemoveEntity(inst): the prefab's own teardown, after its components' and its children's. */
  OnRemoveEntity?(inst: this): void;

  /** EntityScript:AddChild: `child` leaves its old parent, is parented here and is removed with this entity. */
  AddChild(child: EventEntity): void {
    child.parent?.RemoveChild(child);
    child.parent = this;
    (this.children ??= new Set()).add(child);
    child.entityParent = this;
  }

  /** EntityScript:RemoveChild. */
  RemoveChild(child: EventEntity): void {
    child.parent = undefined;
    this.children?.delete(child);
    child.entityParent = undefined;
  }

  /**
   * EntityScript:Remove, in its order: it leaves its parent, pushes `onremove`, then both sides of its event callbacks and
   * its pending tasks go, then its components' OnRemoveEntity, its children, inst.OnRemoveEntity, and it stops persisting.
   * It is valid until it retires last, taking the entities parented to it with entity:SetParent.
   */
  remove(): void {
    if (this.removing || this.lifecycle.peek() === 'removed') return;
    this.removing = true;
    this.parent?.RemoveChild(this);
    this.PushEvent('onremove');
    this.RemoveAllEventCallbacks();
    this.CancelAllPendingTasks();
    // The engine's MiniMapEntity goes with the entity; what lists it unsubscribes among the removal handlers below.
    this.minimap.SetEnabled(false);
    // addComponent registers each component's OnRemoveEntity here, beside the prefab's other teardown, in order.
    for (const remove of this.removalHandlers) remove();
    this.removalHandlers.clear();
    const children = this.children;
    this.children = undefined;
    for (const child of children ?? []) {
      child.parent = undefined;
      child.remove();
    }
    this.OnRemoveEntity?.(this);
    this.persists = false;
    // entity:Retire
    this.engineParent?.engineChildren?.delete(this);
    const engineChildren = this.engineChildren;
    this.engineChildren = undefined;
    for (const child of engineChildren ?? []) child.remove();
    // SGManager:OnRemoveEntity: the stategraph no longer runs; inst.sg stays readable, as in the source.
    this.sg?.dispose?.();
    this.removedState.set(true);
    this.lifecycle.set('removed');
    this.physicsBinding?.dispose();
    this.transform.dispose();
  }

  /** Entity-owned components and logical controllers stop when the inst is permanently removed. */
  onRemove(remove: () => void): () => void {
    if (this.removing || this.lifecycle.peek() === 'removed') { remove(); return () => {}; }
    this.removalHandlers.add(remove);
    return () => { this.removalHandlers.delete(remove); };
  }
}

/** The display's model can be looked up without storing its logical entity in userData. */
type AnyPrefabInstance = PrefabInstance<ArchiveSpriteCommands, object>;
// conventions-allow model-keyed-state: the one model → instance lookup prefabInstance(model) is, instead of userData.
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

/** TheSim:FindEntities, as the world's PrefabEntityManager answers it. */
export interface EntityQuery {
  FindEntities(position: ReadonlyVector3, radius: number,
    mustTags?: readonly string[], cantTags?: readonly string[], oneOfTags?: readonly string[]): PrefabInstance[];
}

/**
 * The global POPULATING: true while a saved entity's SetPersistData runs, so the callbacks its components' OnLoad
 * call settle into their pose instead of playing a transition.
 */
export let POPULATING = false;

/** Prefab(name, fn, assets): how one source prefab is built and which art its display declares. */
export interface PrefabEntityDefinition<Instance extends PrefabInstance<SpriteState, object>> {
  /** `sprites` is the world's shared resource cache, for the sources of the fx children the prefab draws; declaring one performs no IO. */
  fn(position: ReadonlyVector3, sprites: SpriteResources): Instance;
  /** Source skin names and their shared build archives; the display loads the selected one. */
  skins?: Readonly<Record<string, string>>;
  /** The symbols a skin build replaces, when it replaces only some of the base build's (OverrideItemSkinSymbol). */
  skinSymbols?: readonly string[];
  /** Symbols the source keeps from the base build under every skin, such as researchlab's FX symbols. */
  baseSymbols?: readonly string[];
  /** Per skin, the animation banks of its archive drawn over the clip's frame, such as researchlab2_pod's pod FX. */
  skinAnimationBanks?: Readonly<Record<string, readonly string[]>>;
  /** How the builds' materials are made (multColour, point filtering), with or without skins. */
  materialOptions?: import('@dontstarve-web/animation/animationAssets').SpriteMaterialOptions;
  /** In place of `assets`: the art is the inventory image, drawn as a billboard. */
  icon?: { readonly atlas: string; readonly image: string };
  /** In place of `assets`: the sprite factory the art is drawn with; the manager releases it after every entity's display. */
  source?: LoadedSpriteSource & { dispose?(): void };
  /**
   * In place of `assets`: a sprite factory over these archives in the world's shared resources, for art whose instance
   * changes its bank with SetBank (`sprite.setArtSource` with the `sprites` that `fn` receives).
   */
  factory?: Parameters<SpriteResources['factory']>[0];
  /** In place of `assets`: build images drawn as static sprites from the world's shared resources, as walls are. */
  staticImages?: { readonly buildArchive: string; readonly options: Parameters<SpriteResources['staticFactory']>[1] };
  /** A prefab without assets has only a transform and what it declares on it, as FX lights do: nothing to draw or click. */
  assets?: Parameters<SpriteResources['archive']>[0];
  /** In place of `assets`: an instance's own SetBank / SetBuild, which its OnLoad may still change as it spawns. */
  instanceAssets?(instance: Instance): Parameters<SpriteResources['archive']>[0];
  /** How the display builds this art's sprites, such as a plant's instanced batches. */
  assetOptions?: Parameters<SpriteResources['archive']>[1];
  /** Stands the sprite's lowest point on the ground, as this project draws its buildings and their placers. */
  alignBottom?: boolean;
  /** AnimState:SetRayTestOnBB: the mouse hits the art's bounding box rather than its opaque pixels. */
  rayTestOnBB?: boolean;
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
export class PrefabEntityManager<Id extends string, Instance extends PrefabInstance<SpriteState, object>> {
  private readonly resources: SpriteResources;
  private readonly entities = new Set<Instance>();
  /** Entities spawned elsewhere which FindEntities still searches, such as the player. */
  private readonly tracked = new Map<Instance, () => void>();
  private readonly byEntityId = new Map<string, Instance>();
  private readonly byPrefab = new Map<string, Set<Instance>>();
  private icons?: IconSpriteAtlases;
  private readonly iconArchiveUrl?: string;
  private disposed = false;
  private readonly displays: PrefabDisplayGroup;
  private readonly tickingarea?: TileStateQuery;
  private readonly physicsWorld?: CANNON.World;
  private readonly scheduler?: GameTimeScheduler;
  private readonly prefabs: Record<Id, PrefabEntityDefinition<Instance>>;

  /** `displays` is the display-layer owner of the entities' scene membership, injected and disposed by the application. */
  constructor(displays: PrefabDisplayGroup, animationBaseUrl: string | undefined,
    world: { readonly tickingarea?: TileStateQuery; readonly physics?: CANNON.World; readonly iconArchiveUrl?: string; readonly scheduler?: GameTimeScheduler },
    prefabs: Readonly<Record<Id, PrefabEntityDefinition<Instance>>> = {} as Record<Id, PrefabEntityDefinition<Instance>>) {
    this.displays = displays;
    this.iconArchiveUrl = world.iconArchiveUrl;
    this.resources = new SpriteResources(animationBaseUrl);
    this.tickingarea = world.tickingarea;
    this.physicsWorld = world.physics;
    this.scheduler = world.scheduler;
    this.prefabs = { ...prefabs };
  }

  /** Register source prefab declarations in this world's one collection and resource cache. */
  register(prefabs: Readonly<Record<Id, PrefabEntityDefinition<Instance>>>): void {
    if (this.disposed) throw new Error('Cannot register prefabs after disposal');
    for (const id of Object.keys(prefabs)) if (Object.hasOwn(this.prefabs, id)) throw new Error(`Duplicate prefab: ${id}`);
    Object.assign(this.prefabs, prefabs);
  }

  has(prefabId: string): boolean { return Object.hasOwn(this.prefabs, prefabId); }

  /** OnLoadPostPass's `newents`: a live entity by its saved entity ID. */
  get(entityId: string): Instance | undefined { return this.byEntityId.get(entityId); }

  /** The live entities of one prefab, as Ents filtered by prefab, without visiting the others. */
  *instances(prefabId: string): IterableIterator<Instance> {
    for (const instance of this.byPrefab.get(prefabId) ?? []) if (!instance.isRemoved) yield instance;
  }

  /** SpawnPrefab, then SpawnSaveRecord's SetPosition and SetPersistData: the entity exists now and its display loads the art. */
  /**
   * SpawnPrefab for a caller that needs the prefab's own instance class, such as a prefab spawning its own children:
   * the entity is checked to be one, and a prefab that spawns another class is an error.
   */
  spawnAs<Spawned extends Instance>(type: abstract new (...args: never[]) => Spawned, prefabId: Id, position: ReadonlyVector3,
    saved?: Pick<PlacementSaveRecord, 'id' | 'components'> & Partial<Pick<PlacementSaveRecord, 'transform'>>, skinId?: string): Spawned {
    const instance = this.spawn(prefabId, position, saved, skinId);
    if (!(instance instanceof type)) throw new TypeError(`${prefabId} does not spawn a ${type.name}`);
    return instance;
  }

  spawn(prefabId: Id, position: ReadonlyVector3, saved?: Pick<PlacementSaveRecord, 'id' | 'components'> & Partial<Pick<PlacementSaveRecord, 'transform'>>, skinId?: string): Instance {
    if (this.disposed) throw new Error(`Cannot spawn ${prefabId}: its manager has been disposed`);
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError(`Invalid ${prefabId} position`);
    if (!this.has(prefabId)) throw new Error(`Unknown prefab: ${prefabId}`);
    const { fn, assets, instanceAssets, assetOptions, alignBottom, rayTestOnBB, targetable = true, physics, minimapIcon, onSpawned, skins, skinSymbols,
      baseSymbols, skinAnimationBanks, alwaysActive, materialOptions, icon, factory, staticImages } = this.prefabs[prefabId];
    const source = this.prefabs[prefabId].source ?? (factory && this.resources.factory(factory))
      ?? (staticImages && this.resources.staticFactory(staticImages.buildArchive, staticImages.options));
    if (skinId !== undefined && !skins?.[skinId]) throw new Error(`Unsupported ${prefabId} skin: ${skinId}`);
    const instance = fn(position, this.resources);
    // The world's scheduler for inst:DoTaskInTime, unless the prefab's fn already bound the one it scheduled on; binding
    // also takes the spawn time of an fn that set its world services directly.
    const scheduler = instance.worldServices?.scheduler ?? this.scheduler;
    if (scheduler) instance.BindScheduler(scheduler);
    instance.BindSim(this);
    if (skins || materialOptions) instance.sprite.setSkinSource({ art: this.resources.archives, archives: skins ?? {}, materialOptions,
      ...skinSymbols ? { symbols: skinSymbols } : {}, ...baseSymbols ? { baseSymbols } : {},
      ...skinAnimationBanks ? { animationBanks: skinAnimationBanks } : {} });
    const iconSource = icon && this.iconSource(prefabId, icon);
    physics?.make(instance, physics.radius, physics.height);
    if (minimapIcon) instance.minimap.SetIcon(minimapIcon);
    // A shared archive holds a first one-shot clip while its art loads, so a new entity is drawn from its first frame.
    const display = this.displays.add({ root: instance.transform.model, name: prefabId, alignBottom, status: instance.status, sprite: instance.sprite, light: instance.light,
      // Spawning is synchronous, so instanceAssets runs after the SetPersistData below however early the display starts its sprite.
      // conventions-allow prefab-io: the manager hands the display a deferred declaration; the display does the loading.
      ...(instanceAssets ? { archive: { create: clip => Promise.resolve().then(() => this.resources.archive(instanceAssets(instance), assetOptions).create(clip)) } }
        : assets ? { archive: this.resources.archive(assets, assetOptions) } : iconSource ? { source: iconSource }
        : source ? { source } : { empty: true }) });
    bindInstance(display.model, instance);
    if (rayTestOnBB) display.model.userData.rayTestOnBB = true;
    instance.setPosition(position.x, 0, position.z);
    if (saved?.transform?.rotationY) instance.transform.setSavedRotation(saved.transform.rotationY);
    if (physics && this.physicsWorld) instance.bindPhysics(this.physicsWorld);
    instance.entityId = saved?.id ?? newItemEntityId();
    if (saved) {
      instance.saveRecord = { ...saved, transform: { position: [position.x, 0, position.z], rotationY: saved.transform?.rotationY ?? 0 } };
      POPULATING = true;
      try { instance.SetPersistData(saved.components); } finally { POPULATING = false; }
    }
    if (skinId !== undefined) instance.skinId = skinId;
    onSpawned?.(instance);
    if ((assets || instanceAssets || icon || source) && targetable) registerActionEntity(instance);
    this.entities.add(instance);
    const entityId = String(instance.entityId);
    this.byEntityId.set(entityId, instance);
    let ofPrefab = this.byPrefab.get(prefabId);
    if (!ofPrefab) this.byPrefab.set(prefabId, ofPrefab = new Set());
    ofPrefab.add(instance);
    const stopActivity = watchTileActivity(display.model, alwaysActive ? undefined : this.tickingarea, active => instance.setActive(active));
    const stopIndex = this.index(instance);
    instance.onRemove(() => {
      stopActivity(); stopIndex(); this.entities.delete(instance); ofPrefab.delete(instance);
      if (this.byEntityId.get(entityId) === instance) this.byEntityId.delete(entityId);
    });
    return instance;
  }

  /** The spatial hash FindEntities reads, kept current by each entity's position writes. */
  private readonly grid = new EntityGrid<Instance>();
  private readonly revision = createSignal(0);
  /** Changes to what FindEntities can return: an entity joining or leaving Ents, or a tag change. Moves are not included. */
  readonly entitiesChanged = readonlySignal(this.revision);
  private readonly changed = () => { this.revision.set(this.revision.peek() + 1); };
  private index(instance: Instance): () => void {
    this.grid.insert(instance);
    const stopMoved = instance.transform.onMoved(() => this.grid.move(instance));
    const stopTags = instance.onTagChanged(this.changed);
    this.changed();
    return () => { stopMoved(); stopTags(); this.grid.remove(instance); this.changed(); };
  }

  /** One shared icon billboard source per prefab, from the inventory atlases this manager owns. */
  private readonly iconSources = new Map<string, ReturnType<IconSpriteAtlases['source']>>();
  private iconSource(prefabId: string, icon: { readonly atlas: string; readonly image: string }) {
    let source = this.iconSources.get(prefabId);
    if (!source) {
      if (!this.iconArchiveUrl) throw new Error(`${prefabId} is drawn as an icon, but no icon archive was given`);
      this.icons ??= new IconSpriteAtlases(this.iconArchiveUrl);
      this.iconSources.set(prefabId, source = this.icons.source(icon.atlas, icon.image, prefabId));
    }
    return source;
  }

  /**
   * Put an entity this manager did not spawn, such as the player, in the Ents that FindEntities searches.
   * It is not saved or looked up by entity ID here: its owner keeps those, and it leaves when it is removed.
   */
  track(instance: Instance): void {
    if (this.disposed) throw new Error(`Cannot track ${instance.prefab}: its manager has been disposed`);
    if (instance.isRemoved || this.entities.has(instance) || this.tracked.has(instance)) return;
    const stopIndex = this.index(instance);
    this.tracked.set(instance, stopIndex);
    instance.BindSim(this);
    instance.onRemove(() => { this.tracked.get(instance)?.(); this.tracked.delete(instance); });
  }

  /**
   * TheSim:FindEntities(x, y, z, radius, musttags, canttags, mustoneoftags): every valid entity, awake or asleep,
   * within `radius`, nearest first. As in the engine nothing else is left out: the querying entity and INLIMBO
   * entities are returned unless the caller excludes them, as the source does with `v ~= inst` and its cant tags.
   */
  FindEntities(position: ReadonlyVector3, radius: number,
    mustTags: readonly string[] = [], cantTags: readonly string[] = [], oneOfTags: readonly string[] = []): Instance[] {
    if (!Number.isFinite(radius) || radius < 0) throw new RangeError('Invalid entity query radius');
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return [];
    const radiusSquared = radius * radius;
    const found: { entity: Instance; distanceSquared: number }[] = [];
    this.grid.visit(position, radius, entity => {
      if (entity.isRemoved) return;
      const distanceSquared = entity.getPosition().distanceToSquared(position);
      if (!(distanceSquared <= radiusSquared)) return;
      if (mustTags.some(tag => !entity.hasTag(tag)) || cantTags.some(tag => entity.hasTag(tag))
        || (oneOfTags.length > 0 && !oneOfTags.some(tag => entity.hasTag(tag)))) return;
      found.push({ entity, distanceSquared });
    });
    return found.sort((a, b) => a.distanceSquared - b.distanceSquared).map(({ entity }) => entity);
  }

  /** The awake entities' displays, as the display group lists those in the scene. */
  get renderEntities() { return this.displays.renderEntities; }

  /**
   * The save loop's `persists` and GetParent checks, and GetSaveRecord. A held inst is its holder's child
   * (OnPutInInventory's AddChild and RemoveFromScene), so its holder saves it.
   */
  exportRecords(): { prefabId: Id; record: PrefabSaveRecord }[] {
    return [...this.entities].filter(entity => entity.persists && !entity.entityParent && !entity.inlimbo).map(entity => ({ prefabId: entity.prefab as Id, record: {
      id: String(entity.entityId),
      transform: { position: [entity.position.x, 0, entity.position.z], rotationY: entity.transform.model.rotation.y },
      components: entity.GetPersistData(),
    } }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entity of [...this.entities]) entity.remove();
    // A tracked entity belongs to its own owner, which removes it; it only leaves this index.
    for (const stopIndex of [...this.tracked.values()]) stopIndex();
    this.tracked.clear();
    this.grid.clear();
    // Every entity's display is released above, before the shared resources.
    this.resources.dispose();
    for (const source of this.iconSources.values()) source.dispose();
    for (const { source } of Object.values(this.prefabs) as PrefabEntityDefinition<Instance>[]) source?.dispose?.();
    this.iconSources.clear();
    this.icons?.dispose();
  }
}
