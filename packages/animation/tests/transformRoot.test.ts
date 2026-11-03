import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { ResidentSprite } from '@dontstarve-web/animation/residentSprite';
import { installMatrixGate } from '../src/matrixGate';
import { updateSceneMatrices } from '../src/matrixUpdates';
import { markTransformDirty, TransformRoot } from '../src/transformRoot';

/** A stationary archive sprite, as plants draw: its gate is marked by faceCamera(). */
function stationarySprite() {
  const model = new THREE.Group(), visual = new THREE.Group(), leaf = new THREE.Object3D();
  leaf.matrixAutoUpdate = false;
  model.add(visual); visual.add(leaf);
  const gate = installMatrixGate(model, visual, true);
  const sprite = {
    model, frameCount: 1, currentAnimation: 'idle', update: vi.fn(), start: vi.fn(), playOnce: vi.fn(), setFrame: vi.fn(),
    setPaused: vi.fn(), setFacing: vi.fn(), setAnimation: vi.fn(), setOpacity: vi.fn(), setColour: vi.fn(),
    setBuildArchive: vi.fn(), setSymbolOverride: vi.fn(), setSymbolHidden: vi.fn(), refreshTransform: () => gate.markDirty(),
    faceCamera: (rotation: THREE.Quaternion) => { model.quaternion.copy(rotation); gate.markDirty(); },
    dispose: () => { gate.dispose(); model.removeFromParent(); },
  } as unknown as ArchiveSprite;
  return { sprite, leaf };
}

it('skips a resting root, and updates it after marked writes, facing changes, reparenting and moving ancestors', () => {
  const scene = new THREE.Scene(), ground = new THREE.Group();
  scene.add(ground);
  const { sprite, leaf } = stationarySprite();
  const resident = new ResidentSprite(new TransformRoot(), () => sprite, { name: 'idle', loop: true }, sprite, 'plant');
  const root = resident.model as TransformRoot;
  expect(root).toBeInstanceOf(TransformRoot);
  // A position written before the first frame needs no mark: a new root starts dirty.
  root.position.set(3, 0, 4);
  ground.add(root);
  const visits = vi.spyOn(sprite.model, 'updateMatrixWorld');
  updateSceneMatrices(scene);
  expect(leaf.matrixWorld.elements[12]).toBe(3);
  expect(root.transformDirty).toBe(false);

  visits.mockClear();
  for (let i = 0; i < 3; i++) updateSceneMatrices(scene);
  expect(visits).not.toHaveBeenCalled();

  // An unmarked write is not seen: that is the contract every writer of a static transform follows.
  root.position.x = 5;
  updateSceneMatrices(scene);
  expect(leaf.matrixWorld.elements[12]).toBe(3);
  markTransformDirty(root);
  updateSceneMatrices(scene);
  expect(leaf.matrixWorld.elements[12]).toBe(5);

  // The camera turns: the inner sprite's gate marks the enclosing root.
  const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  resident.faceCamera(turned);
  expect(root.transformDirty).toBe(true);
  updateSceneMatrices(scene);
  const direction = new THREE.Vector3(1, 0, 0).transformDirection(leaf.matrixWorld);
  expect(direction.z).toBeCloseTo(-1);

  // A moving ancestor forces the clean root, as Three's traversal does for any child.
  ground.position.x = 10;
  updateSceneMatrices(scene);
  expect(leaf.matrixWorld.elements[12]).toBe(15);

  // Leaving and re-entering the scene (sleep/wake) marks the root.
  root.removeFromParent(); root.position.x = 1; scene.add(root);
  updateSceneMatrices(scene);
  expect(leaf.matrixWorld.elements[12]).toBe(1);
  resident.dispose();
});

it('updates a root carrying FX every frame and reaches a marked root nested inside a clean one', () => {
  const scene = new THREE.Scene(), outer = new TransformRoot(), inner = new TransformRoot(), leaf = new THREE.Object3D();
  outer.add(new THREE.Object3D());
  scene.add(outer); outer.add(inner); inner.add(leaf);
  updateSceneMatrices(scene);
  // Two children: an FX child may move on its own, so the outer root is no longer skipped.
  const fx = outer.children[0];
  fx.position.x = 2;
  updateSceneMatrices(scene);
  expect(fx.matrixWorld.elements[12]).toBe(2);

  inner.remove(leaf); outer.remove(fx);
  const single = new TransformRoot(), nested = new TransformRoot(), point = new THREE.Object3D();
  scene.add(single); single.add(nested); nested.add(point);
  updateSceneMatrices(scene); updateSceneMatrices(scene);
  expect(single.transformDirty).toBe(false);
  nested.position.y = 7; nested.markTransformDirty();
  expect(single.transformDirty).toBe(true);
  updateSceneMatrices(scene);
  expect(point.matrixWorld.elements[13]).toBe(7);
  // Explicit queries settle a marked root without waiting for the frame.
  single.position.x = 4; single.markTransformDirty();
  point.getWorldPosition(new THREE.Vector3());
  expect(point.matrixWorld.elements[12]).toBe(4);
});
