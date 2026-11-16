import { createRenderEffect, watchSignal, type ReadonlySignal } from '@dontstarve-web/signals';
import type { PrefabInstance } from './prefabInstance';

/**
 * Transform:SetEightFaced on a rotation-0 inst: it shows the facing the camera heading selects. On OnGround art, which
 * lies fixed in the world, the eight idles are one drawing turned against the camera's 45-degree steps, so the art keeps
 * its look on screen as the camera turns.
 */
export function SetEightFaced(inst: PrefabInstance, cameraFacing: ReadonlySignal<number> | undefined): void {
  if (!cameraFacing) return;
  let stopWatching: (() => void) | undefined;
  const facing = watchSignal(cameraFacing, stop => { stopWatching = stop; });
  const stopFacing = createRenderEffect(() => inst.sprite.setFacing(facing.get()));
  inst.onRemove(() => { stopFacing(); stopWatching?.(); });
}
