import type * as THREE from 'three';

/** Display-space world lightmap, shared with the ordinary world materials. */
export interface ScenePassLighting {
  readonly texture: THREE.Texture;
  readonly extents: THREE.Vector4;
  readonly ambient: THREE.Vector3;
}

export interface SceneRenderPass {
  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera, lighting?: ScenePassLighting): void;
  prewarm(renderer: THREE.WebGLRenderer, camera: THREE.Camera, signal?: AbortSignal): Promise<void>;
}

const passes = new WeakMap<THREE.Object3D, SceneRenderPass>();

export function registerSceneRenderPass(object: THREE.Object3D, pass: SceneRenderPass): () => void {
  passes.set(object, pass);
  return () => { if (passes.get(object) === pass) passes.delete(object); };
}

function visiblePasses(scene: THREE.Scene): SceneRenderPass[] {
  const result = new Set<SceneRenderPass>();
  scene.traverseVisible(object => { const pass = passes.get(object); if (pass) result.add(pass); });
  return [...result];
}

/** Prepare offscreen inputs before drawing the world that consumes them. */
export function renderScenePasses(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
  lighting?: ScenePassLighting): void {
  scene.updateMatrixWorld();
  camera.updateMatrixWorld();
  for (const pass of visiblePasses(scene)) pass.render(renderer, camera, lighting);
}

export async function prewarmScenePasses(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
  signal?: AbortSignal): Promise<void> {
  scene.updateMatrixWorld();
  camera.updateMatrixWorld();
  for (const pass of visiblePasses(scene)) {
    signal?.throwIfAborted();
    await pass.prewarm(renderer, camera, signal);
  }
}
