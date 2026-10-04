import * as THREE from 'three';
import { disposeSprite } from './disposeSprite';
import {
    createStaticSprite,
    type StaticSpriteController,
} from '@three-roaming/animation/wallSprite';
import { BuildCursor } from './buildCursor';
import { PointerRaycaster } from './pointerRaycaster';
import { snapToWallSlotCenter } from './tile';
import type { WorldContext } from './worldContext';
import { newEntityId, saveGroundPosition, type PlacementSaveRecord, type PlacedEntitySaveRecord } from './saveRecord';
import type { HammerTarget } from './hammer';

export interface WallDefinition {
    archive: string;
    /**
     * Anim archive supplying the `half` pose and `half_hit` feedback. Defaults
     * to the shared `wall.zip`; `wall_dreadstone` ships its own bank.
     */
    animationArchive?: string;
    buildLabel: string;
    /**
     * Front face art for cardinal camera headings (0/90/180/270), where the
     * wall's `facing=15` animations are used, e.g. `14` for `wall_segment-14`.
     */
    frontImageIndex: number;
    /**
     * DST `AnimState:SetMultColour` RGB triple, e.g. hay walls are drawn
     * slightly dark with `[0.9, 0.9, 0.9]`.
     */
    multColour?: readonly number[];
    name: string;
    /**
     * Symbol stacked over the main one. `wall_dreadstone` draws
     * `wall_segment_red` over `wall_segment_base`.
     */
    overlay?: {
        symbol: string;
        frontImageIndex: number;
        sideImageIndex: number;
    };
    scale: number;
    /**
     * Oblique side art for diagonal camera headings (45/135/225/315), where the
     * wall's `facing=240` animations are used, e.g. `4` for `wall_segment-4`.
     */
    sideImageIndex: number;
    /** Symbol the images belong to; defaults to the build's only symbol. */
    symbol?: string;
}

interface WallInstance<BuildId extends string> {
    buildId: BuildId;
    model: THREE.Group;
    animation: StaticSpriteController;
    groundOffset: number;
}

const HEADING_STEP = 45;

function snapToWallSlot(point: THREE.Vector3): THREE.Vector3 {
    const snapped = snapToWallSlotCenter(point);
    return point.set(snapped.x, point.y, snapped.z);
}

/**
 * Places wall prefabs. A wall build archive ships no anim.bin, so its model is a
 * single build image instead of the animated sprite used by
 * `AnimatedBuildingPlacement`.
 */
export class WallPlacement<BuildId extends string> {
    private disposed = false;
    private readonly canvas: HTMLCanvasElement;
    private readonly scene: THREE.Scene;
    private readonly camera: THREE.Camera;
    private readonly ground: THREE.Object3D;
    private readonly player: THREE.Object3D;
    private readonly definitions: Readonly<Record<BuildId, WallDefinition>>;
    private readonly consumeBufferedBuild: (buildId: BuildId) => boolean;
    private readonly cursor: BuildCursor;
    private readonly pointer: PointerRaycaster;
    private active?: WallInstance<BuildId>;
    private loading?: Promise<void>;
    private previewVersion = 0;
    private readonly placed: WallInstance<BuildId>[] = [];
    private readonly cameraWorldQuaternion = new THREE.Quaternion();
    private readonly cameraDirection = new THREE.Vector3();

    constructor(
        world: WorldContext,
        definitions: Readonly<Record<BuildId, WallDefinition>>,
        consumeBufferedBuild: (buildId: BuildId) => boolean,
    ) {
        this.canvas = world.renderer.domElement;
        this.scene = world.scene;
        this.camera = world.camera;
        this.ground = world.ground;
        this.player = world.player;
        this.definitions = definitions;
        this.consumeBufferedBuild = consumeBufferedBuild;
        this.pointer = new PointerRaycaster(world);
        this.cursor = new BuildCursor(world, this.pointer);
        world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    }

