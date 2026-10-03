import type * as THREE from 'three';

/** Presentation supplied by the UI; placement owns ground coordinates and commits. */
export interface BuildCursor {
    show(text: string, button?: 'left' | 'right'): void;
    hide(): void;
    setPreview(model: THREE.Object3D): void;
    update(): void;
}

/** Headless prefab callers can place without creating DOM or rendering a preview. */
export const HIDDEN_BUILD_CURSOR: BuildCursor = {
    show() {}, hide() {}, setPreview() {}, update() {},
};
