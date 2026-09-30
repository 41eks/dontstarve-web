import * as THREE from 'three';
import {
    createAnimatedSprite,
    type SpriteAnimationController,
} from '@three-roaming/animation/sprite';
import { BuildCursor } from './buildCursor';
import { PointerRaycaster } from './pointerRaycaster';
import type { WorldContext } from './worldContext';
import { newEntityId, saveGroundPosition, type PlacementSaveRecord, type PlacedEntitySaveRecord } from './saveRecord';

export interface AnimatedBuildingDefinition {
    archive: string;
    buildLabel: string;
    idleAnimation?: string;
    interaction?: AnimatedBuildingToggleInteraction;
    name: string;
    /** Enable player proximity animations and interaction range checks. */
    onProximity: boolean;
    proximityAnimation?: string;
    scale: number;
    skinArchives?: Readonly<Record<string, string>>;
    skinSymbols?: readonly string[];
    baseSymbols?: readonly string[];
    skinAnimationBanks?: Readonly<Record<string, readonly string[]>>;
}

/** Animations used by buildings that toggle between closed and open on click. */
export interface AnimatedBuildingToggleInteraction {
    closeAnimation: string;
    closedAnimation: string;
    openAnimation: string;
    openAnimationLoop?: boolean;
}

export interface AnimatedBuildingInteractionChange<BuildId extends string> {
    buildId: BuildId;
    isOpen: boolean;
    model: THREE.Group;
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

const PROXIMITY_ENTER_DISTANCE = 9;
const PROXIMITY_EXIT_DISTANCE = 10;

export class AnimatedBuildingPlacement<BuildId extends string> {
    private readonly scene: THREE.Scene;
    private readonly camera: THREE.Camera;
    private readonly ground: THREE.Object3D;
    private readonly player: THREE.Object3D;
    private readonly definitions: Readonly<Record<BuildId, AnimatedBuildingDefinition>>;
    private readonly consumeBufferedBuild: (buildId: BuildId) => boolean;
    private readonly onInteractionChange?: (
        change: AnimatedBuildingInteractionChange<BuildId>,
    ) => void;
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
        onInteractionChange?: (change: AnimatedBuildingInteractionChange<BuildId>) => void,
    ) {
        this.scene = world.scene;
        this.camera = world.camera;
        this.ground = world.ground;
        this.player = world.player;
        this.definitions = definitions;
        this.consumeBufferedBuild = consumeBufferedBuild;
        this.onInteractionChange = onInteractionChange;
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

    /** Restores a logical record directly, without crafting or placement callbacks. */
    async spawnFromSave(buildId: BuildId, record: PlacementSaveRecord): Promise<THREE.Group> {
        const building = await this.createInstance(
            buildId, record.components.building?.skinId, false,
            record.components.building?.state,
        );
        building.model.userData.entityId = record.id;
        building.model.userData.saveRecord = record;
        const [x, y, z] = record.transform.position;
        building.model.position.set(x, y + building.groundOffset, z);
        this.faceCamera(building.model);
        this.scene.add(building.model);
        this.placed.push(building);
        return building.model;
    }

    exportRecords(): PlacedEntitySaveRecord[] {
        return this.placed.map((building) => ({
            prefabId: building.buildId,
            record: {
                id: building.model.userData.entityId as string,
                transform: {
                    position: saveGroundPosition(building.model.position, building.groundOffset),
                    rotationY: 0,
                },
                components: {
                    building: {
                        // Persist the target state of an interaction, not a transient animation frame.
                        state: building.interactionState === undefined ? 'idle'
                            : building.interactionState === 'open' || building.interactionState === 'opening'
                                ? 'open' : 'closed',
                        ...(building.skinId === undefined ? {} : { skinId: building.skinId }),
                    },
                },
            },
        }));
    }

    /** Whole sprite entities and their ground-contact points for depth sorting. */
    get renderEntities() {
        return [...this.placed, ...(this.active ? [this.active] : [])]
            .filter(({ model }) => model.visible)
            .map(({ model, groundOffset }) => ({
                object: model,
                footPosition: model.position.clone().add(new THREE.Vector3(0, -groundOffset, 0)),
                cameraDepth: 0,
            }));
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
            this.updateProximity(building);
            building.animation.update(dt);
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
        const definition = this.definitions[building.buildId];
        const interaction = definition.interaction;
        if (!interaction) return;
        this.updateProximity(building);
        if (definition.onProximity && !building.isPlayerNearby) return;

        if (building.interactionState === 'closed') {
            if (interaction.openAnimationLoop) {
                building.interactionState = 'open';
                building.animation.start(interaction.openAnimation);
                this.onInteractionChange?.({
                    buildId: building.buildId,
                    isOpen: true,
                    model: building.model,
                });
                return;
            }
            building.interactionState = 'opening';
            building.animation.playOnce(interaction.openAnimation, () => {
                building.interactionState = 'open';
                this.onInteractionChange?.({
                    buildId: building.buildId,
                    isOpen: true,
                    model: building.model,
                });
            });
            return;
        }
        if (building.interactionState !== 'open') return;

        this.closeInteraction(building);
    }

    private closeInteraction(building: AnimatedBuildingInstance<BuildId>) {
        const interaction = this.definitions[building.buildId].interaction;
        if (!interaction || (building.interactionState !== 'open'
            && building.interactionState !== 'opening')) return;

        building.interactionState = 'closing';
        this.onInteractionChange?.({
            buildId: building.buildId,
            isOpen: false,
            model: building.model,
        });
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
        attach = true,
        state?: 'idle' | 'closed' | 'open',
    ): Promise<AnimatedBuildingInstance<BuildId>> {
        const definition = this.definitions[buildId];
        const skinArchive = skinId === undefined ? undefined : definition.skinArchives?.[skinId];
        if (skinId !== undefined && skinArchive === undefined) throw new Error(`Unsupported ${buildId} skin: ${skinId}`);
        const model = await createAnimatedSprite(
            `${import.meta.env.BASE_URL}dst/data/anim`,
            definition.archive,
            {
                initialAnimation: state === 'open' && definition.interaction
                    ? definition.interaction.openAnimation : this.idleAnimation(buildId),
                initialFrame: state === 'open' && !definition.interaction?.openAnimationLoop ? 'last' : 'first',
                name: definition.name,
                scale: definition.scale,
                skinArchive,
                skinSymbols: definition.skinSymbols,
                baseSymbols: definition.baseSymbols,
                skinAnimationBanks: skinId === undefined ? undefined : definition.skinAnimationBanks?.[skinId],
            },
        );
        model.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3().setFromObject(model);
        const instance: AnimatedBuildingInstance<BuildId> = {
            buildId,
            model,
            animation: model.userData.animationController as SpriteAnimationController,
            groundOffset: -bounds.min.y,
            ...(definition.interaction ? { interactionState: state === 'open' ? 'open' as const : 'closed' as const } : {}),
            isPlacing: false,
            isPlayerNearby: state === 'open',
            ...(skinArchive === undefined ? {} : { skinId }),
        };
        if (skinArchive !== undefined) model.userData.skinId = skinId;
        if (state === 'open' && definition.interaction?.openAnimationLoop) {
            instance.animation.start(definition.interaction.openAnimation);
        }
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
        if (hit) return hit.point.clone();
        target.y = 0;
        return target;
    }

    private updateProximity(building: AnimatedBuildingInstance<BuildId>) {
        if (building.isPlacing) return;

        const definition = this.definitions[building.buildId];
        if (!definition.onProximity) return;

        const dx = this.player.position.x - building.model.position.x;
        const dz = this.player.position.z - building.model.position.z;
        const threshold = building.isPlayerNearby
            ? PROXIMITY_EXIT_DISTANCE
            : PROXIMITY_ENTER_DISTANCE;
        const isPlayerNearby = dx * dx + dz * dz <= threshold * threshold;
        if (isPlayerNearby === building.isPlayerNearby) return;

        building.isPlayerNearby = isPlayerNearby;
        if (!isPlayerNearby) this.closeInteraction(building);
        if (definition.proximityAnimation) {
            building.animation.start(
                isPlayerNearby
                    ? definition.proximityAnimation
                    : this.idleAnimation(building.buildId),
            );
        }
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
