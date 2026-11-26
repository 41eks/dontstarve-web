import type * as THREE from 'three';
import { createEffect, createRenderEffect, untrack, watchSignal } from '@dontstarve-web/signals';
import type { ActionEntity } from './prefabInstance';
import { registerMouseTarget } from './mouseTargets';

interface Registration {
  dispose(): void;
}
const registrations = new Map<ActionEntity, Registration>();
/** The registered entity of each root model, whether or not a display has bound it yet. */
const byModel = new WeakMap<THREE.Object3D, ActionEntity>();

/**
 * Make an entity something the player can act on: a mouse target while it is awake, following its tags. The instance
 * is the action target itself; it stops being one when it is removed.
 */
export function registerActionEntity<Instance extends ActionEntity>(instance: Instance): Instance {
  const inst: ActionEntity = instance;
  if (registrations.has(inst) || inst.isRemoved) {
    return instance;
  }
  const model = inst.transform.model;
  const cleanups: (() => void)[] = [];
  registrations.set(inst, {
    dispose() {
      stopRemoval();
      cleanups.splice(0).forEach(stop => stop());
      mouse.dispose();
      byModel.delete(model);
    },
  });
  byModel.set(model, inst);
  const mouse = registerMouseTarget(inst);
  // A mouse target while its entity is awake: the instance's status follows the ticking area and limbo.
  const status = watchSignal(inst.status, stop => cleanups.push(stop));
  createEffect(() => mouse.setAwake(status.get() === 'active'));
  let tags = inst.tags.value;
  cleanups.push(
    createRenderEffect(() => {
      const next = inst.tags.get();
      if (next === tags) {
        return;
      }
      tags = next;
      untrack(() => mouse.refresh());
    }),
  );
  let removed = inst.removal.value;
  const stopRemoval = createRenderEffect(() => {
    const next = inst.removal.get();
    if (next === removed) {
      return;
    }
    removed = next;
    if (next) {
      untrack(() => disposeActionEntity(inst));
    }
  });
  return instance;
}

/** The registered entity a picked model belongs to, while it is live; finding it registers nothing. */
export function findActionEntity(model: THREE.Object3D | null | undefined): ActionEntity | undefined {
  const inst = model ? byModel.get(model) : undefined;
  return inst && !inst.isRemoved ? inst : undefined;
}

/**
 * The registered entities, in registration order. Only tests enumerate them, in place of a manager's target list;
 * game code finds entities through TheSim.
 */
export function actionEntities(): Iterable<ActionEntity> {
  return registrations.keys();
}

/** Withdraw an entity from the mouse and placement registries, as removal does. */
export function disposeActionEntity(instance: ActionEntity | undefined): void {
  if (!instance) {
    return;
  }
  const registration = registrations.get(instance);
  if (!registration) {
    return;
  }
  registrations.delete(instance);
  registration.dispose();
}
