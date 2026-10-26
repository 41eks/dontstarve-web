import { Matrix4, type Object3D } from 'three';

let nextTraversal = 0, traversal = 0;

/** One traversal shares ancestor comparisons; explicit queries outside it always
 * sample the current matrix. Nested traversals keep their own comparison scope.
 */
export function updateSceneMatrices(scene: Object3D): void {
  const previous = traversal;
  traversal = ++nextTraversal;
  try { scene.updateMatrixWorld(); }
  finally { traversal = previous; }
}

interface WorldMatrixVersion {
  owners: number;
  traversal: number;
  read(): number;
}

interface MatrixMethods {
  updateMatrixWorld: Object3D['updateMatrixWorld'];
  updateWorldMatrix: Object3D['updateWorldMatrix'];
}

/** Return true only when observers may need to sample a new world transform. */
export interface MatrixUpdater {
  markDirty?(): void;
  updateMatrixWorld(force?: boolean): boolean;
  updateWorldMatrix(parents: boolean, children: boolean): boolean;
}

interface Updates {
  original: MatrixMethods;
  updater?: MatrixUpdater;
  worldVersion?: WorldMatrixVersion;
  observers: Set<() => void>;
  notify(): void;
  release(): void;
}
const updateState = Symbol('matrixUpdates');
type ManagedObject = Object3D & { [updateState]?: Updates };

/** Empty resident visuals do not enter the cache or notify spatial observers. */
function skipRenderMatrixUpdate(): void {}

// Shared call targets keep Three's child traversal monomorphic. Entity state
// is read through a private symbol, without allocating per-model call targets.
function updateMatrixWorld(this: Object3D, force?: boolean): void {
  const state = (this as ManagedObject)[updateState]!;
  if (state.worldVersion) state.worldVersion.traversal = 0;
  if (state.updater) {
    if (state.updater.updateMatrixWorld(force)) state.notify();
  } else { state.original.updateMatrixWorld.call(this, force); state.notify(); }
}

function updateWorldMatrix(this: Object3D, parents: boolean, children: boolean): void {
  const state = (this as ManagedObject)[updateState]!;
  if (state.worldVersion) state.worldVersion.traversal = 0;
  if (state.updater) {
    if (state.updater.updateWorldMatrix(parents, children)) state.notify();
  } else { state.original.updateWorldMatrix.call(this, parents, children); state.notify(); }
}

/** A single wrapper owns both Three.js entry points. Cache and index lifetimes
 * can end in either order without restoring another owner's stale wrapper.
 */
function retain(model: Object3D): Updates {
  const object = model as ManagedObject;
  let state = object[updateState];
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
      if (owned.updater || owned.worldVersion || owned.observers.size || object[updateState] !== owned) return;
      model.updateMatrixWorld = original.updateMatrixWorld;
      model.updateWorldMatrix = original.updateWorldMatrix;
      delete object[updateState];
    },
  };
  model.updateMatrixWorld = updateMatrixWorld;
  model.updateWorldMatrix = updateWorldMatrix;
  object[updateState] = state = owned;
  return state;
}

/** Descendants share one ancestor snapshot, rather than each retaining and
 * comparing its sixteen matrix elements. Invalidation happens before descent.
 */
export function retainWorldMatrixVersion(model: Object3D): { read(): number; dispose(): void } {
  const state = retain(model);
  let version = state.worldVersion;
  if (!version) {
    const matrix = new Matrix4().copy(model.matrixWorld);
    let revision = 0;
    const owned: WorldMatrixVersion = {
      owners: 0, traversal: 0,
      read() {
        if (!traversal || owned.traversal !== traversal) {
          if (!matrix.equals(model.matrixWorld)) { matrix.copy(model.matrixWorld); revision++; }
          owned.traversal = traversal;
        }
        return revision;
      },
    };
    state.worldVersion = version = owned;
  }
  version.owners++;
  const owned = version;
  let disposed = false;
  return { read: owned.read, dispose() {
    if (disposed) return;
    disposed = true;
    if (--owned.owners === 0) { state.worldVersion = undefined; state.release(); }
  } };
}

export function watchMatrixUpdates(model: Object3D, observer: () => void): () => void {
  const state = retain(model);
  const listener = () => observer();
  state.observers.add(listener);
  return () => { state.observers.delete(listener); state.release(); };
}

/** Notify only after the matrix pipeline produces a different world transform.
 * Cached sprite subtrees do not reach this observer on unchanged frames. Plain
 * Three nodes still support direct transform writes and explicit matrix queries.
 */
export function watchWorldMatrixChanges(model: Object3D, observer: () => void): () => void {
  const previous = new Matrix4().copy(model.matrixWorld);
  return watchMatrixUpdates(model, () => {
    if (previous.equals(model.matrixWorld)) return;
    previous.copy(model.matrixWorld);
    observer();
  });
}

/** A cached parent changed: the child's static-ancestor shortcut must settle again. */
export function invalidateMatrixUpdates(model: Object3D): void {
  (model as ManagedObject)[updateState]?.updater?.markDirty?.();
}

export function cacheMatrixUpdates(model: Object3D, create: (original: MatrixMethods) => MatrixUpdater) {
  const state = retain(model);
  if (state.updater) throw new Error('Object already has a matrix cache');
  const updater = state.updater = create(state.original);
  return {
    setRenderEnabled(enabled: boolean) {
      if (state.updater !== updater) return;
      model.updateMatrixWorld = enabled ? updateMatrixWorld : skipRenderMatrixUpdate;
    },
    dispose() {
      if (state.updater !== updater) return;
      state.updater = undefined;
      model.updateMatrixWorld = updateMatrixWorld;
      state.release();
    },
  };
}