    begin(buildId: BuildId): Promise<void> {
        if (this.disposed) return Promise.reject(new Error('Placement has been disposed'));
        if (this.active) return Promise.resolve();
        if (this.loading) return this.loading;

        this.cursor.show(`: 建造 ${this.definitions[buildId].buildLabel}`, 'left');
        const previewVersion = ++this.previewVersion;
        const request = this.createPreview(buildId, previewVersion)
            .catch((error: unknown) => {
                if (previewVersion === this.previewVersion) this.cursor.hide();
                throw error;
            })
            .finally(() => {
                if (this.loading === request) this.loading = undefined;
            });
        this.loading = request;
        return request;
    }

    async spawn(buildId: BuildId): Promise<void> {
        const wall = await this.createInstance(buildId);
        const target = this.playerFrontGroundPosition();
        wall.model.position.set(
            target.x,
            target.y + wall.groundOffset,
            target.z,
        );
        wall.model.visible = true;
        this.setOpacity(wall.model, 1);
        this.faceCamera(wall.model);
        this.placed.push(wall);
    }

    async spawnFromSave(buildId: BuildId, record: PlacementSaveRecord): Promise<THREE.Group> {
        const wall = await this.createInstance(buildId, false);
        wall.model.userData.entityId = record.id;
        wall.model.userData.saveRecord = record;
        const [x, y, z] = record.transform.position;
        wall.model.position.set(x, y + wall.groundOffset, z);
        this.faceCamera(wall.model);
        this.scene.add(wall.model);
        this.placed.push(wall);
        return wall.model;
    }

    get renderEntities() {
        return [...this.placed, ...(this.active ? [this.active] : [])]
            .filter(({ model }) => model.visible)
            .map(({ model, groundOffset }) => ({
                object: model,
                footPosition: model.position.clone().add(new THREE.Vector3(0, -groundOffset, 0)),
                cameraDepth: 0,
            }));
    }

    get hammerTargets(): readonly HammerTarget[] {
        return this.placed.map((wall) => ({
            id: String(wall.model.userData.entityId), model: wall.model,
            position: wall.model.position.clone().add(new THREE.Vector3(0, -wall.groundOffset, 0)),
            isValid: () => wall.model.visible && wall.model.parent !== null,
            // This project displays the constructed wall's half pose; no health is changed.
            playHit: () => wall.animation.playTransient('half_hit'),
        }));
    }

    exportRecords(): PlacedEntitySaveRecord[] {
        return this.placed.map((wall) => {
            const health = (wall.model.userData.saveRecord as PlacementSaveRecord | undefined)?.components.health;
            return {
                prefabId: wall.buildId,
                record: {
                    id: wall.model.userData.entityId as string,
                    transform: {
                        position: saveGroundPosition(wall.model.position, wall.groundOffset),
                        rotationY: 0,
                    },
                    components: health ? { health: { ...health } } : {},
                },
            };
        });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
        this.pointer.dispose();
        this.cancel();
        for (const instance of this.placed) disposeSprite(instance.model);
        this.placed.length = 0;
    }

    cancel() {
        this.previewVersion += 1;
        this.loading = undefined;
        if (this.active) disposeSprite(this.active.model);
        this.active = undefined;
        this.cursor.hide();
    }

    update(dt = 0) {
        this.cursor.update();
        const showFront = !this.isDiagonalHeading();
        if (this.active) this.updateFacing(this.active, showFront);
        for (const wall of this.placed) {
            this.faceCamera(wall.model);
            this.updateFacing(wall, showFront);
            wall.animation.update(dt);
        }
    }

    private readonly handlePointerDown = (event: PointerEvent) => {
        if (event.button === 2) {
            this.cancel();
            return;
        }
        if (event.button !== 0 || event.defaultPrevented) return;
        if (this.loading || this.active) event.preventDefault();
        if (!this.active) return;
        this.pointer.trackPointer(event);
        this.cursor.update();
        if (!this.pointer.isOverGround || !this.consumeBufferedBuild(this.active.buildId)) return;

        const placedWall = this.active;
        placedWall.model.visible = true;
        this.setOpacity(placedWall.model, 1);
        this.placed.push(placedWall);
        this.active = undefined;
        this.cursor.hide();
    };

