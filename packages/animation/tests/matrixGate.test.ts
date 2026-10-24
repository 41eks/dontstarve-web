import * as THREE from 'three';
import { expect, it } from 'vitest';
import { installMatrixGate } from '../src/matrixGate';

it('skips the subtree until it is marked dirty, and never skips a model with extra children', () => {
  const scene = new THREE.Scene(), model = new THREE.Group(), visual = new THREE.Group();
  model.add(visual); scene.add(model);
  const gate = installMatrixGate(model, visual);
  let visits = 0;
  const original = visual.updateMatrixWorld;
  visual.updateMatrixWorld = function (force) { visits++; original.call(this, force); };

  // Created dirty, so a position assigned right after creation is picked up by the first frame.
  model.position.set(3, 0, 4);
  scene.updateMatrixWorld();
  expect(visits).toBe(1);
  expect(visual.matrixWorld.elements[12]).toBe(3);

  scene.updateMatrixWorld();
  scene.updateMatrixWorld();
  expect(visits).toBe(1);

  model.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), .5);
  gate.markDirty();
  scene.updateMatrixWorld();
  expect(visits).toBe(2);

  // An extra child (an effect attached by a prefab) disables the shortcut.
  model.add(new THREE.Object3D());
  scene.updateMatrixWorld();
  scene.updateMatrixWorld();
  expect(visits).toBe(4);

  gate.dispose();
});
