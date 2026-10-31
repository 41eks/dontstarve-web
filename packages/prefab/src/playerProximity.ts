import type { Vector3 } from 'three';

export const PLAYER_PROXIMITY_ENTER_DISTANCE = 9;
export const PLAYER_PROXIMITY_EXIT_DISTANCE = 10;

/** Shared ground interaction range; the exit margin prevents boundary flicker. */
export function isPlayerNearby(
  playerPosition: Vector3,
  targetPosition: Vector3,
  wasNearby: boolean,
): boolean {
  const threshold = wasNearby ? PLAYER_PROXIMITY_EXIT_DISTANCE : PLAYER_PROXIMITY_ENTER_DISTANCE;
  return playerPosition.distanceToSquared(targetPosition) <= threshold * threshold;
}
