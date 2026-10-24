import { Box3, Matrix4, Mesh, Vector3, type Object3D, type Ray } from 'three';
import { prepareSpatialGeometryBounds, spriteSpatialRadius, watchSpatialBounds } from '../../animation/src/spatialBounds.ts';
import { watchMatrixUpdates } from '../../animation/src/matrixUpdates.ts';

// Ground cells also hold tall visual envelopes. Rays traverse cells, never a foot-point radius.
const CELL_SIZE = 4;
interface Entry {
  model: Object3D;
  owners: number;
  mouse: boolean;
  positionOf(): Vector3;
  position: Vector3;
  bounds: Box3;
  keys: string[];
  left: number; right: number; top: number; bottom: number;
  /** Set when something other than the transform changed (children, mouse flag, registration). */
  stale: boolean;
  lastMatrix: Matrix4;
  lastPosition: Vector3;
  sync(): void;
  dispose(): void;
}
const entries = new Map<Object3D, Entry>();
const cells = new Map<string, Set<Entry>>();
const worldBounds = new Box3();
const dirty = new Set<Entry>();

function localRadius(node: Object3D): number {
  const sprite = spriteSpatialRadius(node);
  let radius = sprite ?? 0;
  if (node instanceof Mesh) {
    prepareSpatialGeometryBounds(node.geometry);
    const sphere = node.geometry.boundingSphere;
    if (sphere) radius = sphere.center.length() + sphere.radius;
  }
  // Visibility is deliberately ignored here: revealing a subtree cannot escape its envelope.
  for (const child of node.children) {
    const scale = Math.max(Math.abs(child.scale.x), Math.abs(child.scale.y), Math.abs(child.scale.z));
    radius = Math.max(radius, child.position.length() + scale * localRadius(child));
  }
  return radius;
}

function removeCells(entry: Entry): void {
  for (const key of entry.keys) {
    const cell = cells.get(key);
    cell?.delete(entry);
    if (!cell?.size) cells.delete(key);
  }
  entry.keys.length = 0;
}

/** Retain a spatial entry for pointer queries; NOBLOCK remains queryable. */
export function retainSpatialEntity(model: Object3D, positionOf?: () => Vector3) {
  let entry = entries.get(model);
  if (!entry) {
    const owned: Entry = {
      model, owners: 0, mouse: false, positionOf: positionOf ?? (() => model.position),
      position: new Vector3(), bounds: new Box3(), keys: [],
      left: NaN, right: NaN, top: NaN, bottom: NaN,
      stale: true, lastMatrix: new Matrix4(), lastPosition: new Vector3(),
      sync() {
        if (!model.parent) { removeCells(owned); owned.left = NaN; owned.stale = true; return; }
        const nextPosition = owned.positionOf();
        const matrix = model.matrixWorld;
        if (!owned.stale && owned.lastPosition.equals(nextPosition) && owned.lastMatrix.equals(matrix)) return;
        owned.stale = false;
        owned.lastMatrix.copy(matrix);
        owned.lastPosition.copy(nextPosition);
        owned.position.copy(nextPosition);
        const radius = owned.mouse ? localRadius(model) * matrix.getMaxScaleOnAxis() : 0;
        owned.bounds.min.setFromMatrixPosition(matrix).addScalar(-radius);
        owned.bounds.max.setFromMatrixPosition(matrix).addScalar(radius);
        owned.bounds.expandByPoint(owned.position);
        const min = owned.bounds.min, max = owned.bounds.max;
        if (!Number.isFinite(min.x) || !Number.isFinite(min.y) || !Number.isFinite(min.z)
          || !Number.isFinite(max.x) || !Number.isFinite(max.y) || !Number.isFinite(max.z)) {
          removeCells(owned); owned.left = NaN; return;
        }
        worldBounds.union(owned.bounds);
        const left = Math.floor(owned.bounds.min.x / CELL_SIZE), right = Math.floor(owned.bounds.max.x / CELL_SIZE);
        const top = Math.floor(owned.bounds.min.z / CELL_SIZE), bottom = Math.floor(owned.bounds.max.z / CELL_SIZE);
        if (owned.keys.length && owned.left === left && owned.right === right && owned.top === top && owned.bottom === bottom) return;
        removeCells(owned);
        Object.assign(owned, { left, right, top, bottom });
        for (let x = left; x <= right; x++) for (let z = top; z <= bottom; z++) {
          const key = `${x},${z}`;
          let cell = cells.get(key);
          if (!cell) cells.set(key, cell = new Set());
          cell.add(owned); owned.keys.push(key);
        }
      },
      dispose() {
        stopBounds(); dirty.delete(owned); removeCells(owned);
        stopMatrices();
        model.removeEventListener('added', sync);
        model.removeEventListener('removed', sync);
        entries.delete(model);
        if (!entries.size) worldBounds.makeEmpty();
      },
    };
    // Rendering already updates these matrices. Maintain the index there without an input-time sweep.
    const stopMatrices = watchMatrixUpdates(model, () => { owned.sync(); dirty.delete(owned); });
    const sync = () => syncEntitySpatial(model);
    const stopBounds = watchSpatialBounds(model, () => { owned.stale = true; dirty.add(owned); });
    model.addEventListener('added', sync);
    model.addEventListener('removed', sync);
    entries.set(model, entry = owned);
    sync();
  }
  const owned = entry;
  owned.owners++;
  if (positionOf) { owned.positionOf = positionOf; owned.stale = true; owned.sync(); }
  let disposed = false;
  return {
    setMouse(enabled: boolean) {
      if (disposed || owned.mouse === enabled) return;
      owned.mouse = enabled; owned.stale = true; syncEntitySpatial(model);
    },
    dispose() { if (!disposed) { disposed = true; if (--owned.owners === 0) owned.dispose(); } },
  };
}

