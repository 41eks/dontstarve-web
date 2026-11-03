import { ToolMouseTarget } from './toolMouseTarget';
import { ModelRecords } from './modelRecords';
import * as THREE from 'three';
import { BuildCursor, declarePlacer, entityPlacer } from './buildCursor';
import { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import { snapToWallSlotCenter } from './tile';
import type { WorldContext, PrefabWorldContext } from './worldContext';
import { WorldFx } from './world_fx';
import { bindActionCancellation } from '@dontstarve-web/stategraphs/actionEvents';
import { newEntityId, saveGroundPosition, type PlacementSaveRecord, type PlacedEntitySaveRecord } from './saveRecord';
import { type PrefabInstance, bindInstance } from './prefabInstance';
import { PrefabDisplayGroup, SpriteResources, SpriteState, type PrefabDisplay } from '@dontstarve-web/display';
import { watchTileActivity } from './tileActivity';
import { reskinTarget } from './reskin_tool';
import type { ReskinTarget } from '@dontstarve-web/stategraphs/reskin_tool';
import { wallWorldPrefab, wallWorldSkin } from './wallSkins';
import { actionEntity } from './actionEntity';
import { FACING_CARDINAL } from '@dontstarve-web/animation/facing';
import type { PrefabSkinInitializer } from '@dontstarve-web/animation/prefabskin';

export interface WallDefinition {
    archive: string;
    /**
     * Anim archive supplying the `half` pose and `half_hit` feedback. Defaults
     * to the shared `wall.zip`; `wall_dreadstone` ships its own bank.
     */
    animationArchive?: string;
    buildLabel: string;
    /**
     * Front face art for cardinal camera headings (0/90/180/270), where the
     * wall's `facing=15` animations are used, e.g. `14` for `wall_segment-14`.
     */
    frontImageIndex: number;
    /**
     * DST `AnimState:SetMultColour` RGB triple, e.g. hay walls are drawn
     * slightly dark with `[0.9, 0.9, 0.9]`.
     */
    multColour?: readonly number[];
    name: string;
    /**
     * Symbol stacked over the main one. `wall_dreadstone` draws
     * `wall_segment_red` over `wall_segment_base`.
     */
    overlay?: {
        symbol: string;
        frontImageIndex: number;
        sideImageIndex: number;
    };
    scale: number;
    /**
     * Oblique side art for diagonal camera headings (45/135/225/315), where the
     * wall's `facing=240` animations are used, e.g. `4` for `wall_segment-4`.
     */
    sideImageIndex: number;
    /** Symbol the images belong to; defaults to the build's only symbol. */
    symbol?: string;
    skinArchives?: Readonly<Record<string, string>>;
    skinInit?: PrefabSkinInitializer;
    tags?: readonly string[];
    hammerWorkLeft?: number;
    hammerMaterial?: 'wood' | 'stone' | 'straw';
    hammerLoot?: { itemId: string; maxCount: number };
    /** walls.lua walldata.maxhealth; placed walls start at half of it. */
    maxhealth?: number;
    /** walldata.playerdamagemod → health:SetAbsorptionAmountFromPlayer. */
    playerdamagemod?: number;
    createPrefab: (prefab: string, sprite: SpriteState) => PrefabInstance;
    onplaced: (instance: PrefabInstance, saved?: { current: number; maximum: number }) => void;
}

interface WallInstance<BuildId extends string> {
    readonly buildId: BuildId;
    readonly model: THREE.Group;
    readonly instance: PrefabInstance;
    readonly display: PrefabDisplay;
    readonly inventorySkinId?: string;
    stopActivity?: () => void;
    entity?: ReturnType<typeof actionEntity>;
}



/** This project draws placers translucent; MakePlacer itself only sets SetLightOverride(1). */
const PLACER_OPACITY = .65;

function snapToWallSlot(point: THREE.Vector3): THREE.Vector3 {
    const snapped = snapToWallSlotCenter(point);
    return point.set(snapped.x, point.y, snapped.z);
}

/**
 * Places logical wall prefabs; the display owns static build art, transient clips and tile residency.
 */
export class WallPlacement<BuildId extends string> {
    private readonly actionEvents: WorldContext['actionEvents'];
    private readonly stopActionEvents: () => void;
    private disposed = false;
    private readonly canvas: HTMLCanvasElement;
    private readonly camera: THREE.Camera;
    private readonly ground: THREE.Object3D;
    private readonly player: THREE.Object3D;
    private readonly definitions: Readonly<Record<BuildId, WallDefinition>>;
    private readonly consumeBufferedBuild: (buildId: BuildId, skinId?: string) => boolean;
    private readonly cursor: BuildCursor;
    private readonly pointer: PointerRaycaster;
    private readonly stopPlacerGate?: () => void;
    /** The `wall_<name>_item_placer` entity; committing spawns a new wall, never this one. */
    private placer?: WallInstance<BuildId>;
    private readonly mouseRecords = new ModelRecords<WallInstance<BuildId>>();
    private readonly placed = new Set<WallInstance<BuildId>>();
    private readonly world: PrefabWorldContext;
    private readonly resources = new SpriteResources();
    private readonly displays: PrefabDisplayGroup;
    private readonly localFx?: WorldFx;

    constructor(
        world: WorldContext,
        definitions: Readonly<Record<BuildId, WallDefinition>>,
        consumeBufferedBuild: (buildId: BuildId, skinId?: string) => boolean,
    ) {
        const { scene, ...services } = world;
        this.localFx = world.fx?.collapse ? undefined : new WorldFx(scene);
        this.world = { ...services, fx: this.localFx ?? world.fx };
        this.actionEvents = world.actionEvents;
        this.stopActionEvents = bindActionCancellation(world, this, () => this.cancel(), reason => reason === 'emote');
        this.canvas = world.renderer.domElement;
        this.displays = new PrefabDisplayGroup(world.scene);
        this.camera = world.camera;
        this.ground = world.ground;
        this.player = world.player;
        this.definitions = definitions;
        this.consumeBufferedBuild = consumeBufferedBuild;
        this.pointer = world.mouseActions?.pointer ?? new PointerRaycaster(world);
        this.cursor = new BuildCursor(world, this.pointer);
        // Action controllers see no mouse action while the placer is shown, so the click reaches the placer.
        this.stopPlacerGate = world.mouseActions?.registerPlacer(() => this.placer !== undefined);
        world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    }

    begin(buildId: BuildId, skinId?: string): Promise<void> {
        if (this.disposed) return Promise.reject(new Error('Placement has been disposed'));
        if (this.placer) return Promise.resolve();

        let placer: WallInstance<BuildId>;
        try { placer = this.createPlacer(buildId, skinId); } catch (error) { return Promise.reject(error); }
        this.actionEvents?.emit('action:begin', { owner: this, action: 'BUILD' });
        this.cursor.show(`: 建造 ${this.definitions[buildId].buildLabel}`, 'left');
        this.placer = placer;
        this.cursor.setPreview(entityPlacer(placer.instance), 0, snapToWallSlot);
        this.cursor.update();
        return Promise.resolve();
    }

    async spawn(buildId: BuildId, skinId?: string): Promise<void> {
        const wall = this.createInstance(buildId, skinId);
        const target = this.playerFrontGroundPosition();
        wall.instance.position.copy(target);
        wall.instance.entityId = newEntityId();
        this.place(wall);
    }

    async spawnFromSave(buildId: BuildId, record: PlacementSaveRecord): Promise<THREE.Group> {
        const wall = this.createInstance(buildId, record.components.wall?.skinId);
        wall.instance.entityId = record.id;
        wall.instance.saveRecord = record;
        const [x, y, z] = record.transform.position;
        wall.instance.position.set(x, y, z);
        this.place(wall, record.components.health);
        return wall.model;
    }

    get renderEntities() {
        return [...this.displays.renderEntities, ...(this.localFx?.renderEntities ?? [])];
    }




    get reskinTargets(): readonly ReskinTarget[] {
        return Array.from(this.placed, wall => wall.entity?.reskinTarget)
            .filter((target): target is ReskinTarget => target !== undefined);
    }

    private createReskinTarget(wall: WallInstance<BuildId>): ReskinTarget {
        const isValid = () => this.isLive(wall);
        return reskinTarget({
            get id() { return String(wall.instance.entityId); }, prefabId: wallWorldPrefab(wall.buildId), instance: wall.instance, display: wall.display,
            sprite: wall.instance.sprite, skins: Object.keys(this.definitions[wall.buildId].skinArchives ?? {}),
            hasTag: tag => wall.instance.hasTag(tag), get position() { return wall.instance.position; }, isValid,
        });
    }

    exportRecords(): PlacedEntitySaveRecord[] {
        return Array.from(this.placed, (wall) => {
            const component = wall.instance.components.health!;
            const health = { current: component.currenthealth, maximum: component.maxhealth };
            const skinId = wall.instance.skinId;
            return {
                prefabId: wall.buildId,
                record: {
                    id: wall.instance.entityId as string,
                    transform: {
                        position: saveGroundPosition(wall.instance.position, 0),
                        rotationY: 0,
                    },
                    components: {
                        health,
                        ...(skinId === undefined ? {} : { wall: { skinId } }),
                    },
                },
            };
        });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.stopActionEvents();
        this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
        this.stopPlacerGate?.();
        if (this.pointer !== this.world.mouseActions?.pointer) this.pointer.dispose();
        this.cancel();
        for (const wall of this.placed) this.disposeWall(wall);
        this.localFx?.dispose();
        this.placed.clear();
        this.displays.dispose();
        this.resources.dispose();
    }

    cancel() {
        if (this.placer) this.disposeWall(this.placer);
        this.placer = undefined;
        this.cursor.hide();
    }

    update(dt = 0) {
        this.displays.update(dt);
        this.localFx?.update(dt, this.camera.quaternion);
        this.cursor.update();
    }

    private readonly handlePointerDown = (event: PointerEvent) => {
        if (event.button === 2) {
            this.cancel();
            return;
        }
        if (event.button !== 0 || event.defaultPrevented) return;
        const placer = this.placer;
        if (!placer) return;
        event.preventDefault();
        this.pointer.trackPointer(event);
        this.cursor.update();
        if (!this.pointer.isOverGround || !this.consumeBufferedBuild(placer.buildId, placer.inventorySkinId)) return;

        // The build spawns the wall itself at the placer's slot; the placer is released.
        const wall = this.createInstance(placer.buildId, placer.inventorySkinId);
        wall.instance.position.copy(placer.instance.position);
        wall.instance.entityId = newEntityId();
        this.cancel();
        this.place(wall);
    };

    /** walls.lua MakePlacer("wall_<name>_item_placer", bank, build, "half", ...): a separate, non-persisting entity. */
    private createPlacer(buildId: BuildId, skinId?: string): WallInstance<BuildId> {
        const placer = this.createInstance(buildId, skinId, PLACER_OPACITY, `${wallWorldPrefab(buildId)}_item_placer`);
        declarePlacer(placer.instance);
        return placer;
    }

    /** Declare static images, paired layers and source skin names; the display loads and dresses them. */
    private createInstance(buildId: BuildId, requestedSkin?: string, opacity = 1, prefab = wallWorldPrefab(buildId)): WallInstance<BuildId> {
        if (this.disposed) throw new Error('Placement has been disposed');
        const definition = this.definitions[buildId];
        const sprite = new SpriteState({ name: 'half', held: true, billboard: true });
        const instance = definition.createPrefab(prefab, sprite);
        instance.worldServices = this.world;
        instance.skinId = wallWorldSkin(buildId, requestedSkin);
        instance.sprite.setSkinSource({ art: this.resources.archives,
            archives: Object.fromEntries(Object.entries(definition.skinArchives ?? {}).map(([id, archive]) =>
                [id, definition.skinInit?.(id).skinArchive ?? archive])) });
        instance.sprite.setPose(undefined);
        instance.sprite.setFacingRotation(0);
        instance.sprite.setFacingImages(new Map([[FACING_CARDINAL, definition.frontImageIndex], [240, definition.sideImageIndex]]));
        if (definition.multColour) instance.sprite.setColour(definition.multColour);
        instance.sprite.setOpacity(opacity);
        const display = this.displays.add({ root: instance.transform.model, name: definition.name, status: instance.status, sprite: instance.sprite, light: instance.light, alignBottom: true,
            source: this.resources.staticFactory(definition.archive, {
                imageIndices: [definition.sideImageIndex, definition.frontImageIndex],
                name: definition.name, scale: definition.scale, symbol: definition.symbol,
                ...(definition.overlay ? { overlay: { symbol: definition.overlay.symbol,
                    imageIndices: [definition.overlay.sideImageIndex, definition.overlay.frontImageIndex] } } : {}),
                animationArchive: definition.animationArchive ?? 'wall.zip', restAnimation: 'half',
            }) });
        bindInstance(display.model, instance);
        return { buildId, instance, display, model: display.model, inventorySkinId: requestedSkin };
    }

    /** walls.lua components are owned by the logical instance after placement. */
    private initializeEntity(wall: WallInstance<BuildId>, saved?: { current: number; maximum: number }): void {
        const { buildId, instance, model } = wall;
        this.definitions[buildId].onplaced(instance, saved);
        const entity = wall.entity = actionEntity(model, wallWorldPrefab(buildId), instance);
        entity.reskinTarget = this.createReskinTarget(wall);
        if (instance.components.workable) new ToolMouseTarget(entity, instance, instance.components.workable, this.world.handEquipment);
        instance.onRemove(() => { this.placed.delete(wall); wall.stopActivity?.(); });
    }

    private place(wall: WallInstance<BuildId>, saved?: { current: number; maximum: number }): void {
        this.placed.add(wall); this.mouseRecords.set(wall.model, wall);
        this.initializeEntity(wall, saved);
        wall.stopActivity = watchTileActivity(wall.model, this.world.tickingarea, active => wall.instance.setActive(active));
    }

    private disposeWall(wall: WallInstance<BuildId>): void {
        wall.instance.remove();
        wall.stopActivity?.();
        wall.display.dispose();
    }

    private isLive(wall: WallInstance<BuildId>): boolean {
        return !this.disposed && !wall.instance.isRemoved && this.placed.has(wall);
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

}
