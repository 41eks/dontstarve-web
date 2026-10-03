import * as THREE from 'three';
import type { PointerRaycaster } from './pointerRaycaster';
import type { WorldContext } from './worldContext';
import { setPrefabLightOverride } from './localLight';

/** UI-owned presentation; the placer never creates DOM. */
export interface CursorLabel {
    show(text: string, button?: 'left' | 'right'): void;
    hide(): void;
    update(): void;
}

export type BuildCursorSnap = (point: THREE.Vector3) => THREE.Vector3;

export class BuildCursor {
    private readonly camera: THREE.Camera;
    private readonly pointer: PointerRaycaster;
    private readonly label: CursorLabel;
    private readonly cameraWorldQuaternion = new THREE.Quaternion();
    private preview?: THREE.Object3D;
    private previewGroundOffset = 0;
    private snap?: BuildCursorSnap;

    constructor(world: Pick<WorldContext, 'camera' | 'createCursorLabel'>, pointer: PointerRaycaster) {
        this.camera = world.camera;
        this.pointer = pointer;
        this.label = world.createCursorLabel?.(pointer) ?? { show() {}, hide() {}, update() {} };
    }

    show(text: string, button: 'left' | 'right' = 'left'): void {
        this.label.show(text, button);
    }

    hide(): void {
        this.label.hide();
        if (this.preview) setPrefabLightOverride(this.preview, null);
        this.preview = undefined;
    }

    setPreview(model: THREE.Object3D, groundOffset: number, snap?: BuildCursorSnap): void {
        this.preview = model;
        this.previewGroundOffset = groundOffset;
        this.snap = snap;
        // DST MakePlacer uses AnimState:SetLightOverride(1).
        setPrefabLightOverride(model, 1);
    }

    update(): void {
        this.label.update();
        if (!this.preview) return;
        const point = this.pointer.groundPoint();
        this.preview.visible = point !== undefined;
        if (!point) return;
        const target = this.snap ? this.snap(point) : point;
        this.preview.position.set(target.x, target.y + this.previewGroundOffset, target.z);
        this.camera.getWorldQuaternion(this.cameraWorldQuaternion);
        this.preview.quaternion.copy(this.cameraWorldQuaternion);
    }
}
