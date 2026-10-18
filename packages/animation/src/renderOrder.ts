import type * as THREE from 'three';

const spriteRenderGroups = new WeakMap<THREE.Object3D, THREE.Group>();

export function registerSpriteRenderGroup(
  sprite: THREE.Object3D,
  renderGroup: THREE.Group,
): void {
  spriteRenderGroups.set(sprite, renderGroup);
}

export function setSpriteEntityRenderOrder(
  sprite: THREE.Object3D,
  renderOrder: number,
): void {
  const renderGroup = spriteRenderGroups.get(sprite);
  if (!renderGroup) {
    throw new Error(`${sprite.name || 'Object3D'} is not a registered animated sprite`);
  }
  renderGroup.renderOrder = renderOrder;
}

/** Hidden entities (or ones whose registered visual is hidden) are not drawn, so their order is irrelevant. */
export function isSpriteEntityRendered(sprite: THREE.Object3D): boolean {
  if (!sprite.visible) return false;
  for (let node: THREE.Object3D | null = spriteRenderGroups.get(sprite) ?? null; node && node !== sprite; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

/** Camera depths closer than this are one depth, so float noise cannot reorder overlapping sprites. */
const CAMERA_DEPTH_QUANTUM = 1e-3;

export interface RenderOrderEntry {
  object: THREE.Object3D;
  footPosition: THREE.Vector3;
  cameraDepth: number;
  renderLayer?: number;
  sortGroup?: number;
  sortLayer?: number;
}

/**
 * Layer, then far-to-near camera-space foot depth (negative z, ascending draws far first).
 * Entities on one line of sight (a row of walls) share a depth, so they fall back to their
 * world foot x then z, which does not change while the camera moves. Grouped parts keep
 * sortGroup, sortLayer and id.
 */
export function compareRenderEntries(a: RenderOrderEntry, b: RenderOrderEntry): number {
  const ungrouped = a.sortGroup === undefined && b.sortGroup === undefined;
  return (a.renderLayer ?? 0) - (b.renderLayer ?? 0)
    || Math.round(a.cameraDepth / CAMERA_DEPTH_QUANTUM) - Math.round(b.cameraDepth / CAMERA_DEPTH_QUANTUM)
    || (ungrouped ? a.footPosition.x - b.footPosition.x || a.footPosition.z - b.footPosition.z || (a.sortLayer ?? 1) - (b.sortLayer ?? 1) : 0)
    || (a.sortGroup ?? a.object.id) - (b.sortGroup ?? b.object.id)
    || (a.sortLayer ?? 1) - (b.sortLayer ?? 1)
    || a.object.id - b.object.id;
}

/** Reusable structure-of-arrays scratch space; only numeric indices enter the sort. */
export class SpriteRenderOrderSorter {
  // Store already rounded depth quanta, so Float32 conversion cannot change a bucket.
  // Promote only if a very distant foot exceeds Float32's exact integer precision.
  private depths: Float32Array | Float64Array = new Float32Array(0);
  private renderLayers = new Float64Array(0);
  private footX = new Float64Array(0);
  private footZ = new Float64Array(0);
  private sortGroups = new Float64Array(0);
  private sortLayers = new Float64Array(0);
  private ids = new Float64Array(0);
  private grouped = new Uint8Array(0);
  // Keep Array.sort's comparison schedule for the existing mixed grouped/ungrouped tie rules.
  private readonly indices: number[] = [];
  private entryIndices = new Uint32Array(0);
  private readonly ownerIndices = new Map<number, number>();

  update(entries: readonly Omit<RenderOrderEntry, 'cameraDepth'>[], cameraMatrixWorldInverse: THREE.Matrix4): void {
    this.reserve(entries.length);
    const matrix = cameraMatrixWorldInverse.elements;
    const { renderLayers, footX, footZ, sortGroups, sortLayers, ids, grouped, ownerIndices } = this;
    ownerIndices.clear();
    let count = 0;
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
      const entry = entries[entryIndex];
      const object = entry.object;
      if (!isSpriteEntityRendered(object)) continue;
      const foot = entry.footPosition;
      // The view matrix is affine; compute just camera-space z, without a temporary vector.
      const depth = Math.round((matrix[2] * foot.x + matrix[6] * foot.y
        + matrix[10] * foot.z + matrix[14]) / CAMERA_DEPTH_QUANTUM);
      if (this.depths instanceof Float32Array && Math.fround(depth) !== depth) {
        this.depths = new Float64Array(this.depths);
      }
      this.depths[count] = depth;
      renderLayers[count] = entry.renderLayer ?? 0;
      footX[count] = foot.x;
      footZ[count] = foot.z;
      sortGroups[count] = entry.sortGroup ?? object.id;
      sortLayers[count] = entry.sortLayer ?? 1;
      ids[count] = object.id;
      grouped[count] = entry.sortGroup === undefined ? 0 : 1;
      this.indices[count] = count;
      this.entryIndices[count] = entryIndex;
      ownerIndices.set(object.id, count);
      count++;
    }

    const depths = this.depths;
    // Grouped parts inherit the owner's original depth, even if that owner is itself grouped.
    // The spare half holds resolved depths without overwriting any owner's original depth.
    for (let i = 0; i < count; i++) {
      const owner = grouped[i] && sortGroups[i] !== ids[i]
        ? ownerIndices.get(sortGroups[i]) ?? i : i;
      depths[count + i] = depths[owner];
    }
    ownerIndices.clear();

    const indices = this.indices;
    indices.length = count;
    indices.sort((a, b) => renderLayers[a] - renderLayers[b]
      || depths[count + a] - depths[count + b]
      || (!grouped[a] && !grouped[b]
        ? footX[a] - footX[b] || footZ[a] - footZ[b] || sortLayers[a] - sortLayers[b] : 0)
      || sortGroups[a] - sortGroups[b]
      || sortLayers[a] - sortLayers[b]
      || ids[a] - ids[b]);

    for (let order = 0; order < count; order++) {
      setSpriteEntityRenderOrder(entries[this.entryIndices[indices[order]]].object, order);
    }
  }

  private reserve(count: number): void {
    if (count <= this.entryIndices.length) return;
    const capacity = Math.max(16, count, this.entryIndices.length * 2);
    this.depths = this.depths instanceof Float64Array ? new Float64Array(capacity * 2) : new Float32Array(capacity * 2);
    this.renderLayers = new Float64Array(capacity);
    this.footX = new Float64Array(capacity);
    this.footZ = new Float64Array(capacity);
    this.sortGroups = new Float64Array(capacity);
    this.sortLayers = new Float64Array(capacity);
    this.ids = new Float64Array(capacity);
    this.grouped = new Uint8Array(capacity);
    this.entryIndices = new Uint32Array(capacity);
  }
}
