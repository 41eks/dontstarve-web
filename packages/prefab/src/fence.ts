import { ToolMouseTarget } from './toolMouseTarget';
import { ModelRecords } from './modelRecords';
import * as THREE from 'three';
import { PrefabDisplayGroup, SpriteResources, SpriteState, type PrefabDisplay } from '@dontstarve-web/display';
import { PrefabInstance, bindInstance, prefabInstance } from './prefabInstance';
import { watchTileActivity } from './tileActivity';
import { watchSignal, type Signal } from '@dontstarve-web/signals';
import { bindActionCancellation } from '@dontstarve-web/stategraphs/actionEvents';
import { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import type { HammerTarget } from '@dontstarve-web/stategraphs/hammer';
import type { ReskinTarget } from '@dontstarve-web/stategraphs/reskin_tool';
import { Combat, type CombatInst } from '../../componets/src/combat';
import { Health } from '../../componets/src/health';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Workable } from '../../componets/src/workable';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { actionEntity, FindEntities } from './actionEntity';
import { BuildCursor } from './buildCursor';
import { reskinTarget } from './reskin_tool';
import { newEntityId, saveGroundPosition, type PlacedEntitySaveRecord, type PlacementSaveRecord } from './saveRecord';
import { PlaySound } from './sound';
import { MakeObstaclePhysics } from './standardcomponents';
import { BurnableBinding, FireFxHost } from './treeFire';
import { snapToWallSlotCenter, TILE_SIZE } from './tile';
import { FENCE_ID, FENCE_SKIN_ARCHIVES, fenceWorldSkin, type FenceId } from './fenceSkins';
import type { WallCombatTarget } from './wallPlacement';
import type { WorldContext, PrefabWorldContext } from './worldContext';

export { FENCE_ID, FENCE_ITEM_ID, FENCE_IDS, isFenceId, type FenceId, type FenceSaveState } from './fenceSkins';

/** DST distance unit in world units. */
const UNIT = TILE_SIZE / 4;
/** fence.lua MakeObstaclePhysics(inst, .5). */
export const FENCE_PHYSICS_RADIUS = .5 * UNIT;
const ROT_SIDES = 8;
const FENCE_LOOT = [{ itemId: 'twigs', count: 1 }] as const;
const FENCE_TAGS = ['wall', 'fence', 'alignwall', 'noauradamage', 'electricdamageimmune', 'rotatableobject'] as const;
/** MakeMediumBurnable(inst): burn time 20, fx level 3; MakeMediumPropagator. */
const FENCE_BURN_TIME = 20;
const FENCE_FX_LEVEL = 3;
const PREVIEW_OPACITY = 0.65;

const mod = (value: number, divisor: number) => value - Math.floor(value / divisor) * divisor;

/** fence.lua CalcRotationEnum. */
export function calcRotationEnum(rotation: number): number {
    return Math.floor(mod(Math.floor(rotation + 0.5) / 45, ROT_SIDES));
}

/** Even rotation enums use the narrow `fence_thin` bank, odd ones the wide `fence` bank. */
export function isNarrowRotation(rotation: number): boolean {
    return calcRotationEnum(rotation) % 2 === 0;
}

export interface FenceNeighbour { readonly isFence: boolean; readonly rotation: number }

/**
 * fence.lua FixUpFenceOrientation for a plain fence: facing a parallel fence from behind (the opposite side of
 * the same line) flips the placer by 180 degrees so both fences face the same way.
 */
export function fixUpFenceRotation(rotation: number, neighbours: readonly FenceNeighbour[]): number {
    const thisEnum = calcRotationEnum(rotation);
    const parallel = neighbours.find(({ isFence, rotation: other }) => isFence
        && thisEnum % (ROT_SIDES / 2) === calcRotationEnum(other) % (ROT_SIDES / 2));
    if (parallel && (thisEnum + ROT_SIDES / 2) % ROT_SIDES === calcRotationEnum(parallel.rotation)) return rotation + 180;
    return rotation;
}

/** The placer's rotation: `fixedcameraoffset (0) - TheCamera:GetHeading()`, i.e. a constant camera-relative facing. */
export function placerRotation(heading: number): number {
    return -heading;
}

