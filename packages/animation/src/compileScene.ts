import type * as THREE from 'three';

/**
 * WebGLRenderer.compileAsync for scenes whose materials may be disposed while they compile, as a sprite's private
 * material copies are when it sleeps or stops floating. three's own poll reads the disposed material's dropped program
 * and throws; here such a material simply leaves the wait.
 */
export function compileSceneAsync(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Object3D,
  camera: THREE.Camera,
  targetScene: THREE.Scene | null = null,
): Promise<void> {
  const materials = renderer.compile(scene, camera, targetScene);
  const parallel = renderer.extensions.has('KHR_parallel_shader_compile');
  return new Promise(resolve => {
    const check = () => {
      for (const material of materials) {
        const program = (renderer.properties.get(material) as { currentProgram?: { isReady(): boolean } })
          .currentProgram;
        if (!program || program.isReady()) {
          materials.delete(material);
        }
      }
      if (materials.size === 0) {
        resolve();
      } else {
        setTimeout(check, 10);
      }
    };
    // As compileAsync: without parallel compilation every program is ready once the next task runs.
    if (parallel) {
      check();
    } else {
      setTimeout(check, 10);
    }
  });
}
