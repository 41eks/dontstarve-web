import type * as THREE from 'three';
import type { ComponentActionEntity } from '../../stategraphs/src/componentactions';
import { createSignal, readonlySignal, type ReadonlySignal } from '@dontstarve-web/signals';
import type { WorkableInst } from '../../componets/src/workable';

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
export function actionEntity(model: THREE.Group, prefab: string, inst?: ComponentActionEntity & WorkableInst): ComponentActionEntity & WorkableInst & { readonly model: THREE.Group; getPosition(): THREE.Vector3 } {
  if (model.userData.actionEntity) return model.userData.actionEntity;
  model.userData.components ??= {};
  const removal = inst?.removal ?? modelRemoval(model);
  const entity: ComponentActionEntity & WorkableInst & { readonly model: THREE.Group; getPosition(): THREE.Vector3 } = {
    model,
    prefab,
    removal,
    get isRemoved() { return removal.peek(); },
    get components() { return inst?.components ?? model.userData.components; },
    getPosition: () => model.userData.getGroundPosition?.() ?? model.position.clone(),
    hasTag: tag => {
      if (inst) return inst.hasTag(tag);
      for (const component of Object.values(model.userData.components) as { HasTag?(tag: string): boolean | undefined }[]) {
        const value = component?.HasTag?.(tag);
        if (value !== undefined) return value;
      }
      return model.userData.tags?.includes(tag) ?? false;
    },
    addTag(tag) {
      if (inst) { inst.addTag(tag); return; }
      model.userData.tags ??= [];
      if (!model.userData.tags.includes(tag)) model.userData.tags.push(tag);
    },
    removeTag(tag) {
      if (inst) inst.removeTag(tag);
      else model.userData.tags = (model.userData.tags ?? []).filter((value: string) => value !== tag);
    },
    PushEvent: (name, data) => {
      if (inst) inst.PushEvent?.(name, data);
      else model.dispatchEvent({ type: name, data } as never);
    },
  };
  model.userData.actionEntity = entity;
  return entity;
}

export type FoundEntity = ComponentActionEntity & { getPosition(): THREE.Vector3 };

/** TheSim:FindEntities on the ground plane: radius, then must/cant/oneof tag filters. */
export function FindEntities(root: THREE.Object3D, x: number, z: number, radius: number,
  mustTags: readonly string[] = [], cantTags: readonly string[] = [], oneOfTags: readonly string[] = []): FoundEntity[] {
  const found: FoundEntity[] = [];
  root.traverse(object => {
    const inst = object.userData.actionEntity as FoundEntity | undefined;
    if (!inst || inst.isRemoved || typeof inst.getPosition !== 'function') return;
    const position = inst.getPosition();
    if ((position.x - x) ** 2 + (position.z - z) ** 2 > radius ** 2) return;
    if (mustTags.some(tag => !inst.hasTag(tag)) || cantTags.some(tag => inst.hasTag(tag))
      || (oneOfTags.length > 0 && !oneOfTags.some(tag => inst.hasTag(tag)))) return;
    found.push(inst);
  });
  return found;
}