/** Movement owners call this before a same-frame domain query; rendering also keeps it current. */
export function syncEntitySpatial(model: Object3D): void {
  const entry = entries.get(model);
  if (!entry) return;
  model.updateWorldMatrix(true, true);
  // Geometry, mouse eligibility and authoritative foot positions can change
  // without a transform; explicit query synchronization must settle them too.
  entry.sync(); dirty.delete(entry);
}

/** The model's drawn children were replaced (a resident sprite loaded or unloaded): recompute its bounds at the next query. */
export function invalidateEntitySpatial(model: Object3D): void {
  const entry = entries.get(model);
  if (!entry) return;
  entry.stale = true; dirty.add(entry);
}

function flushBounds(): void {
  for (const entry of dirty) syncEntitySpatial(entry.model);
  dirty.clear();
}

/** Clip an infinite pointer ray to occupied world bounds, then use grid DDA (including vertical rays). */
export function mouseTargetsAlongRay(ray: Ray, near: number, far: number): Object3D[] {
  flushBounds();
  if (worldBounds.isEmpty()) return [];
  let start = near, end = far;
  for (const axis of ['x', 'y', 'z'] as const) {
    const origin = ray.origin[axis], direction = ray.direction[axis];
    if (direction === 0) {
      if (origin < worldBounds.min[axis] || origin > worldBounds.max[axis]) return [];
    } else {
      const a = (worldBounds.min[axis] - origin) / direction, b = (worldBounds.max[axis] - origin) / direction;
      start = Math.max(start, Math.min(a, b)); end = Math.min(end, Math.max(a, b));
    }
  }
  if (start > end) return [];
  const dx = ray.direction.x, dz = ray.direction.z;
  const px = ray.origin.x + dx * start, pz = ray.origin.z + dz * start;
  let x = Math.floor(px / CELL_SIZE), z = Math.floor(pz / CELL_SIZE);
  const stepX = Math.sign(dx), stepZ = Math.sign(dz);
  const deltaX = dx === 0 ? Infinity : CELL_SIZE / Math.abs(dx), deltaZ = dz === 0 ? Infinity : CELL_SIZE / Math.abs(dz);
  let nextX = dx === 0 ? Infinity : start + ((x + (dx > 0 ? 1 : 0)) * CELL_SIZE - px) / dx;
  let nextZ = dz === 0 ? Infinity : start + ((z + (dz > 0 ? 1 : 0)) * CELL_SIZE - pz) / dz;
  const seen = new Set<Entry>(), found: Object3D[] = [];
  const visit = (cx: number, cz: number) => {
    for (const entry of cells.get(`${cx},${cz}`) ?? []) {
      if (seen.has(entry)) continue;
      seen.add(entry);
      if (entry.mouse && ray.intersectsBox(entry.bounds)) found.push(entry.model);
    }
  };
  while (true) {
    visit(x, z);
    const next = Math.min(nextX, nextZ);
    if (next > end || !Number.isFinite(next)) break;
    if (nextX === nextZ) { visit(x + stepX, z); visit(x, z + stepZ); }
    if (nextX === next) { x += stepX; nextX += deltaX; }
    if (nextZ === next) { z += stepZ; nextZ += deltaZ; }
  }
  return found;
}
