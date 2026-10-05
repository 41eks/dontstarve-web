import * as THREE from 'three';
import type { InventoryReceiveListener } from '@dontstarve-web/inventory';
import type { DstInventoryBarElement, InventoryReceiveSource } from '@dontstarve-web/ui';

/** Snapshot the source in browser viewport coordinates, including a canvas offset or CSS scale. */
export function projectInventorySource(
  position: THREE.Vector3, camera: THREE.Camera, canvas: HTMLCanvasElement,
): InventoryReceiveSource | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  camera.updateMatrixWorld();
  const projected = position.clone().project(camera);
  if (![projected.x, projected.y, projected.z].every(Number.isFinite)
    || projected.z < -1 || projected.z > 1) return null;
  return {
    x: rect.left + (projected.x + 1) * rect.width / 2,
    y: rect.top + (1 - projected.y) * rect.height / 2,
  };
}

export function inventoryReceiveEffect(
  bar: DstInventoryBarElement, camera: THREE.Camera, canvas: HTMLCanvasElement, position: THREE.Vector3,
): InventoryReceiveListener {
  const source = projectInventorySource(position, camera, canvas);
  return (received) => {
    if (!source) return;
    for (const { slot, delta } of received) bar.animateReceive(slot, source, delta);
  };
}
