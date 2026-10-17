import { Box3, Mesh, Vector3, type Object3D, type Ray } from 'three';
import { prepareSpatialGeometryBounds, spriteSpatialRadius, watchSpatialBounds } from '../../animation/src/spatialBounds.ts';

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

/** Share registration between engine radius queries and input; NOBLOCK remains queryable. */
export function retainSpatialEntity(model: Object3D, positionOf?: () => Vector3) {
  let entry = entries.get(model);
  if (!entry) {
    const updateMatrixWorld = model.updateMatrixWorld, updateWorldMatrix = model.updateWorldMatrix;
    const owned: Entry = {
      model, owners: 0, mouse: false, positionOf: positionOf ?? (() => model.position),
      position: new Vector3(), bounds: new Box3(), keys: [],
      left: NaN, right: NaN, top: NaN, bottom: NaN,
      sync() {
        if (!model.parent) { removeCells(owned); owned.left = NaN; return; }
        owned.position.copy(owned.positionOf());
        const matrix = model.matrixWorld;
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
        model.removeEventListener('added', sync);
        model.removeEventListener('removed', sync);
        model.updateMatrixWorld = updateMatrixWorld;
        model.updateWorldMatrix = updateWorldMatrix;
        entries.delete(model);
        if (!entries.size) worldBounds.makeEmpty();
      },
    };
    // Rendering already updates these matrices. Maintain the index there without an input-time sweep.
    model.updateMatrixWorld = function (force) {
      updateMatrixWorld.call(this, force); owned.sync(); dirty.delete(owned);
    };
    model.updateWorldMatrix = function (parents, children) {
      updateWorldMatrix.call(this, parents, children); owned.sync(); dirty.delete(owned);
    };
    const sync = () => model.updateWorldMatrix(true, true);
    const stopBounds = watchSpatialBounds(model, () => dirty.add(owned));
    model.addEventListener('added', sync);
    model.addEventListener('removed', sync);
    entries.set(model, entry = owned);
    sync();
  }
  const owned = entry;
  owned.owners++;
  if (positionOf) { owned.positionOf = positionOf; owned.sync(); }
  let disposed = false;
  return {
    setMouse(enabled: boolean) {
      if (disposed || owned.mouse === enabled) return;
      owned.mouse = enabled; syncEntitySpatial(model);
    },
    dispose() { if (!disposed) { disposed = true; if (--owned.owners === 0) owned.dispose(); } },
  };
}

/** Movement owners call this before a same-frame domain query; rendering also keeps it current. */
export function syncEntitySpatial(model: Object3D): void {
  if (entries.has(model)) model.updateWorldMatrix(true, true);
}

function flushBounds(): void {
  for (const entry of dirty) syncEntitySpatial(entry.model);
  dirty.clear();
}

export function visitEntitiesNear(position: Vector3, radius: number, visit: (model: Object3D) => void): void {
  if (!Number.isFinite(radius) || radius < 0) throw new RangeError('Invalid entity query radius');
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return;
  flushBounds();
  const seen = new Set<Entry>(), radiusSquared = radius * radius;
  for (let x = Math.floor((position.x - radius) / CELL_SIZE); x <= Math.floor((position.x + radius) / CELL_SIZE); x++) {
    for (let z = Math.floor((position.z - radius) / CELL_SIZE); z <= Math.floor((position.z + radius) / CELL_SIZE); z++) {
      for (const entry of cells.get(`${x},${z}`) ?? []) {
        if (seen.has(entry)) continue;
        seen.add(entry);
        if (entry.position.distanceToSquared(position) <= radiusSquared) visit(entry.model);
      }
    }
  }
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