/** The source Transform rotation, independent of the display's camera-facing quaternion. */
export class FencePrefabInstance extends PrefabInstance {
    private readonly art: SpriteResources['archives'];
    get rotation(): number { return this.sprite.sprite.peek().facingRotation ?? 0; }

    constructor(rotation: number, skinId: string | undefined, art: SpriteResources['archives'], opacity: number) {
        super(FENCE_ID, new SpriteState({ name: 'idle', billboard: true }));
        this.art = art;
        this.skinId = skinId;
        this.sprite.setSkinSource({ art, archives: FENCE_SKIN_ARCHIVES });
        this.setOrientation(rotation);
        this.sprite.setOpacity(opacity);
        this.sprite.playOnce('idle');
    }

    /** fence.lua SetOrientation changes the AnimState bank, preserving the entity and its build. */
    setOrientation(rotation: number): void {
        this.sprite.setFacingRotation(rotation);
        const bank = isNarrowRotation(rotation) ? 'fence_thin' : 'fence';
        if (this.sprite.sprite.peek().source?.bank !== bank) {
            this.sprite.setArtSource({ animationArchive: `${bank}.zip`, bank, buildArchive: 'fence.zip', art: this.art });
        }
    }
}

interface FenceInstance {
    readonly buildId: FenceId;
    /** One logical fence and the display that draws its declared sprite. */
    readonly instance: FencePrefabInstance;
    readonly display: PrefabDisplay;
    readonly root: THREE.Group;
    stopActivity?: () => void;
    readonly inventorySkinId?: string;
    /** Present once placed: previews are not insts, so they have no tags, components or LIGHT/HAMMER targets. */
    entity?: ReturnType<typeof actionEntity>;
    burn?: BurnableBinding;
}

/**
 * Places `fence_item` and holds the placed `fence` prefabs of prefabs/fence.lua: an eight-faced animated
 * sprite whose bank (`fence` or `fence_thin`) follows the rotation parity.
 */
export class FencePlacement {
    private readonly world: PrefabWorldContext;

    private readonly camera: THREE.Camera;
    private readonly canvas: HTMLCanvasElement;
    private readonly player: THREE.Object3D;
    private readonly ground: THREE.Object3D;
    private readonly pointer: PointerRaycaster;
    private readonly cursor: BuildCursor;
    private readonly resources = new SpriteResources(undefined, 'ground');
    private readonly displays: PrefabDisplayGroup;
    private readonly scheduler: GameTimeScheduler;
    private readonly ownsScheduler: boolean;
    private fireFx?: FireFxHost;
    private readonly consumeBufferedBuild: (buildId: FenceId, skinId?: string) => boolean;
    private readonly stopActionEvents: () => void;
    private readonly heading: Signal<number>;
    private readonly cleanups: (() => void)[] = [];
    private readonly mouseRecords = new ModelRecords<FenceInstance>();
    private readonly placed = new Set<FenceInstance>();
    private readonly effects = new Set<PrefabInstance>();
    private active?: FenceInstance;
    private lastPreviewKey = '';
    private disposed = false;

    constructor(world: WorldContext, consumeBufferedBuild: (buildId: FenceId, skinId?: string) => boolean) {
        const { scene, ...services } = world;
        this.world = services;
        this.camera = world.camera;
        this.canvas = world.renderer.domElement;
        this.player = world.player;
        this.ground = world.ground;
        this.consumeBufferedBuild = consumeBufferedBuild;
        this.displays = new PrefabDisplayGroup(scene);
        this.scheduler = world.scheduler ?? new GameTimeScheduler();
        this.ownsScheduler = !world.scheduler;
        this.stopActionEvents = bindActionCancellation(world, this, 'building', () => this.cancel());
        this.pointer = new PointerRaycaster(world);
        this.cursor = new BuildCursor(world, this.pointer);
        this.heading = watchSignal(world.cameraHeading, stop => this.cleanups.push(stop));
        this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    }

    begin(buildId: FenceId, skinId?: string): Promise<void> {
        if (this.disposed) return Promise.reject(new Error('Placement has been disposed'));
        if (this.active) return Promise.resolve();
        this.world.actionEvents?.emit('action:begin', { owner: this, action: 'BUILD' });
        this.cursor.show(': 建造 栅栏', 'left');
        try { this.createPreview(buildId, skinId); return Promise.resolve(); }
        catch (error) { this.cursor.hide(); return Promise.reject(error); }
    }

