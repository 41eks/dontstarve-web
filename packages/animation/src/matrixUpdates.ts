import type { Object3D } from 'three';

interface MatrixMethods {
  updateMatrixWorld: Object3D['updateMatrixWorld'];
  updateWorldMatrix: Object3D['updateWorldMatrix'];
}

/** Return true only when observers may need to sample a new world transform. */
export interface MatrixUpdater {
  updateMatrixWorld(force?: boolean): boolean;
  updateWorldMatrix(parents: boolean, children: boolean): boolean;
}

interface Updates {
  original: MatrixMethods;
  updater?: MatrixUpdater;
  observers: Set<() => void>;
  notify(): void;
  release(): void;
}
const updates = new WeakMap<Object3D, Updates>();

/** A single wrapper owns both Three.js entry points. Cache and index lifetimes
 * can end in either order without restoring another owner's stale wrapper.
 */
function retain(model: Object3D): Updates {
  let state = updates.get(model);
  if (state) return state;
  const original = { updateMatrixWorld: model.updateMatrixWorld, updateWorldMatrix: model.updateWorldMatrix };
  let notifying = false;
  const owned: Updates = {
    original, observers: new Set(),
    notify() {
      if (notifying) return;
      notifying = true;
      try { for (const observer of owned.observers) observer(); }
      finally { notifying = false; }
    },
    release() {
      if (owned.updater || owned.observers.size || updates.get(model) !== owned) return;
      model.updateMatrixWorld = original.updateMatrixWorld;
      model.updateWorldMatrix = original.updateWorldMatrix;
      updates.delete(model);
    },
  };
  model.updateMatrixWorld = function (force) {
    if (owned.updater) {
      if (owned.updater.updateMatrixWorld(force)) owned.notify();
    } else { original.updateMatrixWorld.call(this, force); owned.notify(); }
  };
  model.updateWorldMatrix = function (parents, children) {
    if (owned.updater) {
      if (owned.updater.updateWorldMatrix(parents, children)) owned.notify();
    } else { original.updateWorldMatrix.call(this, parents, children); owned.notify(); }
  };
  updates.set(model, state = owned);
  return state;
}

export function watchMatrixUpdates(model: Object3D, observer: () => void): () => void {
  const state = retain(model);
  const listener = () => observer();
  state.observers.add(listener);
  return () => { state.observers.delete(listener); state.release(); };
}

export function cacheMatrixUpdates(model: Object3D, create: (original: MatrixMethods) => MatrixUpdater): () => void {
  const state = retain(model);
  if (state.updater) throw new Error('Object already has a matrix cache');
  const updater = state.updater = create(state.original);
  return () => {
    if (state.updater !== updater) return;
    state.updater = undefined;
    state.release();
  };
}
