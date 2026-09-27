import * as THREE from 'three';
import type { PointerRaycaster } from './pointerRaycaster';
import type { WorldContext } from './worldContext';

/** Moves a ground hit onto the grid, e.g. `snapToTileCenter` for walls. */
export type BuildCursorSnap = (point: THREE.Vector3) => THREE.Vector3;

export class BuildCursor {
    private readonly element = document.createElement('div');
    private readonly camera: THREE.Camera;
    private readonly pointer: PointerRaycaster;
    private readonly cameraWorldQuaternion = new THREE.Quaternion();
    private preview?: THREE.Object3D;
    private previewGroundOffset = 0;
    private snap?: BuildCursorSnap;

    constructor(
        world: Pick<WorldContext, 'camera'>,
        pointer: PointerRaycaster,
    ) {
        this.camera = world.camera;
        this.pointer = pointer;
        this.element.className = 'build-cursor-label';
        this.element.hidden = true;
        this.element.setAttribute('aria-hidden', 'true');
        document.body.appendChild(this.element);
    }

    show(text: string) {
        this.element.textContent = text;
        this.element.hidden = false;
        this.updateLabelPosition();
    }

    hide() {
        this.element.hidden = true;
        this.preview = undefined;
    }

    setPreview(model: THREE.Object3D, groundOffset: number, snap?: BuildCursorSnap) {
        this.preview = model;
        this.previewGroundOffset = groundOffset;
        this.snap = snap;
    }

    update() {
        this.updateLabelPosition();
        if (!this.preview) return;

        const point = this.pointer.groundPoint();
        this.preview.visible = point !== undefined;
        if (!point) return;

        const target = this.snap ? this.snap(point) : point;
        this.preview.position.set(
            target.x,
            target.y + this.previewGroundOffset,
            target.z,
        );
        this.camera.getWorldQuaternion(this.cameraWorldQuaternion);
        this.preview.quaternion.copy(this.cameraWorldQuaternion);
    }

    private updateLabelPosition() {
        if (this.element.hidden || !this.pointer.hasPointer) return;
        this.element.style.left = `${this.pointer.pointerClientX}px`;
        this.element.style.top = `${this.pointer.pointerClientY}px`;
    }
}
