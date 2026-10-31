import * as THREE from 'three';
import type { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import type { WorldContext } from './worldContext';
import { prefabInstance } from './prefabInstance';

import type { CursorLabel } from '@dontstarve-web/stategraphs/actionContext';
export type { CursorLabel } from '@dontstarve-web/stategraphs/actionContext';

export type BuildCursorSnap = (point: THREE.Vector3) => THREE.Vector3;

/** What the cursor moves: a placer's transform, and whether it is shown. */
export interface BuildCursorPlacer {
    readonly position: THREE.Vector3;
    show(shown: boolean): void;
    release?(): void;
}

/** A placer entity: its owner declares its art (MakePlacer's clip and SetLightOverride(1)); the cursor declares only whether it is shown. */
export function entityPlacer(entity: { readonly position: THREE.Vector3; readonly sprite: { setVisible(visible: boolean): void } }): BuildCursorPlacer {
    return { position: entity.position, show: shown => entity.sprite.setVisible(shown) };
}

/**
 * Compatibility bridge for walls, fences and the dock kit, whose preview model still becomes the placed entity: the
 * cursor declares MakePlacer's SetLightOverride(1) on each entity in the model and shows the model itself.
 */
export function modelPlacer(model: THREE.Object3D): BuildCursorPlacer {
    const lightOverride = (value: number | null) => model.traverse(node => prefabInstance(node)?.sprite.setLightOverride(value));
    lightOverride(1);
    return { position: model.position, show: shown => { model.visible = shown; }, release: () => lightOverride(null) };
}

/** The cursor label and the placer that follows the pointer's ground point. */
export class BuildCursor {
    private readonly pointer: PointerRaycaster;
    private readonly label: CursorLabel;
    private preview?: BuildCursorPlacer;
    private previewGroundOffset = 0;
    private shown?: boolean;
    private snap?: BuildCursorSnap;

    constructor(world: Pick<WorldContext, 'createCursorLabel'>, pointer: PointerRaycaster) {
        this.pointer = pointer;
        this.label = world.createCursorLabel?.(pointer) ?? { show() {}, hide() {}, update() {} };
    }

    /** Whether the placer was last declared shown: the pointer was over the ground. */
    get previewVisible(): boolean { return this.shown === true; }

    show(text: string, button: 'left' | 'right' = 'left'): void {
        this.label.show(text, button);
    }

    hide(): void {
        this.label.hide();
        this.preview?.release?.();
        this.preview = undefined;
        this.shown = undefined;
    }

    setPreview(placer: BuildCursorPlacer, groundOffset: number, snap?: BuildCursorSnap): void {
        this.preview?.release?.();
        this.preview = placer;
        this.previewGroundOffset = groundOffset;
        this.snap = snap;
        this.shown = undefined;
    }

    update(): void {
        this.label.update();
        if (!this.preview) return;
        const point = this.pointer.groundPoint();
        const shown = point !== undefined;
        if (shown !== this.shown) this.preview.show(this.shown = shown);
        if (!point) return;
        const target = this.snap ? this.snap(point) : point;
        this.preview.position.set(target.x, target.y + this.previewGroundOffset, target.z);
    }
}
