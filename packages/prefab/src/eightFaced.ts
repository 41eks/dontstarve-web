import { rotateFacing } from '@dontstarve-web/animation/facing';
import { createRenderEffect, watchSignal, type ReadonlySignal } from '@dontstarve-web/signals';
import type { PrefabInstance } from './prefabInstance';

/**
 * Transform:SetEightFaced: the inst shows the facing the camera heading selects, turned by its Transform:SetRotation
 * when `rotation` is given (rotation 0 otherwise). On OnGround art, which lies fixed in the world, the eight idles are
 * one drawing turned against the camera's 45-degree steps, so the art keeps its look on screen as the camera turns.
 */
export function SetEightFaced(
  inst: PrefabInstance,
  cameraFacing: ReadonlySignal<number> | undefined,
  /** Maps the selected facing onto the build frame that holds it, for builds whose frames are stored under other names. */
  frameFor: (facing: number) => number = facing => facing,
  rotation?: ReadonlySignal<number>,
): void {
  if (!cameraFacing) { return; }
  let stopWatching: (() => void) | undefined;
  const facing = watchSignal(cameraFacing, stop => { stopWatching = stop; });
  const stopFacing = createRenderEffect(() => {
    const selected = facing.get();
    inst.sprite.setFacing(frameFor(rotation ? rotateFacing(selected, rotation.get()) : selected));
  });
  inst.onRemove(() => { stopFacing(); stopWatching?.(); });
}
