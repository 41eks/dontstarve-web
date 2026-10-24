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

/** Offscreen inputs and the world share one matrix traversal, including spatial-index updates. */
export function renderSceneWithPasses(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
  lighting?: ScenePassLighting): void {
  scene.updateMatrixWorld();
  // A camera in the scene was already updated with its ancestors above.
  if (camera.parent === null) camera.updateMatrixWorld();
  const sceneAutoUpdate = scene.matrixWorldAutoUpdate;
  const cameraAutoUpdate = camera.matrixWorldAutoUpdate;
  try {
    // The ocean pass also renders with this camera. Only suppress automatic updates
    // for this render sequence; explicit movement/query updates remain available.
    scene.matrixWorldAutoUpdate = false;
    camera.matrixWorldAutoUpdate = false;
    for (const pass of visiblePasses(scene)) pass.render(renderer, camera, lighting);
    renderer.render(scene, camera);
  } finally {
    scene.matrixWorldAutoUpdate = sceneAutoUpdate;
    camera.matrixWorldAutoUpdate = cameraAutoUpdate;
  }
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
