import { Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import { cacheMatrixUpdates } from './matrixUpdates';

class LocalTransform {
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly scale = new Vector3();
  private readonly matrix = new Matrix4();
  private readonly pivot = new Vector3();
  private automatic = true;

  matches(object: Object3D): boolean {
    return this.automatic === object.matrixAutoUpdate && (this.automatic
      ? this.position.equals(object.position) && this.quaternion.equals(object.quaternion) && this.scale.equals(object.scale)
        && this.pivot.x === (object.pivot?.x ?? 0) && this.pivot.y === (object.pivot?.y ?? 0) && this.pivot.z === (object.pivot?.z ?? 0)
      : this.matrix.equals(object.matrix));
  }

  capture(object: Object3D): void {
    this.automatic = object.matrixAutoUpdate;
    this.position.copy(object.position); this.quaternion.copy(object.quaternion); this.scale.copy(object.scale);
    this.matrix.copy(object.matrix);
    this.pivot.set(object.pivot?.x ?? 0, object.pivot?.y ?? 0, object.pivot?.z ?? 0);
  }
}

/**
 * Cache the transform-only subtree of a baked billboard. Geometry/frame changes
 * have no transform work. Detect direct movement, visual offsets and ancestor
 * transforms instead of requiring each prefab to declare itself stationary.
 * Additional children retain ordinary Three.js updates (attached FX may move).
 * Both matrix entry points share this cache, including spatial/pointer queries.
 */
export function installMatrixGate(model: Object3D, visual: Object3D, stationary = false) {
  const local = new LocalTransform(), visualLocal = new LocalTransform(), parentWorld = new Matrix4();
  let dirty = true;
  const markDirty = () => { dirty = true; };
  const reusable = () => !dirty && !model.matrixWorldNeedsUpdate && !visual.matrixWorldNeedsUpdate
    && model.children.length === 1 && model.children[0] === visual && visual.children.length <= 1
    && (!visual.children.length || !visual.children[0].matrixAutoUpdate && !visual.children[0].children.length)
    && (stationary || local.matches(model) && visualLocal.matches(visual))
    && (!model.parent || parentWorld.equals(model.parent.matrixWorld));
  const capture = () => {
    if (!stationary) { local.capture(model); visualLocal.capture(visual); }
    if (model.parent) parentWorld.copy(model.parent.matrixWorld);
    dirty = false;
  };
  model.addEventListener('added', markDirty);
  model.addEventListener('removed', markDirty);
  const stopUpdates = cacheMatrixUpdates(model, original => ({
    updateMatrixWorld(force) {
      if (reusable()) return false;
      original.updateMatrixWorld.call(model, force);
      capture();
      return true;
    },
    updateWorldMatrix(parents, children) {
      if (parents) model.parent?.updateWorldMatrix(true, false);
      if (reusable()) return false;
      original.updateWorldMatrix.call(model, false, children);
      // updateWorldMatrix leaves these flags set even after calculating the
      // matrices. Only a complete subtree update can settle our cached state.
      if (children) {
        model.matrixWorldNeedsUpdate = visual.matrixWorldNeedsUpdate = false;
        capture();
      } else dirty = true;
      return true;
    },
  }));
  return {
    markDirty,
    dispose() {
      stopUpdates();
      model.removeEventListener('added', markDirty);
      model.removeEventListener('removed', markDirty);
    },
  };
}
