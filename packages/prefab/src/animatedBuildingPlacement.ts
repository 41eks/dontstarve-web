import { PrefabDisplayGroup, SpriteResources, type LoadedSpriteSource } from '@dontstarve-web/display';
import { ToolMouseTarget } from './toolMouseTarget';
import { ModelRecords } from './modelRecords';
import * as THREE from 'three';
import { AnimState, type AnimStateArt } from '@dontstarve-web/animation/animState';
import { createEffect, watchSignal, getBoundWatchWorldContent, WorldContentKey, type ReadonlySignal, type Signal } from '@dontstarve-web/signals';
import { disposeSprite } from './disposeSprite';
import type { AnimatedSpriteSourceOptions } from '@dontstarve-web/animation/sprite';
import { createPrefabEntity, type PrefabInstance } from './prefabInstance';
import type { PrefabDisplay, SpriteState } from '@dontstarve-web/display';
import { watchTileActivity } from './tileActivity';
import type { PrefabSkinInitializer } from '@dontstarve-web/animation/prefabskin';
import type { BuildingContainerDefinition } from './containers';
import { BuildCursor } from './buildCursor';
import { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import type { WorldContext, PrefabWorldContext } from './worldContext';
import { bindActionCancellation } from '@dontstarve-web/stategraphs/actionEvents';
import { newEntityId, saveGroundPosition, type PlacementSaveRecord, type PlacedEntitySaveRecord } from './saveRecord';
import type { HammerTarget } from '@dontstarve-web/stategraphs/hammer';
import { nextReskin } from './reskin_tool';
import { type ReskinFxMessage, type ReskinTarget } from '@dontstarve-web/stategraphs/reskin_tool';
import { isPlayerNearby } from './playerProximity';
import { createBuildingContainer, isStorageBuildingId } from './containers';
import { performCookAction } from '../../stategraphs/src/cook';
import { Workable } from '../../componets/src/workable';
import { actionEntity, findActionEntity, FindEntities } from './actionEntity';
import type { MiniMapState } from '../../map/src/minimapState';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { GetRecipeLoot, type LootRecipe } from '../../componets/src/lootdropper';
import recipeData from '@dontstarve-web/animation/recipes.json';
import { PlaySound, type SoundHandle } from './sound';
import { Burnable, type BurnableInst } from '../../componets/src/burnable';
import { Propagator } from '../../componets/src/propagator';
import type { TradeItem, Trader } from '../../componets/src/trader';
import { TILE_SIZE } from './tile';
import { MakeObstaclePhysics } from './standardcomponents';

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
    /** Source MakeObstaclePhysics radius in DST units; previews never bind a body. */
    obstacleRadius?: number;
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
    /** Temporary destruction art, independent of a building's skin. */
    hammerEffect?: { archive: string; animation: string; name: string };
    /** Sources of the fx children the prefab spawns (its Lua prefab dependencies), declared on the placement's shared resources. */
    fxSources?: (sprites: SpriteResources) => readonly LoadedSpriteSource[];
    name: string;
    /** Source AddMiniMapEntity() + MiniMapEntity:SetIcon(); omitted buildings have no map icon. */
    minimapIcon?: string;
    container?: BuildingContainerDefinition;
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
    /**
     * A skin init_fn / clear_fn that writes the building's own AnimState (OverrideItemSkinSymbol / ClearOverrideSymbol)
     * instead of calling SetSkin; `skinArchive` is the skin's entry in `skinArchives`.
     */
    skinAnimState?: { init(anim: AnimState, skinArchive: string): void; clear(anim: AnimState): void };
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

/** An effect drawn at its building's foot point, behind (0) or after (2+) the building (1). */
export interface BuildingRenderEffect { object: THREE.Group; sortLayer: number; }

export interface AnimatedBuildingEventContext {
    model: THREE.Group;
    /** The building entity: identity, tags and persistence. */
    instance: PrefabInstance;
    animation: SpriteState;
    /** Changes whenever the building's drawn sprite is rebuilt; effects that dress the sprite read it. */
    art?: ReadonlySignal<number>;
    /** inst.AnimState: the building's own symbol overrides and layers, declared once on its sprite and dressed by the display. */
    animState: AnimState;
    /** Shared resource owner for the builds named by the entity's AnimState slots; display performs the IO. */
    animStateArt?: AnimStateArt;
    /** The placement's shared sprite sources for the fx children a building spawns; declaring one performs no IO. */
    sprites?: SpriteResources;
    skinId?: string;
    itemEntities?: WorldContext['itemEntities'];
    world?: PrefabWorldContext;
    displays?: PrefabDisplayGroup;
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
    readonly instance: PrefabInstance;
    /** Draws the building; its sprite is built only while the building's tile is active. */
    readonly display: PrefabDisplay;
    readonly animation: SpriteState;
    /** The entity's own AnimState. */
    readonly animState: AnimState;
    interactionState?: AnimatedBuildingInteractionState;
    isPlacing: boolean;
    isPlayerNearby: boolean;
    readonly skinId: Signal<string | undefined>;
    stopSkin?: () => void;
    stopActivity?: () => void;
    stopBurning?: () => void;
    fire?: DrawnEffect;
    fireSound?: SoundHandle;
    minimap?: MiniMapState;
}

/** A transient fx entity (fire, collapse) drawn by its own display. */
interface DrawnEffect { readonly instance: PrefabInstance; readonly display: PrefabDisplay }

export class AnimatedBuildingPlacement<BuildId extends string> {
    private readonly actionEvents: WorldContext['actionEvents'];
    private readonly stopActionEvents: () => void;
    private disposed = false;
    private readonly worldContext: PrefabWorldContext;
    private readonly canvas: HTMLCanvasElement;
    private readonly displays: PrefabDisplayGroup;
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
    private readonly mouseRecords = new ModelRecords<AnimatedBuildingInstance<BuildId>>();
    private readonly placed: AnimatedBuildingInstance<BuildId>[] = [];
    private readonly effects = new Set<DrawnEffect>();
    /** Archives, atlas materials and frame geometry shared by every placed building of one build and skin, and by their effects. */
    private readonly sprites = new SpriteResources();
    private readonly skinAssets = this.sprites.archives;
    private stopPlayerPositions?: () => void;

    constructor(
        world: WorldContext,
        definitions: Readonly<Record<BuildId, AnimatedBuildingDefinition>>,
        consumeBufferedBuild: (buildId: BuildId) => boolean,
        onInteractionChange?: (change: AnimatedBuildingInteractionChange<BuildId>) => void,
    ) {
        const { scene, ...services } = world;
        this.worldContext = services;
        this.actionEvents = world.actionEvents;
        this.stopActionEvents = bindActionCancellation(world, this, 'building', () => this.cancel());
        this.canvas = world.renderer.domElement;
        this.displays = new PrefabDisplayGroup(scene);
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
        // Proximity follows the world's player snapshots; interactions still recheck the live position.
        const playerpositions = getBoundWatchWorldContent()?.(WorldContentKey.PlayerPositions, stop => { this.stopPlayerPositions = stop; });
        if (playerpositions) createEffect(() => {
            const [position] = playerpositions.get();
            if (position) for (const building of this.placed) this.updateProximity(building, position);
        });
    }

    /** Shows the placer at once; its display draws the preview when its art has loaded. */
    begin(buildId: BuildId, skinId?: string): void {
        if (this.disposed) throw new Error('Placement has been disposed');
        if (this.active) return;

        this.actionEvents?.emit('action:begin', { owner: this, action: 'BUILD' });
        this.cursor.show(`: 建造 ${this.definitions[buildId].buildLabel}`, 'left');
        try { this.createPreview(buildId, skinId); } catch (error) { this.cursor.hide(); throw error; }
    }

    spawn(buildId: BuildId, skinId?: string): void {
        const building = this.createInstance(buildId, skinId);
        const target = this.playerFrontGroundPosition();
        building.instance.position.set(target.x, target.y, target.z);
        building.model.visible = true;
        building.animation.setOpacity(1);
        this.placed.push(building); this.mouseRecords.set(building.model, building);
        this.initializeComponents(building);
    }

    /** Restores a logical record directly, without crafting or placement callbacks. */
    spawnFromSave(buildId: BuildId, record: PlacementSaveRecord): THREE.Group {
        const building = this.createInstance(
            buildId, record.components.building?.skinId, false,
            record.components.building?.state,
        );
        building.instance.entityId = record.id;
        building.instance.saveRecord = record;
        const [x, y, z] = record.transform.position;
        building.instance.position.set(x, y, z);
        this.initializeComponents(building);
        const container = building.instance.components?.container;
        if (!this.worldContext.registerContainer && record.components.container) {
            container?.OnLoad({ items: Object.fromEntries(record.components.container.slots.map(({ slotKey, item }) => [String(Number(slotKey) + 1), item])) });
        }
        this.definitions[buildId].onrestore?.(this.eventContext(building), record.components);
        if (record.components.building?.burnt) this.burnBuilding(building);
        this.displays.mount(building.display);
        this.placed.push(building); this.mouseRecords.set(building.model, building);
        return building.model;
    }

    exportRecords(): PlacedEntitySaveRecord[] {
        // inst.persists = false: buildings that are being destroyed are not saved.
        return this.placed.filter(building => building.instance.persists).map((building) => ({
            prefabId: building.buildId,
            record: {
                id: building.instance.entityId as string,
                transform: {
                    position: saveGroundPosition(building.instance.position, 0),
                    rotationY: 0,
                },
                components: {
                    ...(building.instance.components?.container ? { container: {
                        slotCount: building.instance.components.container.GetNumSlots(),
                        slots: Object.entries(building.instance.components.container.OnSave().items)
                            .map(([slot, item]) => ({ slotKey: String(Number(slot) - 1), item: item as import('@dontstarve-web/inventory').InventoryStack })),
                    } } : {}),
                    ...this.definitions[building.buildId].exportComponents?.(this.eventContext(building)),
                    building: {
                        // Persist the target state of an interaction, not a transient animation frame.
                        state: building.interactionState === undefined ? 'idle'
                            : building.interactionState === 'open' || building.interactionState === 'opening'
                                ? 'open' : 'closed',
                        ...(building.skinId.peek() === undefined ? {} : { skinId: building.skinId.peek() }),
                        // A burning structure saves as burnt; a firepit's own fire is restored from its fuel.
                        ...(building.instance.hasTag('burnt') || (this.definitions[building.buildId].burnable
                            && building.instance.components?.burnable?.IsBurning()) ? { burnt: true as const } : {}),
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
        return action === 'COOK' && performCookAction(building.instance, doer);
    }

    private initializeComponents(building: AnimatedBuildingInstance<BuildId>): void {
        const { model, buildId } = building;
        actionEntity(model, buildId).reskinTarget = this.createReskinTarget(building);
        const obstacleRadius = this.definitions[buildId].obstacleRadius;
        if (obstacleRadius !== undefined) MakeObstaclePhysics(building.instance, obstacleRadius);
        if (this.worldContext.physics) building.instance.bindPhysics(this.worldContext.physics);
        this.bindSkin(building);
        const container = this.definitions[buildId].createContainer?.(model)
            ?? (isStorageBuildingId(buildId) ? createBuildingContainer(buildId, model) : undefined);
        if (container) {
            Object.assign(building.instance.components, { container });
            this.worldContext.registerContainer?.(`world:${buildId}:${String(building.instance.entityId)}`, container,
                building.instance.saveRecord?.components.container);
            container.onclosefn = () => {
                if (building.interactionState !== 'open' && building.interactionState !== 'opening') return;
                this.closeInteraction(building);
            };
        }
        this.definitions[buildId].oninit?.(this.eventContext(building));
        const definition = this.definitions[buildId];
        if (definition.minimapIcon !== undefined) {
            building.minimap = building.instance.minimap;
            building.minimap.SetIcon(definition.minimapIcon);
        }
        if (definition.hammerWorkLeft !== undefined) {
            const entity = actionEntity(model, buildId);
            const workable = new Workable(building.instance);
            entity.components.workable = workable;
            workable.SetWorkAction('HAMMER');
            workable.SetWorkLeft(definition.hammerWorkLeft);
            entity.hammerTarget = {
                get id() { return String(building.instance.entityId); },
                entity: building.instance, instance: building.instance, display: building.display,
                get position() { return entity.getPosition(); },
                isValid: () => this.isHammerTargetValid(building),
                playHit: () => {
                    if (this.isHammerTargetValid(building)) performToolWork('HAMMER', entity, {});
                },
            };
            workable.SetOnWorkCallback(() => {
                if (entity.hasTag('burnt')) return;
                if (definition.hammerHitOnlyWhileWorking && workable.GetWorkLeft() <= 0) return;
                this.updateProximity(building);
                const context = this.hammerContext(building);
                if (definition.hammerDropContentsOnHit) {
                    building.instance.components?.container?.DropEverything(context.position);
                    building.instance.components?.container?.Close();
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
                building.instance.components?.burnable?.Extinguish();
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
                    building.instance.components?.container?.DropEverything(context.position);
                    definition.hammerDropEntities?.(this.eventContext(building));
                    context.spawnEffect();
                    PlaySound('dontstarve/common/destroy_smoke', context.position);
                    if (definition.hammerMaterial) PlaySound(`dontstarve/common/destroy_${definition.hammerMaterial}`, context.position);
                    context.remove();
                }
            });
        }
        if (definition.burnable) this.initializeBurnable(building);
        if (definition.hammerWorkLeft !== undefined || definition.burnable) {
            const entity = actionEntity(model, buildId);
            new ToolMouseTarget(entity, building.instance, entity.components.workable, this.worldContext.handEquipment, {
                canInteractWithoutTool: () => !entity.hasTag('burnt') && !!(definition.interaction
                    || definition.container || building.instance.components?.container || entity.components.trader || entity.components.fueled
                    || entity.components.prototyper || entity.components.occupiable),
            });
        }
        // OnEntitySleep/OnEntityWake: the sprite exists only while the building's tile is active.
        building.stopActivity = watchTileActivity(model, this.worldContext.tickingarea, active => building.instance.setActive(active));
    }

    private initializeBurnable(building: AnimatedBuildingInstance<BuildId>): void {
        const entity = actionEntity(building.model, building.buildId), spec = this.definitions[building.buildId].burnable!;
        entity.addTag('structure');
        const inst: BurnableInst = entity;
        const burnable = new Burnable(inst);
        entity.components.burnable = burnable;
        burnable.SetBurnTime(spec.burnTime);
        entity.components.propagator = new Propagator(inst, spec.propagator, radius => {
            return FindEntities(inst.getPosition(), radius).filter(target => target.components.propagator && !target.hasTag('INLIMBO'));
        }, TILE_SIZE / 4, undefined, getBoundWatchWorldContent());
        building.stopBurning = burnable.burning.subscribe(burning => {
            if (!burning) { this.releaseFire(building); return; }
            const fire = this.createEffect(this.fireSource(building.buildId), 'fire', `level${spec.fxLevel}`, true, ['FX', 'HASHEATER']);
            fire.instance.position.copy(entity.getPosition());
            building.fire = fire;
            this.displays.mount(fire.display); this.effects.add(fire);
            building.instance.light.set({ colour: [1, 1, 192 / 255], radius: (spec.fxLevel + 1) * (TILE_SIZE / 4), intensity: .8, falloff: .33 });
            building.fireSound = PlaySound('dontstarve/common/campfire', building.model.position);
        });
        burnable.SetOnExtinguishFn(() => { PlaySound('dontstarve/common/fireOut', building.model.position); });
        burnable.SetOnBurntFn(() => this.burnBuilding(building));
    }

    /** DefaultBurntStructureFn, including the supported container/stewer/workable branches. */
    private burnBuilding(building: AnimatedBuildingInstance<BuildId>): void {
        const { model } = building, entity = actionEntity(model, building.buildId);
        if (building.instance.hasTag('burnt')) return;
        entity.addTag('burnt');
        if (entity.components.burnable) entity.components.burnable.canlight = false;
        entity.PushEvent?.('burntup', undefined);
        entity.components.prototyper?.OnRemoveFromEntity();
        delete entity.components.prototyper;
        entity.components.workable?.SetWorkLeft(1);
        const container = building.instance.components?.container;
        container?.DropEverything(entity.getPosition());
        container?.Close();
        this.releaseContainer(building);
        delete building.instance.components.container;
        const stewer = building.instance.components.stewer;
        stewer?.StopCooking('fire');
        stewer?.OnRemoveFromEntity();
        delete building.instance.components.stewer;
        entity.components.burnable?.dispose(); delete entity.components.burnable;
        building.stopBurning?.(); building.stopBurning = undefined;
        entity.components.propagator?.dispose(); delete entity.components.propagator;
        this.releaseFire(building);
        building.interactionState = this.definitions[building.buildId].interaction ? 'closed' : undefined;
        building.animation.start('burnt');
    }

    private releaseFire(building: AnimatedBuildingInstance<BuildId>): void {
        if (building.fire) {
            this.effects.delete(building.fire);
            this.releaseEffect(building.fire);
            building.fire = undefined;
        }
        building.fireSound?.stop(); building.fireSound = undefined;
        building.instance.light.set(null);
    }

    private releaseBurnable(building: AnimatedBuildingInstance<BuildId>): void {
        building.stopActivity?.(); building.stopActivity = undefined;
        building.stopBurning?.(); building.stopBurning = undefined;
        const burnable = actionEntity(building.model, building.buildId).components.burnable;
        burnable?.SetOnExtinguishFn(undefined);
        burnable?.dispose();
        actionEntity(building.model, building.buildId).components.propagator?.dispose();
        this.releaseFire(building);
    }

    /** Whole sprite entities and their ground-contact points for depth sorting. */
    get renderEntities() {
        const entries = [...this.placed, ...(this.active ? [this.active] : []),
            ...Array.from(this.effects, ({ display }) => ({ model: display.model }))]
            .filter(({ model }) => !this.placed.some(({ fire }) => fire?.display.model === model))
            .filter(({ model }) => model.visible)
            .map(({ model }) => ({
                object: model,
                footPosition: model.position,
                cameraDepth: 0, sortLayer: 1,
            }));
        // A burning building's fire and its declared effects share its foot point, so they order with the building.
        const fires = this.placed.filter(({ fire }) => fire?.display.model.visible).map(({ model, fire }) => ({
            object: fire!.display.model, footPosition: model.position,
            cameraDepth: 0, sortLayer: 2 }));
        return [...entries, ...fires, ...this.placed.flatMap(building => {
            const effects = (this.definitions[building.buildId].renderEffects?.(this.eventContext(building)) ?? []).filter(effect => effect.object.visible);
            if (!effects.length) return [];
            const footPosition = building.instance.position;
            return effects.map(effect => ({ ...effect, footPosition, cameraDepth: 0 }));
        })];
    }

    get spellTargets(): readonly import('./staff').DeconstructionTarget[] { return this.getSpellTargets(); }

    getSpellTargets(model?: THREE.Object3D): readonly import('./staff').DeconstructionTarget[] {
        return this.mouseRecords.select(model, this.placed).map(building => {
            const entity = actionEntity(building.model, building.buildId);
            const isValid = () => !this.disposed && this.placed.includes(building) && !building.isPlacing;
            return {
                prefab: building.buildId, instance: building.instance, display: building.display,
                components: building.instance.components as import('./staff').DeconstructionTarget['components'],
                get position() { return building.instance.position; },
                get isRemoved() { return !isValid(); }, isValid,
                isVisible: () => building.model.visible,
                hasTag: (tag: string) => entity.hasTag(tag),
                PushEvent: (name: string, data: unknown) => entity.PushEvent?.(name, data),
                removeOne: () => { if (!isValid()) return false; this.hammerContext(building).remove(); return true; },
            };
        });
    }

    get hammerTargets(): readonly HammerTarget[] { return this.getHammerTargets(); }

    getHammerTargets(model?: THREE.Object3D): readonly HammerTarget[] {
        return this.mouseRecords.select(model, this.placed).filter(building => actionEntity(building.model, building.buildId).hasTag('HAMMER_workable'))
            .map(building => actionEntity(building.model, building.buildId).hammerTarget)
            .filter((target): target is HammerTarget => target !== undefined);
    }

    get reskinTargets(): readonly ReskinTarget[] {
        return Array.from(this.placed, building => findActionEntity(building.model)?.reskinTarget)
            .filter((target): target is ReskinTarget => target !== undefined);
    }

    private createReskinTarget(building: AnimatedBuildingInstance<BuildId>): ReskinTarget {
        const isValid = () => !this.disposed && this.placed.includes(building) && !building.isPlacing && building.model.visible;
        return {
            get id() { return String(building.instance.entityId); }, prefabId: building.buildId,
            instance: building.instance, display: building.display,
            skins: Object.keys(this.definitions[building.buildId].skinArchives ?? {}),
            get skinId() { return building.skinId.peek(); },
            get isRemoved() { return building.instance.isRemoved; },
            hasTag: tag => actionEntity(building.model, building.buildId).hasTag(tag),
            get position() { return building.instance.position; }, isValid,
            prepareNextSkin: async (tool) => {
                const previousSkin = building.skinId.peek();
                const skinId = nextReskin(Object.keys(this.definitions[building.buildId].skinArchives ?? {}), previousSkin, tool?._cached_reskinname, building.buildId);
                let used = false;
                return {
                    skinId,
                    apply: (fx?: ReskinFxMessage) => {
                        if (used || !isValid() || building.skinId.peek() !== previousSkin) return false;
                        building.skinId.set(skinId);
                        fx?.play(building.instance.position, building.buildId);
                        used = true;
                        return true;
                    },
                    dispose: () => { used = true; },
                };
            },
        };
    }

    private eventContext(building: AnimatedBuildingInstance<BuildId>): AnimatedBuildingEventContext {
        return { model: building.model, instance: building.instance, animation: building.animation, art: building.animation.art,
            animState: building.animState, animStateArt: this.skinAssets, sprites: this.sprites, skinId: building.skinId.peek(),
            itemEntities: this.worldContext.itemEntities, world: this.worldContext, displays: this.displays,
            remove: () => this.hammerContext(building).remove() };
    }

    /** Skin changes update presentation; the entity root and components retain their identity. */
    private bindSkin(building: AnimatedBuildingInstance<BuildId>): void {
        const skin = watchSignal(building.skinId, stop => { building.stopSkin = stop; });
        let previous = skin.peek();
        createEffect(() => {
            const skinId = skin.get();
            if (skinId === previous) return;
            const definition = this.definitions[building.buildId];
            // Reskinning runs the old skin's clear_fn, then the new skin's init_fn.
            if (definition.skinAnimState) {
                if (previous !== undefined) definition.skinAnimState.clear(building.animState);
                if (skinId !== undefined) definition.skinAnimState.init(building.animState, definition.skinArchives![skinId]);
            }
            previous = skinId;
            definition.onreskin?.(this.eventContext(building));
            if (actionEntity(building.model, building.buildId).hasTag('burnt')) building.animation.start('burnt');
            if (building.isPlayerNearby) this.definitions[building.buildId].onturnon?.(this.eventContext(building));
        });
    }

    private releaseSkin(building: AnimatedBuildingInstance<BuildId>): void {
        building.stopSkin?.();
        building.stopSkin = undefined;
    }

    private releaseContainer(building: AnimatedBuildingInstance<BuildId>): void {
        const container = building.instance.components?.container;
        if (!container) return;
        container.onclosefn = undefined;
        container.onopenfn = undefined;
        this.worldContext.unregisterContainer?.(`world:${building.buildId}:${String(building.instance.entityId)}`, container);
        container.dispose();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.stopActionEvents();
        this.stopPlayerPositions?.();
        this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
        this.pointer.dispose();
        this.cancel();
        for (const instance of this.placed) {
            actionEntity(instance.model, instance.buildId).components.workable?.dispose();
            this.releaseBurnable(instance);
            this.definitions[instance.buildId].ondispose?.(this.eventContext(instance));
            this.releaseContainer(instance);
            this.releaseSkin(instance);

            disposeSprite(instance.model);
        }
        this.placed.length = 0;
        // Factory-owned effects share materials: each entity returns its sprite before the factories go.
        for (const effect of this.effects) this.releaseEffect(effect);
        this.effects.clear();
        // Every sprite is released above; only now can the atlases they drew from go.
        this.displays.dispose(); this.sprites.dispose();
    }

    cancel() {
        // Cancel only the placer; its display stops any load it started. The buffered build stays in inventory.
        if (this.active) disposeSprite(this.active.model);
        this.active = undefined;
        this.cursor.hide();
    }

    update(dt: number) {
        // Displays advance the declared clips: the placer preview's own, then the group's buildings and fire effects.
        this.active?.display.update(dt);
        this.displays.update(dt);
        this.cursor.update();
        for (const building of this.placed) {
            this.definitions[building.buildId].onupdate?.(this.eventContext(building), dt);
            const components = actionEntity(building.model, building.buildId).components;
            components.burnable?.Update(dt);
            components.propagator?.Update(dt);
        }
    }

    private readonly handlePointerDown = (event: PointerEvent) => {
        if (event.button === 2) {
            this.cancel();
            return;
        }
        if (event.button !== 0) return;
        if (event.defaultPrevented) return;
        if (this.active) {
            event.preventDefault();
            this.placeActiveBuilding(event);
            return;
        }
        this.interactWithPlacedBuilding(event);
    };

    /** Hover candidates for the shared GIVE action: every building with a trader. */
    get giveTargets(): readonly { model: THREE.Group; canGive(item: TradeItem): boolean }[] {
        return this.placed.filter(building => building.instance.components?.trader).map(building => ({
            model: building.model,
            canGive: (item: TradeItem) => this.canGive(building, item),
        }));
    }

    private canGive(building: AnimatedBuildingInstance<BuildId>, item: TradeItem): boolean {
        const trader: Trader<TradeItem> | undefined = building.instance.components?.trader;
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
        placedBuilding.animation.setOpacity(1);
        placedBuilding.model.visible = true;
        this.placed.push(placedBuilding); this.mouseRecords.set(placedBuilding.model, placedBuilding);
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
            const container = building.instance.components?.container;
            if (container && (!container.canbeopened || !container.CanOpen())) return;
            container?.Open(this.player);
            definition.onopen?.(this.eventContext(building));
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
        building.instance.components?.container?.Close(this.player);
        definition.onclose?.(this.eventContext(building));
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

    private createPreview(buildId: BuildId, skinId?: string): void {
        const instance = this.createInstance(buildId, skinId, true, undefined, true);
        instance.animation.setOpacity(0.65);
        instance.model.visible = false;
        this.active = instance;
        this.cursor.setPreview(instance.model, 0);
        this.cursor.update();
    }

    private createInstance(
        buildId: BuildId,
        skinId?: string,
        attach = true,
        state?: 'idle' | 'closed' | 'open',
        preview = false,
    ): AnimatedBuildingInstance<BuildId> {
        if (this.disposed) throw new Error('Placement has been disposed');
        const definition = this.definitions[buildId];
        const skinArchive = skinId === undefined ? undefined : definition.skinArchives?.[skinId];
        if (skinId !== undefined && skinArchive === undefined) throw new Error(`Unsupported ${buildId} skin: ${skinId}`);
        const skin = skinId === undefined ? undefined : definition.skinInit?.(skinId);
        const archive = skin?.archive ?? definition.archive;
        const sourceOptions: AnimatedSpriteSourceOptions = { buildArchive: skin?.buildArchive ?? definition.buildArchive,
            symbolOverrides: definition.symbolOverrides };
        const initialAnimation = preview && definition.previewAnimation ? definition.previewAnimation
            : state === 'open' && definition.interaction ? definition.interaction.openAnimation : this.idleAnimation(buildId);
        const held = state === 'open' && !definition.interaction?.openAnimationLoop;
        // A preview is made translucent through its materials, so it keeps resources of its own.
        const resources = preview ? new SpriteResources() : this.sprites;
        const source: LoadedSpriteSource = resources.animated(archive, sourceOptions, {
            name: definition.name, scale: definition.scale,
            skinSymbols: definition.skinSymbols, baseSymbols: definition.baseSymbols,
            skinAnimationBanks: skinId === undefined ? undefined : definition.skinAnimationBanks?.[skinId],
            hiddenLayers: definition.hiddenLayers,
        });
        // The fx it spawns load with the building, so that they are drawn when they are spawned.
        const dependencies = preview ? [] : [
            ...definition.hammerEffect ? [this.hammerEffectSource(definition.hammerEffect)] : [],
            ...definition.burnable ? [this.fireSource(buildId)] : [],
            ...definition.fxSources?.(this.sprites) ?? []];
        const animState = new AnimState();
        if (definition.skinAnimState && skinArchive !== undefined) definition.skinAnimState.init(animState, skinArchive);
        const { instance: entity, display } = createPrefabEntity(buildId, source, { name: initialAnimation, held, billboard: true }, definition.name, entity => {
            entity.skinId = skinId;
            entity.sprite.setAnimState(animState.json, this.skinAssets);
            if (definition.skinAnimState) return;
            entity.sprite.setSkinSource({ art: this.skinAssets,
                archives: Object.fromEntries(Object.entries(definition.skinArchives ?? {}).map(([id, archive]) =>
                    [id, definition.skinInit?.(id).skinArchive ?? archive])),
                symbols: definition.skinSymbols, baseSymbols: definition.baseSymbols, animationBanks: definition.skinAnimationBanks });
        }, undefined, { alignBottom: true, dependencies });
        const { model } = display;
        if (preview) display.onDispose(() => resources.dispose());
        const instance: AnimatedBuildingInstance<BuildId> = {
            buildId,
            model,
            instance: entity,
            display,
            animation: entity.sprite,
            animState,
            ...(definition.interaction ? { interactionState: state === 'open' ? 'open' as const : 'closed' as const } : {}),
            isPlacing: false,
            isPlayerNearby: state === 'open',
            skinId: entity.sprite.skinId,
        };
        if (skinArchive !== undefined) instance.instance.skinId = skinId;
        if (state === 'open' && definition.interaction?.openAnimationLoop) {
            instance.animation.start(definition.interaction.openAnimation);
        }
        if (attach) instance.instance.entityId = newEntityId();
        if (attach) this.displays.mount(display);
        return instance;
    }

    private hammerEffectSource({ archive, name }: NonNullable<AnimatedBuildingDefinition['hammerEffect']>): LoadedSpriteSource {
        return this.sprites.animated(archive, {}, { name });
    }

    private fireSource(buildId: BuildId): LoadedSpriteSource {
        return this.sprites.animated('fire.zip', {}, { name: 'fire', scale: this.definitions[buildId].scale });
    }

    private isHammerTargetValid(building: AnimatedBuildingInstance<BuildId>): boolean {
        return !this.disposed && this.placed.includes(building) && !building.isPlacing
            && actionEntity(building.model, building.buildId).components.workable?.CanBeWorked() === true
            && building.model.visible && building.model.parent !== null;
    }

    private hammerContext(building: AnimatedBuildingInstance<BuildId>): AnimatedBuildingHammerContext {
        const position = building.instance.position.clone();
        return {
            ...this.eventContext(building),
            workLeft: actionEntity(building.model, building.buildId).components.workable?.GetWorkLeft() ?? 0,
            position, isPlayerNearby: building.isPlayerNearby,
            dropLoot: (items) => this.dropLoot?.(items, position.clone()),
            spawnEffect: () => {
                const definition = this.definitions[building.buildId].hammerEffect;
                if (!definition || this.disposed) return;
                const effect = this.createEffect(this.hammerEffectSource(definition), definition.name, definition.animation, false, ['FX', 'NOCLICK']);
                effect.instance.position.copy(position);
                this.displays.mount(effect.display);
                this.effects.add(effect);
                effect.instance.sprite.playOnce(definition.animation, () => {
                    this.effects.delete(effect);
                    this.releaseEffect(effect);
                });
            },
            remove: () => {
                const index = this.placed.indexOf(building);
                if (index < 0) return;
                this.placed.splice(index, 1);
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

    private updateProximity(building: AnimatedBuildingInstance<BuildId>, playerPosition: THREE.Vector3 = this.player.position) {
        if (building.isPlacing) return;

        const definition = this.definitions[building.buildId];
        if (!definition.onProximity) return;

        const nearby = isPlayerNearby(playerPosition, building.model.position, building.isPlayerNearby);
        if (nearby === building.isPlayerNearby) return;

        building.isPlayerNearby = nearby;
        if (!nearby) this.closeInteraction(building);
        const onProximityChange = nearby ? definition.onturnon : definition.onturnoff;
        onProximityChange?.(this.eventContext(building));
    }

    private idleAnimation(buildId: BuildId) {
        return this.definitions[buildId].idleAnimation ?? 'idle';
    }

    private createEffect(source: LoadedSpriteSource, prefab: string, animation: string, loop: boolean, tags: readonly string[]): DrawnEffect {
        const effect = createPrefabEntity(prefab, source, { name: animation, held: !loop, billboard: true }, prefab);
        effect.instance.persists = false;
        for (const tag of tags) effect.instance.addTag(tag);
        return effect;
    }

    private releaseEffect({ instance, display }: DrawnEffect): void { instance.remove(); display.dispose(); }
}
