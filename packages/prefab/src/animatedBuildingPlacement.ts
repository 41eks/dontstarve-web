import { PrefabDisplayGroup, SpriteResources, type LoadedSpriteSource } from '@dontstarve-web/display';
import { ToolMouseTarget } from './toolMouseTarget';
import { ModelRecords } from './modelRecords';
import * as THREE from 'three';
import { AnimState, type AnimStateArt } from '@dontstarve-web/animation/animState';
import { createEffect, watchSignal, getBoundWatchWorldContent, type ReadonlySignal, type Signal } from '@dontstarve-web/signals';
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
import { reskinTarget } from './reskin_tool';
import type { ReskinTarget } from '@dontstarve-web/stategraphs/reskin_tool';
import { isPlayerNearby } from './playerProximity';
import { createBuildingContainer, isStorageBuildingId, releaseBuildingContainer } from './containers';
import { performCookAction } from '../../stategraphs/src/cook';
import { actionEntity, findActionEntity } from './actionEntity';
import type { MiniMapState } from '../../map/src/minimapState';
import { PlaySound } from './sound';
import { BurnableBinding, FireFxHost } from './treeFire';
import { removeComponent } from './components';
import type { TradeItem, Trader } from '../../componets/src/trader';
import { TILE_SIZE } from './tile';
import { DefaultBurntStructureFn, MakeObstaclePhysics } from './standardcomponents';

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
    /** standardcomponents.lua's burn time, generic fire level and heat propagator size. */
    burnable?: { burnTime: number; fxLevel: 2 | 3 | 4; propagator: 'small' | 'medium' | 'large' };
    /** Sources of the fx children the prefab spawns (its Lua prefab dependencies), declared on the placement's shared resources. */
    fxSources?: (sprites: SpriteResources) => readonly LoadedSpriteSource[];
    name: string;
    /** Source AddMiniMapEntity() + MiniMapEntity:SetIcon(); omitted buildings have no map icon. */
    minimapIcon?: string;
    container?: BuildingContainerDefinition;
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
    onupdate?: (context: AnimatedBuildingEventContext, dt: number) => void;
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

export interface AnimatedBuildingInteractionChange<BuildId extends string> {
    buildId: BuildId;
    isOpen: boolean;
    model: THREE.Group;
}

