import { ToolMouseTarget } from './toolMouseTarget';
import { ModelRecords } from './modelRecords';
import * as THREE from 'three';
import { BuildCursor } from './buildCursor';
import { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import { snapToWallSlotCenter } from './tile';
import type { WorldContext } from './worldContext';
import { bindActionCancellation } from '@dontstarve-web/stategraphs/actionEvents';
import { newEntityId, saveGroundPosition, type PlacementSaveRecord, type PlacedEntitySaveRecord } from './saveRecord';
import type { HammerTarget } from '@dontstarve-web/stategraphs/hammer';
import { PrefabInstance, bindInstance } from './prefabInstance';
import { PrefabDisplayGroup, SpriteResources, SpriteState, type PrefabDisplay } from '@dontstarve-web/display';
import { watchTileActivity } from './tileActivity';
import { nextReskin } from './reskin_tool';
import { type ReskinFxMessage, type ReskinTarget } from '@dontstarve-web/stategraphs/reskin_tool';
import { wallWorldPrefab, wallWorldSkin } from './wallSkins';
import { actionEntity } from './actionEntity';
import { Workable } from '../../componets/src/workable';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { PlaySound } from './sound';
import { TILE_SIZE } from './tile';
import { MakeObstaclePhysics } from './standardcomponents';
import { Health } from '../../componets/src/health';
import { Combat, type CombatInst } from '../../componets/src/combat';
import { createEffect, watchSignal } from '@dontstarve-web/signals';
import { FACING_CARDINAL } from '@dontstarve-web/animation/facing';
import type { PrefabSkinInitializer } from '@dontstarve-web/animation/prefabskin';

/** DST distance unit in world units. */
const UNIT = TILE_SIZE / 4;
/** walls.lua: MakeObstaclePhysics(inst, .5). */
export const WALL_PHYSICS_RADIUS = .5 * UNIT;

/** walls.lua anims: thresholds on health percent, low to high. */
const WALL_HEALTH_ANIMS: readonly { threshold: number; anim: string | readonly string[] }[] = [
    { threshold: 0, anim: 'broken' },
    { threshold: 0.4, anim: 'onequarter' },
    { threshold: 0.5, anim: 'half' },
    { threshold: 0.99, anim: 'threequarter' },
    { threshold: 1, anim: ['fullA', 'fullB', 'fullC'] },
];

/** walls.lua resolveanimtoplay; the full variant is stable for a world position in DST units. */
export function resolveWallAnim(percent: number, position: THREE.Vector3): string {
    for (const { threshold, anim } of WALL_HEALTH_ANIMS) {
        if (percent > threshold) continue;
        if (typeof anim === 'string') return anim;
        const x = Math.floor(position.x / UNIT), z = Math.floor(position.z / UNIT);
        const q1 = anim.length + 1, q2 = anim.length + 4;
        const mod = (value: number, divisor: number) => value - Math.floor(value / divisor) * divisor;
        return anim[mod(mod(mod(x, q1) * (x + 3), q2) + mod(mod(z, q1) * (z + 3), q2), anim.length)];
    }
    return 'half';
}

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
    onhammered?: (context: WallHammerContext) => void;
}

/** Services supplied to walls.lua's prefab-owned onhammered callback. */
export interface WallHammerContext {
    readonly definition: WallDefinition;
    readonly health: Pick<Health, 'GetPercent'>;
    readonly position: THREE.Vector3;
    dropLoot(items: readonly { itemId: string; count: number }[]): void;
    spawnEffect(): void;
    remove(): void;
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

/** A live, attackable wall for combat target selection. */
export interface WallCombatTarget {
    readonly id: string;
    readonly model: THREE.Group;
    readonly inst: CombatInst;
    isValid(): boolean;
}


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
    private active?: WallInstance<BuildId>;
    private readonly mouseRecords = new ModelRecords<WallInstance<BuildId>>();
    private readonly placed = new Set<WallInstance<BuildId>>();
    private readonly world: WorldContext;
    private readonly resources = new SpriteResources();
    private readonly displays: PrefabDisplayGroup;
    private readonly effects = new Set<PrefabInstance>();

