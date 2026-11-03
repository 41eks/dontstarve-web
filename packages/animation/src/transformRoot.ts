import { Group, Matrix4, type Object3D, type Vector3 } from 'three';
import { invalidateMatrixUpdates, retainWorldMatrixVersion } from './matrixUpdates';

/** A position to read. Its writers are the entity Transform's methods, which keep the tile tracker and matrices in step. */
export type ReadonlyVector3 = Readonly<Pick<Vector3, 'x' | 'y' | 'z' | 'isVector3' | 'clone' | 'toArray' | 'distanceTo' | 'distanceToSquared' | 'equals' | 'length' | 'lengthSq' | 'dot' | 'manhattanDistanceTo'>>;

/** Set while a root invalidates its own descendants: their marks belong to the update already running. */
let settling = 0;
const previousWorld = new Matrix4();

/**
 * The root of an entity whose transforms change only through marked writes. A scene traversal reaches the root but
 * does not descend into it while it is clean, so a resting entity costs one check per frame instead of a walk over
 * its subtree.
 *
 * Contract: whoever writes a transform at or below the root calls `markTransformDirty()` on the written node (or on
 * the root). Adding or removing the root or one of its direct children marks it automatically. Three passes `force`
 * to every child of a node with `matrixAutoUpdate`, so it says nothing about movement; a moving parent is detected
 * through the parent's shared world-matrix version instead, as the matrix gates do. A root with more than one child
 * (attached FX, which may move on their own) is updated on every traversal, as an ordinary node would be.
 */
export class TransformRoot extends Group {
  readonly isTransformRoot = true;
  private dirty = true;
  private watchedParent: Object3D | null = null;
  private parentVersion?: ReturnType<typeof retainWorldMatrixVersion>;
  private seenParentVersion = -1;
  private readonly mark = () => { this.markTransformDirty(); };
  private readonly released = () => { this.watchParent(null); this.markTransformDirty(); };

  constructor() {
    super();
    this.addEventListener('added', this.mark);
    this.addEventListener('removed', this.released);
    this.addEventListener('childadded', this.mark);
    this.addEventListener('childremoved', this.mark);
  }

  private watchParent(parent: Object3D | null): void {
    if (parent === this.watchedParent) return;
    this.parentVersion?.dispose();
    this.watchedParent = parent;
    this.parentVersion = parent ? retainWorldMatrixVersion(parent) : undefined;
    this.seenParentVersion = -1;
  }

  /** Whether the parent's world matrix changed since this root last settled; one shared comparison per traversal. */
  private parentMoved(): boolean {
    this.watchParent(this.parent);
    const version = this.parentVersion?.read() ?? 0;
    if (version === this.seenParentVersion) return false;
    this.seenParentVersion = version;
    return true;
  }

  /** Whether the next traversal or query recomputes this subtree. */
  get transformDirty(): boolean { return this.dirty; }

  /** A transform at or below this root changed; enclosing roots must also let the next traversal reach it. */
  markTransformDirty(): void {
    this.dirty = true;
    if (settling) return;
    for (let node = this.parent; node; node = node.parent) if (node instanceof TransformRoot) node.dirty = true;
  }

  override updateMatrixWorld(_force?: boolean): void {
    const parentMoved = this.parentMoved();
    if (!parentMoved && !this.dirty && !this.matrixWorldNeedsUpdate && this.children.length <= 1) return;
    if (this.matrixAutoUpdate) this.updateMatrix();
    previousWorld.copy(this.matrixWorld);
    if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    else this.matrixWorld.copy(this.matrix);
    this.matrixWorldNeedsUpdate = false;
    // Cached descendants (a stationary sprite's matrix gate) assume a static parent: tell them it moved. A mark from
    // inside the subtree (a sprite turned to the camera) leaves this root's matrix as it was and needs no invalidation.
    // Their marks reach this root again, so it is cleaned only afterwards.
    if (!previousWorld.equals(this.matrixWorld)) {
      settling++;
      try { for (const child of this.children) invalidateMatrixUpdates(child); }
      finally { settling--; }
    }
    this.dirty = false;
    for (const child of this.children) child.updateMatrixWorld(true);
  }

  /** Queries settle the whole subtree when dirty, so a clean root always has current descendants. */
  override updateWorldMatrix(updateParents: boolean, _updateChildren: boolean): void {
    if (updateParents && this.parent) this.parent.updateWorldMatrix(true, false);
    this.updateMatrixWorld(false);
  }
}

/** Mark the transform root enclosing `object` (or `object` itself); nodes outside any root need no marking. */
export function markTransformDirty(object: Object3D | null | undefined): void {
  for (let node = object; node; node = node.parent) {
    if (node instanceof TransformRoot) { node.markTransformDirty(); return; }
  }
}
