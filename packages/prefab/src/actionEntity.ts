import type * as THREE from 'three';
import type { Object3D, Vector3 } from 'three';
import type { ComponentActionEntity } from '../../stategraphs/src/componentactions';
import { createEffect, createSignal, readonlySignal, watchSignal, type ReadonlySignal } from '@dontstarve-web/signals';
import type { WorkableInst } from '../../componets/src/workable';
import { registerPlacementEntity, syncPlacementEntity } from './placementEntities';
import { prefabInstance } from './prefabInstance';
import { registerMouseTarget } from './mouseTargets';

/** The action and mouse-target view of an entity's model; world queries go through its TheSim, not this view. */
export type FoundEntity = ComponentActionEntity & WorkableInst & {
  readonly model: Object3D;
  getPosition(): Vector3;
};

/** Legacy removal bridge for bare models only; instance and injected owners supply their own lifecycle. */
function modelRemoval(model: THREE.Object3D): ReadonlySignal<boolean> {
  const state = createSignal(model.userData.removed === true);
  Object.defineProperty(model.userData, 'removed', {
    enumerable: true, configurable: true,
    get: () => state.peek(), set: (removed: boolean) => state.set(removed === true),
  });
  return readonlySignal(state);
}

/** Project the engine inst onto its existing world model, keeping one tag/component owner. */
export function actionEntity(model: THREE.Object3D, prefab: string, inst?: ComponentActionEntity & WorkableInst & { getPosition?(): THREE.Vector3 }): FoundEntity & { getPhysicsRadius(): number } {
  const existing = entitiesByModel.get(model);
  if (existing) return existing;
  const instance = prefabInstance(model);
  const owner = inst ?? instance;
  if (owner) actionOwners.set(model, owner);
  const components = owner?.components ?? {};
  const removal = owner?.removal ?? modelRemoval(model);
  const entity: FoundEntity & { getPhysicsRadius(): number } = {
    model,
    prefab,
    removal,
    get isRemoved() { return removal.peek(); },
    get components() { return components; },
    getPosition: () => owner?.getPosition?.() ?? model.position,
    getPhysicsRadius: () => instance?.getPhysicsRadius(0) ?? 0,
    hasTag: tag => {
      if (owner) return owner.hasTag(tag);
      for (const component of Object.values(components) as { HasTag?(tag: string): boolean | undefined }[]) {
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
    // A bare model without an inst has no event listeners to reach.
    PushEvent: (name, data) => (inst ?? instance)?.PushEvent?.(name, data),
  };
  entitiesByModel.set(model, entity);
  const mouse = registerMouseTarget(entity);
  mouseRegistrations.set(entity, mouse);
  const mouseCleanups: (() => void)[] = [];
  // A mouse target while its entity is awake: the instance's status follows the ticking area and limbo.
  if (instance) {
    const status = watchSignal(instance.status, stop => mouseCleanups.push(stop));
    createEffect(() => mouse.setAwake(status.get() === 'active'));
  }
  const stopPlacement = registerPlacementEntity(model, entity.getPosition);
  const tagsChanged = () => { syncPlacementEntity(model); mouse.refresh(); };
  const stopTags = inst && inst !== instance ? (inst as typeof inst & { ListenForEvent?(name: string, listener: () => void): () => void })
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
    liveEntities.delete(entity);
    entitiesByModel.delete(model);
    actionOwners.delete(model);
  });
  return entity;
}

const liveEntities = new Set<FoundEntity>();
const entitiesByModel = new WeakMap<THREE.Object3D, FoundEntity & { getPhysicsRadius(): number }>();
const actionOwners = new WeakMap<THREE.Object3D, ComponentActionEntity>();

/** The original logical inst, for actions which do not need the legacy target view. */
export function actionInstance(model: THREE.Object3D | undefined): ComponentActionEntity | undefined {
  return model ? actionOwners.get(model) : undefined;
}
const disposals = new Map<FoundEntity, () => void>();
const mouseRegistrations = new WeakMap<FoundEntity, ReturnType<typeof registerMouseTarget>>();

/**
 * The live action projections, in registration order. Only tests enumerate them, in place of a manager's target list;
 * game code finds entities through TheSim.
 */
export function actionEntities(): Iterable<FoundEntity> { return liveEntities; }

/** Resolve an already registered action entity for the picked model without creating a projection. */
export function findActionEntity(model: THREE.Object3D | null | undefined): FoundEntity | undefined {
  const entity = model ? entitiesByModel.get(model) : undefined;
  return entity && entity.model === model && liveEntities.has(entity) && !entity.isRemoved ? entity : undefined;
}

/** Release a model projection, including when its logical item survives a visual replacement or pickup. */
export function disposeActionEntity(model: THREE.Object3D): void {
  const entity = entitiesByModel.get(model);
  if (!entity) return;
  const dispose = disposals.get(entity);
  disposals.delete(entity);
  dispose?.();
}
