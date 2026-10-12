import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prewarmScene } from '../../../src/prewarmScene';

beforeEach(() => vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
  queueMicrotask(() => callback(0));
  return 1;
}));
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const scene = new THREE.Scene();
  const parent = new THREE.Group();
  parent.position.x = 12;
  scene.add(parent, new THREE.AmbientLight());
  const texture = new THREE.Texture();
  const atlas = new THREE.Texture();
  const material = new THREE.MeshBasicMaterial({ map: texture });
  material.userData.prewarmTextures = [atlas];
  const meshes = Array.from({ length: 9 }, () => new THREE.Mesh(new THREE.PlaneGeometry(), material));
  parent.add(...meshes);
  const target = new THREE.WebGLRenderTarget(64, 64);
  let current: THREE.WebGLRenderTarget | null = target;
  const renderer = {
    initTexture: vi.fn(),
    getRenderTarget: () => current,
    setRenderTarget: (next: THREE.WebGLRenderTarget | null) => { current = next; },
    compileAsync: vi.fn(async () => undefined),
    render: vi.fn(() => { expect(current?.width).toBe(1); expect(current?.height).toBe(1); }),
  };
  return { scene, parent, texture, atlas, meshes, target, renderer };
}

it('uploads shared/custom textures once, warms small batches and preserves parents and world transforms', async () => {
  const s = setup();
  await prewarmScene(s.renderer as unknown as THREE.WebGLRenderer, s.scene, new THREE.Camera());
  expect(s.renderer.initTexture.mock.calls).toEqual([[s.texture], [s.atlas]]);
  expect(s.renderer.compileAsync).toHaveBeenCalledTimes(3);
  expect(s.renderer.render).toHaveBeenCalledTimes(3);
  expect(s.renderer.getRenderTarget()).toBe(s.target);
  expect(s.parent.children).toEqual(s.meshes);
  for (const mesh of s.meshes) {
    expect(mesh.parent).toBe(s.parent);
    expect(mesh.matrixWorld.elements[12]).toBe(12);
  }
});

it('stops later batches on cancellation without drawing or changing the render target', async () => {
  const s = setup();
  const controller = new AbortController();
  s.renderer.compileAsync.mockImplementationOnce(async () => { controller.abort(); });
  await expect(prewarmScene(s.renderer as unknown as THREE.WebGLRenderer, s.scene, new THREE.Camera(), controller.signal))
    .rejects.toThrow();
  expect(s.renderer.compileAsync).toHaveBeenCalledOnce();
  expect(s.renderer.render).not.toHaveBeenCalled();
  expect(s.renderer.getRenderTarget()).toBe(s.target);
  expect(s.meshes.every(mesh => mesh.parent === s.parent)).toBe(true);
});
