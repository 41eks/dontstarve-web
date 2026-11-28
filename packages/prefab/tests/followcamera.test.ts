import * as THREE from 'three';
import { expect, it } from 'vitest';
import { DownVecForHeading, RightVecForHeading } from '../src/followcamera';

/** A camera at `heading` and `pitch`, oriented as src/camera.ts's apply() (followcamera.lua Apply) orients it. */
function cameraAt(heading: number, pitch: number): THREE.PerspectiveCamera {
  const h = THREE.MathUtils.degToRad(heading),
    p = THREE.MathUtils.degToRad(pitch);
  const direction = new THREE.Vector3(-Math.cos(p) * Math.cos(h), -Math.sin(p), -Math.cos(p) * Math.sin(h));
  const luaRight = new THREE.Vector3(Math.cos(h + Math.PI / 2), 0, Math.sin(h + Math.PI / 2));
  const up = new THREE.Vector3().crossVectors(direction, luaRight).normalize();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
  camera.position.copy(direction).multiplyScalar(-30);
  camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), direction, up));
  camera.updateMatrixWorld();
  return camera;
}

it('GetRightVec points to the right of the screen and GetDownVec to its bottom, at every camera step', () => {
  for (let heading = 0; heading < 360; heading += 45) {
    for (const pitch of [30, 60]) {
      const camera = cameraAt(heading, pitch),
        origin = new THREE.Vector3().project(camera);
      const right = RightVecForHeading(heading).project(camera).sub(origin);
      const down = DownVecForHeading(heading).project(camera).sub(origin);
      expect(right.x, `right x at ${heading}`).toBeGreaterThan(0);
      expect(Math.abs(right.y), `right y at ${heading}`).toBeLessThan(1e-6);
      expect(down.y, `down y at ${heading}`).toBeLessThan(0);
      expect(Math.abs(down.x), `down x at ${heading}`).toBeLessThan(1e-6);
    }
  }
});
