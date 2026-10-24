import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { installMatrixGate } from '../src/matrixGate';
import { watchMatrixUpdates } from '../src/matrixUpdates';

it.each(['cache', 'observer'] as const)('shares updates and restores original methods when the %s ends first', first => {
  const scene = new THREE.Scene(), model = new THREE.Group(), visual = new THREE.Group();
  scene.add(model); model.add(visual);
  const original = model.updateMatrixWorld, originalWorld = model.updateWorldMatrix;
  const gate = installMatrixGate(model, visual), observer = vi.fn(), stop = watchMatrixUpdates(model, observer);
  scene.updateMatrixWorld(); scene.updateMatrixWorld();
  expect(observer).toHaveBeenCalledTimes(1);
  if (first === 'cache') gate.dispose(); else stop();
  model.position.x = 6;
  scene.updateMatrixWorld();
  expect(visual.matrixWorld.elements[12]).toBe(6);
  expect(observer).toHaveBeenCalledTimes(first === 'cache' ? 2 : 1);
  gate.dispose(); stop();
  expect(model.updateMatrixWorld).toBe(original);
  expect(model.updateWorldMatrix).toBe(originalWorld);
  const next = vi.fn(), stopNext = watchMatrixUpdates(model, next);
  stop(); // A stale cleanup cannot restore methods over a new owner.
  scene.updateMatrixWorld();
  expect(next).toHaveBeenCalledTimes(1);
  stopNext();
});

it('skips the subtree until it is marked dirty, and never skips a model with extra children', () => {
  const scene = new THREE.Scene(), model = new THREE.Group(), visual = new THREE.Group();
  model.add(visual); scene.add(model);
  const gate = installMatrixGate(model, visual, true);
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

it('shares cached matrices with queries and detects direct model, visual and parent movement', () => {
  const scene = new THREE.Scene(), parent = new THREE.Group(), model = new THREE.Group(), visual = new THREE.Group();
  const mesh = new THREE.Object3D();
  mesh.matrixAutoUpdate = false;
  scene.add(parent); parent.add(model); model.add(visual); visual.add(mesh);
  const original = model.updateMatrixWorld, originalWorld = model.updateWorldMatrix;
  const gate = installMatrixGate(model, visual);
  scene.updateMatrixWorld();
  const renderUpdates = vi.spyOn(visual, 'updateMatrixWorld'), queryUpdates = vi.spyOn(visual, 'updateWorldMatrix');
  try {
    model.updateWorldMatrix(true, true);
    model.getWorldPosition(new THREE.Vector3());
    scene.updateMatrixWorld();
    expect(renderUpdates).not.toHaveBeenCalled();
    expect(queryUpdates).not.toHaveBeenCalled();
    model.position.x = 3;
    model.updateWorldMatrix(true, true);
    expect(mesh.matrixWorld.elements[12]).toBe(3);
    expect(queryUpdates).toHaveBeenCalledTimes(1);
    scene.updateMatrixWorld();
    expect(renderUpdates).not.toHaveBeenCalled();
    visual.position.x = 2;
    scene.updateMatrixWorld();
    expect(mesh.matrixWorld.elements[12]).toBe(5);
    parent.position.x = 7;
    scene.updateMatrixWorld();
    expect(mesh.matrixWorld.elements[12]).toBe(12);
    model.position.x = 4;
    model.updateWorldMatrix(true, false);
    // A shallow query updates the root; rendering still settles its descendants.
    scene.updateMatrixWorld();
    expect(mesh.matrixWorld.elements[12]).toBe(13);
    model.matrixAutoUpdate = false;
    model.matrix.makeTranslation(8, 0, 0);
    scene.updateMatrixWorld();
    expect(mesh.matrixWorld.elements[12]).toBe(17);
  } finally {
    renderUpdates.mockRestore(); queryUpdates.mockRestore(); gate.dispose();
  }
  expect(model.updateMatrixWorld).toBe(original);
  expect(model.updateWorldMatrix).toBe(originalWorld);
});
