import type { Object3D } from 'three';

/**
 * Stops the per-frame matrix traversal at a static billboard until something says it changed.
 *
 * three.js recomposes every object's local matrix and visits all of its children on each `updateMatrixWorld`, even when
 * nothing moved. A sprite model sits directly below the scene and its subtree only changes when the owner calls
 * `markDirty` (camera turned, a new frame's meshes, the entity was moved), so until then the whole subtree is skipped.
 * A pending `matrixWorldNeedsUpdate`, reparenting, or any child other than `visual` (effects attached by a prefab)
 * always falls through to the normal update. Starts dirty, so a position assigned right after creation is picked up by
 * the first traversal. Ancestors must not move; the `force` argument is ignored because `Scene.updateMatrixWorld`
 * forces its children every frame.
 */
export function installMatrixGate(model: Object3D, visual: Object3D) {
  const original = model.updateMatrixWorld;
  let dirty = true;
  const markDirty = () => { dirty = true; };
  model.addEventListener('added', markDirty);
  model.addEventListener('removed', markDirty);
  model.updateMatrixWorld = function (force) {
    if (!dirty && !this.matrixWorldNeedsUpdate && this.children.length === 1 && this.children[0] === visual) return;
    original.call(this, force);
    dirty = false;
  };
  return {
    markDirty,
    dispose() {
      model.updateMatrixWorld = original;
      model.removeEventListener('added', markDirty);
      model.removeEventListener('removed', markDirty);
    },
  };
}