interface AnimatedBuildingInstance<BuildId extends string> {
    buildId: BuildId;
    model: THREE.Group;
    readonly instance: PrefabInstance;
    /** Draws the building; its sprite is built only while the building's tile is active. */
    readonly display: PrefabDisplay;
    readonly animation: SpriteState;
    /** The entity's own AnimState. */
    readonly animState: AnimState;
    readonly skinId: Signal<string | undefined>;
    stopSkin?: () => void;
    stopActivity?: () => void;
    stopContainerEvents?: () => void;
    burn?: BurnableBinding;
    minimap?: MiniMapState;
}

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
    /** Archives, atlas materials and frame geometry shared by every placed building of one build and skin, and by their effects. */
    private readonly sprites = new SpriteResources();
    private readonly fireFx = FireFxHost.create();
    private readonly skinAssets = this.sprites.archives;
    /** Placers are made translucent through their materials, so they draw from resources apart from the buildings'. */
    private readonly placerSprites = new SpriteResources();

    constructor(
        world: WorldContext,
        definitions: Readonly<Record<BuildId, AnimatedBuildingDefinition>>,
        consumeBufferedBuild: (buildId: BuildId) => boolean,
        onInteractionChange?: (change: AnimatedBuildingInteractionChange<BuildId>) => void,
    ) {
        const { scene, ...services } = world;
        this.worldContext = services;
        this.actionEvents = world.actionEvents;
        this.stopActionEvents = bindActionCancellation(world, this, () => this.cancel(), reason => reason === 'emote');
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
        building.instance.setPosition(target.x, target.y, target.z);
        this.placed.push(building); this.mouseRecords.set(building.model, building);
        this.initializeComponents(building);
    }

    /** Restores a logical record directly, without crafting or placement callbacks. */
    spawnFromSave(buildId: BuildId, record: PlacementSaveRecord): THREE.Group {
        const building = this.createInstance(buildId, record.components.building?.skinId, false);
        building.instance.entityId = record.id;
        building.instance.saveRecord = record;
        const [x, y, z] = record.transform.position;
        building.instance.setPosition(x, y, z);
        this.initializeComponents(building);
        const container = building.instance.components?.container;
        if (!this.worldContext.registerContainer && record.components.container) {
            container?.OnLoad({ items: Object.fromEntries(record.components.container.slots.map(({ slotKey, item }) => [String(Number(slotKey) + 1), item])) });
        }
        building.instance.OnLoad?.(building.instance, record.components);
        this.displays.mount(building.display);
        this.placed.push(building); this.mouseRecords.set(building.model, building);
        return building.model;
    }

    exportRecords(): PlacedEntitySaveRecord[] {
        // inst.persists = false: buildings that are being destroyed are not saved.
        return this.placed.filter(building => building.instance.persists).map((building) => {
            const { instance } = building, skinId = building.skinId.peek();
            const components: PlacementSaveRecord['components'] = {
                ...(instance.components?.container ? { container: {
                    slotCount: instance.components.container.GetNumSlots(),
                    slots: Object.entries(instance.components.container.OnSave().items)
                        .map(([slot, item]) => ({ slotKey: String(Number(slot) - 1), item: item as import('@dontstarve-web/inventory').InventoryStack })),
                } } : {}),
                building: skinId === undefined ? {} : { skinId },
            };
            instance.OnSave?.(instance, components);
            return {
                prefabId: building.buildId,
                record: {
                    id: instance.entityId as string,
                    transform: { position: saveGroundPosition(instance.position, 0), rotationY: 0 },
                    components,
                },
            };
        });
    }

    performContainerAction(model: THREE.Object3D, action: 'COOK', doer: object): boolean {
        const building = this.placed.find(instance => instance.model === model);
        if (!building || this.disposed || !model.visible || !model.parent) return false;
        return action === 'COOK' && performCookAction(building.instance, doer);
    }

    private initializeComponents(building: AnimatedBuildingInstance<BuildId>): void {
        const { model, buildId } = building;
        building.instance.worldServices = this.worldContext;
        building.instance.onRemove(() => this.releaseBuilding(building));
        actionEntity(model, buildId).reskinTarget = this.createReskinTarget(building);
        actionEntity(model, buildId).deconstructionTarget = this.createDeconstructionTarget(building);
        const obstacleRadius = this.definitions[buildId].obstacleRadius;
        if (obstacleRadius !== undefined) MakeObstaclePhysics(building.instance, obstacleRadius);
        if (this.worldContext.physics) building.instance.bindPhysics(this.worldContext.physics);
        this.bindSkin(building);
        const container = this.definitions[buildId].createContainer?.(building.instance)
            ?? (isStorageBuildingId(buildId) ? createBuildingContainer(buildId, building.instance) : undefined);
        if (container) {
            container.SetAutoClose(this.worldContext.getWatchWorldContent ?? getBoundWatchWorldContent(), 3 * (TILE_SIZE / 4));
            this.worldContext.registerContainer?.(`world:${buildId}:${String(building.instance.entityId)}`, container,
                building.instance.saveRecord?.components.container);
            this.watchContainer(building);
        }
        this.definitions[buildId].oninit?.(this.eventContext(building));
        const definition = this.definitions[buildId];
        if (definition.minimapIcon !== undefined) {
            building.minimap = building.instance.minimap;
            building.minimap.SetIcon(definition.minimapIcon);
        }
        const workable = building.instance.components.workable;
        if (definition.burnable) this.initializeBurnable(building);
        if (workable || definition.burnable) {
            const entity = actionEntity(model, buildId);
            new ToolMouseTarget(entity, building.instance, entity.components.workable, this.worldContext.handEquipment, {
                canInteractWithoutTool: () => !entity.hasTag('burnt') && !!(definition.container || building.instance.components?.container || entity.components.trader || entity.components.fueled
                    || entity.components.prototyper || entity.components.occupiable),
            });
        }
        // OnEntitySleep/OnEntityWake: the sprite exists only while the building's tile is active.
        building.stopActivity = watchTileActivity(model, this.worldContext.tickingarea, active => building.instance.setActive(active));
    }

    private initializeBurnable(building: AnimatedBuildingInstance<BuildId>): void {
        building.instance.addTag('structure');
        building.burn = new BurnableBinding(building.instance, {
            ...this.definitions[building.buildId].burnable!,
            onExtinguish: () => { PlaySound('dontstarve/common/fireOut', building.instance.position); },
            onBurnt: () => {
                DefaultBurntStructureFn(building.instance);
                building.burn?.dispose(); building.burn = undefined;
            },
        }, { fire: this.fireFx });
    }

    private releaseBurnable(building: AnimatedBuildingInstance<BuildId>): void {
        building.stopActivity?.(); building.stopActivity = undefined;
        building.burn?.dispose(); building.burn = undefined;
    }

    /** Whole sprite entities and their ground-contact points for depth sorting. */
    get renderEntities() {
        const entries = [...this.placed, ...(this.placer ? [{ model: this.placer.display.model }] : [])]
            .filter(({ model }) => model.visible)
            .map(({ model }) => ({
                object: model,
                footPosition: model.position,
                cameraDepth: 0, sortLayer: 1,
            }));
        return [...entries, ...this.placed.flatMap(building => {
            const effects = (this.definitions[building.buildId].renderEffects?.(this.eventContext(building)) ?? []).filter(effect => effect.object.visible);
            if (!effects.length) return [];
            const footPosition = building.instance.position;
            return effects.map(effect => ({ ...effect, footPosition, cameraDepth: 0 }));
        })];
    }

    get reskinTargets(): readonly ReskinTarget[] {
        return Array.from(this.placed, building => findActionEntity(building.model)?.reskinTarget)
            .filter((target): target is ReskinTarget => target !== undefined);
    }

    /** The greenstaff's view of a placed building: deconstruction removes the building. */
    private createDeconstructionTarget(building: AnimatedBuildingInstance<BuildId>): import('./staff').DeconstructionTarget {
        const entity = actionEntity(building.model, building.buildId);
        const isValid = () => !this.disposed && this.placed.includes(building);
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
    }

    private createReskinTarget(building: AnimatedBuildingInstance<BuildId>): ReskinTarget {
        const isValid = () => !this.disposed && this.placed.includes(building) && building.model.visible;
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
        });
    }

    private releaseSkin(building: AnimatedBuildingInstance<BuildId>): void {
        building.stopSkin?.();
        building.stopSkin = undefined;
    }

    /** The application's storage panel follows the container's onopen and onclose events. */
    private watchContainer(building: AnimatedBuildingInstance<BuildId>): void {
        const { buildId, model, instance } = building;
        const stopOpen = instance.ListenForEvent('onopen', () => this.onInteractionChange?.({ buildId, isOpen: true, model }));
        const stopClose = instance.ListenForEvent('onclose', () => this.onInteractionChange?.({ buildId, isOpen: false, model }));
        building.stopContainerEvents = () => { stopOpen(); stopClose(); };
    }

    private releaseContainer(building: AnimatedBuildingInstance<BuildId>): void {
        building.stopContainerEvents?.(); building.stopContainerEvents = undefined;
        const container = building.instance.components?.container;
        if (!container) return;
        container.onclosefn = undefined;
        container.onopenfn = undefined;
        releaseBuildingContainer(building.instance);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.stopActionEvents();
        this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
        this.stopPlacerGate?.();
        if (this.pointer !== this.worldContext.mouseActions?.pointer) this.pointer.dispose();
        this.cancel();
        for (const building of [...this.placed]) building.instance.remove();
        this.placed.length = 0;
        // Every sprite is released above; only now can the atlases they drew from go.
        this.fireFx.dispose();
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
        this.cursor.update();
        for (const building of this.placed) {
            this.definitions[building.buildId].onupdate?.(this.eventContext(building), dt);
            const components = actionEntity(building.model, building.buildId).components;
            components.burnable?.Update(dt);
            components.propagator?.Update(dt);
            building.burn?.update(dt);
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
        return !this.disposed && this.placed.includes(building) && trader !== undefined
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
        building.instance.copyPosition(placer.instance.position);
        this.releasePlacer();
        this.placed.push(building); this.mouseRecords.set(building.model, building);
        this.initializeComponents(building);
        building.instance.PushEvent('onbuilt', undefined);
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
    ): AnimatedBuildingInstance<BuildId> {
        if (this.disposed) throw new Error('Placement has been disposed');
        const definition = this.definitions[buildId];
        const { source, animState, initialize } = this.declareArt(this.sprites, buildId, skinId);
        // The fx it spawns load with the building, so that they are drawn when they are spawned.
        const dependencies = [
            ...definition.burnable ? [this.fireFx.source] : [],
            ...definition.fxSources?.(this.sprites) ?? []];
        const { instance: entity, display } = createPrefabEntity(buildId, source, { name: this.idleAnimation(buildId), held: definition.idleHeld === true, billboard: true },
            definition.name, initialize, undefined, { alignBottom: true, dependencies });
        const { model } = display;
        const instance: AnimatedBuildingInstance<BuildId> = {
            buildId,
            model,
            instance: entity,
            display,
            animation: entity.sprite,
            animState,
            skinId: entity.sprite.skinId,
        };
        if (attach) instance.instance.entityId = newEntityId();
        if (attach) this.displays.mount(display);
        return instance;
    }

    /** Inst removal owns the decision; the manager releases its registrations and shared-resource references. */
    private releaseBuilding(building: AnimatedBuildingInstance<BuildId>): void {
        const index = this.placed.indexOf(building);
        if (index >= 0) this.placed.splice(index, 1);
        removeComponent(building.instance, 'workable');
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

    private idleAnimation(buildId: BuildId) {
        return this.definitions[buildId].idleAnimation ?? 'idle';
    }
}
