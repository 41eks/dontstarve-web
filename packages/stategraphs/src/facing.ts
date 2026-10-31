import * as THREE from 'three';

export type PlayerFacing = 'up' | 'down' | 'side';

/** The four-faced player's sprite facing values for each camera-relative facing. */
export const PLAYER_FACING_VALUES: Readonly<Record<PlayerFacing, number>> = { down: 8, side: 5, up: 2 };

const UP = new THREE.Vector3(0, 1, 0);
const direction = new THREE.Vector3(), forward = new THREE.Vector3(), right = new THREE.Vector3();

/**
 * inst:ForceFacePoint for the four-faced player: the camera-relative facing from `from` towards `to`.
 * Returns undefined when the points coincide, so the current facing is kept.
 */
export function facingToward(camera: THREE.Camera, from: THREE.Vector3Like, to: THREE.Vector3Like):
  { facing: PlayerFacing; mirrored: boolean } | undefined {
  direction.subVectors(to, from);
  camera.getWorldDirection(forward).setY(0).normalize();
  right.crossVectors(forward, UP).normalize();
  const depth = direction.dot(forward), side = direction.dot(right);
  if (depth * depth + side * side < 1e-8) return undefined;
  return Math.abs(depth) >= Math.abs(side)
    ? { facing: depth > 0 ? 'up' : 'down', mirrored: false }
    : { facing: 'side', mirrored: side < 0 };
}

/** Turns `animation` from `from` towards `to` relative to the camera; coincident points keep the facing. */
export function facePoint(animation: { setFacing(facing: PlayerFacing, mirrored?: boolean): void },
  camera: THREE.Camera, from: THREE.Vector3Like, to: THREE.Vector3Like): void {
  const result = facingToward(camera, from, to);
  if (result) animation.setFacing(result.facing, result.mirrored);
}

/** facePoint for callers that write the player's sprite facing value directly. */
export function faceSpritePoint(sprite: { setFacing(facing: number, mirrored?: boolean): void },
  camera: THREE.Camera, from: THREE.Vector3Like, to: THREE.Vector3Like): void {
  const result = facingToward(camera, from, to);
  if (result) sprite.setFacing(PLAYER_FACING_VALUES[result.facing], result.mirrored);
}
