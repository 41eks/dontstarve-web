import * as THREE from 'three';
import {
    createAnimatedSprite,
    type SpriteAnimationController,
} from '@three-roaming/animation/sprite';
import { BuildCursor } from './buildCursor';
import { PointerRaycaster } from './pointerRaycaster';
import type { WorldContext } from './worldContext';

export interface AnimatedBuildingDefinition {
    archive: string;
    buildLabel: string;
    idleAnimation?: string;
    interaction?: AnimatedBuildingToggleInteraction;
    name: string;
    proximityAnimation?: string;
    scale: number;
    skinArchives?: Readonly<Record<string, string>>;
}

/** Animations used by buildings that toggle between closed and open on click. */
export interface AnimatedBuildingToggleInteraction {
    closeAnimation: string;
    closedAnimation: string;
    openAnimation: string;
}

type AnimatedBuildingInteractionState = 'closed' | 'opening' | 'open' | 'closing';

interface AnimatedBuildingInstance<BuildId extends string> {
    buildId: BuildId;
    model: THREE.Group;
    animation: SpriteAnimationController;
    groundOffset: number;
    interactionState?: AnimatedBuildingInteractionState;
    isPlacing: boolean;
    isPlayerNearby: boolean;
    skinId?: string;
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
    private readonly pointer: PointerRaycaster;
    private active?: AnimatedBuildingInstance<BuildId>;
    private loading?: Promise<void>;
    private readonly placed: AnimatedBuildingInstance<BuildId>[] = [];
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
        this.pointer = new PointerRaycaster(world);
        this.cursor = new BuildCursor(world, this.pointer);
        world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    }

    begin(buildId: BuildId, skinId?: string): Promise<void> {
        if (this.active) return Promise.resolve();
        if (this.loading) return this.loading;

        this.cursor.show(`build ${this.definitions[buildId].buildLabel}`);
        const request = this.createPreview(buildId, skinId)
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

    async spawn(buildId: BuildId, skinId?: string): Promise<void> {
        const building = await this.createInstance(buildId, skinId);
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

    cancel() {
        if (!this.active) return;
        this.scene.remove(this.active.model);
        this.active = undefined;
        this.cursor.hide();
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
        if (event.button !== 0) return;
        if (this.active) {
            this.placeActiveBuilding(event);
            return;
        }
        this.interactWithPlacedBuilding(event);
    };

    private placeActiveBuilding(event: PointerEvent) {
        if (!this.active) return;
        this.pointer.trackPointer(event);
        this.cursor.update();
        if (!this.pointer.isOverGround || !this.consumeBufferedBuild(this.active.buildId)) return;

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
    }

    private interactWithPlacedBuilding(event: PointerEvent) {
        const interactable = this.placed.filter((building) =>
            this.definitions[building.buildId].interaction !== undefined
            && !building.isPlacing
        );
        if (interactable.length === 0) return;

        this.pointer.trackPointer(event);
        const byModel = new Map<THREE.Object3D, AnimatedBuildingInstance<BuildId>>(
            interactable.map((building) => [building.model, building]),
        );
        const hit = this.pointer.raycastPointer([...byModel.keys()], true);
        let object: THREE.Object3D | null = hit?.object ?? null;
        while (object && !byModel.has(object)) object = object.parent;
        if (!object) return;

        const building = byModel.get(object);
        if (building) this.toggleInteraction(building);
    }

    private toggleInteraction(building: AnimatedBuildingInstance<BuildId>) {
        const interaction = this.definitions[building.buildId].interaction;
        if (!interaction) return;

        if (building.interactionState === 'closed') {
            building.interactionState = 'opening';
            building.animation.playOnce(interaction.openAnimation, () => {
                building.interactionState = 'open';
            });
            return;
        }
        if (building.interactionState !== 'open') return;

        building.interactionState = 'closing';
        building.animation.playOnce(interaction.closeAnimation, () => {
            building.animation.start(interaction.closedAnimation);
            building.interactionState = 'closed';
        });
    }

    private async createPreview(buildId: BuildId, skinId?: string) {
        const instance = await this.createInstance(buildId, skinId);
        this.setOpacity(instance.model, 0.65);
        instance.model.visible = false;
        this.active = instance;
        this.cursor.setPreview(instance.model, instance.groundOffset);
        this.cursor.update();
    }

    private async createInstance(
        buildId: BuildId,
        skinId?: string,
    ): Promise<AnimatedBuildingInstance<BuildId>> {
        const definition = this.definitions[buildId];
        const skinArchive = skinId === undefined ? undefined : definition.skinArchives?.[skinId];
        const model = await createAnimatedSprite(
            `${import.meta.env.BASE_URL}dst/data/anim`,
            skinArchive ?? definition.archive,
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
            ...(definition.interaction ? { interactionState: 'closed' as const } : {}),
            isPlacing: false,
            isPlayerNearby: false,
            ...(skinArchive === undefined ? {} : { skinId }),
        };
        if (skinArchive !== undefined) model.userData.skinId = skinId;
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
