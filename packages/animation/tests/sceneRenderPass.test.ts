import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { registerSceneRenderPass, renderSceneWithPasses } from '../src/sceneRenderPass';

it('updates nested transforms before both passes and drawing on consecutive frames', () => {
  const scene = new THREE.Scene();
  const parent = new THREE.Group();
  const model = new THREE.Object3D();
  const camera = new THREE.PerspectiveCamera();
  scene.add(parent);
  parent.add(model, camera);
  model.position.x = 2;
  camera.position.z = 10;
  const modelUpdate = vi.spyOn(model, 'updateMatrixWorld');
  const cameraUpdate = vi.spyOn(camera, 'updateMatrixWorld');
  const snapshots: number[][] = [];
  const snapshot = () => {
    expect(scene.matrixWorldAutoUpdate).toBe(false);
    expect(camera.matrixWorldAutoUpdate).toBe(false);
    snapshots.push([model.matrixWorld.elements[12], camera.matrixWorldInverse.elements[12]]);
  };
  const renderer = { render: snapshot } as unknown as THREE.WebGLRenderer;
  const unregister = registerSceneRenderPass(model, { render: snapshot, prewarm: async () => {} });
  try {
    parent.position.x = 5;
    renderSceneWithPasses(renderer, scene, camera);
    parent.position.x = 9;
    renderSceneWithPasses(renderer, scene, camera);
    expect(snapshots).toEqual([[7, -5], [7, -5], [11, -9], [11, -9]]);
    expect(modelUpdate).toHaveBeenCalledTimes(2);
    expect(cameraUpdate).toHaveBeenCalledTimes(2);
    expect(scene.matrixWorldAutoUpdate).toBe(true);
    expect(camera.matrixWorldAutoUpdate).toBe(true);
  } finally { unregister(); }
});

it.each(['pass', 'world'] as const)('restores automatic-update settings when the %s render throws', stage => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  // Preserve deliberately disabled settings as well as the default enabled ones.
  camera.matrixWorldAutoUpdate = false;
  const failure = new Error('render failed');
  const renderer = { render: () => { throw failure; } } as unknown as THREE.WebGLRenderer;
  const unregister = registerSceneRenderPass(scene, {
    render: () => { if (stage === 'pass') throw failure; },
    prewarm: async () => {},
  });
  try {
    expect(() => renderSceneWithPasses(renderer, scene, camera)).toThrow(failure);
    expect(scene.matrixWorldAutoUpdate).toBe(true);
    expect(camera.matrixWorldAutoUpdate).toBe(false);
  } finally { unregister(); }
});
