import type { Object3D } from 'three';
import type { ActionEntity } from './prefabInstance';

/** What the mouse registry reads of an entity: its root model, removal and tags. */
export type MouseTargetEntity = Pick<ActionEntity, 'transform' | 'isRemoved' | 'hasTag'>;

interface Registration {
  readonly entity: MouseTargetEntity;
  awake: boolean;
  refresh(): void;
}

const targets = new Set<MouseTargetEntity>();
const registrations = new WeakMap<Object3D, Registration>();
const enabled = new WeakMap<Object3D, boolean>();

/** Mouse candidates retain visible blockers even when no action is currently available. */
export const mouseTargets: ReadonlySet<MouseTargetEntity> = targets;

/** Prefabs with conditional input opt in/out as their own state changes, independently of world queries. */
export function setMouseTargetEnabled(model: Object3D, value: boolean): void {
  if (enabled.get(model) === value) { return; }
  enabled.set(model, value);
  refreshMouseTarget(model);
}

export function refreshMouseTarget(model: Object3D): void { registrations.get(model)?.refresh(); }

/** A registered entity owns one registration; its lifecycle and tags update it without a pointer-time world scan. */
export function registerMouseTarget(entity: MouseTargetEntity) {
  const model = entity.transform.model;
  const registration: Registration = { entity, awake: true, refresh() {
    if (registration.awake && model.parent && enabled.get(model) !== false
      && !entity.isRemoved && !entity.hasTag('NOCLICK')) { targets.add(entity); }
    else { targets.delete(entity); }
  } };
  registrations.set(model, registration);
  registration.refresh();
  model.addEventListener('added', registration.refresh);
  model.addEventListener('removed', registration.refresh);
  return {
    refresh: registration.refresh,
    setAwake(value: boolean) { registration.awake = value; registration.refresh(); },
    dispose() {
      targets.delete(entity);
      model.removeEventListener('added', registration.refresh);
      model.removeEventListener('removed', registration.refresh);
      if (registrations.get(model) === registration) { registrations.delete(model); enabled.delete(model); }
    },
  };
}
