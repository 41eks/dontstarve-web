import { Matrix4, type Object3D } from 'three';
import { cacheMatrixUpdates, retainWorldMatrixVersion } from './matrixUpdates';

/** Inline scalar snapshots keep the common automatic-transform check compact.
 * Manual matrices allocate their snapshot only when an owner actually uses one.
 */
class LocalTransform {
  private px = 0; private py = 0; private pz = 0;
  private qx = 0; private qy = 0; private qz = 0; private qw = 1;
  private sx = 1; private sy = 1; private sz = 1;
  private pivotX = 0; private pivotY = 0; private pivotZ = 0;
  private matrix?: Matrix4;
  private automatic = true;

  matches(object: Object3D): boolean {
    if (this.automatic !== object.matrixAutoUpdate) return false;
    if (!this.automatic) return this.matrix!.equals(object.matrix);
    const { position: p, quaternion: q, scale: s, pivot } = object;
    return this.px === p.x && this.py === p.y && this.pz === p.z
      && this.qx === q.x && this.qy === q.y && this.qz === q.z && this.qw === q.w
      && this.sx === s.x && this.sy === s.y && this.sz === s.z
      && this.pivotX === (pivot?.x ?? 0) && this.pivotY === (pivot?.y ?? 0) && this.pivotZ === (pivot?.z ?? 0);
  }

  capture(object: Object3D): void {
    this.automatic = object.matrixAutoUpdate;
    if (!this.automatic) { (this.matrix ??= new Matrix4()).copy(object.matrix); return; }
    const { position: p, quaternion: q, scale: s, pivot } = object;
    this.px = p.x; this.py = p.y; this.pz = p.z;
    this.qx = q.x; this.qy = q.y; this.qz = q.z; this.qw = q.w;
    this.sx = s.x; this.sy = s.y; this.sz = s.z;
    this.pivotX = pivot?.x ?? 0; this.pivotY = pivot?.y ?? 0; this.pivotZ = pivot?.z ?? 0;
  }
}

class MatrixGate {
  private readonly model: Object3D;
  private readonly visual: Object3D;
  private readonly stationary: boolean;
  private readonly fixedVisual: boolean;
  private readonly dynamicParent: boolean;
  private readonly original: { updateMatrixWorld: Object3D['updateMatrixWorld']; updateWorldMatrix: Object3D['updateWorldMatrix'] };
  private readonly local = new LocalTransform();
  private readonly visualLocal = new LocalTransform();
  private parent: Object3D | null = null;
  private parentVersion?: ReturnType<typeof retainWorldMatrixVersion>;
  private capturedParentVersion = -1;
  private dirty = true;
  readonly markDirty = () => { this.dirty = true; };

  constructor(model: Object3D, visual: Object3D, stationary: boolean, fixedVisual: boolean, dynamicParent: boolean, original: MatrixGate['original']) {
    this.model = model; this.visual = visual; this.stationary = stationary;
    this.fixedVisual = fixedVisual; this.dynamicParent = dynamicParent; this.original = original;
  }

  private readParentVersion(): number {
    if (this.parent !== this.model.parent || this.parent && !this.parentVersion) {
      this.parentVersion?.dispose();
      this.parent = this.model.parent;
      this.parentVersion = this.parent ? retainWorldMatrixVersion(this.parent) : undefined;
      this.dirty = true;
    }
    return this.parentVersion?.read() ?? 0;
  }

  private reusable(): boolean {
    const { model, visual } = this;
    return !this.dirty && !model.matrixWorldNeedsUpdate && !visual.matrixWorldNeedsUpdate
      && model.children.length === 1 && model.children[0] === visual && visual.children.length <= 1
      && (!visual.children.length || !visual.children[0].matrixAutoUpdate && !visual.children[0].children.length)
      && (this.stationary || this.local.matches(model))
      && (this.fixedVisual || this.visualLocal.matches(visual))
      && (!this.dynamicParent || this.capturedParentVersion === this.readParentVersion()) && !this.dirty;
  }

  private capture(): void {
    const { model, visual } = this;
    if (!this.stationary) this.local.capture(model);
    if (!this.fixedVisual) this.visualLocal.capture(visual);
    if (this.dynamicParent) this.capturedParentVersion = this.readParentVersion();
    // A detached resident placeholder was not visited by this update.
    this.dirty = visual.parent !== model;
  }

  updateMatrixWorld(force?: boolean): boolean {
    if (this.reusable()) return false;
    this.original.updateMatrixWorld.call(this.model, force);
    this.capture();
    return true;
  }

  updateWorldMatrix(parents: boolean, children: boolean): boolean {
    const { model, visual } = this;
    if (parents) model.parent?.updateWorldMatrix(true, false);
    if (this.reusable()) return false;
    this.original.updateWorldMatrix.call(model, false, children);
    // Shallow queries have not settled the descendant matrices.
    if (children) {
      model.matrixWorldNeedsUpdate = visual.matrixWorldNeedsUpdate = false;
      this.capture();
    } else this.dirty = true;
    return true;
  }

  dispose(): void { this.parentVersion?.dispose(); }
}

/**
 * Cache the transform-only subtree of a baked billboard. Geometry/frame changes
 * have no transform work. Detect direct movement, visual offsets and ancestor
 * transforms instead of requiring each prefab to declare itself stationary.
 * Additional children retain ordinary Three.js updates (attached FX may move).
 * Both matrix entry points share this cache, including spatial/pointer queries.
 * Owners of a fixed visual must markDirty() after changing its local transform.
 * Ancestors are assumed static: attaching or detaching `model` invalidates the cache, but an
 * ancestor that moves while `model` stays attached needs `dynamicParent` to be noticed.
 */
export function installMatrixGate(model: Object3D, visual: Object3D, stationary = false, fixedVisual = stationary, dynamicParent = false) {
  let gate!: MatrixGate;
  const updates = cacheMatrixUpdates(model, original => gate = new MatrixGate(model, visual, stationary, fixedVisual, dynamicParent, original));
  let renderEnabled = true;
  const refreshRenderEntry = () => {
    // Attached FX retain normal updates even while the resident visual is absent.
    const empty = model.children.length === 1 && model.children[0] === visual && visual.children.length === 0;
    updates.setRenderEnabled(renderEnabled || !empty);
  };
  model.addEventListener('added', gate.markDirty);
  model.addEventListener('removed', gate.markDirty);
  model.addEventListener('childadded', refreshRenderEntry);
  model.addEventListener('childremoved', refreshRenderEntry);
  visual.addEventListener('childadded', refreshRenderEntry);
  visual.addEventListener('childremoved', refreshRenderEntry);
  return {
    markDirty: gate.markDirty,
    setRenderEnabled(enabled: boolean) {
      renderEnabled = enabled;
      gate.markDirty();
      refreshRenderEntry();
    },
    dispose() {
      model.removeEventListener('childadded', refreshRenderEntry);
      model.removeEventListener('childremoved', refreshRenderEntry);
      visual.removeEventListener('childadded', refreshRenderEntry);
      visual.removeEventListener('childremoved', refreshRenderEntry);
      updates.dispose(); gate.dispose();
      model.removeEventListener('added', gate.markDirty);
      model.removeEventListener('removed', gate.markDirty);
    },
  };
}
