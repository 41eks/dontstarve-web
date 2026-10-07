import * as THREE from 'three';
import { disposeSprite } from './disposeSprite';
import {
    createAnimatedSprite,
    createAnimatedSpriteFactory,
    type AnimatedSpriteFactory,
    type SpriteAnimationController,
    type TransientSpriteAnimationController,
} from '@dontstarve-web/animation/sprite';
import type { PrefabSkinInitializer } from '@dontstarve-web/animation/prefabskin';
import type { BuildingContainerDefinition } from './containers';
import { BuildCursor } from './buildCursor';
import { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import type { WorldContext } from './worldContext';
import { newEntityId, saveGroundPosition, type PlacementSaveRecord, type PlacedEntitySaveRecord } from './saveRecord';
import type { HammerTarget } from '@dontstarve-web/stategraphs/hammer';
import { nextReskin } from './reskin_tool';
import { type ReskinTarget } from '@dontstarve-web/stategraphs/reskin_tool';
import { registerSpriteRenderGroup } from '@dontstarve-web/animation/renderOrder';
import { isPlayerNearby } from './playerProximity';

export interface AnimatedBuildingDefinition {
    archive: string;
    buildLabel: string;
    idleAnimation?: string;
    previewAnimation?: string;
    interaction?: AnimatedBuildingToggleInteraction;
    /** Source SetWorkAction(ACTIONS.HAMMER) and its OnWork animation. */
    hammerAnimation?: string;
    /** Source workable work count; omitted buildings retain animation-only hits. */
    hammerWorkLeft?: number;
    onhit?: (context: AnimatedBuildingHammerContext) => void;
    onhammered?: (context: AnimatedBuildingHammerContext) => void;
    /** Preloaded, temporary destruction art, independent of a building's skin. */
    hammerEffect?: { archive: string; animation: string; name: string };
    name: string;
    container?: BuildingContainerDefinition;
    /** Prepares prefab resources alongside the sprite, without playing effects. */
    prepare?: () => Promise<void>;
    /** Runs only after successful placement; call onComplete when built effects finish. */
    onbuilt?: (context: AnimatedBuildingBuiltContext) => void;
    /** Runs when an accepted interaction starts its opening animation. */
    onopen?: (context: AnimatedBuildingEventContext) => void;
    /** Runs when a click or proximity exit starts its closing animation. */
    onclose?: (context: AnimatedBuildingEventContext) => void;
    /** Runs when the player enters the building's proximity range. */
    onturnon?: (context: AnimatedBuildingEventContext) => void;
    /** Runs when the player leaves the building's proximity range. */
    onturnoff?: (context: AnimatedBuildingEventContext) => void;
    /** Enable player proximity events and interaction range checks. */
    onProximity: boolean;
    scale: number;
    skinArchives?: Readonly<Record<string, string>>;
    skinInit?: PrefabSkinInitializer;
    skinSymbols?: readonly string[];
    baseSymbols?: readonly string[];
    skinAnimationBanks?: Readonly<Record<string, readonly string[]>>;
}

export interface AnimatedBuildingEventContext {
    model: THREE.Group;
    animation: SpriteAnimationController;
    skinId?: string;
}

export interface AnimatedBuildingBuiltContext extends AnimatedBuildingEventContext {
    onComplete: () => void;
}

export interface AnimatedBuildingHammerContext extends AnimatedBuildingEventContext {
    isPlayerNearby: boolean;
    position: THREE.Vector3;
    dropLoot: (items: readonly { itemId: string; count: number }[]) => void;
    spawnEffect: () => void;
    remove: () => void;
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
    animation: TransientSpriteAnimationController;
    groundOffset: number;
    interactionState?: AnimatedBuildingInteractionState;
    isPlacing: boolean;
    isPlayerNearby: boolean;
    skinId?: string;
    workLeft?: number;
    effectFactory?: AnimatedSpriteFactory;
}

export class AnimatedBuildingPlacement<BuildId extends string> {
    private disposed = false;
    private readonly canvas: HTMLCanvasElement;
    private readonly scene: THREE.Scene;
    private readonly camera: THREE.Camera;
    private readonly ground: THREE.Object3D;
    private readonly player: THREE.Object3D;
    private readonly dropLoot?: WorldContext['dropLoot'];
    private readonly definitions: Readonly<Record<BuildId, AnimatedBuildingDefinition>>;
    private readonly consumeBufferedBuild: (buildId: BuildId) => boolean;
    private readonly onInteractionChange?: (
        change: AnimatedBuildingInteractionChange<BuildId>,
    ) => void;
    private readonly cursor: BuildCursor;
    private readonly pointer: PointerRaycaster;
    private active?: AnimatedBuildingInstance<BuildId>;
    private loading?: Promise<void>;
    private previewVersion = 0;
    private readonly placed: AnimatedBuildingInstance<BuildId>[] = [];
    private readonly effects = new Set<THREE.Group>();
    private readonly effectFactories = new Map<string, Promise<AnimatedSpriteFactory>>();
    private readonly cameraWorldQuaternion = new THREE.Quaternion();

    constructor(
        world: WorldContext,
        definitions: Readonly<Record<BuildId, AnimatedBuildingDefinition>>,
        consumeBufferedBuild: (buildId: BuildId) => boolean,
        onInteractionChange?: (change: AnimatedBuildingInteractionChange<BuildId>) => void,
    ) {
        this.canvas = world.renderer.domElement;
        this.scene = world.scene;
        this.camera = world.camera;
        this.ground = world.ground;
        this.player = world.player;
        this.dropLoot = world.dropLoot;
        this.definitions = definitions;
        this.consumeBufferedBuild = consumeBufferedBuild;
        this.onInteractionChange = onInteractionChange;
        this.pointer = new PointerRaycaster(world);
        this.cursor = new BuildCursor(world, this.pointer);
        world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    }

    begin(buildId: BuildId, skinId?: string): Promise<void> {
        if (this.disposed) return Promise.reject(new Error('Placement has been disposed'));
        if (this.active) return Promise.resolve();
        if (this.loading) return this.loading;

        this.cursor.show(`: 建造 ${this.definitions[buildId].buildLabel}`, 'left');
        const previewVersion = ++this.previewVersion;
        const request = this.createPreview(buildId, previewVersion, skinId)
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
        return [...this.placed, ...(this.active ? [this.active] : []),
            ...Array.from(this.effects, (model) => ({ model, groundOffset: 0 }))]
            .filter(({ model }) => model.visible)
            .map(({ model, groundOffset }) => ({
                object: model,
                footPosition: model.position.clone().add(new THREE.Vector3(0, -groundOffset, 0)),
                cameraDepth: 0,
            }));
    }

    get hammerTargets(): readonly HammerTarget[] {
        return this.placed.filter((building) => this.definitions[building.buildId].hammerAnimation !== undefined)
            .map((building) => ({
                id: String(building.model.userData.entityId),
                model: building.model,
                position: building.model.position.clone().add(new THREE.Vector3(0, -building.groundOffset, 0)),
                isValid: () => this.isHammerTargetValid(building),
                playHit: () => {
                    if (!this.isHammerTargetValid(building)) return;
                    this.updateProximity(building);
                    const definition = this.definitions[building.buildId];
                    if (building.workLeft !== undefined) building.workLeft = Math.max(0, building.workLeft - 1);
                    const context = this.hammerContext(building);
                    if (definition.onhit) definition.onhit(context);
                    else {
                        const current = building.animation.currentAnimation;
                        const hit = definition.hammerAnimation === 'hit_empty'
                            ? current === 'cooking_loop' ? 'hit_cooking' : current === 'idle_full' ? 'hit_full' : 'hit_empty'
                            : (building.buildId === 'mushroom_light' || building.buildId === 'mushroom_light2') && current.endsWith('_on')
                                ? 'hit_on' : definition.hammerAnimation!;
                        building.animation.playTransient(hit);
                    }
                    if (building.workLeft === 0) definition.onhammered?.(context);
                },
            }));
    }

    get reskinTargets(): readonly ReskinTarget[] {
        return this.placed.filter(({ buildId }) => Object.keys(this.definitions[buildId].skinArchives ?? {}).length > 0)
            .map((building) => {
                const isValid = () => this.placed.includes(building) && !building.isPlacing
                    && building.model.visible && building.model.parent !== null
                    && building.interactionState !== 'opening' && building.interactionState !== 'closing';
                return {
                    id: String(building.model.userData.entityId), prefabId: building.buildId, model: building.model,
                    position: building.model.position.clone().add(new THREE.Vector3(0, -building.groundOffset, 0)), isValid,
                    prepareNextSkin: async () => {
                        const previousSkin = building.skinId;
                        const previousState = building.interactionState;
                        const skinId = nextReskin(Object.keys(this.definitions[building.buildId].skinArchives!), previousSkin);
                        const replacement = await this.createInstance(building.buildId, skinId, false,
                            previousState === 'open' ? 'open' : previousState === 'closed' ? 'closed' : 'idle');
                        let used = false;
                        const disposeModel = (model: THREE.Group) => {
                            const materials = new Set<THREE.Material>();
                            model.traverse((object) => {
                                if (!(object instanceof THREE.Mesh)) return;
                                object.geometry.dispose();
                                (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => materials.add(material));
                            });
                            for (const material of materials) {
                                if (material instanceof THREE.MeshBasicMaterial) material.map?.dispose();
                                material.dispose();
                            }
                            model.clear();
                        };
                        return {
                            apply: () => {
                                if (used || !isValid() || building.skinId !== previousSkin || building.interactionState !== previousState) return false;
                                const footY = building.model.position.y - building.groundOffset;
                                // Keep the entity root: open container panels and IDs retain their references.
                                disposeModel(building.model);
                                for (const child of [...replacement.model.children]) building.model.add(child);
                                registerSpriteRenderGroup(building.model, building.model.children[0] as THREE.Group);
                                building.animation = replacement.animation;
                                building.model.userData.animationController = replacement.animation;
                                building.skinId = skinId;
                                if (skinId === undefined) delete building.model.userData.skinId;
                                else building.model.userData.skinId = skinId;
                                building.groundOffset = replacement.groundOffset;
                                building.model.position.y = footY + building.groundOffset;
                                if (building.isPlayerNearby) this.definitions[building.buildId].onturnon?.({
                                    model: building.model, animation: building.animation, skinId,
                                });
                                used = true;
                                return true;
                            },
                            dispose: () => { if (!used) { disposeModel(replacement.model); used = true; } },
                        };
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
        // Factory-owned effects share materials; only their factory disposes them.
        for (const effect of this.effects) effect.removeFromParent();
        this.effects.clear();
        for (const factory of this.effectFactories.values()) void factory.then((value) => value.dispose(), () => undefined);
        this.effectFactories.clear();
    }

    cancel() {
        // Cancel only the placer, including pending asset loads. The buffered build stays in inventory.
        this.previewVersion += 1;
        this.loading = undefined;
        if (this.active) disposeSprite(this.active.model);
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
        for (const effect of this.effects) {
            (effect.userData.animationController as SpriteAnimationController).update(dt);
            this.faceCamera(effect);
        }
    }

    private readonly handlePointerDown = (event: PointerEvent) => {
        if (event.button === 2) {
            this.cancel();
            return;
        }
        if (event.button !== 0) return;
        if (event.defaultPrevented) return;
        if (this.loading) {
            event.preventDefault();
            return;
        }
        if (this.active) {
            event.preventDefault();
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
        const onbuilt = this.definitions[placedBuilding.buildId].onbuilt;
        placedBuilding.isPlacing = onbuilt !== undefined;
        this.setOpacity(placedBuilding.model, 1);
        placedBuilding.model.visible = true;
        this.placed.push(placedBuilding);
        this.active = undefined;
        this.cursor.hide();
        onbuilt?.({
            model: placedBuilding.model,
            animation: placedBuilding.animation,
            skinId: placedBuilding.skinId,
            onComplete: () => { placedBuilding.isPlacing = false; },
        });
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
        if (building) {
            event.preventDefault();
            this.toggleInteraction(building);
        }
    }

    private toggleInteraction(building: AnimatedBuildingInstance<BuildId>) {
        const definition = this.definitions[building.buildId];
        const interaction = definition.interaction;
        if (!interaction) return;
        this.updateProximity(building);
        if (definition.onProximity && !building.isPlayerNearby) return;

        if (building.interactionState === 'closed') {
            definition.onopen?.({
                model: building.model,
                animation: building.animation,
                skinId: building.skinId,
            });
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
        const definition = this.definitions[building.buildId];
        const interaction = definition.interaction;
        if (!interaction || (building.interactionState !== 'open'
            && building.interactionState !== 'opening')) return;

        building.interactionState = 'closing';
        definition.onclose?.({
            model: building.model,
            animation: building.animation,
            skinId: building.skinId,
        });
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

    private async createPreview(buildId: BuildId, previewVersion: number, skinId?: string) {
        const instance = await this.createInstance(buildId, skinId, true, undefined, true);
        if (previewVersion !== this.previewVersion) {
            disposeSprite(instance.model);
            return;
        }
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
        preview = false,
    ): Promise<AnimatedBuildingInstance<BuildId>> {
        if (this.disposed) throw new Error('Placement has been disposed');
        const definition = this.definitions[buildId];
        const skinArchive = skinId === undefined ? undefined : definition.skinArchives?.[skinId];
        if (skinId !== undefined && skinArchive === undefined) throw new Error(`Unsupported ${buildId} skin: ${skinId}`);
        const skin = skinId === undefined ? undefined : definition.skinInit?.(skinId);
        const [model, , effectFactory] = await Promise.all([createAnimatedSprite(
            `${import.meta.env.BASE_URL}dst/data/anim`,
            skin?.archive ?? definition.archive,
            {
                initialAnimation: preview && definition.previewAnimation ? definition.previewAnimation
                    : state === 'open' && definition.interaction
                    ? definition.interaction.openAnimation : this.idleAnimation(buildId),
                initialFrame: state === 'open' && !definition.interaction?.openAnimationLoop ? 'last' : 'first',
                name: definition.name,
                scale: definition.scale,
                skinArchive: skin?.skinArchive ?? skinArchive,
                skinSymbols: definition.skinSymbols,
                baseSymbols: definition.baseSymbols,
                skinAnimationBanks: skinId === undefined ? undefined : definition.skinAnimationBanks?.[skinId],
            },
        ), definition.prepare?.(), definition.hammerEffect ? this.prepareEffect(definition.hammerEffect.archive) : undefined]);
        if (this.disposed) { disposeSprite(model); throw new Error('Placement has been disposed'); }
        model.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3().setFromObject(model);
        const instance: AnimatedBuildingInstance<BuildId> = {
            buildId,
            model,
            animation: model.userData.animationController as TransientSpriteAnimationController,
            workLeft: definition.hammerWorkLeft,
            effectFactory,
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

    private isHammerTargetValid(building: AnimatedBuildingInstance<BuildId>): boolean {
        return !this.disposed && this.placed.includes(building) && !building.isPlacing
            && building.workLeft !== 0 && building.model.visible && building.model.parent !== null;
    }

    private prepareEffect(archive: string): Promise<AnimatedSpriteFactory> {
        let request = this.effectFactories.get(archive);
        if (!request) {
            request = createAnimatedSpriteFactory(`${import.meta.env.BASE_URL}dst/data/anim`, archive);
            this.effectFactories.set(archive, request);
            void request.catch(() => this.effectFactories.delete(archive));
        }
        return request;
    }

    private hammerContext(building: AnimatedBuildingInstance<BuildId>): AnimatedBuildingHammerContext {
        const position = building.model.position.clone().add(new THREE.Vector3(0, -building.groundOffset, 0));
        return {
            model: building.model, animation: building.animation, skinId: building.skinId,
            position, isPlayerNearby: building.isPlayerNearby,
            dropLoot: (items) => this.dropLoot?.(items, position.clone()),
            spawnEffect: () => {
                const definition = this.definitions[building.buildId].hammerEffect;
                if (!definition || !building.effectFactory || this.disposed) return;
                const effect = building.effectFactory.create({
                    initialAnimation: definition.animation, name: definition.name,
                });
                effect.position.copy(position);
                effect.userData.persists = false;
                effect.userData.tags = ['FX', 'NOCLICK'];
                this.faceCamera(effect);
                this.scene.add(effect);
                this.effects.add(effect);
                (effect.userData.animationController as SpriteAnimationController).playOnce(definition.animation, () => {
                    this.effects.delete(effect);
                    building.effectFactory!.disposeSprite(effect);
                });
            },
            remove: () => {
                const index = this.placed.indexOf(building);
                if (index < 0) return;
                this.placed.splice(index, 1);
                disposeSprite(building.model);
            },
        };
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

        const nearby = isPlayerNearby(this.player.position, building.model.position, building.isPlayerNearby);
        if (nearby === building.isPlayerNearby) return;

        building.isPlayerNearby = nearby;
        if (!nearby) this.closeInteraction(building);
        const onProximityChange = nearby ? definition.onturnon : definition.onturnoff;
        onProximityChange?.({
            model: building.model,
            animation: building.animation,
            skinId: building.skinId,
        });
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
