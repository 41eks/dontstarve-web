import * as THREE from 'three';
import { expect, it } from 'vitest';
import { createSpritePlacement, placeSprite } from '../src/instancedSpritePlacement';

/** The vertex shader's placement (SPRITE_PLACEMENT_VERTEX, then the instance matrix), in JS. */
function shaderVertex(
  placement: ReturnType<typeof createSpritePlacement>,
  camera: THREE.Matrix3,
  local: THREE.Vector3,
): THREE.Vector3 {
  const transformed = local.clone().multiply(placement.scale);
  if (placement.facesCamera) {
    transformed.applyMatrix3(camera);
  }
  return transformed.applyMatrix4(placement.matrix);
}

it('places a batched billboard where its display turns it, whatever the camera rotation', () => {
  const world = new THREE.Group(),
    root = new THREE.Group(),
    model = new THREE.Group(),
    visual = new THREE.Group();
  world.position.set(1, 0, -2);
  world.quaternion.setFromEuler(new THREE.Euler(0, 0.4, 0));
  world.add(root);
  root.position.set(3, 0.5, 4);
  root.quaternion.setFromEuler(new THREE.Euler(0, -1.1, 0));
  root.scale.setScalar(1.5);
  root.add(model);
  model.position.set(0, 0.25, 0);
  model.add(visual);
  // An archive sprite's visual: SPRITE_SCALE with y flipped, x flipped too for a mirrored facing.
  visual.scale.set(-0.01, -0.01, 0.01);
  const rootRotation = new THREE.Quaternion();
  const camera = new THREE.Matrix3();
  const placement = createSpritePlacement();
  // The display's camera facing (PrefabDisplay.alignVisual): the camera rotation against the root's.
  for (const euler of [new THREE.Euler(-0.8, 0.3, 0), new THREE.Euler(-0.6, 2.4, 0.1)]) {
    const cameraRotation = new THREE.Quaternion().setFromEuler(euler);
    world.updateMatrixWorld(true);
    root.getWorldQuaternion(rootRotation);
    model.quaternion.copy(rootRotation).invert().multiply(cameraRotation);
    world.updateMatrixWorld(true);
    camera.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(cameraRotation));
    placeSprite(placement, model, visual, true);
    expect(placement.facesCamera).toBe(true);
    for (const corner of [new THREE.Vector3(-40, 10, 0), new THREE.Vector3(55, -120, 0)]) {
      const expected = corner.clone().applyMatrix4(visual.matrixWorld);
      const drawn = shaderVertex(placement, camera, corner);
      expect(drawn.distanceTo(expected)).toBeLessThan(1e-9);
    }
  }
});

it('places other sprites, and billboards with a visual offset of their own, by their visual world matrix', () => {
  const root = new THREE.Group(),
    model = new THREE.Group(),
    visual = new THREE.Group();
  root.add(model);
  model.add(visual);
  root.position.set(2, 0, 1);
  // Flat ground art (ResidentSprite.setGround).
  visual.rotation.x = -Math.PI / 2;
  visual.position.y = 0.01;
  root.updateMatrixWorld(true);
  const placement = createSpritePlacement();
  for (const facesCamera of [false, true]) {
    placeSprite(placement, model, visual, facesCamera);
    expect(placement.facesCamera).toBe(false);
    expect(placement.matrix.equals(visual.matrixWorld)).toBe(true);
    expect(placement.scale.toArray()).toEqual([1, 1, 1]);
  }
});