    private async createPreview(buildId: BuildId, previewVersion: number) {
        const instance = await this.createInstance(buildId);
        if (previewVersion !== this.previewVersion) {
            disposeSprite(instance.model);
            return;
        }
        this.setOpacity(instance.model, 0.65);
        instance.model.visible = false;
        this.active = instance;
        this.cursor.setPreview(instance.model, instance.groundOffset, snapToWallSlot);
        this.cursor.update();
    }

    private async createInstance(buildId: BuildId, attach = true): Promise<WallInstance<BuildId>> {
        if (this.disposed) throw new Error('Placement has been disposed');
        const definition = this.definitions[buildId];
        const model = await createStaticSprite(
            `${import.meta.env.BASE_URL}dst/data/anim`,
            definition.archive,
            {
                imageIndices: [definition.sideImageIndex, definition.frontImageIndex],
                imageIndex: this.isDiagonalHeading()
                    ? definition.sideImageIndex
                    : definition.frontImageIndex,
                name: definition.name,
                scale: definition.scale,
                symbol: definition.symbol,
                ...(definition.overlay ? {
                    overlay: {
                        symbol: definition.overlay.symbol,
                        imageIndices: [definition.overlay.sideImageIndex, definition.overlay.frontImageIndex],
                    },
                } : {}),
                animationArchive: definition.animationArchive ?? 'wall.zip',
                restAnimation: 'half',
            },
        );
        if (definition.multColour) this.setMultColour(model, definition.multColour);
        if (this.disposed) { disposeSprite(model); throw new Error('Placement has been disposed'); }
        model.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3().setFromObject(model);
        const instance: WallInstance<BuildId> = {
            buildId,
            model,
            animation: model.userData.animationController as StaticSpriteController,
            groundOffset: -bounds.min.y,
        };
        if (attach) model.userData.entityId = newEntityId();
        if (attach) this.scene.add(model);
        return instance;
    }

    private playerFrontGroundPosition(): THREE.Vector3 {
        const direction = new THREE.Vector3();
        this.camera.getWorldDirection(direction);
        direction.y = 0;
        if (direction.lengthSq() === 0) direction.set(0, 0, 1);
        else direction.normalize();
        const target = this.player.position.clone().addScaledVector(direction, 10);
        const rayOrigin = new THREE.Vector3(target.x, target.y + 1000, target.z);
        const hit = this.pointer.raycast(rayOrigin, new THREE.Vector3(0, -1, 0), this.ground);
        if (hit) return snapToWallSlot(hit.point.clone());
        target.y = 0;
        return snapToWallSlot(target);
    }

    private updateFacing(wall: WallInstance<BuildId>, showFront: boolean) {
        const definition = this.definitions[wall.buildId];
        wall.animation.showImage(
            showFront ? definition.frontImageIndex : definition.sideImageIndex,
        );
        wall.animation.setFacing(showFront ? 8 : 128);
    }

    /**
     * The wall is eight-faced and never rotated, so the game picks its art from
     * `rotation + camera heading` (see `components/placer.lua`, "rotate against
     * the camera"). A diagonal heading therefore selects the oblique `facing=240`
     * art, a cardinal one the front `facing=15` art.
     */
    private isDiagonalHeading(): boolean {
        this.camera.getWorldDirection(this.cameraDirection);
        this.cameraDirection.y = 0;
        if (this.cameraDirection.lengthSq() === 0) return false;
        const heading = Math.atan2(-this.cameraDirection.z, -this.cameraDirection.x);
        const steps = Math.round(THREE.MathUtils.radToDeg(heading) / HEADING_STEP);
        return THREE.MathUtils.euclideanModulo(steps, 2) === 1;
    }

    private faceCamera(model: THREE.Object3D) {
        this.camera.getWorldQuaternion(this.cameraWorldQuaternion);
        model.quaternion.copy(this.cameraWorldQuaternion);
    }

    private setOpacity(model: THREE.Object3D, opacity: number) {
        model.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => {
                material.transparent = true;
                material.opacity = opacity;
            });
        });
    }

    private setMultColour(model: THREE.Object3D, colour: readonly number[]) {
        const [red, green, blue] = [colour[0] ?? 1, colour[1] ?? 1, colour[2] ?? 1];
        model.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => {
                material.color.setRGB(red, green, blue);
            });
        });
    }
}