    constructor(
        world: WorldContext,
        definitions: Readonly<Record<BuildId, WallDefinition>>,
        consumeBufferedBuild: (buildId: BuildId, skinId?: string) => boolean,
    ) {
        this.world = world;
        this.actionEvents = world.actionEvents;
        this.stopActionEvents = bindActionCancellation(world, this, 'building', () => this.cancel());
        this.canvas = world.renderer.domElement;
        this.displays = new PrefabDisplayGroup(world.scene);
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
        if (this.disposed) return Promise.reject(new Error('Placement has been disposed'));
        if (this.active) return Promise.resolve();

        this.actionEvents?.emit('action:begin', { owner: this, action: 'BUILD' });
        this.cursor.show(`: 建造 ${this.definitions[buildId].buildLabel}`, 'left');
        try { this.createPreview(buildId, skinId); return Promise.resolve(); }
        catch (error) { this.cursor.hide(); return Promise.reject(error); }
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
        return this.displays.renderEntities;
    }

    get hammerTargets(): readonly HammerTarget[] { return this.getHammerTargets(); }

    getHammerTargets(model?: THREE.Object3D): readonly HammerTarget[] {
        const targets: HammerTarget[] = [];
        for (const wall of this.mouseRecords.select(model, this.placed)) {
            const entity = wall.entity!;
            if (!entity.hasTag('HAMMER_workable')) continue;
            if (entity.hammerTarget) targets.push(entity.hammerTarget);
        }
        return targets;
    }

    /** Live walls that combat:CanTarget; broken walls are dead and excluded. */
    get combatTargets(): readonly WallCombatTarget[] {
        return Array.from(this.placed, (wall) => ({
            id: String(wall.instance.entityId), model: wall.model, inst: wall.instance,
            isValid: () => this.isLive(wall) && !wall.instance.components.health!.IsDead(),
        }));
    }

    get reskinTargets(): readonly ReskinTarget[] {
        return Array.from(this.placed, wall => wall.entity?.reskinTarget)
            .filter((target): target is ReskinTarget => target !== undefined);
    }

    private createReskinTarget(wall: WallInstance<BuildId>): ReskinTarget {
        const isValid = () => this.isLive(wall);
        return {
            get id() { return String(wall.instance.entityId); }, prefabId: wallWorldPrefab(wall.buildId), instance: wall.instance, display: wall.display,
            skins: Object.keys(this.definitions[wall.buildId].skinArchives ?? {}), get skinId() { return wall.instance.skinId; },
            get isRemoved() { return !isValid(); }, hasTag: tag => wall.instance.hasTag(tag),
            get position() { return wall.instance.position; }, isValid,
            prepareNextSkin: async (tool) => {
                const previousSkin = wall.instance.skinId;
                const skinId = nextReskin(Object.keys(this.definitions[wall.buildId].skinArchives ?? {}), previousSkin, tool?._cached_reskinname, wallWorldPrefab(wall.buildId));
                let used = false;
                return {
                    skinId,
                    apply: (fx?: ReskinFxMessage) => {
                        if (used || !isValid() || wall.instance.skinId !== previousSkin) return false;
                        wall.instance.skinId = skinId;
                        fx?.play(wall.instance.position, wallWorldPrefab(wall.buildId));
                        used = true;
                        return true;
                    },
                    dispose: () => { used = true; },
                };
            },
        };
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
        this.pointer.dispose();
        this.cancel();
        for (const wall of this.placed) this.disposeWall(wall);
        for (const effect of this.effects) effect.remove();
        this.effects.clear();
        this.placed.clear();
        this.displays.dispose();
        this.resources.dispose();
    }

    cancel() {
        if (this.active) this.disposeWall(this.active);
        this.active = undefined;
        this.cursor.hide();
    }

