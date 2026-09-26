import * as THREE from 'three';
import type { WorldContext } from './worldContext';

/** Moves a ground hit onto the grid, e.g. `snapToTileCenter` for walls. */
export type BuildCursorSnap = (point: THREE.Vector3) => THREE.Vector3;

export class BuildCursor {
    private readonly element = document.createElement('div');
    private readonly ground: THREE.Object3D;
    private readonly camera: THREE.Camera;
    private readonly renderer: THREE.WebGLRenderer;
    private readonly raycaster = new THREE.Raycaster();
    private readonly pointer = new THREE.Vector2();
    private readonly cameraWorldQuaternion = new THREE.Quaternion();
    private pointerClientX = 0;
    private pointerClientY = 0;
    private hasPointer = false;
    private preview?: THREE.Object3D;
    private previewGroundOffset = 0;
    private snap?: BuildCursorSnap;
    private hasGroundTarget = false;

    constructor(world: WorldContext) {
        this.ground = world.ground;
        this.camera = world.camera;
        this.renderer = world.renderer;
        this.element.className = 'build-cursor-label';
        this.element.hidden = true;
        this.element.setAttribute('aria-hidden', 'true');
        document.body.appendChild(this.element);
        window.addEventListener('pointermove', this.handlePointerMove);
    }

    show(text: string) {
        this.element.textContent = text;
        this.element.hidden = false;
        this.updateLabelPosition();
    }

    hide() {
        this.element.hidden = true;
        this.preview = undefined;
        this.hasGroundTarget = false;
    }

    setPreview(model: THREE.Object3D, groundOffset: number, snap?: BuildCursorSnap) {
        this.preview = model;
        this.previewGroundOffset = groundOffset;
        this.snap = snap;
    }

    trackPointer(event: PointerEvent) {
        this.pointerClientX = event.clientX;
        this.pointerClientY = event.clientY;
        this.hasPointer = true;
    }

    get isOverGround() {
        return this.hasGroundTarget;
    }

    update() {
        this.updateLabelPosition();
        if (!this.preview) return;

        const point = this.groundPointAtPointer();
        this.hasGroundTarget = Boolean(point);
        this.preview.visible = this.hasGroundTarget;
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

    private readonly handlePointerMove = (event: PointerEvent) => {
        this.trackPointer(event);
        this.update();
    };

    private updateLabelPosition() {
        if (this.element.hidden || !this.hasPointer) return;
        this.element.style.left = `${this.pointerClientX}px`;
        this.element.style.top = `${this.pointerClientY}px`;
    }

    private groundPointAtPointer(): THREE.Vector3 | undefined {
        if (!this.hasPointer) return undefined;
        const bounds = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((this.pointerClientX - bounds.left) / bounds.width) * 2 - 1;
        this.pointer.y = -((this.pointerClientY - bounds.top) / bounds.height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);
        this.ground.updateWorldMatrix(true, false);
        const hit = this.raycaster.intersectObject(this.ground, false)[0];
        return hit?.point.clone();
    }
}
