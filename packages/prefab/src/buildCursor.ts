import * as THREE from 'three';
import type { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import type { WorldContext } from './worldContext';
import type { PrefabInstance } from './prefabInstance';

import type { CursorLabel } from '@dontstarve-web/stategraphs/actionContext';
export type { CursorLabel } from '@dontstarve-web/stategraphs/actionContext';

export type BuildCursorSnap = (point: THREE.Vector3) => THREE.Vector3;

/** What the cursor moves: a placer's transform, and whether it is shown. */
export interface BuildCursorPlacer {
    readonly position: THREE.Vector3;
    show(shown: boolean): void;
}

/** A placer entity: its owner declares its art (MakePlacer's clip and SetLightOverride(1)); the cursor declares only whether it is shown. */
export function entityPlacer(entity: { readonly position: THREE.Vector3; readonly sprite: { setVisible(visible: boolean): void } }): BuildCursorPlacer {
    return { position: entity.position, show: shown => entity.sprite.setVisible(shown) };
}

/** prefabutil.lua MakePlacer / gridplacer.lua: AddTag("CLASSIFIED"), AddTag("NOCLICK"), AddTag("placer"). */
export const PLACER_TAGS = ['CLASSIFIED', 'NOCLICK', 'placer'] as const;

/**
 * The declarations every placer entity shares: MakePlacer's tags, persists = false and SetLightOverride(1). It starts
 * hidden; the cursor shows it once the pointer is over the ground.
 */
export function declarePlacer(placer: Pick<PrefabInstance, 'addTag' | 'persists'> & {
    readonly sprite: { setLightOverride(value: number | null): void; setVisible(visible: boolean): void };
}): void {
    for (const tag of PLACER_TAGS) placer.addTag(tag);
    placer.persists = false;
    placer.sprite.setLightOverride(1);
    placer.sprite.setVisible(false);
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
        this.preview = undefined;
        this.shown = undefined;
    }

    setPreview(placer: BuildCursorPlacer, groundOffset: number, snap?: BuildCursorSnap): void {
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
