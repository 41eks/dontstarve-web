import type * as THREE from 'three';

const spriteRenderGroups = new WeakMap<THREE.Object3D, THREE.Group>();
const undrawnGroups = new WeakSet<THREE.Object3D>();

/** The frame renderer owns whether its ordinary mesh actually draws. Instance
 * proxies still support picking, but their batch performs its own foot sorting.
 */
export function setSpriteRenderGroupDrawn(group: THREE.Object3D, drawn: boolean): void {
  if (drawn) undrawnGroups.delete(group); else undrawnGroups.add(group);
}

export function registerSpriteRenderGroup(
  sprite: THREE.Object3D,
  renderGroup: THREE.Group,
): void {
  // A sprite loaded or swapped under a stable root keeps the entity's order until the next sort.
  const previous = spriteRenderGroups.get(sprite);
  if (previous && renderGroup && previous !== renderGroup) renderGroup.renderOrder = previous.renderOrder;
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

/** Entity visibility, independent of whether its pixels use an ordinary mesh or an instance batch. */
export function isSpriteEntityVisible(sprite: THREE.Object3D): boolean {
  if (!sprite.visible) return false;
  const group = spriteRenderGroups.get(sprite);
  for (let node: THREE.Object3D | null = group ?? null; node && node !== sprite; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

/** Hidden entities and sprites drawn by an instance batch do not join ordinary billboard sorting. */
export function isSpriteEntityRendered(sprite: THREE.Object3D): boolean {
  const group = spriteRenderGroups.get(sprite);
  return !(group && undrawnGroups.has(group)) && isSpriteEntityVisible(sprite);
}


/**
 * Each entity's render order is its own key, computed from its foot point and the camera alone: three.js sorts
 * transparent groups by these numbers, so no list of entities is ranked here. The key orders, most significant first:
 *
 * - `renderLayer` (background < 0 < world);
 * - camera-space foot depth, far to near, in millimetre buckets so float noise cannot reorder overlapping sprites;
 * - camera-space foot x, left to right, in millimetre buckets: entities on one line of sight (a row of walls) share
 *   a depth, and their order across the screen does not change while the camera pans;
 * - `sortLayer` (default 1), for parts that share one foot point: an effect passes its owner's foot and draws after
 *   it (2) or behind it (0).
 *
 * Keys are integers up to 2^26 plus a fraction in 2^-26 steps, so every key is an exact double. They lie in
 * [1, 2^26 + 1): after ground tiles and background decals (explicit orders up to 0), before weather overlays.
 */
const QUANTUM = 1e-3;
const DEPTH_BUCKETS = 2 ** 24;
const LATERAL_BUCKETS = 2 ** 23;
const SORT_LAYERS = 8;
const MIN_RENDER_LAYER = -2;
const RENDER_LAYERS = 4;
const FRACTION = LATERAL_BUCKETS * SORT_LAYERS;

export interface RenderOrderEntry {
  object: THREE.Object3D;
  footPosition: THREE.Vector3;
  renderLayer?: number;
  sortLayer?: number;
}

const bucket = (value: number, buckets: number) => Math.min(buckets - 1, Math.max(0, Math.round(value / QUANTUM) + buckets / 2));

export function spriteRenderOrderKey(foot: THREE.Vector3, view: THREE.Matrix4, renderLayer = 0, sortLayer = 1): number {
  const layer = renderLayer - MIN_RENDER_LAYER;
  if (!Number.isInteger(layer) || layer < 0 || layer >= RENDER_LAYERS) throw new Error(`Unsupported render layer ${renderLayer}`);
  if (!Number.isInteger(sortLayer) || sortLayer < 0 || sortLayer >= SORT_LAYERS) throw new Error(`Unsupported sort layer ${sortLayer}`);
  // The view matrix is affine; compute just camera-space x and z, without a temporary vector.
  const m = view.elements;
  const depth = bucket(m[2] * foot.x + m[6] * foot.y + m[10] * foot.z + m[14], DEPTH_BUCKETS);
  const lateral = bucket(m[0] * foot.x + m[4] * foot.y + m[8] * foot.z + m[12], LATERAL_BUCKETS);
  return 1 + layer * DEPTH_BUCKETS + depth + (lateral * SORT_LAYERS + sortLayer) / FRACTION;
}

/** Writes every shown entity's key; hidden entities and sprites drawn by an instance batch keep theirs. */
export function updateSpriteRenderOrders(entries: readonly RenderOrderEntry[], view: THREE.Matrix4): void {
  for (let i = 0; i < entries.length; i++) {
    const { object, footPosition, renderLayer, sortLayer } = entries[i];
    if (isSpriteEntityRendered(object)) setSpriteEntityRenderOrder(object, spriteRenderOrderKey(footPosition, view, renderLayer, sortLayer));
  }
}
