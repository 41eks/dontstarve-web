import * as THREE from 'three';
import type { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import type { WorldContext } from './worldContext';
import { prefabInstance } from './prefabInstance';

import type { CursorLabel } from '@dontstarve-web/stategraphs/actionContext';
export type { CursorLabel } from '@dontstarve-web/stategraphs/actionContext';

export type BuildCursorSnap = (point: THREE.Vector3) => THREE.Vector3;

/** DST MakePlacer uses AnimState:SetLightOverride(1): each entity drawn in the preview declares it on its sprite. */
function setPlacerLightOverride(preview: THREE.Object3D, value: number | null): void {
    preview.traverse(node => prefabInstance(node)?.sprite.setLightOverride(value));
}

export class BuildCursor {
    private readonly pointer: PointerRaycaster;
    private readonly label: CursorLabel;
    private preview?: THREE.Object3D;
    private previewGroundOffset = 0;
    private snap?: BuildCursorSnap;

    constructor(world: Pick<WorldContext, 'createCursorLabel'>, pointer: PointerRaycaster) {
        this.pointer = pointer;
        this.label = world.createCursorLabel?.(pointer) ?? { show() {}, hide() {}, update() {} };
    }

    show(text: string, button: 'left' | 'right' = 'left'): void {
        this.label.show(text, button);
    }

    hide(): void {
        this.label.hide();
        if (this.preview) setPlacerLightOverride(this.preview, null);
        this.preview = undefined;
    }

    setPreview(model: THREE.Object3D, groundOffset: number, snap?: BuildCursorSnap): void {
        this.preview = model;
        this.previewGroundOffset = groundOffset;
        this.snap = snap;
        setPlacerLightOverride(model, 1);
    }

    update(): void {
        this.label.update();
        if (!this.preview) return;
        const point = this.pointer.groundPoint();
        this.preview.visible = point !== undefined;
        if (!point) return;
        const target = this.snap ? this.snap(point) : point;
        this.preview.position.set(target.x, target.y + this.previewGroundOffset, target.z);
    }
}
