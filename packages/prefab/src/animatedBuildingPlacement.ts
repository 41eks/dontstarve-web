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
import type { WorldContext, PrefabWorldContext } from './worldContext';
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
import { BuildingPlacer } from './buildingPlacer';
import { removeComponent } from './components';
import type { TradeItem, Trader } from '../../componets/src/trader';
import { TILE_SIZE } from './tile';
import { DefaultBurntStructureFn, MakeDeconstructable, MakeObstaclePhysics } from './standardcomponents';

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

export class AnimatedBuildingPlacement<BuildId extends string> {
    private disposed = false;
    private readonly worldContext: PrefabWorldContext;
    private readonly displays: PrefabDisplayGroup;
    private readonly player: THREE.Object3D;
    private readonly definitions: Readonly<Record<BuildId, AnimatedBuildingDefinition>>;
    private readonly onInteractionChange?: (
        change: AnimatedBuildingInteractionChange<BuildId>,
    ) => void;
    /** The build flow; committing a build places it here. */
    private readonly placer: BuildingPlacer<BuildId>;
    private readonly mouseRecords = new ModelRecords<AnimatedBuildingInstance<BuildId>>();
    private readonly placed: AnimatedBuildingInstance<BuildId>[] = [];
    /** Archives, atlas materials and frame geometry shared by every placed building of one build and skin, and by their effects. */
    private readonly sprites = new SpriteResources();
    private readonly fireFx = FireFxHost.create();
    private readonly skinAssets = this.sprites.archives;

    constructor(
        world: WorldContext,
        definitions: Readonly<Record<BuildId, AnimatedBuildingDefinition>>,
        consumeBufferedBuild: (buildId: BuildId) => boolean,
        onInteractionChange?: (change: AnimatedBuildingInteractionChange<BuildId>) => void,
    ) {
        const { scene, ...services } = world;
        this.worldContext = services;
        this.displays = new PrefabDisplayGroup(scene);
        this.player = world.player;
        this.definitions = definitions;
        this.onInteractionChange = onInteractionChange;
        this.placer = new BuildingPlacer(world, buildId => {
            const definition = this.definitions[buildId];
            return { buildLabel: definition.buildLabel, name: definition.name,
                animation: definition.previewAnimation ?? this.idleAnimation(buildId),
                art: (resources, skinId) => this.declareArt(resources, buildId, skinId) };
        }, consumeBufferedBuild, (buildId, position, skinId) => this.placeBuilding(buildId, position, skinId));
    }

    /** Shows the placer at once; its display draws the preview when its art has loaded. */
    begin(buildId: BuildId, skinId?: string): void { this.placer.begin(buildId, skinId); }

    spawn(buildId: BuildId, skinId?: string): void {
        const building = this.createInstance(buildId, skinId);
        const target = this.placer.groundInFrontOfPlayer();
        building.instance.setPosition(target.x, target.y, target.z);
        this.placed.push(building); this.mouseRecords.set(building.model, building);
        this.initializeComponents(building);
        this.registerContainer(building);
    }

    /** Restores a logical record directly, without crafting or placement callbacks. */
    spawnFromSave(buildId: BuildId, record: PlacementSaveRecord): THREE.Group {
        const building = this.createInstance(buildId, record.components.building?.skinId, false);
        building.instance.entityId = record.id;
        building.instance.saveRecord = record;
        const [x, y, z] = record.transform.position;
        building.instance.setPosition(x, y, z);
        this.initializeComponents(building);
        // SetPersistData: Container:OnLoad restores the items, and only then does inst.OnLoad run.
        const saved = record.components.container;
        if (saved) building.instance.components?.container?.OnLoad(saved);
        this.registerContainer(building);
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
                ...(instance.components?.container ? { container: instance.components.container.OnSave() } : {}),
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
        MakeDeconstructable(building.instance);
        const obstacleRadius = this.definitions[buildId].obstacleRadius;
        if (obstacleRadius !== undefined) MakeObstaclePhysics(building.instance, obstacleRadius);
        if (this.worldContext.physics) building.instance.bindPhysics(this.worldContext.physics);
        this.bindSkin(building);
        const container = this.definitions[buildId].createContainer?.(building.instance)
            ?? (isStorageBuildingId(buildId) ? createBuildingContainer(buildId, building.instance) : undefined);
        if (container) {
            container.SetAutoClose(this.worldContext.getWatchWorldContent ?? getBoundWatchWorldContent(), 3 * (TILE_SIZE / 4));
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
        const entries = this.placed
            .filter(({ model }) => model.visible)
            .map(({ model }) => ({
                object: model,
                footPosition: model.position,
                cameraDepth: 0, sortLayer: 1,
            }));
        return [...entries, ...this.placer.renderEntities, ...this.placed.flatMap(building => {
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
    /** Gives the UI and item moves an address for the slots the entity's container already owns. */
    private registerContainer({ buildId, instance }: AnimatedBuildingInstance<BuildId>): void {
        const container = instance.components?.container;
        if (container) this.worldContext.registerContainer?.(`world:${buildId}:${String(instance.entityId)}`, container);
    }

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
        this.placer.dispose();
        for (const building of [...this.placed]) building.instance.remove();
        this.placed.length = 0;
        // Every sprite is released above; only now can the atlases they drew from go.
        this.fireFx.dispose();
        this.displays.dispose(); this.sprites.dispose();
    }

    cancel() { this.placer.cancel(); }

    update(dt: number) {
        // Displays advance the declared clips of the buildings and their fire effects.
        this.displays.update(dt);
        this.placer.update(dt);
        for (const building of this.placed) {
            this.definitions[building.buildId].onupdate?.(this.eventContext(building), dt);
            const components = actionEntity(building.model, building.buildId).components;
            components.burnable?.Update(dt);
            components.propagator?.Update(dt);
            building.burn?.update(dt);
        }
    }

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

    /** The build flow's commit: the building is spawned afresh where its placer stood. */
    private placeBuilding(buildId: BuildId, position: THREE.Vector3, skinId?: string): void {
        const building = this.createInstance(buildId, skinId);
        building.instance.copyPosition(position);
        this.placed.push(building); this.mouseRecords.set(building.model, building);
        this.initializeComponents(building);
        this.registerContainer(building);
        building.instance.PushEvent('onbuilt', undefined);
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

    private idleAnimation(buildId: BuildId) {
        return this.definitions[buildId].idleAnimation ?? 'idle';
    }
}
