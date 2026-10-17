import * as THREE from 'three';

/** Yield after each small GPU batch so the generating page can keep painting. */
export function yieldLoadingFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

const FRAME_BUDGET_MS = 8;

/** Returns a checkpoint that yields a frame only after the work since the last yield used up the budget. */
function createFrameBudget(signal?: AbortSignal): () => Promise<void> {
  let frameStart = performance.now();
  return async () => {
    signal?.throwIfAborted();
    if (performance.now() - frameStart < FRAME_BUDGET_MS) return;
    await yieldLoadingFrame();
    signal?.throwIfAborted();
    frameStart = performance.now();
  };
}

export async function prewarmScene(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const textures = new Set<THREE.Texture>();
  const objects: THREE.Object3D[] = [];
  const lights: THREE.Object3D[] = [];
  const addTexture = (value: unknown) => {
    if (value instanceof THREE.Texture && !value.isRenderTargetTexture) textures.add(value);
    else if (Array.isArray(value)) value.forEach(addTexture);
  };
  scene.traverseVisible(object => {
    if (object instanceof THREE.Light) lights.push(object);
    const material = (object as THREE.Mesh).material;
    if (!material) return;
    objects.push(object);
    for (const entry of Array.isArray(material) ? material : [material]) {
      Object.values(entry).forEach(addTexture);
      addTexture(entry.userData.prewarmTextures);
      if (entry instanceof THREE.ShaderMaterial) {
        Object.values(entry.uniforms).forEach(uniform => addTexture(uniform.value));
      }
    }
  });
  const checkpoint = createFrameBudget(signal);
  for (const texture of textures) {
    await checkpoint();
    renderer.initTexture(texture);
  }
  const target = renderer.getRenderTarget();
  const staging = target ? new THREE.WebGLRenderTarget(1, 1) : undefined;
  scene.updateMatrixWorld();
  try {
    for (let index = 0; index < objects.length; index += 4) {
      await checkpoint();
      // A shallow view preserves mesh types, world transforms and original parents.
      const batch = new THREE.Scene();
      batch.matrixWorldAutoUpdate = false;
      batch.environment = scene.environment;
      batch.fog = scene.fog;
      batch.children = [...lights, ...objects.slice(index, index + 4)];
      await renderer.compileAsync(batch, camera, scene);
      signal?.throwIfAborted();
      if (staging) {
        // Exercise uniforms and geometry too, even without KHR_parallel_shader_compile.
        // Each batch draws only into a single pixel; the game canvas stays untouched.
        renderer.setRenderTarget(staging);
        try { renderer.render(batch, camera); }
        finally { renderer.setRenderTarget(target); }
      }
    }
  } finally {
    staging?.dispose();
  }
}
