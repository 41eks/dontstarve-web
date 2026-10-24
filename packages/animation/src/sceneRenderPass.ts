import * as THREE from 'three';

/** Display-space world lightmap, shared with the ordinary world materials. */
export interface ScenePassLighting {
  readonly texture: THREE.Texture;
  readonly extents: THREE.Vector4;
  readonly ambient: THREE.Vector3;
}

/** Invoked after world matrices settle, before any pass reads world positions. */
export type PrepareSceneLighting = () => ScenePassLighting;

export interface SceneRenderPass {
  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera, lighting?: ScenePassLighting): void;
  prewarm(renderer: THREE.WebGLRenderer, camera: THREE.Camera, signal?: AbortSignal): Promise<void>;
}

interface PassRegistration { object: THREE.Object3D; pass: SceneRenderPass }
const registrations = new WeakMap<THREE.Object3D, PassRegistration>();
const passes = new Map<SceneRenderPass, Set<PassRegistration>>();

/** Detached transforms borrowing the source geometry, materials and render passes.
 * Disposing a snapshot releases only its registrations, never the world's assets.
 */
export function createSceneRenderSnapshot(roots: readonly THREE.Object3D[]): { scene: THREE.Scene; dispose(): void } {
  const scene = new THREE.Scene();
  const cleanups: (() => void)[] = [];
  const borrowed: { source: THREE.Mesh; copy: THREE.Mesh }[] = [];
  const snapshotPasses = new Map<SceneRenderPass, SceneRenderPass>();
  const syncResources = () => {
    for (const { source, copy } of borrowed) { copy.geometry = source.geometry; copy.material = source.material; }
  };
  const snapshotPass = (pass: SceneRenderPass): SceneRenderPass => {
    let result = snapshotPasses.get(pass);
    if (!result) {
      result = {
        render(renderer, camera, lighting) {
          pass.render(renderer, camera, lighting);
          // Passes may replace borrowed geometry (the ocean floor follows its
          // surface here). Refresh before drawing the detached colour scene.
          syncResources();
        },
        async prewarm(renderer, camera, signal) { await pass.prewarm(renderer, camera, signal); syncResources(); },
      };
      snapshotPasses.set(pass, result);
    }
    return result;
  };
  const copy = (source: THREE.Object3D): THREE.Object3D => {
    const object = source.clone(false);
    object.onBeforeRender = source.onBeforeRender;
    object.onAfterRender = source.onAfterRender;
    const registration = registrations.get(source);
    if (registration) cleanups.push(registerSceneRenderPass(object, snapshotPass(registration.pass)));
    if ((source as THREE.Mesh).geometry) borrowed.push({ source: source as THREE.Mesh, copy: object as THREE.Mesh });
    for (const child of source.children) object.add(copy(child));
    return object;
  };
  for (const source of roots) {
    source.updateWorldMatrix(true, true);
    const object = copy(source);
    object.matrix.copy(source.matrixWorld);
    object.matrixAutoUpdate = false;
    scene.add(object);
  }
  return { scene, dispose() { for (const stop of cleanups.splice(0)) stop(); scene.clear(); } };
}

function removeRegistration(registration: PassRegistration): void {
  const anchors = passes.get(registration.pass);
  anchors?.delete(registration);
  if (!anchors?.size) passes.delete(registration.pass);
}

export function registerSceneRenderPass(object: THREE.Object3D, pass: SceneRenderPass): () => void {
  const previous = registrations.get(object);
  if (previous) removeRegistration(previous);
  const registration = { object, pass };
  registrations.set(object, registration);
  let anchors = passes.get(pass);
  if (!anchors) passes.set(pass, anchors = new Set());
  anchors.add(registration);
  return () => {
    if (registrations.get(object) !== registration) return;
    registrations.delete(object);
    removeRegistration(registration);
  };
}

function visiblePasses(scene: THREE.Scene): SceneRenderPass[] {
  const result: SceneRenderPass[] = [];
  // Each pass only needs one visible anchor. Do not traverse every sprite and
  // geometry in the scene just to rediscover the same small set of passes.
  for (const [pass, anchors] of passes) {
    for (const { object } of anchors) {
      let node: THREE.Object3D | null = object;
      while (node?.visible && node !== scene) node = node.parent;
      if (node === scene && scene.visible) { result.push(pass); break; }
    }
  }
  return result;
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
  lighting?: ScenePassLighting | PrepareSceneLighting): void {
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
    const preparedLighting = typeof lighting === 'function' ? lighting() : lighting;
    for (const pass of visiblePasses(scene)) pass.render(renderer, camera, preparedLighting);
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
