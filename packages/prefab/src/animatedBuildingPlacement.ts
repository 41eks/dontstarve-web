import * as THREE from 'three';
import {
    createAnimatedSprite,
    type SpriteAnimationController,
} from '@three-roaming/animation/sprite';
import { BuildCursor } from './buildCursor';
import type { WorldContext } from './worldContext';

export interface AnimatedBuildingDefinition {
    archive: string;
    buildLabel: string;
    idleAnimation?: string;
    name: string;
    proximityAnimation?: string;
    scale: number;
}

interface AnimatedBuildingInstance<BuildId extends string> {
    buildId: BuildId;
    model: THREE.Group;
    animation: SpriteAnimationController;
    groundOffset: number;
    isPlacing: boolean;
    isPlayerNearby: boolean;
}

const PROXIMITY_ENTER_DISTANCE = 18;
const PROXIMITY_EXIT_DISTANCE = 20;

export class AnimatedBuildingPlacement<BuildId extends string> {
    private readonly scene: THREE.Scene;
    private readonly camera: THREE.Camera;
    private readonly ground: THREE.Object3D;
    private readonly player: THREE.Object3D;
    private readonly definitions: Readonly<Record<BuildId, AnimatedBuildingDefinition>>;
    private readonly consumeBufferedBuild: (buildId: BuildId) => boolean;
    private readonly cursor: BuildCursor;
    private active?: AnimatedBuildingInstance<BuildId>;
    private loading?: Promise<void>;
    private readonly placed: AnimatedBuildingInstance<BuildId>[] = [];
    private readonly raycaster = new THREE.Raycaster();
    private readonly cameraWorldQuaternion = new THREE.Quaternion();

    constructor(
        world: WorldContext,
        definitions: Readonly<Record<BuildId, AnimatedBuildingDefinition>>,
        consumeBufferedBuild: (buildId: BuildId) => boolean,
    ) {
        this.scene = world.scene;
        this.camera = world.camera;
        this.ground = world.ground;
        this.player = world.player;
        this.definitions = definitions;
        this.consumeBufferedBuild = consumeBufferedBuild;
        this.cursor = new BuildCursor(world);
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
        const building = await this.createInstance(buildId);
        const target = this.playerFrontGroundPosition();
        building.model.position.set(
            target.x,
            target.y + building.groundOffset,
            target.z,
        );
        building.model.visible = true;
        this.setOpacity(building.model, 1);
        this.faceCamera(building.model);
        this.placed.push(building);
    }

    update(dt: number) {
        if (this.active) {
            this.active.animation.update(dt);
        }
        this.cursor.update();
        for (const building of this.placed) {
            building.animation.update(dt);
            this.updateProximityAnimation(building);
            this.faceCamera(building.model);
        }
    }

    private readonly handlePointerDown = (event: PointerEvent) => {
        if (event.button !== 0 || !this.active) return;
        this.cursor.trackPointer(event);
        this.cursor.update();
        if (!this.cursor.isOverGround || !this.consumeBufferedBuild(this.active.buildId)) return;

        const placedBuilding = this.active;
        placedBuilding.isPlacing = true;
        this.setOpacity(placedBuilding.model, 1);
        placedBuilding.model.visible = true;
        placedBuilding.animation.playOnce('place', () => {
            placedBuilding.animation.start(this.idleAnimation(placedBuilding.buildId));
            placedBuilding.isPlacing = false;
        });
        this.placed.push(placedBuilding);
        this.active = undefined;
        this.cursor.hide();
    };

    private async createPreview(buildId: BuildId) {
        const instance = await this.createInstance(buildId);
        this.setOpacity(instance.model, 0.65);
        instance.model.visible = false;
        this.active = instance;
        this.cursor.setPreview(instance.model, instance.groundOffset);
        this.cursor.update();
    }

    private async createInstance(buildId: BuildId): Promise<AnimatedBuildingInstance<BuildId>> {
        const definition = this.definitions[buildId];
        const model = await createAnimatedSprite(
            `${import.meta.env.BASE_URL}dst/data/anim`,
            definition.archive,
            {
                initialAnimation: this.idleAnimation(buildId),
                name: definition.name,
                scale: definition.scale,
            },
        );
        model.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3().setFromObject(model);
        const instance: AnimatedBuildingInstance<BuildId> = {
            buildId,
            model,
            animation: model.userData.animationController as SpriteAnimationController,
            groundOffset: -bounds.min.y,
            isPlacing: false,
            isPlayerNearby: false,
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
        this.raycaster.set(rayOrigin, new THREE.Vector3(0, -1, 0));
        this.ground.updateWorldMatrix(true, false);
        const hit = this.raycaster.intersectObject(this.ground, false)[0];
        if (hit) return hit.point.clone();
        target.y = 0;
        return target;
    }

    private updateProximityAnimation(building: AnimatedBuildingInstance<BuildId>) {
        if (building.isPlacing) return;

        const definition = this.definitions[building.buildId];
        if (!definition.proximityAnimation) return;

        const dx = this.player.position.x - building.model.position.x;
        const dz = this.player.position.z - building.model.position.z;
        const threshold = building.isPlayerNearby
            ? PROXIMITY_EXIT_DISTANCE
            : PROXIMITY_ENTER_DISTANCE;
        const isPlayerNearby = dx * dx + dz * dz <= threshold * threshold;
        if (isPlayerNearby === building.isPlayerNearby) return;

        building.isPlayerNearby = isPlayerNearby;
        building.animation.start(
            isPlayerNearby
                ? definition.proximityAnimation
                : this.idleAnimation(building.buildId),
        );
    }

    private idleAnimation(buildId: BuildId) {
        return this.definitions[buildId].idleAnimation ?? 'idle';
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