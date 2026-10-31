import { PrefabDisplayGroup, SpriteResources, type LoadedSpriteSource } from '@dontstarve-web/display';
import { ToolMouseTarget } from './toolMouseTarget';
import { ModelRecords } from './modelRecords';
import * as THREE from 'three';
import { AnimState, type AnimStateArt } from '@dontstarve-web/animation/animState';
import { createEffect, watchSignal, getBoundWatchWorldContent, WorldContentKey, type ReadonlySignal, type Signal } from '@dontstarve-web/signals';
import type { AnimatedSpriteSourceOptions } from '@dontstarve-web/animation/sprite';
import { createPrefabEntity, type PrefabInstance } from './prefabInstance';
import type { PrefabDisplay, SpriteState } from '@dontstarve-web/display';
import { watchTileActivity } from './tileActivity';
import type { PrefabSkinInitializer } from '@dontstarve-web/animation/prefabskin';
import type { BuildingContainerDefinition } from './containers';
import { BuildCursor, declarePlacer, entityPlacer } from './buildCursor';
import { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import type { WorldContext, PrefabWorldContext } from './worldContext';
import { bindActionCancellation } from '@dontstarve-web/stategraphs/actionEvents';
import { newEntityId, saveGroundPosition, type PlacementSaveRecord, type PlacedEntitySaveRecord } from './saveRecord';
import type { HammerTarget } from '@dontstarve-web/stategraphs/hammer';
import { reskinTarget } from './reskin_tool';
import type { ReskinTarget } from '@dontstarve-web/stategraphs/reskin_tool';
import { isPlayerNearby } from './playerProximity';
import { createBuildingContainer, isStorageBuildingId } from './containers';
import { performCookAction } from '../../stategraphs/src/cook';
import { actionEntity, findActionEntity, FindEntities } from './actionEntity';
import type { MiniMapState } from '../../map/src/minimapState';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { PlaySound, type SoundHandle } from './sound';
import { Burnable, type BurnableInst } from '../../componets/src/burnable';
import { Propagator } from '../../componets/src/propagator';
import type { TradeItem, Trader } from '../../componets/src/trader';
import { TILE_SIZE } from './tile';
import { MakeObstaclePhysics } from './standardcomponents';
import { WorldFx } from './world_fx';

export interface AnimatedBuildingDefinition {
    /** Source MakeObstaclePhysics radius in DST units; previews never bind a body. */
    obstacleRadius?: number;
    archive: string;
    /** Build zip when `archive` holds only the bank. */
    buildArchive?: string;
    buildLabel: string;
    idleAnimation?: string;
    /** Source PlayAnimation(idle) / PushAnimation(closed, false): the idle and closed clips play once and rest on their last frame. */
    idleHeld?: boolean;
    previewAnimation?: string;
    interaction?: AnimatedBuildingToggleInteraction;
    /** standardcomponents.lua's burn time, generic fire level and heat propagator size. */
    burnable?: { burnTime: number; fxLevel: 2 | 3 | 4; propagator: 'small' | 'medium' | 'large' };
    /** Sources of the fx children the prefab spawns (its Lua prefab dependencies), declared on the placement's shared resources. */
    fxSources?: (sprites: SpriteResources) => readonly LoadedSpriteSource[];
    name: string;
    /** Source AddMiniMapEntity() + MiniMapEntity:SetIcon(); omitted buildings have no map icon. */
    minimapIcon?: string;
    container?: BuildingContainerDefinition;
    /** Runs only after successful placement; call onComplete when built effects finish. */
    onbuilt?: (context: AnimatedBuildingBuiltContext) => void;
    /** Runs when the container opens (RUMMAGE) and its opening animation starts. */
    onopen?: (context: AnimatedBuildingEventContext) => void;
    /** Runs when the container closes (RUMMAGE, the panel or a proximity exit) and its closing animation starts. */
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
}

export interface AnimatedBuildingBuiltContext extends AnimatedBuildingEventContext {
    onComplete: () => void;
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

/** A fire entity drawn by its own display. */
interface DrawnEffect { readonly instance: PrefabInstance; readonly display: PrefabDisplay }

/**
 * prefabutil.lua MakePlacer: a separate `<name>_placer` entity that only declares its clip, light override, opacity and
 * whether it is shown; its display draws it. Committing a build spawns the building itself, never this entity.
 */
interface BuildingPlacer<BuildId extends string> {
    readonly buildId: BuildId;
    readonly skinId?: string;
    readonly instance: PrefabInstance;
    readonly display: PrefabDisplay;
}

/** This project draws placers translucent; MakePlacer itself only sets SetLightOverride(1). */
const PLACER_OPACITY = 0.65;

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
    private readonly ownedFx?: WorldFx;
    private readonly definitions: Readonly<Record<BuildId, AnimatedBuildingDefinition>>;
    private readonly consumeBufferedBuild: (buildId: BuildId) => boolean;
    private readonly onInteractionChange?: (
        change: AnimatedBuildingInteractionChange<BuildId>,
    ) => void;
    private readonly cursor: BuildCursor;
    private readonly pointer: PointerRaycaster;
    private readonly stopPlacerGate?: () => void;
    private placer?: BuildingPlacer<BuildId>;
    private readonly mouseRecords = new ModelRecords<AnimatedBuildingInstance<BuildId>>();
    private readonly placed: AnimatedBuildingInstance<BuildId>[] = [];
    private readonly effects = new Set<DrawnEffect>();
    /** Archives, atlas materials and frame geometry shared by every placed building of one build and skin, and by their effects. */
    private readonly sprites = new SpriteResources();
    private readonly skinAssets = this.sprites.archives;
    /** Placers are made translucent through their materials, so they draw from resources apart from the buildings'. */
    private readonly placerSprites = new SpriteResources();
    private stopPlayerPositions?: () => void;

    constructor(
        world: WorldContext,
        definitions: Readonly<Record<BuildId, AnimatedBuildingDefinition>>,
        consumeBufferedBuild: (buildId: BuildId) => boolean,
        onInteractionChange?: (change: AnimatedBuildingInteractionChange<BuildId>) => void,
    ) {
        const { scene, ...services } = world;
        if (!services.fx?.collapse) {
            const sharedFx = services.fx;
            const fx = this.ownedFx = new WorldFx(scene);
            services.fx = { spawn: (prefab, position) => (sharedFx ?? fx).spawn(prefab, position),
                collapse: (size, position, material) => fx.collapse(size, position, material) };
        }
        this.worldContext = services;
        this.actionEvents = world.actionEvents;
        this.stopActionEvents = bindActionCancellation(world, this, 'building', () => this.cancel());
        this.canvas = world.renderer.domElement;
        this.displays = new PrefabDisplayGroup(scene);
        this.camera = world.camera;
        this.ground = world.ground;
        this.player = world.player;
        this.definitions = definitions;
        this.consumeBufferedBuild = consumeBufferedBuild;
        this.onInteractionChange = onInteractionChange;
        this.pointer = world.mouseActions?.pointer ?? new PointerRaycaster(world);
        this.cursor = new BuildCursor(world, this.pointer);
        // Action controllers see no mouse action while the placer is shown, so the click reaches the placer.
        this.stopPlacerGate = world.mouseActions?.registerPlacer(() => this.placer !== undefined);
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
        if (this.placer) return;

        const placer = this.createPlacer(buildId, skinId);
        this.actionEvents?.emit('action:begin', { owner: this, action: 'BUILD' });
        this.cursor.show(`: 建造 ${this.definitions[buildId].buildLabel}`, 'left');
        this.placer = placer;
        this.cursor.setPreview(entityPlacer(placer.instance), 0);
        this.cursor.update();
    }

    spawn(buildId: BuildId, skinId?: string): void {
        const building = this.createInstance(buildId, skinId);
        const target = this.playerFrontGroundPosition();
        building.instance.position.set(target.x, target.y, target.z);
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
        building.instance.worldServices = this.worldContext;
        building.instance.onRemove(() => this.releaseBuilding(building));
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
            container.onopenfn = () => this.openInteraction(building);
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
        const workable = building.instance.components.workable;
        if (workable?.GetWorkAction() === 'HAMMER') {
            const entity = actionEntity(model, buildId);
            entity.hammerTarget = {
                get id() { return String(building.instance.entityId); },
                entity: building.instance, instance: building.instance, display: building.display,
                get position() { return entity.getPosition(); },
                isValid: () => this.isHammerTargetValid(building),
                playHit: () => {
                    if (this.isHammerTargetValid(building)) performToolWork('HAMMER', entity, {});
                },
            };
        }
        if (definition.burnable) this.initializeBurnable(building);
        if (workable || definition.burnable) {
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
        const entries = [...this.placed, ...(this.placer ? [{ model: this.placer.display.model }] : []),
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
        return [...this.ownedFx?.renderEntities ?? [], ...entries, ...fires, ...this.placed.flatMap(building => {
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
                removeOne: () => { if (!isValid()) return false; building.instance.remove(); return true; },
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
        return reskinTarget({
            get id() { return String(building.instance.entityId); }, prefabId: building.buildId,
            instance: building.instance, display: building.display, sprite: building.animation,
            skins: Object.keys(this.definitions[building.buildId].skinArchives ?? {}),
            get isRemoved() { return building.instance.isRemoved; },
            hasTag: tag => actionEntity(building.model, building.buildId).hasTag(tag),
            get position() { return building.instance.position; }, isValid,
        });
    }

    private eventContext(building: AnimatedBuildingInstance<BuildId>): AnimatedBuildingEventContext {
        return { model: building.model, instance: building.instance, animation: building.animation, art: building.animation.art,
            animState: building.animState, animStateArt: this.skinAssets, sprites: this.sprites, skinId: building.skinId.peek(),
            itemEntities: this.worldContext.itemEntities, world: this.worldContext, displays: this.displays };
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
        this.stopPlacerGate?.();
        if (this.pointer !== this.worldContext.mouseActions?.pointer) this.pointer.dispose();
        this.cancel();
        for (const building of [...this.placed]) building.instance.remove();
        this.placed.length = 0;
        // Factory-owned effects share materials: each entity returns its sprite before the factories go.
        for (const effect of this.effects) this.releaseEffect(effect);
        this.effects.clear();
        // Every sprite is released above; only now can the atlases they drew from go.
        this.ownedFx?.dispose();
        this.displays.dispose(); this.sprites.dispose(); this.placerSprites.dispose();
    }

    cancel() {
        // Cancel only the placer; its display stops any load it started. The buffered build stays in inventory.
        this.releasePlacer();
    }

    private releasePlacer(): void {
        if (this.placer) { this.placer.instance.remove(); this.placer.display.dispose(); }
        this.placer = undefined;
        this.cursor.hide();
    }

    update(dt: number) {
        // Displays advance the declared clips of the placer, the buildings and their fire effects.
        this.displays.update(dt);
        this.ownedFx?.update(dt, this.camera.quaternion);
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
        if (event.button !== 0 || event.defaultPrevented || !this.placer) return;
        event.preventDefault();
        this.placeBuilding(event);
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

    /** Commits the build at the placer's position: the building is spawned afresh and the placer released. */
    private placeBuilding(event: PointerEvent) {
        const placer = this.placer;
        if (!placer) return;
        this.pointer.trackPointer(event);
        this.cursor.update();
        if (!this.pointer.isOverGround || !this.consumeBufferedBuild(placer.buildId)) return;

        const building = this.createInstance(placer.buildId, placer.skinId);
        building.instance.position.copy(placer.instance.position);
        this.releasePlacer();
        const onbuilt = this.definitions[building.buildId].onbuilt;
        building.isPlacing = onbuilt !== undefined;
        this.placed.push(building); this.mouseRecords.set(building.model, building);
        this.initializeComponents(building);
        // An opening clip would replace the place clip and drop its completion, so RUMMAGE waits for it.
        const container = building.instance.components?.container;
        if (container && building.isPlacing) container.canbeopened = false;
        onbuilt?.({
            ...this.eventContext(building),
            onComplete: () => {
                building.isPlacing = false;
                if (container) container.canbeopened = true;
            },
        });
    }

    /** container.onopenfn: RUMMAGE opened the container, so the building plays its opening (treasurechest onopen). */
    private openInteraction(building: AnimatedBuildingInstance<BuildId>) {
        const definition = this.definitions[building.buildId];
        const interaction = definition.interaction;
        if (!interaction || actionEntity(building.model, building.buildId).hasTag('burnt')) return;
        this.updateProximity(building);
        definition.onopen?.(this.eventContext(building));
        const opened = () => this.onInteractionChange?.({ buildId: building.buildId, isOpen: true, model: building.model });
        if (interaction.openImmediately) {
            building.interactionState = 'open';
            opened();
            return;
        }
        if (interaction.openAnimationLoop) {
            building.interactionState = 'open';
            building.animation.start(interaction.openAnimation);
            opened();
            return;
        }
        building.interactionState = 'opening';
        building.animation.playOnce(interaction.openAnimation, () => {
            building.interactionState = 'open';
            opened();
        });
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
        if (definition.idleHeld) {
            building.animation.playOnce(interaction.closeAnimation, () => { building.interactionState = 'closed'; });
            building.animation.pushAnimation(interaction.closedAnimation, false);
            return;
        }
        building.animation.playOnce(interaction.closeAnimation, () => {
            building.animation.start(interaction.closedAnimation);
            building.interactionState = 'closed';
        });
    }

    private createPlacer(buildId: BuildId, skinId?: string): BuildingPlacer<BuildId> {
        const definition = this.definitions[buildId];
        const art = this.declareArt(this.placerSprites, buildId, skinId);
        // MakePlacer: PlayAnimation(anim, true) with the shared placer declarations.
        const { instance, display } = createPrefabEntity(`${buildId}_placer`, art.source,
            { name: definition.previewAnimation ?? this.idleAnimation(buildId), billboard: true }, `${definition.name}Placer`, entity => {
                art.initialize(entity);
                declarePlacer(entity);
                entity.sprite.setOpacity(PLACER_OPACITY);
            }, undefined, { alignBottom: true });
        this.displays.mount(display);
        return { buildId, skinId, instance, display };
    }

    /** The source a building's art is drawn from and the appearance its entity declares before the first draw. */
    private declareArt(resources: SpriteResources, buildId: BuildId, skinId: string | undefined) {
        const definition = this.definitions[buildId];
        const skinArchive = skinId === undefined ? undefined : definition.skinArchives?.[skinId];
        if (skinId !== undefined && skinArchive === undefined) throw new Error(`Unsupported ${buildId} skin: ${skinId}`);
        const skin = skinId === undefined ? undefined : definition.skinInit?.(skinId);
        const sourceOptions: AnimatedSpriteSourceOptions = { buildArchive: skin?.buildArchive ?? definition.buildArchive,
            symbolOverrides: definition.symbolOverrides };
        const source: LoadedSpriteSource = resources.animated(skin?.archive ?? definition.archive, sourceOptions, {
            name: definition.name, scale: definition.scale,
            skinSymbols: definition.skinSymbols, baseSymbols: definition.baseSymbols,
            skinAnimationBanks: skinId === undefined ? undefined : definition.skinAnimationBanks?.[skinId],
            hiddenLayers: definition.hiddenLayers,
        });
        const animState = new AnimState();
        if (definition.skinAnimState && skinArchive !== undefined) definition.skinAnimState.init(animState, skinArchive);
        const initialize = (entity: PrefabInstance) => {
            entity.skinId = skinId;
            entity.sprite.setAnimState(animState.json, resources.archives);
            if (definition.skinAnimState) return;
            entity.sprite.setSkinSource({ art: resources.archives,
                archives: Object.fromEntries(Object.entries(definition.skinArchives ?? {}).map(([id, archive]) =>
                    [id, definition.skinInit?.(id).skinArchive ?? archive])),
                symbols: definition.skinSymbols, baseSymbols: definition.baseSymbols, animationBanks: definition.skinAnimationBanks });
        };
        return { source, animState, initialize };
    }

    private createInstance(
        buildId: BuildId,
        skinId?: string,
        attach = true,
        state?: 'idle' | 'closed' | 'open',
    ): AnimatedBuildingInstance<BuildId> {
        if (this.disposed) throw new Error('Placement has been disposed');
        const definition = this.definitions[buildId];
        const { source, animState, initialize } = this.declareArt(this.sprites, buildId, skinId);
        const initialAnimation = state === 'open' && definition.interaction ? definition.interaction.openAnimation : this.idleAnimation(buildId);
        const held = state === 'open' ? !definition.interaction?.openAnimationLoop : definition.idleHeld === true;
        // The fx it spawns load with the building, so that they are drawn when they are spawned.
        const dependencies = [
            ...definition.burnable ? [this.fireSource(buildId)] : [],
            ...definition.fxSources?.(this.sprites) ?? []];
        const { instance: entity, display } = createPrefabEntity(buildId, source, { name: initialAnimation, held, billboard: true },
            definition.name, initialize, undefined, { alignBottom: true, dependencies });
        const { model } = display;
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
        if (state === 'open' && definition.interaction?.openAnimationLoop) {
            instance.animation.start(definition.interaction.openAnimation);
        }
        if (attach) instance.instance.entityId = newEntityId();
        if (attach) this.displays.mount(display);
        return instance;
    }

    private fireSource(buildId: BuildId): LoadedSpriteSource {
        return this.sprites.animated('fire.zip', {}, { name: 'fire', scale: this.definitions[buildId].scale });
    }

    private isHammerTargetValid(building: AnimatedBuildingInstance<BuildId>): boolean {
        return !this.disposed && this.placed.includes(building) && !building.isPlacing
            && actionEntity(building.model, building.buildId).components.workable?.CanBeWorked() === true
            && building.model.visible && building.model.parent !== null;
    }

    /** Inst removal owns the decision; the manager releases its registrations and shared-resource references. */
    private releaseBuilding(building: AnimatedBuildingInstance<BuildId>): void {
        const index = this.placed.indexOf(building);
        if (index >= 0) this.placed.splice(index, 1);
        building.instance.components.workable?.dispose();
        this.releaseBurnable(building);
        this.definitions[building.buildId].ondispose?.(this.eventContext(building));
        this.releaseSkin(building);
        this.releaseContainer(building);
        building.display.dispose();
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