    /** c_spawn("fence"): SpawnPrefab leaves rotation 0 (the narrow bank) in front of the player. */
    async spawn(buildId: FenceId, skinId?: string): Promise<void> {
        const fence = this.createInstance(buildId, 0, skinId);
        fence.instance.entityId = newEntityId();
        fence.root.position.copy(this.playerFrontGroundPosition());
        this.place(fence);
    }

    async spawnFromSave(buildId: FenceId, record: PlacementSaveRecord): Promise<THREE.Group> {
        const saved = record.components.fence;
        const fence = this.createInstance(buildId, (saved?.rot ?? 0) * 45, saved?.skinId);
        fence.instance.entityId = record.id;
        fence.instance.saveRecord = record;
        const [x, y, z] = record.transform.position;
        fence.root.position.set(x, y, z);
        this.place(fence);
        return fence.root;
    }

    get renderEntities() {
        return this.displays.renderEntities;
    }

    get hammerTargets(): readonly HammerTarget[] { return this.getHammerTargets(); }

    getHammerTargets(model?: THREE.Object3D): readonly HammerTarget[] {
        const targets: HammerTarget[] = [];
        for (const fence of this.mouseRecords.select(model, this.placed)) {
            const entity = fence.entity!;
            if (!entity.hasTag('HAMMER_workable')) continue;
            if (entity.hammerTarget) targets.push(entity.hammerTarget);
        }
        return targets;
    }

    /** fence.lua combat.onhitfn turns an attack into one unit of HAMMER work. */
    get combatTargets(): readonly WallCombatTarget[] {
        return Array.from(this.placed, fence => ({
            id: String(fence.instance.entityId), model: fence.root, inst: fence.instance,
            isValid: () => this.isLive(fence) && !fence.instance.components.health!.IsDead(),
        }));
    }

    get reskinTargets(): readonly ReskinTarget[] {
        return Array.from(this.placed, fence => fence.entity?.reskinTarget)
            .filter((target): target is ReskinTarget => target !== undefined);
    }

    private createReskinTarget(fence: FenceInstance): ReskinTarget {
        const isValid = () => this.isLive(fence);
        return reskinTarget({
            get id() { return String(fence.instance.entityId); }, prefabId: FENCE_ID, instance: fence.instance, display: fence.display,
            sprite: fence.instance.sprite, skins: Object.keys(FENCE_SKIN_ARCHIVES),
            hasTag: (tag: string) => fence.instance.hasTag(tag), get position() { return fence.root.position; }, isValid,
        });
    }

    exportRecords(): PlacedEntitySaveRecord[] {
        // DefaultBurnFn: a burning fence has persists = false and is not saved.
        return Array.from(this.placed).filter(fence => fence.instance.persists !== false).map((fence) => {
            const skinId = fence.instance.skinId, rot = calcRotationEnum(fence.instance.rotation);
            return {
                prefabId: FENCE_ID,
                record: {
                    id: fence.instance.entityId as string,
                    transform: { position: saveGroundPosition(fence.root.position, 0), rotationY: 0 },
                    components: { fence: { ...(rot > 0 ? { rot } : {}), ...(skinId === undefined ? {} : { skinId }) } },
                },
            };
        });
    }

    update(dt = 0): void {
        if (this.ownsScheduler) this.scheduler.advance(dt);
        this.displays.update(dt);
        for (const fence of this.placed) fence.burn?.update(dt);
        this.cursor.update();
        if (this.active) this.updatePreview(this.active);
    }

    cancel(): void {
        if (this.active) this.disposeFence(this.active);
        this.active = undefined;
        this.cursor.hide();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.stopActionEvents();
        this.cleanups.splice(0).forEach(stop => stop());
        this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
        this.pointer.dispose();
        this.cancel();
        for (const fence of [...this.placed]) this.disposeFence(fence);
        this.placed.clear();
        for (const effect of this.effects) effect.remove();
        this.effects.clear();
        this.displays.dispose();
        this.fireFx?.dispose();
        this.resources.dispose();
        if (this.ownsScheduler) this.scheduler.dispose();
    }

    private isLive(fence: FenceInstance): boolean {
        return !this.disposed && !fence.instance.isRemoved && this.placed.has(fence);
    }

