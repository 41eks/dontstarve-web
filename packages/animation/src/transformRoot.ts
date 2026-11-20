import { Group, Matrix4, type Object3D, type Vector3 } from 'three';
import { cacheMatrixUpdates, invalidateMatrixUpdates, retainWorldMatrixVersion, type MatrixUpdater } from './matrixUpdates';

/** A position to read. Its writers are the entity Transform's methods, which keep the tile tracker and matrices in step. */
export type ReadonlyVector3 = Readonly<Pick<Vector3, 'x' | 'y' | 'z' | 'isVector3' | 'clone' | 'toArray' | 'distanceTo' | 'distanceToSquared' | 'equals' | 'length' | 'lengthSq' | 'dot' | 'manhattanDistanceTo'>>;

/** Set while a root invalidates its own descendants: their marks belong to the update already running. */
let settling = 0;
const previousWorld = new Matrix4();

/**
 * The root of an entity whose transforms change only through marked writes. Under a parent with
 * `retainEntityRootUpdates()` (the scene) a clean root is not visited at all: a mark schedules its outermost root,
 * and the parent's update settles only scheduled roots. Elsewhere a traversal reaches the root but does not descend
 * into it while it is clean.
 *
 * Its matrices never update automatically (`matrixAutoUpdate` and `matrixWorldAutoUpdate` are false): settling a
 * marked root composes its local matrix and recomputes the subtree.
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
    this.matrixAutoUpdate = false;
    this.matrixWorldAutoUpdate = false;
    this.addEventListener('added', this.mark);
    this.addEventListener('removed', this.released);
    this.addEventListener('childadded', this.mark);
    this.addEventListener('childremoved', this.mark);
  }

  private watchParent(parent: Object3D | null): void {
    if (parent === this.watchedParent) { return; }
    this.parentVersion?.dispose();
    this.watchedParent = parent;
    this.parentVersion = parent ? retainWorldMatrixVersion(parent) : undefined;
    this.seenParentVersion = -1;
  }

  /** Whether the parent's world matrix changed since this root last settled; one shared comparison per traversal. */
  private parentMoved(): boolean {
    this.watchParent(this.parent);
    const version = this.parentVersion?.read() ?? 0;
    if (version === this.seenParentVersion) { return false; }
    this.seenParentVersion = version;
    return true;
  }

  /** Whether the next traversal or query recomputes this subtree. */
  get transformDirty(): boolean { return this.dirty; }

  /** A transform at or below this root changed; enclosing roots must also let the next traversal reach it. */
  markTransformDirty(): void {
    this.dirty = true;
    if (settling) { return; }
    let outermost: TransformRoot = this;
    for (let node = this.parent; node; node = node.parent) { if (node instanceof TransformRoot) { node.dirty = true; outermost = node; } }
    if (outermost.parent) { rootUpdates.get(outermost.parent)?.schedule(outermost); }
  }

  /** A root with attached children (FX, symbol followers) may change below without a mark: it settles on every update. */
  get volatile(): boolean { return this.children.length > 1; }

  override updateMatrixWorld(_force?: boolean): void {
    const parentMoved = this.parentMoved();
    if (!parentMoved && !this.dirty && !this.matrixWorldNeedsUpdate && !this.volatile) { return; }
    this.updateMatrix();
    previousWorld.copy(this.matrixWorld);
    if (this.parent) { this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix); }
    else { this.matrixWorld.copy(this.matrix); }
    this.matrixWorldNeedsUpdate = false;
    // Cached descendants (a stationary sprite's matrix gate) assume a static parent: tell them it moved. A mark from
    // inside the subtree (a sprite turned to the camera) leaves this root's matrix as it was and needs no invalidation.
    // Their marks reach this root again, so it is cleaned only afterwards.
    if (!previousWorld.equals(this.matrixWorld)) {
      settling++;
      try { for (const child of this.children) { invalidateMatrixUpdates(child); } }
      finally { settling--; }
    }
    this.dirty = false;
    for (const child of this.children) { child.updateMatrixWorld(true); }
  }

  /** Queries settle the whole subtree when dirty, so a clean root always has current descendants. */
  override updateWorldMatrix(updateParents: boolean, _updateChildren: boolean): void {
    if (updateParents && this.parent) { this.parent.updateWorldMatrix(true, false); }
    this.updateMatrixWorld(false);
  }
}

/** Mark the transform root enclosing `object` (or `object` itself); nodes outside any root need no marking. */
export function markTransformDirty(object: Object3D | null | undefined): void {
  for (let node = object; node; node = node.parent) {
    if (node instanceof TransformRoot) { node.markTransformDirty(); return; }
  }
}

/** Settle passes per update; marks made while settling beyond this wait for the next update. */
const MAX_SETTLE_PASSES = 8;

