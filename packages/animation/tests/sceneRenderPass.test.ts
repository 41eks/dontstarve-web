import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { createSceneRenderSnapshot, registerSceneRenderPass, renderSceneWithPasses } from '../src/sceneRenderPass';

it('captures detached world transforms and render passes without transferring or disposing borrowed assets', () => {
  const world = new THREE.Scene(), parent = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
  const empty = new THREE.BufferGeometry(), child = new THREE.Mesh(empty, mesh.material);
  mesh.add(child);
  world.add(parent); parent.add(mesh); parent.position.set(7, 2, 5); mesh.position.x = 3;
  mesh.onBeforeRender = vi.fn();
  const render = vi.fn(() => { child.geometry = mesh.geometry; });
  const stop = registerSceneRenderPass(mesh, { render, prewarm: async () => {} });
  const geometryDispose = vi.spyOn(mesh.geometry, 'dispose'), materialDispose = vi.spyOn(mesh.material, 'dispose');
  const renderer = { render: () => {} } as unknown as THREE.WebGLRenderer, camera = new THREE.Camera();
  const snapshot = createSceneRenderSnapshot([mesh]);
  try {
    const copy = snapshot.scene.children[0] as THREE.Mesh;
    expect(copy.geometry).toBe(mesh.geometry); expect(copy.material).toBe(mesh.material);
    expect(copy.onBeforeRender).toBe(mesh.onBeforeRender);
    renderSceneWithPasses(renderer, snapshot.scene, camera);
    expect((copy.children[0] as THREE.Mesh).geometry).toBe(mesh.geometry);
    expect(new THREE.Vector3().setFromMatrixPosition(copy.matrixWorld).toArray()).toEqual([10, 2, 5]);
    expect(render).toHaveBeenCalledTimes(1);
    expect(mesh.parent).toBe(parent);
    snapshot.dispose();
    renderSceneWithPasses(renderer, snapshot.scene, camera);
    expect(render).toHaveBeenCalledTimes(1);
    renderSceneWithPasses(renderer, world, camera);
    expect(render).toHaveBeenCalledTimes(2);
    expect(geometryDispose).not.toHaveBeenCalled(); expect(materialDispose).not.toHaveBeenCalled();
  } finally { snapshot.dispose(); stop(); empty.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); }
});

it('selects each registered pass once through visible anchors, following reparenting and replacement', () => {
  const scene = new THREE.Scene(), other = new THREE.Scene(), hidden = new THREE.Group();
  const first = new THREE.Object3D(), second = new THREE.Object3D(), camera = new THREE.PerspectiveCamera();
  scene.add(hidden, second); hidden.add(first); hidden.visible = false;
  const render = vi.fn(), replacement = vi.fn();
  const pass = { render, prewarm: async () => {} };
  const stopFirst = registerSceneRenderPass(first, pass), stopSecond = registerSceneRenderPass(second, pass);
  const traversal = vi.spyOn(scene, 'traverseVisible');
  const renderer = { render: () => {} } as unknown as THREE.WebGLRenderer;
  let stopReplacement = () => {};
  try {
    renderSceneWithPasses(renderer, scene, camera);
    expect(render).toHaveBeenCalledTimes(1);
    expect(traversal).not.toHaveBeenCalled();
    other.add(second);
    renderSceneWithPasses(renderer, scene, camera);
    expect(render).toHaveBeenCalledTimes(1);
    hidden.visible = true;
    renderSceneWithPasses(renderer, scene, camera);
    expect(render).toHaveBeenCalledTimes(2);
    stopReplacement = registerSceneRenderPass(first, { render: replacement, prewarm: async () => {} });
    stopFirst(); // An old registration cannot remove its replacement.
    renderSceneWithPasses(renderer, scene, camera);
    expect(replacement).toHaveBeenCalledTimes(1);
    renderSceneWithPasses(renderer, other, camera);
    expect(render).toHaveBeenCalledTimes(3);
    stopReplacement();
    renderSceneWithPasses(renderer, scene, camera);
    expect(replacement).toHaveBeenCalledTimes(1);
  } finally { stopFirst(); stopSecond(); stopReplacement(); traversal.mockRestore(); }
});

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
  const prepareLighting = () => {
    snapshot();
    return { texture: new THREE.Texture(), extents: new THREE.Vector4(), ambient: new THREE.Vector3() };
  };
  try {
    parent.position.x = 5;
    renderSceneWithPasses(renderer, scene, camera, prepareLighting);
    parent.position.x = 9;
    renderSceneWithPasses(renderer, scene, camera, prepareLighting);
    expect(snapshots).toEqual([[7, -5], [7, -5], [7, -5], [11, -9], [11, -9], [11, -9]]);
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
