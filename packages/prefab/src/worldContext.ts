import * as THREE from 'three';

/**
 * Everything a prefab needs from the host application to place itself in the
 * running game. The application owns the scene graph, the camera, the renderer
 * and the ground, so prefabs receive them instead of creating their own.
 */
export interface WorldContext {
    scene: THREE.Scene;
    camera: THREE.Camera;
    renderer: THREE.WebGLRenderer;
    ground: THREE.Object3D;
    player: THREE.Object3D;
}

/** The subset a prefab needs to turn raw pointer events into raycasts. */
export type PointerContext = Pick<WorldContext, 'camera' | 'renderer'>;
