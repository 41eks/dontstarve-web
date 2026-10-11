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

/** Camera depths closer than this are one depth, so float noise cannot reorder overlapping sprites. */
const CAMERA_DEPTH_QUANTUM = 1e-3;

export interface RenderOrderEntry {
  object: THREE.Object3D;
  footPosition: { x: number; z: number };
  cameraDepth: number;
  sortGroup?: number;
  sortLayer?: number;
}

/**
 * Far-to-near comparator over camera-space foot depth (negative z, ascending draws far first).
 * Entities on one line of sight (a row of walls) share a depth, so they fall back to their
 * world foot x then z, which does not change while the camera moves. Grouped parts keep
 * sortGroup, sortLayer and id.
 */
export function compareRenderEntries(a: RenderOrderEntry, b: RenderOrderEntry): number {
  const ungrouped = a.sortGroup === undefined && b.sortGroup === undefined;
  return Math.round(a.cameraDepth / CAMERA_DEPTH_QUANTUM) - Math.round(b.cameraDepth / CAMERA_DEPTH_QUANTUM)
    || (ungrouped ? a.footPosition.x - b.footPosition.x || a.footPosition.z - b.footPosition.z : 0)
    || (a.sortGroup ?? a.object.id) - (b.sortGroup ?? b.object.id)
    || (a.sortLayer ?? 1) - (b.sortLayer ?? 1)
    || a.object.id - b.object.id;
}
