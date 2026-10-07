import * as THREE from 'three';
import { PointerRaycaster } from './pointerRaycaster.ts';
import type { ActionWorldContext as WorldContext, ActionAnimationController as WilsonAnimationController } from './actionContext.ts';
export interface StaffSummonTarget { prepare(): Promise<void>; spawn(position: THREE.Vector3): Promise<unknown>; }

/** Right-click a ground point while the authoritative hand slot contains this staff. */
export function setupLightStaffCasting(
  world: WorldContext,
  animation: WilsonAnimationController,
  stars: StaffSummonTarget,
  isEquipped: () => boolean,
  onStart: () => void,
  onError: (error: unknown) => void,
): () => void {
  const pointer = new PointerRaycaster(world);
  let preparing = false;
  let disposed = false;
  const cast = async (target: THREE.Vector3) => {
    // Keep the clicked raycast point through loading, casting and later pointer movement.
    const summonPosition = target.clone();
    preparing = true;
    try {
      // A failed asset request must never commit a summon or leave the player busy.
      await stars.prepare();
      if (disposed || !isEquipped() || animation.isCasting) return;
      const direction = summonPosition.clone().sub(world.player.position);
      direction.y = 0;
      if (direction.lengthSq() > 0) {
        direction.normalize();
        const forward = world.camera.getWorldDirection(new THREE.Vector3());
        forward.y = 0;
        forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
        const f = direction.dot(forward), r = direction.dot(right);
        animation.setFacing(Math.abs(f) >= Math.abs(r) ? (f > 0 ? 'up' : 'down') : 'side',
          Math.abs(r) > Math.abs(f) && r < 0);
      }
      if (animation.playStaffCast(() => {
        if (!disposed && isEquipped()) void stars.spawn(summonPosition).catch(onError);
      })) onStart();
    } catch (error) { onError(error); }
    finally { preparing = false; }
  };
  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 2 || event.defaultPrevented || preparing || animation.isCasting || !isEquipped()) return;
    pointer.trackPointer(event);
    const target = pointer.groundPoint();
    if (!target) return;
    event.preventDefault();
    void cast(target);
  };
  world.renderer.domElement.addEventListener('pointerdown', handlePointerDown);
  return () => {
    disposed = true;
    pointer.dispose();
    world.renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
  };
}

export const setupYellowStaffCasting = setupLightStaffCasting;