    private readonly handlePointerDown = (event: PointerEvent) => {
        if (event.button === 2) { this.cancel(); return; }
        if (event.button !== 0 || event.defaultPrevented) return;
        if (this.active) event.preventDefault();
        if (!this.active) return;
        this.pointer.trackPointer(event);
        this.cursor.update();
        this.updatePreview(this.active);
        if (!this.pointer.isOverGround || !this.consumeBufferedBuild(this.active.buildId, this.active.inventorySkinId)) return;
        const fence = this.active;
        this.active = undefined;
        this.cursor.hide();
        fence.instance.sprite.setOpacity(1);
        fence.instance.entityId = newEntityId();
        this.place(fence);
        PlaySound('dontstarve/common/place_structure_wood', fence.root.position);
    };

    private createPreview(buildId: FenceId, skinId?: string): void {
        const fence = this.createInstance(buildId, placerRotation(this.heading.peek()), skinId, PREVIEW_OPACITY);
        fence.root.visible = false;
        this.active = fence;
        this.cursor.setPreview(fence.root, 0, point => {
            const snapped = snapToWallSlotCenter(point);
            return point.set(snapped.x, point.y, snapped.z);
        });
        this.lastPreviewKey = '';
        this.cursor.update();
        this.updatePreview(fence);
    }

    /** placerupdate: FixUpFenceOrientation against the neighbours at the snapped position. */
    private updatePreview(fence: FenceInstance): void {
        const { x, z } = fence.root.position;
        const key = `${x}:${z}:${this.heading.peek()}`;
        if (key === this.lastPreviewKey) return;
        this.lastPreviewKey = key;
        this.orientPreview(fence, this.heading.peek());
    }

    private orientPreview(fence: FenceInstance, heading: number): void {
        const rotation = fixUpFenceRotation(placerRotation(heading), this.neighbours(fence));
        fence.instance.setOrientation(rotation);
    }

    /** FindEntities(x, 0, z, 1.5, {"wall"}) as FixUpFenceOrientation sees it. */
    private neighbours(fence: FenceInstance): FenceNeighbour[] {
        return FindEntities(fence.root.position, 1.5 * UNIT, ['wall'])
            .filter(found => found.model !== fence.root)
            .map(found => ({ isFence: found.hasTag('fence'),
                rotation: (prefabInstance(found.model) as FencePrefabInstance | undefined)?.rotation ?? 0 }));
    }

    /** Art and skin state only; a placed fence additionally becomes an inst in `place()`. */
    private createInstance(buildId: FenceId, rotation: number, requestedSkin?: string, opacity = 1): FenceInstance {
        if (this.disposed) throw new Error('Placement has been disposed');
        const instance = new FencePrefabInstance(rotation, fenceWorldSkin(buildId, requestedSkin), this.resources.archives, opacity);
        const display = this.displays.add({ name: FENCE_ID, status: instance.status, sprite: instance.sprite, light: instance.light,
            source: this.resources.factory({ animationArchive: 'fence.zip', extraAnimationArchives: ['fence_thin.zip'], buildArchive: 'fence.zip' }) });
        const root = display.model;
        bindInstance(root, instance);
        const fence: FenceInstance = { buildId, instance, display, root, inventorySkinId: requestedSkin };
        return fence;
    }

    /** prefabs/fence.lua's components, attached once the preview becomes a placed inst. */
    private initializeEntity(fence: FenceInstance): void {
        const { root } = fence;
        const entity = actionEntity(root, FENCE_ID, fence.instance);
        entity.reskinTarget = this.createReskinTarget(fence);
        fence.entity = entity;
        for (const tag of FENCE_TAGS) entity.addTag(tag);
        const combatInst: CombatInst = fence.instance;
        // SetMaxHealth(1), SetAbsorptionAmount(1), canheal = false, nofadeout = true.
        const health = new Health(1, combatInst);
        health.absorb = 1; health.canheal = false; health.nofadeout = true;
        const combat = new Combat(combatInst, () => 0);
        combat.SetKeepTargetFunction(() => false);
        Object.assign(entity.components, { health, combat });
        const workable = new Workable(entity);
        entity.components.workable = workable;
        workable.SetWorkAction('HAMMER');
        workable.SetWorkLeft(3);
        // onworked: hit, then idle.
        workable.SetOnWorkCallback(() => this.playHit(fence));
        workable.SetOnFinishCallback(() => this.hammered(fence));
        entity.hammerTarget = {
            get id() { return String(fence.instance.entityId); }, instance: fence.instance, display: fence.display, entity,
            position: fence.instance.position, isValid: () => this.isLive(fence),
            playHit: () => { performToolWork('HAMMER', entity, {}); },
        };
        combat.onhitfn = (_inst, attacker) => {
            workable.WorkedBy({ PushEvent: (name, data) => attacker.PushEvent?.(name, data) });
        };
        (root as unknown as THREE.EventDispatcher<{ death: object }>).addEventListener('death', () => this.hammered(fence));
        this.initializeBurnable(fence);
        new ToolMouseTarget(entity, fence.instance, workable, this.world.handEquipment);
    }

