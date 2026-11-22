import * as THREE from 'three';
import { compileSceneAsync } from '@dontstarve-web/animation/compileScene';

/** Yield after each small GPU batch so the generating page can keep painting. */
export function yieldLoadingFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

const FRAME_BUDGET_MS = 8;

/** Resolves once the renderer's context is usable again, rejecting if `signal` aborts first. */
function contextRestored(renderer: THREE.WebGLRenderer, signal?: AbortSignal): Promise<void> {
  const canvas = renderer.domElement;
  return new Promise((resolve, reject) => {
    if (!renderer.getContext().isContextLost()) {
      resolve();
      return;
    }
    const done = () => {
      canvas.removeEventListener('webglcontextrestored', onRestored);
      signal?.removeEventListener('abort', onAbort);
    };
    const onRestored = () => {
      done();
      resolve();
    };
    const onAbort = () => {
      done();
      reject(signal!.reason);
    };
    canvas.addEventListener('webglcontextrestored', onRestored);
    signal?.addEventListener('abort', onAbort);
  });
}

/**
 * Runs a GPU prewarm again after the WebGL context is lost and restored while it runs. A GPU reset during loading
 * makes compiles against the lost context throw (three.js reads a null shader precision); the game keeps loading
 * once the browser restores the context instead of failing to start. Other errors and aborts propagate.
 */
export async function prewarmThroughContextLoss(
  renderer: THREE.WebGLRenderer,
  prewarm: () => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const canvas = renderer.domElement;
  for (;;) {
    let lost = renderer.getContext().isContextLost();
    const onLost = () => {
      lost = true;
    };
    canvas.addEventListener('webglcontextlost', onLost);
    try {
      if (!lost) {
        await prewarm();
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (!lost && !renderer.getContext().isContextLost()) {
        throw error;
      }
    } finally {
      canvas.removeEventListener('webglcontextlost', onLost);
    }
    if (!lost && !renderer.getContext().isContextLost()) {
      return;
    }
    console.warn('WebGL context lost while preparing the scene; preparing again once it is restored');
    await contextRestored(renderer, signal);
  }
}

/** Returns a checkpoint that yields a frame only after the work since the last yield used up the budget. */
function createFrameBudget(signal?: AbortSignal): () => Promise<void> {
  let frameStart = performance.now();
  return async () => {
    signal?.throwIfAborted();
    if (performance.now() - frameStart < FRAME_BUDGET_MS) {
      return;
    }
    await yieldLoadingFrame();
    signal?.throwIfAborted();
    frameStart = performance.now();
  };
}

export async function prewarmScene(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const textures = new Set<THREE.Texture>();
  const objects: THREE.Object3D[] = [];
  const lights: THREE.Object3D[] = [];
  const addTexture = (value: unknown) => {
    if (value instanceof THREE.Texture && !value.isRenderTargetTexture) {
      textures.add(value);
    } else if (Array.isArray(value)) {
      value.forEach(addTexture);
    }
  };
  scene.traverseVisible(object => {
    if (object instanceof THREE.Light) {
      lights.push(object);
    }
    if (!('material' in object)) {
      return;
    }
    const { material } = object;
    if (!material) {
      return;
    }
    objects.push(object);
    for (const entry of Array.isArray(material) ? material : [material]) {
      if (!(entry instanceof THREE.Material)) {
        continue;
      }
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
      await compileSceneAsync(renderer, batch, camera, scene);
      signal?.throwIfAborted();
      if (staging) {
        // Exercise uniforms and geometry too, even without KHR_parallel_shader_compile.
        // Each batch draws only into a single pixel; the game canvas stays untouched.
        renderer.setRenderTarget(staging);
        try {
          renderer.render(batch, camera);
        } finally {
          renderer.setRenderTarget(target);
        }
      }
    }
  } finally {
    staging?.dispose();
  }
}