/**
 * The matrix update of a parent (the scene) whose entity roots settle on marks. Its update does not walk the roots:
 * it settles those marked since the last update, and the volatile ones on every update, while its other children
 * update as usual. When the parent's own world matrix changes, every child updates once.
 */
class EntityRootUpdates implements MatrixUpdater {
  owners = 0;
  private pending = new Set<TransformRoot>();
  private spare = new Set<TransformRoot>();
  private readonly volatileRoots = new Set<TransformRoot>();
  private readonly plain = new Set<Object3D>();
  private readonly world = new Matrix4();
  /** The first update after installing visits every child, as roots added earlier were never scheduled. */
  private full = true;
  private readonly parent: Object3D;
  private readonly original: { updateWorldMatrix: Object3D['updateWorldMatrix'] };
  private readonly onChildAdded = ({ child }: { child: Object3D }) => { if (!(child instanceof TransformRoot)) { this.plain.add(child); } };
  private readonly onChildRemoved = ({ child }: { child: Object3D }) => { this.plain.delete(child); };
  release!: () => void;

  constructor(parent: Object3D, original: EntityRootUpdates['original']) {
    this.parent = parent; this.original = original;
    for (const child of parent.children) { if (!(child instanceof TransformRoot)) { this.plain.add(child); } }
    parent.addEventListener('childadded', this.onChildAdded);
    parent.addEventListener('childremoved', this.onChildRemoved);
  }

  schedule(root: TransformRoot): void { this.pending.add(root); }
  isScheduled(root: TransformRoot): boolean { return this.pending.has(root); }

  updateMatrixWorld(force?: boolean): boolean {
    const parent = this.parent;
    if (parent.matrixAutoUpdate) { parent.updateMatrix(); }
    // updateMatrix() always raises matrixWorldNeedsUpdate, so movement is detected by comparing the world matrix.
    if (parent.parent) { parent.matrixWorld.multiplyMatrices(parent.parent.matrixWorld, parent.matrix); }
    else { parent.matrixWorld.copy(parent.matrix); }
    parent.matrixWorldNeedsUpdate = false;
    if (force || this.full || !this.world.equals(parent.matrixWorld)) {
      this.world.copy(parent.matrixWorld);
      this.full = false;
      this.pending.clear();
      for (const child of parent.children) {
        child.updateMatrixWorld(true);
        if (child instanceof TransformRoot && child.volatile) { this.pending.add(child); }
      }
      return true;
    }
    for (const child of this.plain) { child.updateMatrixWorld(false); }
    const volatile = this.volatileRoots;
    let batch = this.pending;
    for (let pass = 0; pass < MAX_SETTLE_PASSES && batch.size; pass++) {
      // Roots marked while this batch settles form the next pass.
      this.pending = this.spare;
      for (const root of batch) {
        if (root.parent !== parent) { continue; }
        root.updateMatrixWorld(false);
        if (root.volatile) { volatile.add(root); }
      }
      batch.clear();
      this.spare = batch;
      batch = this.pending;
    }
    for (const root of volatile) { this.pending.add(root); }
    volatile.clear();
    return true;
  }

  updateWorldMatrix(parents: boolean, children: boolean): boolean {
    this.original.updateWorldMatrix.call(this.parent, parents, children);
    return true;
  }

  dispose(): void {
    this.parent.removeEventListener('childadded', this.onChildAdded);
    this.parent.removeEventListener('childremoved', this.onChildRemoved);
    this.pending.clear(); this.volatileRoots.clear(); this.plain.clear();
  }
}

const rootUpdates = new WeakMap<Object3D, EntityRootUpdates>();

/**
 * Settle the entity roots directly under `parent` (normally the scene) only when marked: a matrix update of `parent`
 * no longer walks its clean roots. Owners share one installation; the last release restores the ordinary traversal.
 */
export function retainEntityRootUpdates(parent: Object3D): () => void {
  let updates = rootUpdates.get(parent);
  if (!updates) {
    let created!: EntityRootUpdates;
    const cache = cacheMatrixUpdates(parent, original => created = new EntityRootUpdates(parent, original));
    updates = created;
    updates.release = () => { cache.dispose(); created.dispose(); rootUpdates.delete(parent); };
    rootUpdates.set(parent, updates);
  }
  updates.owners++;
  const owned = updates;
  let released = false;
  return () => {
    if (released) { return; }
    released = true;
    if (--owned.owners === 0) { owned.release(); }
  };
}

/** Whether `root` waits for the next settle of its parent's entity root updates. */
export function isTransformRootScheduled(root: TransformRoot): boolean {
  return !!root.parent && !!rootUpdates.get(root.parent)?.isScheduled(root);
}
