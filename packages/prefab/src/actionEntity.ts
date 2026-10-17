import type * as THREE from 'three';
import type { ComponentActionEntity } from '../../stategraphs/src/componentactions';
import { createEffect, createSignal, readonlySignal, watchSignal, type ReadonlySignal, type TileStateQuery } from '@dontstarve-web/signals';
import type { WorkableInst } from '../../componets/src/workable';
import { TileTracker } from '../../componets/src/tileManager';
import { registerMouseTarget } from '../../stategraphs/src/mouseTargets';
import { retainSpatialEntity, syncEntitySpatial, visitEntitiesNear } from '../../stategraphs/src/entitySpatialIndex';
import { registerPlacementEntity, syncPlacementEntity } from './placementEntities';

/** Existing world removal writes update the sole lifecycle signal, including inside batches. */
function modelRemoval(model: THREE.Group): ReadonlySignal<boolean> {
  const state = createSignal(model.userData.removed === true);
  Object.defineProperty(model.userData, 'removed', {
    enumerable: true, configurable: true,
    get: () => state.peek(), set: (removed: boolean) => state.set(removed === true),
  });
  return readonlySignal(state);
}

/** Project the engine inst onto its existing world model, keeping one tag/component owner. */
export function actionEntity(model: THREE.Group, prefab: string, inst?: ComponentActionEntity & WorkableInst): ComponentActionEntity & WorkableInst & { readonly model: THREE.Group; getPosition(): THREE.Vector3; getPhysicsRadius(): number } {
  if (model.userData.actionEntity) return model.userData.actionEntity;
  model.userData.components ??= {};
  const removal = inst?.removal ?? modelRemoval(model);
  let mouseTarget: ReturnType<typeof registerMouseTarget> | undefined;
  const entity: ComponentActionEntity & WorkableInst & { readonly model: THREE.Group; getPosition(): THREE.Vector3; getPhysicsRadius(): number } = {
    model,
    prefab,
    removal,
    get isRemoved() { return removal.peek(); },
    get components() { return inst?.components ?? model.userData.components; },
    getPosition: () => model.userData.getGroundPosition?.() ?? model.position,
    getPhysicsRadius: () => model.userData.physicsRadius ?? 0,
    hasTag: tag => {
      if (inst) return inst.hasTag(tag);
      for (const component of Object.values(model.userData.components) as { HasTag?(tag: string): boolean | undefined }[]) {
        const value = component?.HasTag?.(tag);
        if (value !== undefined) return value;
      }
      return model.userData.tags?.includes(tag) ?? false;
    },
    addTag(tag) {
      if (inst) inst.addTag(tag);
      else {
        model.userData.tags ??= [];
        if (!model.userData.tags.includes(tag)) model.userData.tags.push(tag);
      }
      if (tag === 'NOCLICK' || tag === 'tickingarea') mouseTarget?.refresh();
      syncPlacementEntity(model);
      syncEntitySpatial(model);
    },
    removeTag(tag) {
      if (inst) inst.removeTag(tag);
      else model.userData.tags = (model.userData.tags ?? []).filter((value: string) => value !== tag);
      if (tag === 'NOCLICK' || tag === 'tickingarea') mouseTarget?.refresh();
      syncPlacementEntity(model);
      syncEntitySpatial(model);
    },
    PushEvent: (name, data) => {
      if (inst) inst.PushEvent?.(name, data);
      else model.dispatchEvent({ type: name, data } as never);
    },
  };
  model.userData.actionEntity = entity;
  const spatial = retainSpatialEntity(model, entity.getPosition);
  const stopPlacement = registerPlacementEntity(model, entity.getPosition);
  mouseTarget = registerMouseTarget(model, () => !entity.isRemoved && entity.hasTag('tickingarea') && !entity.hasTag('NOCLICK'));
  const stopTags = (inst as typeof inst & { ListenForEvent?(name: string, listener: () => void): () => void })
    ?.ListenForEvent?.('tagchanged', () => { mouseTarget?.refresh(); syncPlacementEntity(model); syncEntitySpatial(model); });
  liveEntities.add(entity);
  const stopRemoval = removal.subscribe(removed => { if (removed) disposeActionEntity(model); });
  disposals.set(entity, () => {
    stopRemoval();
    stopTags?.();
    mouseTarget?.dispose();
    stopPlacement();
    spatial.dispose();
    entityWorlds.get(entity)?.remove(entity);
    entity.removeTag('tickingarea');
    liveEntities.delete(entity);
    delete model.userData.actionEntity;
  });
  if (!entity.isRemoved) {
    if (currentEntityWorld) currentEntityWorld.add(entity);
    else entity.addTag('tickingarea'); // Standalone worlds have no area gate.
  }
  return entity;
}

/**
 * The engine's lifecycle list adopts projected insts when a world binds. Radius and mouse queries use the shared
 * spatial index; removed insts leave both registrations when their removal signal fires.
 */
const liveEntities = new Set<FoundEntity>();
const disposals = new Map<FoundEntity, () => void>();
const entityWorlds = new WeakMap<FoundEntity, EntityTickingArea>();
let currentEntityWorld: EntityTickingArea | undefined;

/** Release a model projection, including when its logical item survives a visual replacement or pickup. */
export function disposeActionEntity(model: THREE.Group): void {
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
    const model = (entity as FoundEntity & { model: THREE.Group }).model;
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
        if (active.get()) entity.addTag('tickingarea');
        else entity.removeTag('tickingarea');
      });
    } else entity.addTag('tickingarea');
  }

  remove(entity: FoundEntity): void {
    const record = this.records.get(entity);
    this.records.delete(entity);
    entityWorlds.delete(entity);
    record?.stop();
  }

  dispose(): void {
    this.cleanups.splice(0).forEach(stop => stop());
    for (const entity of [...this.records.keys()]) disposeActionEntity((entity as FoundEntity & { model: THREE.Group }).model);
  }
}

/** Bind before restoring/spawning world entities; also adopt projections already attached to this root. */
export function bindActionEntityWorld(root: THREE.Object3D, query: TileStateQuery,
  positions: ReadonlySignal<THREE.Vector3[]>): () => void {
  const world = new EntityTickingArea(query, positions);
  currentEntityWorld = world;
  for (const entity of liveEntities) {
    const model = (entity as FoundEntity & { model: THREE.Group }).model;
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

export type FoundEntity = ComponentActionEntity & WorkableInst & { getPosition(): THREE.Vector3 };

/** Query only tickingarea-tagged entities, then apply root, caller tags and radius. */
export function FindEntities(root: THREE.Object3D, position: THREE.Vector3, radius: number,
  mustTags: readonly string[] = [], cantTags: readonly string[] = [], oneOfTags: readonly string[] = []): FoundEntity[] {
  const found: FoundEntity[] = [];
  visitEntitiesNear(position, radius, model => {
    const inst = model.userData.actionEntity as FoundEntity | undefined;
    // Radius has already narrowed the grid candidates; test tags before walking the root chain.
    if (!inst || inst.isRemoved || !inst.hasTag('tickingarea')) return;
    if (mustTags.some(tag => !inst.hasTag(tag)) || cantTags.some(tag => inst.hasTag(tag))
      || (oneOfTags.length > 0 && !oneOfTags.some(tag => inst.hasTag(tag)))) return;
    if (!isUnder(model, root)) return;
    found.push(inst);
  });
  return found;
}
