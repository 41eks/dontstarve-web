import type * as THREE from 'three';
import type { ComponentActionEntity } from '../../stategraphs/src/componentactions';
import { createEffect, createSignal, readonlySignal, watchSignal, type ReadonlySignal, type TileStateQuery } from '@dontstarve-web/signals';
import type { WorkableInst } from '../../componets/src/workable';
import { TileTracker } from '../../componets/src/tileManager';
import { registerPlacementEntity, syncPlacementEntity } from './placementEntities';
import { activePrefabs, type FoundEntity } from './activePrefabs';
import { prefabInstance } from './prefabInstance';
import { registerMouseTarget } from './mouseTargets';

export { activePrefabs, type FoundEntity } from './activePrefabs';

/** Existing world removal writes update the sole lifecycle signal, including inside batches. */
function modelRemoval(model: THREE.Object3D): ReadonlySignal<boolean> {
  const state = createSignal(model.userData.removed === true);
  Object.defineProperty(model.userData, 'removed', {
    enumerable: true, configurable: true,
    get: () => state.peek(), set: (removed: boolean) => state.set(removed === true),
  });
  return readonlySignal(state);
}

/** Project the engine inst onto its existing world model, keeping one tag/component owner. */
export function actionEntity(model: THREE.Object3D, prefab: string, inst?: ComponentActionEntity & WorkableInst): FoundEntity & { getPhysicsRadius(): number } {
  if (model.userData.actionEntity) return model.userData.actionEntity;
  const instance = prefabInstance(model);
  model.userData.components ??= instance?.components ?? {};
  const removal = inst?.removal ?? modelRemoval(model);
  const entity: FoundEntity & { getPhysicsRadius(): number } = {
    model,
    prefab,
    removal,
    get isRemoved() { return removal.peek(); },
    get components() { return inst?.components ?? model.userData.components; },
    getPosition: () => model.userData.getGroundPosition?.() ?? model.position,
    getPhysicsRadius: () => instance?.getPhysicsRadius(0) ?? 0,
    hasTag: tag => {
      if (inst) return inst.hasTag(tag);
      for (const component of Object.values(model.userData.components) as { HasTag?(tag: string): boolean | undefined }[]) {
        const value = component?.HasTag?.(tag);
        if (value !== undefined) return value;
      }
      return instance ? instance.hasTag(tag) : model.userData.tags?.includes(tag) ?? false;
    },
    addTag(tag) {
      const owner = inst ?? instance;
      if (owner) owner.addTag(tag);
      else {
        model.userData.tags ??= [];
        if (!model.userData.tags.includes(tag)) model.userData.tags.push(tag);
      }
      syncPlacementEntity(model);
      mouseRegistrations.get(entity)?.refresh();
    },
    removeTag(tag) {
      const owner = inst ?? instance;
      if (owner) owner.removeTag(tag);
      else model.userData.tags = (model.userData.tags ?? []).filter((value: string) => value !== tag);
      syncPlacementEntity(model);
      mouseRegistrations.get(entity)?.refresh();
    },
    PushEvent: (name, data) => {
      if (inst) inst.PushEvent?.(name, data);
      else if (instance) instance.PushEvent(name, data);
      else model.dispatchEvent({ type: name, data } as never);
    },
  };
  model.userData.actionEntity = entity;
  const mouse = registerMouseTarget(entity);
  mouseRegistrations.set(entity, mouse);
  const mouseCleanups: (() => void)[] = [];
  if (instance) {
    const status = watchSignal(instance.status, stop => mouseCleanups.push(stop));
    createEffect(() => mouse.setAwake(status.get() === 'active'));
  }
  const stopPlacement = registerPlacementEntity(model, entity.getPosition);
  const tagsChanged = () => { syncPlacementEntity(model); mouse.refresh(); };
  const stopTags = inst ? (inst as typeof inst & { ListenForEvent?(name: string, listener: () => void): () => void })
    .ListenForEvent?.('tagchanged', tagsChanged)
    : instance?.onTagChanged(tagsChanged);
  liveEntities.add(entity);
  const stopRemoval = removal.subscribe(removed => { if (removed) disposeActionEntity(model); });
  disposals.set(entity, () => {
    stopRemoval();
    stopTags?.();
    stopPlacement();
    mouseCleanups.splice(0).forEach(stop => stop());
    mouse.dispose(); mouseRegistrations.delete(entity);
    entityWorlds.get(entity)?.remove(entity);
    setPrefabActive(entity, false);
    entity.removeTag('tickingarea');
    liveEntities.delete(entity);
    delete entity.reskinTarget;
    delete entity.hammerTarget;
    delete model.userData.actionEntity;
  });
  if (!entity.isRemoved) {
    if (currentEntityWorld) currentEntityWorld.add(entity);
    else {
      entity.addTag('tickingarea'); // Standalone worlds have no area gate.
      setPrefabActive(entity, true);
    }
  }
  return entity;
}

/**
 * The engine's lifecycle list adopts projected insts when a world binds. Area effects maintain the active
 * prefab list independently of scene attachment. Mouse input has a separate, explicitly maintained registry.
 */
