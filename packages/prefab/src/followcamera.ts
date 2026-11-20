import * as THREE from 'three';

/**
 * TheCamera as gameplay reads it: followcamera.lua's GetDownVec / GetRightVec, both from the heading target, so a turn
 * in progress already steers by where the camera is turning to.
 */
export interface TheCamera {
  /** FollowCamera:GetDownVec: the ground direction toward the bottom of the screen. */
  GetDownVec(out?: THREE.Vector3): THREE.Vector3;
  /** FollowCamera:GetRightVec: the ground direction toward the right of the screen. */
  GetRightVec(out?: THREE.Vector3): THREE.Vector3;
}

/** GetDownVec for a heading in degrees: Vector3(cos(heading), 0, sin(heading)). */
export function DownVecForHeading(heading: number, out = new THREE.Vector3()): THREE.Vector3 {
  const radians = THREE.MathUtils.degToRad(heading);
  return out.set(Math.cos(radians), 0, Math.sin(radians));
}

/**
 * GetRightVec for a heading in degrees. Lua turns the heading by +90 in DST's left-handed world; saves are imported with
 * z negated into this right-handed scene, where the same screen-right is the heading turned by -90. Down runs along
 * the view axis, so it needs no such change.
 */
export function RightVecForHeading(heading: number, out = new THREE.Vector3()): THREE.Vector3 {
  const radians = THREE.MathUtils.degToRad(heading - 90);
  return out.set(Math.cos(radians), 0, Math.sin(radians));
}

/** A camera whose heading target is `heading()`, for worlds without a follow camera (tests, tools). */
export function headingCamera(heading: () => number): TheCamera {
  return { GetDownVec: out => DownVecForHeading(heading(), out), GetRightVec: out => RightVecForHeading(heading(), out) };
}

/** A camera fixed at one heading. */
export function fixedCamera(heading: number): TheCamera {
  return headingCamera(() => heading);
}