    update(dt = 0) {
        this.displays.update(dt);
        this.cursor.update();
    }

    private readonly handlePointerDown = (event: PointerEvent) => {
        if (event.button === 2) {
            this.cancel();
            return;
        }
        if (event.button !== 0 || event.defaultPrevented) return;
        if (this.active) event.preventDefault();
        if (!this.active) return;
        this.pointer.trackPointer(event);
        this.cursor.update();
        if (!this.pointer.isOverGround || !this.consumeBufferedBuild(this.active.buildId, this.active.inventorySkinId)) return;

        const placedWall = this.active;
        placedWall.model.visible = true;
        placedWall.instance.sprite.setOpacity(1);
        placedWall.instance.entityId = newEntityId();
        this.place(placedWall);
        this.active = undefined;
        this.cursor.hide();
    };

    private createPreview(buildId: BuildId, skinId?: string) {
        const wall = this.createInstance(buildId, skinId, .65);
        wall.model.visible = false;
        this.active = wall;
        this.cursor.setPreview(wall.model, 0, snapToWallSlot);
        this.cursor.update();
    }

    /** Declare static images, paired layers and source skin names; the display loads and dresses them. */
    private createInstance(buildId: BuildId, requestedSkin?: string, opacity = 1): WallInstance<BuildId> {
        if (this.disposed) throw new Error('Placement has been disposed');
        const definition = this.definitions[buildId];
        const instance = new PrefabInstance(wallWorldPrefab(buildId), new SpriteState({ name: 'half', held: true, billboard: true }));
        instance.skinId = wallWorldSkin(buildId, requestedSkin);
        instance.sprite.setSkinSource({ art: this.resources.archives,
            archives: Object.fromEntries(Object.entries(definition.skinArchives ?? {}).map(([id, archive]) =>
                [id, definition.skinInit?.(id).skinArchive ?? archive])) });
        instance.sprite.setPose(undefined);
        instance.sprite.setFacingRotation(0);
        instance.sprite.setFacingImages(new Map([[FACING_CARDINAL, definition.frontImageIndex], [240, definition.sideImageIndex]]));
        if (definition.multColour) instance.sprite.setColour(definition.multColour);
        instance.sprite.setOpacity(opacity);
        const display = this.displays.add({ name: definition.name, status: instance.status, sprite: instance.sprite, light: instance.light, alignBottom: true,
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
        const definition = this.definitions[buildId];
        const entity = wall.entity = actionEntity(model, wallWorldPrefab(buildId), instance);
        entity.addTag('wall');
        entity.addTag('noauradamage');
        entity.addTag('electricdamageimmune');
        for (const tag of definition.tags ?? []) instance.addTag(tag);
        const combatInst: CombatInst = instance;
        // walls.lua: SetMaxHealth(maxhealth), SetCurrentHealth(maxhealth * .5), canheal = false.
        const health = new Health(definition.maxhealth ?? 100, combatInst);
        health.SetCurrentHealth(health.maxhealth * .5);
        health.canheal = false;
        health.nofadeout = true;
        if (definition.playerdamagemod !== undefined) health.SetAbsorptionAmountFromPlayer(definition.playerdamagemod);
        const combat = new Combat(combatInst, () => 0);
        combat.SetKeepTargetFunction(() => false);
        // Restore after the position is known so full walls choose their stable variant.
        if (saved) health.OnLoad({ health: saved.current, maxhealth: saved.maximum });
        entity.reskinTarget = this.createReskinTarget(wall);
        Object.assign(entity.components, { health, combat });
        const percent = watchSignal(health.percent, stop => instance.onRemove(stop));
        createEffect(() => {
            const anim = resolveWallAnim(percent.get(), instance.position);
            instance.sprite.setPose(anim === 'half' ? undefined : anim);
        });
        // onhealthchange: a live wall plays <anim>_hit then holds <anim>; a broken wall holds `broken`.
        health.ondelta = (_inst, _oldPercent, newPercent) => {
            if (newPercent > 0) instance.sprite.playTransient(`${resolveWallAnim(newPercent, instance.position)}_hit`);
            this.setObstacle(wall, newPercent > 0);
        };
        // onhit, shared by combat.onhitfn and workable:SetOnWorkCallback.
        const onhit = () => {
            if (definition.hammerMaterial) PlaySound(`dontstarve/common/destroy_${definition.hammerMaterial}`, model.position);
            if (health.GetPercent() > 0) instance.sprite.playTransient(`${resolveWallAnim(health.GetPercent(), instance.position)}_hit`);
        };
        combat.onhitfn = onhit;
        const workable = new Workable(entity);
        entity.components.workable = workable;
        workable.SetWorkAction('HAMMER');
        workable.SetWorkLeft(definition.hammerWorkLeft ?? 3);
        new ToolMouseTarget(entity, wall.instance, workable, this.world.handEquipment);
        workable.SetOnWorkCallback(onhit);
        entity.hammerTarget = {
            get id() { return String(instance.entityId); }, instance, display: wall.display, entity,
            position: instance.position, isValid: () => this.isLive(wall),
            playHit: () => { performToolWork('HAMMER', entity, {}); },
        };
        workable.SetOnFinishCallback(() => {
            if (!this.placed.has(wall)) return;
            const context = this.hammerContext(wall);
            if (definition.onhammered) definition.onhammered(context);
            else context.remove();
        });
    }

    private hammerContext(wall: WallInstance<BuildId>): WallHammerContext {
        const position = wall.instance.position;
        return {
            definition: this.definitions[wall.buildId], health: wall.instance.components.health!, position,
            dropLoot: items => this.world.dropLoot?.(items, position),
            spawnEffect: () => this.spawnCollapse(position),
            remove: () => {
                if (!this.placed.delete(wall)) return;
                this.disposeWall(wall);
            },
        };
    }

    private spawnCollapse(position: THREE.Vector3): void {
        const instance = new PrefabInstance('collapse_small', new SpriteState({ name: 'collapse_small', billboard: true }));
        for (const tag of ['NOCLICK', 'FX']) instance.addTag(tag);
        instance.persists = false;
        instance.sprite.playOnce('collapse_small', () => { instance.remove(); this.effects.delete(instance); });
        const display = this.displays.add({ name: 'collapse_small', status: instance.status, sprite: instance.sprite,
            archive: this.resources.archive({ animationArchive: 'structure_collapse_fx.zip', buildArchives: ['structure_collapse_fx.zip'], bank: 'collapse' }) });
        bindInstance(display.model, instance);
        instance.position.copy(position);
        this.effects.add(instance);
    }

    private place(wall: WallInstance<BuildId>, saved?: { current: number; maximum: number }): void {
        this.placed.add(wall); this.mouseRecords.set(wall.model, wall);
        this.initializeEntity(wall, saved);
        // walls.lua: MakeObstaclePhysics(inst, .5); Physics:SetDontRemoveOnSleep(true), so pens hold outside the ticking area.
        MakeObstaclePhysics(wall.instance, .5).SetDontRemoveOnSleep(true);
        this.setObstacle(wall, !wall.instance.components.health!.IsDead());
        if (this.world.physics) wall.instance.bindPhysics(this.world.physics);
        wall.stopActivity = watchTileActivity(wall.model, this.world.tickingarea, active => wall.instance.setActive(active));
    }

    /** walls.lua makeobstacle/clearobstacle: Physics:SetActive follows health > 0. Previews have no physics. */
    private setObstacle(wall: WallInstance<BuildId>, active: boolean): void {
        if (this.placed.has(wall)) wall.instance.physics.SetActive(active);
    }

    private disposeWall(wall: WallInstance<BuildId>): void {
        wall.instance.remove();
        wall.stopActivity?.();
        const { workable, health, combat } = wall.instance.components;
        workable?.dispose();
        health?.dispose();
        if (combat) combat.onhitfn = undefined;
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
