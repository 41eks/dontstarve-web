import type { Object3D } from 'three';
import type { FoundEntity } from './activePrefabs';

interface Registration {
  readonly entity: FoundEntity;
  active: boolean;
  awake: boolean;
  refresh(): void;
}

const targets = new Set<FoundEntity>();
const registrations = new WeakMap<Object3D, Registration>();
const enabled = new WeakMap<Object3D, boolean>();

/** Mouse candidates retain visible blockers even when no action is currently available. */
export const mouseTargets: ReadonlySet<FoundEntity> = targets;

/** Prefabs with conditional input opt in/out as their own state changes, independently of world queries. */
export function setMouseTargetEnabled(model: Object3D, value: boolean): void {
  if (enabled.get(model) === value) return;
  enabled.set(model, value);
  refreshMouseTarget(model);
}

export function refreshMouseTarget(model: Object3D): void { registrations.get(model)?.refresh(); }

/** A projected entity owns one registration; its lifecycle and tags update it without a pointer-time world scan. */
export function registerMouseTarget(entity: FoundEntity) {
  const { model } = entity;
  const registration: Registration = { entity, active: false, awake: true, refresh() {
    if (registration.active && registration.awake && model.parent && enabled.get(model) !== false
      && !entity.isRemoved && !entity.hasTag('NOCLICK')) targets.add(entity);
    else targets.delete(entity);
  } };
  registrations.set(model, registration);
  model.addEventListener('added', registration.refresh);
  model.addEventListener('removed', registration.refresh);
  return {
    refresh: registration.refresh,
    setActive(value: boolean) { registration.active = value; registration.refresh(); },
    setAwake(value: boolean) { registration.awake = value; registration.refresh(); },
    dispose() {
      targets.delete(entity);
      model.removeEventListener('added', registration.refresh);
      model.removeEventListener('removed', registration.refresh);
      if (registrations.get(model) === registration) { registrations.delete(model); enabled.delete(model); }
    },
  };
}