    private playHit(fence: FenceInstance): void {
        const { sprite } = fence.instance;
        sprite.playOnce('hit', () => sprite.playOnce('idle'));
    }

    /** onhammered: loot, collapse_small and Remove. */
    private hammered(fence: FenceInstance): void {
        if (!this.placed.has(fence)) return;
        const position = fence.root.position.clone();
        this.world.dropLoot?.(FENCE_LOOT, position);
        this.spawnCollapse(position);
        PlaySound('dontstarve/common/destroy_smoke', position);
        PlaySound('dontstarve/common/destroy_wood', position);
        this.removeFence(fence);
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

    private removeFence(fence: FenceInstance): void {
        if (!this.placed.delete(fence)) return;
        this.disposeFence(fence);
    }

    /** MakeMediumBurnable + MakeMediumPropagator, with DefaultBurnFn / DefaultExtinguishFn / DefaultBurntFn. */
    private initializeBurnable(fence: FenceInstance): void {
        this.fireFx ??= FireFxHost.create(`${import.meta.env.BASE_URL}dst/data/anim`);
        fence.burn = new BurnableBinding(fence.entity!, {
            propagator: 'medium', burnTime: FENCE_BURN_TIME, fxLevel: FENCE_FX_LEVEL,
            onIgnite: () => { fence.instance.persists = false; },
            onExtinguish: () => { fence.instance.persists = true; },
            onBurnt: () => {
                // DefaultBurntFn: one ash at the fence, then Remove.
                const position = fence.instance.position.clone();
                const ash = this.world.spawnItem?.({ itemId: 'ash', count: 1 });
                if (ash) this.world.dropItem?.(ash, position);
                this.removeFence(fence);
            },
        }, { scheduler: this.scheduler, fire: this.fireFx });
    }

    private place(fence: FenceInstance): void {
        this.placed.add(fence); this.mouseRecords.set(fence.root, fence);
        fence.root.visible = true;
        this.initializeEntity(fence);
        // fence.lua: MakeObstaclePhysics(inst, .5); Physics:SetDontRemoveOnSleep(true), so pens hold outside the ticking area.
        MakeObstaclePhysics(fence.instance, .5).SetDontRemoveOnSleep(true);
        if (this.world.physics) fence.instance.bindPhysics(this.world.physics);
        fence.stopActivity = watchTileActivity(fence.root, this.world.tickingarea, active => {
            fence.instance.setActive(active);
        });
    }

    private disposeFence(fence: FenceInstance): void {
        fence.instance.remove();
        fence.stopActivity?.();
        fence.burn?.dispose();
        const components = fence.instance.components;
        components?.workable?.dispose();
        components.health?.dispose();
        if (components.combat) components.combat.onhitfn = undefined;
        fence.display.dispose();
    }

    private playerFrontGroundPosition(): THREE.Vector3 {
        const direction = new THREE.Vector3();
        this.camera.getWorldDirection(direction);
        direction.y = 0;
        if (direction.lengthSq() === 0) direction.set(0, 0, 1); else direction.normalize();
        const target = this.player.position.clone().addScaledVector(direction, 10);
        const hit = this.pointer.raycast(new THREE.Vector3(target.x, target.y + 1000, target.z), new THREE.Vector3(0, -1, 0), this.ground);
        const point = hit ? hit.point.clone() : target.setY(0);
        const snapped = snapToWallSlotCenter(point);
        return new THREE.Vector3(snapped.x, point.y, snapped.z);
    }
}
