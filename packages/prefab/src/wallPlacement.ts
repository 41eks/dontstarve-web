import * as THREE from 'three';
import {
    createStaticSprite,
    type StaticSpriteController,
} from '@three-roaming/animation/sprite';
import { BuildCursor } from './buildCursor';
import { PointerRaycaster } from './pointerRaycaster';
import { snapToWallSlotCenter } from './tile';
import type { WorldContext } from './worldContext';

export interface WallDefinition {
    archive: string;
    buildLabel: string;
    /**
     * Front face art for cardinal camera headings (0/90/180/270), where the
     * wall's `facing=15` animations are used, e.g. `14` for `wall_segment-14`.
     */
    frontImageIndex: number;
    name: string;
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
    private readonly placed: WallInstance<BuildId>[] = [];
    private readonly cameraWorldQuaternion = new THREE.Quaternion();
    private readonly cameraDirection = new THREE.Vector3();

    constructor(
        world: WorldContext,
        definitions: Readonly<Record<BuildId, WallDefinition>>,
        consumeBufferedBuild: (buildId: BuildId) => boolean,
    ) {
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
        if (this.active) return Promise.resolve();
        if (this.loading) return this.loading;

        this.cursor.show(`build ${this.definitions[buildId].buildLabel}`);
        const request = this.createPreview(buildId)
            .catch((error: unknown) => {
                this.cursor.hide();
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

    cancel() {
        if (!this.active) return;
        this.scene.remove(this.active.model);
        this.active = undefined;
        this.cursor.hide();
    }

    update() {
        this.cursor.update();
        const showFront = !this.isDiagonalHeading();
        if (this.active) this.updateFacing(this.active, showFront);
        for (const wall of this.placed) {
            this.faceCamera(wall.model);
            this.updateFacing(wall, showFront);
        }
    }

    private readonly handlePointerDown = (event: PointerEvent) => {
        if (event.button !== 0 || !this.active) return;
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

    private async createPreview(buildId: BuildId) {
        const instance = await this.createInstance(buildId);
        this.setOpacity(instance.model, 0.65);
        instance.model.visible = false;
        this.active = instance;
        this.cursor.setPreview(instance.model, instance.groundOffset, snapToWallSlot);
        this.cursor.update();
    }

    private async createInstance(buildId: BuildId): Promise<WallInstance<BuildId>> {
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
            },
        );
        model.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3().setFromObject(model);
        const instance: WallInstance<BuildId> = {
            buildId,
            model,
            animation: model.userData.animationController as StaticSpriteController,
            groundOffset: -bounds.min.y,
        };
        this.scene.add(model);
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
}