const liveEntities = new Set<FoundEntity>();
const disposals = new Map<FoundEntity, () => void>();
const entityWorlds = new WeakMap<FoundEntity, EntityTickingArea>();
const mouseRegistrations = new WeakMap<FoundEntity, ReturnType<typeof registerMouseTarget>>();
let currentEntityWorld: EntityTickingArea | undefined;

/** Resolve an already registered action entity for the picked model without creating a projection. */
export function findActionEntity(model: THREE.Object3D): FoundEntity | undefined {
  const entity = model.userData.actionEntity as FoundEntity | undefined;
  return entity?.model === model && liveEntities.has(entity) && !entity.isRemoved ? entity : undefined;
}

function setPrefabActive(entity: FoundEntity, active: boolean): void {
  mouseRegistrations.get(entity)?.setActive(active);
  const index = activePrefabs.indexOf(entity);
  if (active && !entity.isRemoved) {
    if (index === -1) activePrefabs.push(entity);
  } else if (index !== -1) activePrefabs.splice(index, 1);
}

/** Release a model projection, including when its logical item survives a visual replacement or pickup. */
export function disposeActionEntity(model: THREE.Object3D): void {
  const entity = model.userData.actionEntity as FoundEntity | undefined;
  if (!entity) return;
  const dispose = disposals.get(entity);
  disposals.delete(entity);
  dispose?.();
}

/** One player-position bridge per world; moving entities refresh on the existing 60-frame snapshots. */
class EntityTickingArea {
  private readonly records = new Map<FoundEntity, { tracker: TileTracker; stop(): void }>();
  private readonly positions;
  private readonly cleanups: (() => void)[] = [];
  private readonly query: TileStateQuery;

  constructor(query: TileStateQuery, positions: ReadonlySignal<THREE.Vector3[]>) {
    this.query = query;
    this.positions = watchSignal(positions, stop => this.cleanups.push(stop));
    createEffect(() => {
      this.positions.get();
      for (const { tracker } of this.records.values()) tracker.sync();
    });
  }

  add(entity: FoundEntity): void {
    if (this.records.has(entity)) return;
    const model = entity.model;
    const tracker = new TileTracker(() => entity.getPosition());
    const area = this.query(tracker.tile);
    const cleanups: (() => void)[] = [];
    const sync = () => tracker.sync();
    model.addEventListener('added', sync);
    this.records.set(entity, { tracker, stop: () => {
      model.removeEventListener('added', sync);
      cleanups.splice(0).forEach(stop => stop());
      area?.dispose();
    } });
    entityWorlds.set(entity, this);
    if (area) {
      const active = watchSignal(area, stop => cleanups.push(stop));
      createEffect(() => {
        const awake = active.get();
        if (awake) entity.addTag('tickingarea');
        else entity.removeTag('tickingarea');
        setPrefabActive(entity, awake);
      });
    } else {
      entity.addTag('tickingarea');
      setPrefabActive(entity, true);
    }
  }

  remove(entity: FoundEntity): void {
    const record = this.records.get(entity);
    this.records.delete(entity);
    entityWorlds.delete(entity);
    record?.stop();
  }

  dispose(): void {
    this.cleanups.splice(0).forEach(stop => stop());
    for (const entity of [...this.records.keys()]) disposeActionEntity(entity.model);
  }
}

/** Bind before restoring/spawning world entities; also adopt projections already attached to this root. */
export function bindActionEntityWorld(root: THREE.Object3D, query: TileStateQuery,
  positions: ReadonlySignal<THREE.Vector3[]>): () => void {
  const world = new EntityTickingArea(query, positions);
  currentEntityWorld = world;
  for (const entity of liveEntities) {
    const model = entity.model;
    if (isUnder(model, root) && !entityWorlds.has(entity)) world.add(entity);
  }
  return () => {
    if (currentEntityWorld === world) currentEntityWorld = undefined;
    world.dispose();
  };
}

function isUnder(model: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let object: THREE.Object3D | null = model; object; object = object.parent) if (object === root) return true;
  return false;
}

/** Query tickingarea-registered prefabs by their logical position and tags, independently of their visual. */
export function FindEntities(position: THREE.Vector3, radius: number,
  mustTags: readonly string[] = [], cantTags: readonly string[] = [], oneOfTags: readonly string[] = []): FoundEntity[] {
  if (!Number.isFinite(radius) || radius < 0) throw new RangeError('Invalid entity query radius');
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return [];
  const found: FoundEntity[] = [];
  const radiusSquared = radius * radius;
  for (const inst of activePrefabs) {
    if (inst.isRemoved || !(inst.getPosition().distanceToSquared(position) <= radiusSquared)) continue;
    if (mustTags.some(tag => !inst.hasTag(tag)) || cantTags.some(tag => inst.hasTag(tag))
      || (oneOfTags.length > 0 && !oneOfTags.some(tag => inst.hasTag(tag)))) continue;
    found.push(inst);
  }
  return found;
}
