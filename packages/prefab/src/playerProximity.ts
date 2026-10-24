import type { Vector3 } from 'three';

export const PLAYER_PROXIMITY_ENTER_DISTANCE = 9;
export const PLAYER_PROXIMITY_EXIT_DISTANCE = 10;

/** Shared ground interaction range; the exit margin prevents boundary flicker. */
export function isPlayerNearby(
  playerPosition: Pick<Vector3, 'x' | 'z'>,
  targetPosition: Pick<Vector3, 'x' | 'z'>,
  wasNearby: boolean,
): boolean {
  const dx = playerPosition.x - targetPosition.x;
  const dz = playerPosition.z - targetPosition.z;
  const threshold = wasNearby ? PLAYER_PROXIMITY_EXIT_DISTANCE : PLAYER_PROXIMITY_ENTER_DISTANCE;
  return dx * dx + dz * dz <= threshold * threshold;
}
