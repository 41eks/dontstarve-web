import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prewarmScene, prewarmThroughContextLoss } from '../src/prewarmScene';

beforeEach(() =>
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0));
    return 1;
  }),
);
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
    setRenderTarget: (next: THREE.WebGLRenderTarget | null) => {
      current = next;
    },
    // compileSceneAsync: compile, then wait for each program (ready at once without parallel compilation).
    compile: vi.fn((): Set<THREE.Material> => new Set()),
    extensions: { has: () => false },
    properties: { get: () => ({}) },
    render: vi.fn(() => {
      expect(current?.width).toBe(1);
      expect(current?.height).toBe(1);
    }),
  };
  return { scene, parent, texture, atlas, meshes, target, renderer };
}

it('uploads shared/custom textures once, warms small batches and preserves parents and world transforms', async () => {
  const s = setup();
  await prewarmScene(s.renderer as unknown as THREE.WebGLRenderer, s.scene, new THREE.Camera());
  expect(s.renderer.initTexture.mock.calls).toEqual([[s.texture], [s.atlas]]);
  expect(s.renderer.compile).toHaveBeenCalledTimes(3);
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
  s.renderer.compile.mockImplementationOnce(() => {
    controller.abort();
    return new Set();
  });
  await expect(
    prewarmScene(s.renderer as unknown as THREE.WebGLRenderer, s.scene, new THREE.Camera(), controller.signal),
  ).rejects.toThrow();
  expect(s.renderer.compile).toHaveBeenCalledOnce();
  expect(s.renderer.render).not.toHaveBeenCalled();
  expect(s.renderer.getRenderTarget()).toBe(s.target);
  expect(s.meshes.every(mesh => mesh.parent === s.parent)).toBe(true);
});

it('prepares the scene again after a context lost during loading is restored, and still fails on other errors', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const canvas = new EventTarget();
  let lost = false;
  const renderer = {
    domElement: canvas,
    getContext: () => ({ isContextLost: () => lost }),
  } as unknown as THREE.WebGLRenderer;
  let runs = 0;
  // The first run loses the context halfway; compiling then throws as three.js does on a lost context.
  const prewarm = vi.fn(async () => {
    runs++;
    if (runs === 1) {
      lost = true;
      canvas.dispatchEvent(new Event('webglcontextlost'));
      throw new TypeError("Cannot read properties of null (reading 'precision')");
    }
  });
  let settled = false;
  const preparing = prewarmThroughContextLoss(renderer, prewarm).then(() => {
    settled = true;
  });
  await new Promise(resolve => setTimeout(resolve));
  // Loading waits on the lost context instead of failing the game start.
  expect(settled).toBe(false);
  expect(prewarm).toHaveBeenCalledOnce();
  lost = false;
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  await preparing;
  expect(prewarm).toHaveBeenCalledTimes(2);

  const failure = new Error('missing build');
  await expect(prewarmThroughContextLoss(renderer, () => Promise.reject(failure))).rejects.toBe(failure);
  const aborted = new AbortController();
  lost = true;
  const waiting = prewarmThroughContextLoss(renderer, prewarm, aborted.signal);
  aborted.abort(new Error('scene disposed'));
  await expect(waiting).rejects.toThrow('scene disposed');
});
