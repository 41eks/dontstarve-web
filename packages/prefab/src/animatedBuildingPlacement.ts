import * as THREE from 'three';
import { createSignal, readonlySignal, getBoundWatchWorldContent, type Signal } from '@dontstarve-web/signals';
import { disposeSprite } from './disposeSprite';
import {
    createAnimatedSprite,
    createAnimatedSpriteFactory,
    SpriteController,
    type AnimatedSpriteFactory,
    type SpriteAnimationController,
    type TransientSpriteAnimationController,
} from '@dontstarve-web/animation/sprite';
import type { PrefabSkinInitializer } from '@dontstarve-web/animation/prefabskin';
import type { BuildingContainerDefinition } from './containers';
import { BuildCursor } from './buildCursor';
import { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import type { WorldContext } from './worldContext';
import { bindActionCancellation } from '@dontstarve-web/stategraphs/actionEvents';
import { newEntityId, saveGroundPosition, type PlacementSaveRecord, type PlacedEntitySaveRecord } from './saveRecord';
import type { HammerTarget } from '@dontstarve-web/stategraphs/hammer';
import { nextReskin } from './reskin_tool';
import { type ReskinTarget } from '@dontstarve-web/stategraphs/reskin_tool';
import { registerSpriteRenderGroup } from '@dontstarve-web/animation/renderOrder';
import { isPlayerNearby } from './playerProximity';
import { createBuildingContainer, isStorageBuildingId } from './containers';
import { performCookAction } from '../../stategraphs/src/cook';
import { Workable } from '../../componets/src/workable';
import { actionEntity } from './actionEntity';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { GetRecipeLoot, type LootRecipe } from '../../componets/src/lootdropper';
import recipeData from '@dontstarve-web/animation/recipes.json';
import { PlaySound, PreloadSounds } from './sound';
import { Burnable, type BurnableInst } from '../../componets/src/burnable';
import { Propagator } from '../../componets/src/propagator';
import { setPrefabLocalLight } from './localLight';
import type { TradeItem, Trader } from '../../componets/src/trader';
import { TILE_SIZE } from './tile';

const lootRecipes = new Map<string, LootRecipe>([
    ...recipeData.recipes
        .filter(recipe => recipe.ingredients.every(ingredient => typeof ingredient.type === 'string' && typeof ingredient.amount === 'number'))
        .map((recipe): [string, LootRecipe] => [recipe.name, { ingredients: recipe.ingredients as LootRecipe['ingredients'] }]),
    // DeconstructRecipe registers its returnIngredients in AllRecipes, which lootdropper reads for structures such as pighead.
    ...recipeData.deconstructionRecipes.map((recipe): [string, LootRecipe] => [recipe.name, { ingredients: recipe.returnIngredients as LootRecipe['ingredients'] }]),
]);

/** Recipe.ingredients-based DropLoot of a buildable prefab (lootdropper's default for structures). */
export const buildingRecipeLoot = (buildId: string) => GetRecipeLoot(lootRecipes.get(buildId), lootRecipes);

export interface AnimatedBuildingDefinition {
    archive: string;
    /** Build zip when `archive` holds only the bank. */
    buildArchive?: string;
    buildLabel: string;
    idleAnimation?: string;
    previewAnimation?: string;
    interaction?: AnimatedBuildingToggleInteraction;
    /** Source SetWorkAction(ACTIONS.HAMMER) and its OnWork animation. */
    hammerAnimation?: string;
    /** Source workable work count; omitted buildings retain animation-only hits. */
    hammerWorkLeft?: number;
    hammerMaterial?: 'wood' | 'stone' | 'metal';
    hammerDropContentsOnHit?: boolean;
    hammerHitOnlyWhileWorking?: boolean;
    hammerExtraLoot?: readonly { itemId: string; count: number }[];
    /** Loot the finishing callback adds on both the intact and the burnt path, from the world's current state. */
    hammerBonusLoot?: (context: AnimatedBuildingEventContext) => readonly { itemId: string; count: number }[];
    /** Items the building itself holds, dropped with its recipe loot when hammered. */
    hammerHeldLoot?: (context: AnimatedBuildingEventContext) => readonly { itemId: string; count: number }[];
    /** Existing insts the building holds (occupants, shelved items) leave with their identity and state. */
    hammerDropEntities?: (context: AnimatedBuildingEventContext) => void;
    /** standardcomponents.lua's burn time, generic fire level and heat propagator size. */
    burnable?: { burnTime: number; fxLevel: 2 | 3 | 4; propagator: 'small' | 'medium' | 'large' };
    onhit?: (context: AnimatedBuildingHammerContext) => void;
    onhammered?: (context: AnimatedBuildingHammerContext) => void;
    /** Preloaded, temporary destruction art, independent of a building's skin. */
    hammerEffect?: { archive: string; animation: string; name: string };
    name: string;
    container?: BuildingContainerDefinition;
    /**
     * Prepares prefab resources alongside the sprite, without playing effects. Returned
     * materials belong to this instance's art and are released with it.
     */
    prepare?: () => Promise<void | AnimatedBuildingPreparedResources>;
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
    symbolOverrides?: Readonly<Record<string, { archive: string; symbol: string }>>;
    hiddenLayers?: readonly string[];
    canInteract?: (context: AnimatedBuildingEventContext) => boolean;
    onrestore?: (context: AnimatedBuildingEventContext, components: PlacementSaveRecord['components']) => void;
    onupdate?: (context: AnimatedBuildingEventContext, dt: number) => void;
    exportComponents?: (context: AnimatedBuildingEventContext) => PlacementSaveRecord['components'];
    onreskin?: (context: AnimatedBuildingEventContext) => void;
    ondispose?: (context: AnimatedBuildingEventContext) => void;
    oninit?: (context: AnimatedBuildingEventContext) => void;
    createContainer?: (inst: object) => import('./containers').BuildingContainer;
    renderEffects?: (context: AnimatedBuildingEventContext) => readonly BuildingRenderEffect[];
}

export interface BuildingRenderEffect { object: THREE.Group; footPosition: THREE.Vector3; sortLayer: number; }

export interface AnimatedBuildingPreparedResources {
    readonly materials: readonly THREE.Material[];
    dispose?(): void;
}

export interface AnimatedBuildingEventContext {
    model: THREE.Group;
    animation: SpriteAnimationController;
    skinId?: string;
    /** Result of the definition's prepare() for the art currently displayed. */
    prepared?: AnimatedBuildingPreparedResources;
    itemEntities?: WorldContext['itemEntities'];
    world?: WorldContext;
    /** inst:Remove(): releases the building's art, components and physics. */
    remove?: () => void;
}

export interface AnimatedBuildingBuiltContext extends AnimatedBuildingEventContext {
    onComplete: () => void;
}

export interface AnimatedBuildingHammerContext extends AnimatedBuildingEventContext {
    workLeft: number;
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
    closeImmediately?: boolean;
    /** Opening plays no clip of its own; onopen drives the animation (bookstation hit). */
    openImmediately?: boolean;
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
    readonly skinId: Signal<string | undefined>;
    readonly burnt: Signal<boolean>;
    prepared?: AnimatedBuildingPreparedResources;
    readonly preparedSkins: Map<string | undefined, AnimatedBuildingInstance<BuildId>>;
    stopSkin?: () => void;
    stopBurnt?: () => void;
    stopBurning?: () => void;
    skinArtReleased?: boolean;
    effectFactory?: AnimatedSpriteFactory;
    fireFactory?: AnimatedSpriteFactory;
    fire?: THREE.Group;
}

export class AnimatedBuildingPlacement<BuildId extends string> {
    private readonly actionEvents: WorldContext['actionEvents'];
    private readonly stopActionEvents: () => void;
    private disposed = false;
    private readonly worldContext: WorldContext;
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
        this.worldContext = world;
        this.actionEvents = world.actionEvents;
        this.stopActionEvents = bindActionCancellation(world, this, 'building', () => this.cancel());
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

        this.actionEvents?.emit('action:begin', { owner: this, action: 'BUILD' });
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
        this.initializeComponents(building);
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
        this.initializeComponents(building);
        const container = building.model.userData.components?.container;
        if (!this.worldContext.registerContainer && record.components.container) {
            container?.OnLoad({ items: Object.fromEntries(record.components.container.slots.map(({ slotKey, item }) => [String(Number(slotKey) + 1), item])) });
        }
        this.definitions[buildId].onrestore?.(this.eventContext(building), record.components);
        if (record.components.building?.burnt) this.burnBuilding(building);
        this.faceCamera(building.model);
        this.scene.add(building.model);
        this.placed.push(building);
        return building.model;
    }

    exportRecords(): PlacedEntitySaveRecord[] {
        // inst.persists = false: buildings that are being destroyed are not saved.
        return this.placed.filter(building => building.model.userData.persists !== false).map((building) => ({
            prefabId: building.buildId,
            record: {
                id: building.model.userData.entityId as string,
                transform: {
                    position: saveGroundPosition(building.model.position, building.groundOffset),
                    rotationY: 0,
                },
                components: {
                    ...(building.model.userData.components?.container ? { container: {
                        slotCount: building.model.userData.components.container.GetNumSlots(),
                        slots: Object.entries(building.model.userData.components.container.OnSave().items)
                            .map(([slot, item]) => ({ slotKey: String(Number(slot) - 1), item: item as import('@dontstarve-web/inventory').InventoryStack })),
                    } } : {}),
                    ...this.definitions[building.buildId].exportComponents?.(this.eventContext(building)),
                    building: {
                        // Persist the target state of an interaction, not a transient animation frame.
                        state: building.interactionState === undefined ? 'idle'
                            : building.interactionState === 'open' || building.interactionState === 'opening'
                                ? 'open' : 'closed',
                        ...(building.skinId.peek() === undefined ? {} : { skinId: building.skinId.peek() }),
                        ...(building.burnt.peek()
                            || building.model.userData.components?.burnable?.IsBurning() ? { burnt: true as const } : {}),
                    },
                },
            },
        }));
    }

    performContainerAction(model: THREE.Object3D, action: 'COOK', doer: object): boolean {
        const building = this.placed.find(instance => instance.model === model);
        if (!building || this.disposed || building.isPlacing || !model.visible || !model.parent) return false;
        this.updateProximity(building);
        if (this.definitions[building.buildId].onProximity && !building.isPlayerNearby) return false;
        return action === 'COOK' && performCookAction({ components: model.userData.components ?? {} }, doer);
    }

    private initializeComponents(building: AnimatedBuildingInstance<BuildId>): void {
        const { model, buildId } = building;
        model.userData.getGroundPosition = () => model.position.clone().add(new THREE.Vector3(0, -building.groundOffset, 0));
        model.userData.dropLoot = (items: readonly { itemId: string; count: number }[]) => this.dropLoot?.(items, model.userData.getGroundPosition());
        this.bindSkin(building);
        model.userData.burntSignal = readonlySignal(building.burnt);
        building.stopBurnt = building.burnt.subscribe(burnt => {
            if (burnt) building.animation.start('burnt');
        });
        const container = this.definitions[buildId].createContainer?.(model)
            ?? (isStorageBuildingId(buildId) ? createBuildingContainer(buildId, model) : undefined);
        if (container) {
            model.userData.components = { container };
            this.worldContext.registerContainer?.(`world:${buildId}:${String(model.userData.entityId)}`, container,
                (model.userData.saveRecord as PlacementSaveRecord | undefined)?.components.container);
            container.onclosefn = () => {
                if (building.interactionState !== 'open' && building.interactionState !== 'opening') return;
                this.closeInteraction(building);
            };
        }
        this.definitions[buildId].oninit?.(this.eventContext(building));
        const definition = this.definitions[buildId];
        if (definition.hammerWorkLeft !== undefined) {
            const entity = actionEntity(model, buildId);
            const workable = new Workable(entity);
            entity.components.workable = workable;
            workable.SetWorkAction('HAMMER');
            workable.SetWorkLeft(definition.hammerWorkLeft);
            workable.SetOnWorkCallback(() => {
                if (entity.hasTag('burnt')) return;
                if (definition.hammerHitOnlyWhileWorking && workable.GetWorkLeft() <= 0) return;
                this.updateProximity(building);
                const context = this.hammerContext(building);
                if (definition.hammerDropContentsOnHit) {
                    model.userData.components?.container?.DropEverything(context.position);
                    model.userData.components?.container?.Close();
                }
                if (definition.onhit) definition.onhit(context);
                else {
                    const current = building.animation.currentAnimation;
                    const hit = definition.hammerAnimation === 'hit_empty'
                        ? current === 'cooking_loop' ? 'hit_cooking' : current === 'idle_full' ? 'hit_full' : 'hit_empty'
                        : (buildId === 'mushroom_light' || buildId === 'mushroom_light2') && current.endsWith('_on')
                            ? 'hit_on' : definition.hammerAnimation!;
                    building.animation.playTransient(hit);
                }
            });
            workable.SetOnFinishCallback(() => {
                const context = this.hammerContext(building);
                model.userData.components?.burnable?.Extinguish();
                if (entity.hasTag('burnt')) {
                    const loot = GetRecipeLoot(lootRecipes.get(buildId), lootRecipes, true);
                    if (Math.random() < .4) loot.push({ itemId: 'charcoal', count: 1 });
                    loot.push(...definition.hammerBonusLoot?.(this.eventContext(building)) ?? []);
                    context.dropLoot(loot); context.spawnEffect(); context.remove();
                } else if (definition.onhammered) definition.onhammered(context);
                else {
                    context.dropLoot([...GetRecipeLoot(lootRecipes.get(buildId), lootRecipes), ...(definition.hammerExtraLoot ?? []),
                        ...(definition.hammerBonusLoot?.(this.eventContext(building)) ?? []),
                        ...(definition.hammerHeldLoot?.(this.eventContext(building)) ?? [])]);
                    model.userData.components?.container?.DropEverything(context.position);
                    definition.hammerDropEntities?.(this.eventContext(building));
                    context.spawnEffect();
                    PlaySound('dontstarve/common/destroy_smoke', context.position);
                    if (definition.hammerMaterial) PlaySound(`dontstarve/common/destroy_${definition.hammerMaterial}`, context.position);
                    context.remove();
                }
            });
        }
        if (definition.burnable) this.initializeBurnable(building);
    }

    private initializeBurnable(building: AnimatedBuildingInstance<BuildId>): void {
        const entity = actionEntity(building.model, building.buildId), spec = this.definitions[building.buildId].burnable!;
        entity.addTag('structure');
        const inst: BurnableInst = entity;
        const burnable = new Burnable(inst);
        entity.components.burnable = burnable;
        burnable.SetBurnTime(spec.burnTime);
        entity.components.propagator = new Propagator(inst, spec.propagator, radius => {
            const targets: BurnableInst[] = [], origin = inst.getPosition();
            this.scene.traverse(model => {
                const target = model.userData.actionEntity as BurnableInst | undefined;
                if (!target?.components.propagator || target.isRemoved || target.hasTag('INLIMBO')) return;
                const position = target.getPosition();
                if ((position.x - origin.x) ** 2 + (position.z - origin.z) ** 2 <= radius ** 2) targets.push(target);
            });
            return targets;
        }, TILE_SIZE / 4, undefined, getBoundWatchWorldContent());
        building.model.userData.burningSignal = burnable.burning;
        building.stopBurning = burnable.burning.subscribe(burning => {
            if (!burning) { this.releaseFire(building); return; }
            const fire = building.fireFactory!.create({ initialAnimation: `level${spec.fxLevel}`, name: 'fire', scale: this.definitions[building.buildId].scale });
            fire.position.copy(entity.getPosition());
            building.fire = fire;
            this.scene.add(fire); this.effects.add(fire);
            setPrefabLocalLight(building.model, { colour: [1, 1, 192 / 255], radius: (spec.fxLevel + 1) * (TILE_SIZE / 4), intensity: .8, falloff: .33 });
            building.model.userData.fireSound = PlaySound('dontstarve/common/campfire', building.model.position);
        });
        burnable.SetOnExtinguishFn(() => { PlaySound('dontstarve/common/fireOut', building.model.position); });
        burnable.SetOnBurntFn(() => this.burnBuilding(building));
    }

    /** DefaultBurntStructureFn, including the supported container/stewer/workable branches. */
    private burnBuilding(building: AnimatedBuildingInstance<BuildId>): void {
        const { model } = building, entity = actionEntity(model, building.buildId);
        if (building.burnt.peek()) return;
        entity.addTag('burnt');
        if (entity.components.burnable) entity.components.burnable.canlight = false;
        entity.PushEvent?.('burntup', undefined);
        entity.components.prototyper?.OnRemoveFromEntity();
        delete entity.components.prototyper;
        entity.components.workable?.SetWorkLeft(1);
        const container = model.userData.components?.container;
        container?.DropEverything(entity.getPosition());
        container?.Close();
        this.releaseContainer(building);
        delete model.userData.components.container;
        const stewer = model.userData.components.stewer;
        stewer?.StopCooking('fire');
        stewer?.OnRemoveFromEntity();
        delete model.userData.components.stewer;
        model.userData.stewerSound?.stop(); delete model.userData.stewerSound;
        entity.components.burnable?.dispose(); delete entity.components.burnable;
        building.stopBurning?.(); building.stopBurning = undefined;
        entity.components.propagator?.dispose(); delete entity.components.propagator;
        this.releaseFire(building);
        building.interactionState = this.definitions[building.buildId].interaction ? 'closed' : undefined;
        building.burnt.set(true);
    }

    private releaseFire(building: AnimatedBuildingInstance<BuildId>): void {
        if (building.fire) {
            this.effects.delete(building.fire);
            building.fireFactory!.disposeSprite(building.fire);
            building.fire = undefined;
        }
        building.model.userData.fireSound?.stop(); delete building.model.userData.fireSound;
        setPrefabLocalLight(building.model, null);
    }

    private releaseBurnable(building: AnimatedBuildingInstance<BuildId>): void {
        building.stopBurning?.(); building.stopBurning = undefined;
        building.stopBurnt?.(); building.stopBurnt = undefined;
        const burnable = actionEntity(building.model, building.buildId).components.burnable;
        burnable?.SetOnExtinguishFn(undefined);
        burnable?.dispose();
        actionEntity(building.model, building.buildId).components.propagator?.dispose();
        this.releaseFire(building);
    }

    /** Whole sprite entities and their ground-contact points for depth sorting. */
    get renderEntities() {
        const entries = [...this.placed, ...(this.active ? [this.active] : []),
            ...Array.from(this.effects, (model) => ({ model, groundOffset: 0 }))]
            .filter(({ model }) => model.visible)
            .map(({ model, groundOffset }) => ({
                object: model,
                footPosition: model.position.clone().add(new THREE.Vector3(0, -groundOffset, 0)),
                cameraDepth: 0,
                sortGroup: model.id, sortLayer: 1,
            }));
        return [...entries, ...this.placed.flatMap(building =>
            (this.definitions[building.buildId].renderEffects?.(this.eventContext(building)) ?? [])
                .filter(effect => effect.object.visible).map(effect => ({ ...effect, cameraDepth: 0, sortGroup: building.model.id })))];
    }

    get spellTargets(): readonly import('./greenstaff').DeconstructionTarget[] {
        return this.placed.map(building => {
            const entity = actionEntity(building.model, building.buildId);
            const isValid = () => !this.disposed && this.placed.includes(building) && !building.isPlacing;
            return {
                prefab: building.buildId, model: building.model, components: building.model.userData.components,
                get position() { return building.model.position.clone().add(new THREE.Vector3(0, -building.groundOffset, 0)); },
                get isRemoved() { return !isValid(); }, isValid,
                isVisible: () => building.model.visible,
                hasTag: (tag: string) => entity.hasTag(tag),
                PushEvent: (name: string, data: unknown) => entity.PushEvent?.(name, data),
                removeOne: () => { if (!isValid()) return false; this.hammerContext(building).remove(); return true; },
            };
        });
    }

    get hammerTargets(): readonly HammerTarget[] {
        return this.placed.filter(building => actionEntity(building.model, building.buildId).hasTag('HAMMER_workable'))
            .map((building) => ({
                id: String(building.model.userData.entityId),
                entity: actionEntity(building.model, building.buildId),
                model: building.model,
                position: building.model.position.clone().add(new THREE.Vector3(0, -building.groundOffset, 0)),
                isValid: () => this.isHammerTargetValid(building),
                playHit: () => {
                    if (!this.isHammerTargetValid(building)) return;
                    performToolWork('HAMMER', actionEntity(building.model, building.buildId), {});
                },
            }));
    }

    get reskinTargets(): readonly ReskinTarget[] {
        return this.placed.map(building => {
                const isValid = () => !this.disposed && this.placed.includes(building) && !building.isPlacing
                    && building.model.visible && building.model.parent !== null;
                return {
                    id: String(building.model.userData.entityId), prefabId: building.buildId, model: building.model,
                    skins: Object.keys(this.definitions[building.buildId].skinArchives ?? {}),
                    get skinId() { return building.skinId.peek(); },
                    get isRemoved() { return building.model.userData.removed === true; },
                    hasTag: tag => actionEntity(building.model, building.buildId).hasTag(tag),
                    position: building.model.position.clone().add(new THREE.Vector3(0, -building.groundOffset, 0)), isValid,
                    prepareNextSkin: async (tool) => {
                        const previousSkin = building.skinId.peek();
                        const previousState = building.interactionState;
                        const skinId = nextReskin(Object.keys(this.definitions[building.buildId].skinArchives ?? {}), previousSkin, tool?._cached_reskinname, building.buildId);
                        const replacement = await this.createInstance(building.buildId, skinId, false,
                            previousState === 'open' ? 'open' : previousState === 'closed' ? 'closed' : 'idle');
                        if (!isValid() || building.skinId.peek() !== previousSkin || building.interactionState !== previousState) {
                            this.releasePreparedSkin(replacement);
                            return { apply: () => false, dispose: () => {} };
                        }
                        building.preparedSkins.set(skinId, replacement);
                        let used = false;
                        return {
                            apply: () => {
                                if (used || !isValid() || building.skinId.peek() !== previousSkin
                                    || building.preparedSkins.get(skinId) !== replacement) return false;
                                building.skinId.set(skinId);
                                used = true;
                                return true;
                            },
                            dispose: () => {
                                if (used) return;
                                if (building.preparedSkins.get(skinId) === replacement) building.preparedSkins.delete(skinId);
                                this.releasePreparedSkin(replacement);
                                used = true;
                            },
                        };
                    },
                };
            });
    }

    private eventContext(building: AnimatedBuildingInstance<BuildId>): AnimatedBuildingEventContext {
        return { model: building.model, animation: building.animation, skinId: building.skinId.peek(), prepared: building.prepared,
            itemEntities: this.worldContext.itemEntities, world: this.worldContext,
            remove: () => this.hammerContext(building).remove() };
    }

    /** Skin changes update presentation; the entity root and components retain their identity. */
    private bindSkin(building: AnimatedBuildingInstance<BuildId>): void {
        building.model.userData.skinIdSignal = readonlySignal(building.skinId);
        building.stopSkin = building.skinId.subscribe(skinId => {
            const replacement = building.preparedSkins.get(skinId);
            if (!replacement) throw new Error('Skin assets must be prepared before committing a skin change');
            building.preparedSkins.delete(skinId);
            replacement.skinArtReleased = true;
            const footY = building.model.position.y - building.groundOffset;
            (replacement.animation as SpriteController).copyPlaybackFrom(building.animation as SpriteController);
            this.disposeBuildingArt(building.model);
            for (const child of [...replacement.model.children]) building.model.add(child);
            registerSpriteRenderGroup(building.model, building.model.children[0] as THREE.Group);
            building.animation = replacement.animation;
            building.prepared = replacement.prepared;
            building.model.userData.animationController = replacement.animation;
            building.model.userData.ownedSpriteMaterials = replacement.model.userData.ownedSpriteMaterials;
            building.model.userData.disposePreparedResources = replacement.model.userData.disposePreparedResources;
            if (skinId === undefined) delete building.model.userData.skinId;
            else building.model.userData.skinId = skinId;
            building.groundOffset = replacement.groundOffset;
            building.model.position.y = footY + building.groundOffset;
            this.definitions[building.buildId].onreskin?.(this.eventContext(building));
            if (actionEntity(building.model, building.buildId).hasTag('burnt')) building.animation.start('burnt');
            if (building.isPlayerNearby) this.definitions[building.buildId].onturnon?.(this.eventContext(building));
        });
    }

    private disposeBuildingArt(model: THREE.Group): void {
        model.userData.disposePreparedResources?.();
        delete model.userData.disposePreparedResources;
        const materials = new Set<THREE.Material>();
        model.traverse(object => {
            for (const material of object.userData.ownedSpriteMaterials ?? []) materials.add(material);
            if (!(object instanceof THREE.Mesh)) return;
            object.geometry.dispose();
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
        });
        for (const material of materials) {
            if (material instanceof THREE.MeshBasicMaterial) material.map?.dispose();
            material.dispose();
        }
        model.clear();
    }

    private releaseSkin(building: AnimatedBuildingInstance<BuildId>): void {
        building.stopSkin?.();
        building.stopSkin = undefined;
        for (const replacement of building.preparedSkins.values()) this.releasePreparedSkin(replacement);
        building.preparedSkins.clear();
    }

    private releasePreparedSkin(replacement: AnimatedBuildingInstance<BuildId>): void {
        if (replacement.skinArtReleased) return;
        replacement.skinArtReleased = true;
        disposeSprite(replacement.model);
    }

    private releaseContainer(building: AnimatedBuildingInstance<BuildId>): void {
        const container = building.model.userData.components?.container;
        if (!container) return;
        container.onclosefn = undefined;
        container.onopenfn = undefined;
        this.worldContext.unregisterContainer?.(`world:${building.buildId}:${String(building.model.userData.entityId)}`, container);
        container.dispose();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.stopActionEvents();
        this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
        this.pointer.dispose();
        this.cancel();
        for (const instance of this.placed) {
            instance.model.userData.removed = true;
            actionEntity(instance.model, instance.buildId).components.workable?.dispose();
            this.releaseBurnable(instance);
            this.definitions[instance.buildId].ondispose?.(this.eventContext(instance));
            this.releaseContainer(instance);
            this.releaseSkin(instance);
            disposeSprite(instance.model);
        }
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
            this.definitions[building.buildId].onupdate?.(this.eventContext(building), dt);
            const components = actionEntity(building.model, building.buildId).components;
            components.burnable?.Update(dt);
            components.propagator?.Update(dt);
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

    /** Hover candidates for the shared GIVE action: every building with a trader. */
    get giveTargets(): readonly { model: THREE.Group; canGive(item: TradeItem): boolean }[] {
        return this.placed.filter(building => building.model.userData.components?.trader).map(building => ({
            model: building.model,
            canGive: (item: TradeItem) => this.canGive(building, item),
        }));
    }

    private canGive(building: AnimatedBuildingInstance<BuildId>, item: TradeItem): boolean {
        const trader: Trader<TradeItem> | undefined = building.model.userData.components?.trader;
        return !this.disposed && this.placed.includes(building) && !building.isPlacing && trader !== undefined
            && !actionEntity(building.model, building.buildId).hasTag('burnt')
            && isPlayerNearby(this.player.position, building.model.position, false) && trader.AbleToAccept(item).ok;
    }

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
        this.initializeComponents(placedBuilding);
        this.active = undefined;
        this.cursor.hide();
        onbuilt?.({
            ...this.eventContext(placedBuilding),
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
        if (actionEntity(building.model, building.buildId).hasTag('burnt')) return;
        const definition = this.definitions[building.buildId];
        const interaction = definition.interaction;
        if (!interaction) return;
        if (definition.canInteract?.(this.eventContext(building)) === false) return;
        this.updateProximity(building);
        if (definition.onProximity && !building.isPlayerNearby) return;

        if (building.interactionState === 'closed') {
            const container = building.model.userData.components?.container;
            if (container && (!container.canbeopened || !container.CanOpen())) return;
            container?.Open(this.player);
            definition.onopen?.({
                model: building.model,
                animation: building.animation,
                skinId: building.skinId.peek(),
            });
            if (interaction.openImmediately) {
                building.interactionState = 'open';
                this.onInteractionChange?.({ buildId: building.buildId, isOpen: true, model: building.model });
                return;
            }
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
        if (actionEntity(building.model, building.buildId).hasTag('burnt')) return;
        const definition = this.definitions[building.buildId];
        const interaction = definition.interaction;
        if (!interaction || (building.interactionState !== 'open'
            && building.interactionState !== 'opening')) return;

        building.interactionState = interaction.closeImmediately ? 'closed' : 'closing';
        building.model.userData.components?.container?.Close(this.player);
        definition.onclose?.({
            model: building.model,
            animation: building.animation,
            skinId: building.skinId.peek(),
        });
        this.onInteractionChange?.({
            buildId: building.buildId,
            isOpen: false,
            model: building.model,
        });
        if (interaction.closeImmediately) return;
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
        const [model, [preparedResult], effectFactory, fireFactory] = await Promise.all([createAnimatedSprite(
            `${import.meta.env.BASE_URL}dst/data/anim`,
            skin?.archive ?? definition.archive,
            {
                buildArchive: skin?.buildArchive ?? definition.buildArchive,
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
                symbolOverrides: definition.symbolOverrides,
                hiddenLayers: definition.hiddenLayers,
            },
        ), Promise.all([definition.prepare?.(), definition.hammerMaterial
            ? PreloadSounds('dontstarve/common/destroy_smoke', `dontstarve/common/destroy_${definition.hammerMaterial}`) : undefined]),
          definition.hammerEffect ? this.prepareEffect(definition.hammerEffect.archive) : undefined,
          definition.burnable ? Promise.all([this.prepareEffect('fire.zip'), PreloadSounds('dontstarve/common/campfire', 'dontstarve/common/fireOut')]).then(([factory]) => factory) : undefined]);
        const prepared = preparedResult as AnimatedBuildingPreparedResources | undefined;
        if (prepared) (model.userData.ownedSpriteMaterials ??= []).push(...prepared.materials);
        if (prepared?.dispose) model.userData.disposePreparedResources = () => prepared.dispose!();
        if (this.disposed) { disposeSprite(model); throw new Error('Placement has been disposed'); }
        model.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3().setFromObject(model);
        const instance: AnimatedBuildingInstance<BuildId> = {
            buildId,
            model,
            animation: model.userData.animationController as TransientSpriteAnimationController,
            effectFactory,
            fireFactory,
            groundOffset: -bounds.min.y,
            ...(definition.interaction ? { interactionState: state === 'open' ? 'open' as const : 'closed' as const } : {}),
            isPlacing: false,
            isPlayerNearby: state === 'open',
            skinId: createSignal(skinId),
            burnt: createSignal(false),
            prepared,
            preparedSkins: new Map(),
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
            && actionEntity(building.model, building.buildId).components.workable?.CanBeWorked() === true
            && building.model.visible && building.model.parent !== null;
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
            model: building.model, animation: building.animation, skinId: building.skinId.peek(), prepared: building.prepared,
            workLeft: actionEntity(building.model, building.buildId).components.workable?.GetWorkLeft() ?? 0,
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
                building.model.userData.removed = true;
                actionEntity(building.model, building.buildId).components.workable?.dispose();
                this.releaseBurnable(building);
                this.definitions[building.buildId].ondispose?.(this.eventContext(building));
                this.releaseSkin(building);
                this.releaseContainer(building);
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
            skinId: building.skinId.peek(),
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
