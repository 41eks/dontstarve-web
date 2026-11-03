import { PrefabDisplayGroup, SpriteResources, type LoadedSpriteSource, type PrefabDisplay } from '@dontstarve-web/display';
import { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import { bindActionCancellation } from '@dontstarve-web/stategraphs/actionEvents';
import * as THREE from 'three';
import { BuildCursor, declarePlacer, entityPlacer } from './buildCursor';
import { createPrefabEntity, type PrefabInstance } from './prefabInstance';
import type { WorldContext } from './worldContext';

/** prefabutil.lua MakePlacer(name, bank, build, anim): what a build's placer draws. */
export interface BuildingPlacerSpec {
    readonly buildLabel: string;
    /** The display's name for the placer's sprites. */
    readonly name: string;
    readonly animation: string;
    /** The source it draws from and the appearance its entity declares before the first draw. */
    art(resources: SpriteResources, skinId?: string): { source: LoadedSpriteSource; initialize?(entity: PrefabInstance): void };
}

/** This project draws placers translucent; MakePlacer itself only sets SetLightOverride(1). */
const PLACER_OPACITY = 0.65;

/**
 * The build flow, apart from the buildings it makes: a separate `<name>_placer` entity that only declares its clip, light
 * override, opacity and whether it is shown; its display draws it. Committing a build consumes the buffered build and
 * hands the position to `place`, which spawns the building itself, never this entity.
 */
export class BuildingPlacer<BuildId extends string> {
    private disposed = false;
    private readonly specs: (buildId: BuildId) => BuildingPlacerSpec;
    private readonly consumeBufferedBuild: (buildId: BuildId) => boolean;
    private readonly place: (buildId: BuildId, position: THREE.Vector3, skinId?: string) => void;
    private readonly actionEvents: WorldContext['actionEvents'];
    private readonly stopActionEvents: () => void;
    private readonly stopPlacerGate?: () => void;
    private readonly ownsPointer: boolean;
    private readonly canvas: HTMLCanvasElement;
    private readonly camera: THREE.Camera;
    private readonly ground: THREE.Object3D;
    private readonly player: THREE.Object3D;
    private readonly pointer: PointerRaycaster;
    private readonly cursor: BuildCursor;
    private readonly displays: PrefabDisplayGroup;
    /** Placers are made translucent through their materials, so they draw from resources apart from the buildings'. */
    private readonly sprites = new SpriteResources();
    private placer?: { buildId: BuildId; skinId?: string; instance: PrefabInstance; display: PrefabDisplay };

    constructor(
        world: WorldContext,
        specs: (buildId: BuildId) => BuildingPlacerSpec,
        consumeBufferedBuild: (buildId: BuildId) => boolean,
        place: (buildId: BuildId, position: THREE.Vector3, skinId?: string) => void,
    ) {
        this.specs = specs;
        this.consumeBufferedBuild = consumeBufferedBuild;
        this.place = place;
        this.actionEvents = world.actionEvents;
        this.stopActionEvents = bindActionCancellation(world, this, () => this.cancel(), reason => reason === 'emote');
        this.canvas = world.renderer.domElement;
        this.camera = world.camera;
        this.ground = world.ground;
        this.player = world.player;
        this.displays = new PrefabDisplayGroup(world.scene);
        this.ownsPointer = !world.mouseActions?.pointer;
        this.pointer = world.mouseActions?.pointer ?? new PointerRaycaster(world);
        this.cursor = new BuildCursor(world, this.pointer);
        // Action controllers see no mouse action while the placer is shown, so the click reaches the placer.
        this.stopPlacerGate = world.mouseActions?.registerPlacer(() => this.placer !== undefined);
        this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    }

    /** Shows the placer at once; its display draws the preview when its art has loaded. */
    begin(buildId: BuildId, skinId?: string): void {
        if (this.disposed) throw new Error('Placement has been disposed');
        if (this.placer) return;
        const spec = this.specs(buildId), art = spec.art(this.sprites, skinId);
        // MakePlacer: PlayAnimation(anim, true) with the shared placer declarations.
        const { instance, display } = createPrefabEntity(`${buildId}_placer`, art.source,
            { name: spec.animation, billboard: true }, `${spec.name}Placer`, entity => {
                art.initialize?.(entity);
                declarePlacer(entity);
                entity.sprite.setOpacity(PLACER_OPACITY);
            }, undefined, { alignBottom: true });
        this.displays.mount(display);
        this.actionEvents?.emit('action:begin', { owner: this, action: 'BUILD' });
        this.cursor.show(`: 建造 ${spec.buildLabel}`, 'left');
        this.placer = { buildId, skinId, instance, display };
        this.cursor.setPreview(entityPlacer(instance), 0);
        this.cursor.update();
    }

    /** Cancel only the placer; its display stops any load it started. The buffered build stays in inventory. */
    cancel(): void {
        if (this.placer) { this.placer.instance.remove(); this.placer.display.dispose(); }
        this.placer = undefined;
        this.cursor.hide();
    }

    /** The display advances the placer's clip, and the placer follows the pointer. */
    update(dt: number): void {
        this.displays.update(dt);
        this.cursor.update();
    }

    /** The placer's sprite and its ground-contact point for depth sorting. */
    get renderEntities() {
        const model = this.placer?.display.model;
        return model?.visible ? [{ object: model, footPosition: model.position, cameraDepth: 0, sortLayer: 1 }] : [];
    }

    /** Where a debug spawn puts a building: on the ground ahead of the player, along the camera's direction. */
    groundInFrontOfPlayer(): THREE.Vector3 {
        const direction = new THREE.Vector3();
        this.camera.getWorldDirection(direction);
        direction.y = 0;
        if (direction.lengthSq() === 0) direction.set(0, 0, 1);
        else direction.normalize();
        const target = this.player.position.clone().addScaledVector(direction, 10);
        const rayOrigin = new THREE.Vector3(target.x, target.y + 1000, target.z);
        const hit = this.pointer.raycast(rayOrigin, new THREE.Vector3(0, -1, 0), this.ground);
        if (hit) return hit.point.clone();
        target.y = 0;
        return target;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.stopActionEvents();
        this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
        this.stopPlacerGate?.();
        if (this.ownsPointer) this.pointer.dispose();
        this.cancel();
        this.displays.dispose();
        this.sprites.dispose();
    }

    private readonly handlePointerDown = (event: PointerEvent) => {
        if (event.button === 2) {
            this.cancel();
            return;
        }
        if (event.button !== 0 || event.defaultPrevented || !this.placer) return;
        event.preventDefault();
        this.commit(event);
    };

    /** Commits the build at the placer's position: the building is spawned afresh and the placer released. */
    private commit(event: PointerEvent): void {
        const placer = this.placer;
        if (!placer) return;
        this.pointer.trackPointer(event);
        this.cursor.update();
        if (!this.pointer.isOverGround || !this.consumeBufferedBuild(placer.buildId)) return;
        const position = placer.instance.position.clone();
        this.cancel();
        this.place(placer.buildId, position, placer.skinId);
    }
}
