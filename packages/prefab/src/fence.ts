import { ToolMouseTarget } from './toolMouseTarget';
import { ModelRecords } from './modelRecords';
import * as THREE from 'three';
import { createSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { ArchiveSpriteCommands, PrefabDisplay } from '@dontstarve-web/display';
import { createArchiveEntity, createEmptyEntity, type PrefabInstance } from './prefabInstance';
import { watchTileActivity } from './tileActivity';
import { facingFromRotation } from '@dontstarve-web/animation/facing';
import { registerSpriteRenderGroup } from '@dontstarve-web/animation/renderOrder';
import { createEffect, createRenderEffect, createSignal, readonlySignal, watchSignal, getBoundWatchWorldContent, type Signal } from '@dontstarve-web/signals';
import { bindActionCancellation } from '@dontstarve-web/stategraphs/actionEvents';
import { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import type { HammerTarget } from '@dontstarve-web/stategraphs/hammer';
import type { ReskinFxMessage, ReskinTarget } from '@dontstarve-web/stategraphs/reskin_tool';
import { Burnable, type BurnableInst } from '../../componets/src/burnable';
import { Combat, type CombatInst } from '../../componets/src/combat';
import { Health } from '../../componets/src/health';
import { Propagator } from '../../componets/src/propagator';
import { Workable } from '../../componets/src/workable';
import { bindPhysics, type PhysicsBinding } from '../../componets/src/physicsBinding';
import { PhysicsState } from '../../componets/src/physicsState';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { actionEntity, FindEntities } from './actionEntity';
import { BuildCursor } from './buildCursor';
import { GroundItemAssets } from './groundItems';
import { setPrefabLocalLight } from './localLight';
import { nextReskin } from './reskin_tool';
import { newEntityId, saveGroundPosition, type PlacedEntitySaveRecord, type PlacementSaveRecord } from './saveRecord';
import { PlaySound, PreloadSounds } from './sound';
import { MakeObstaclePhysics } from './standardcomponents';
import { snapToWallSlotCenter, TILE_SIZE } from './tile';
import { FENCE_ID, FENCE_SKIN_ARCHIVES, fenceWorldSkin, type FenceId } from './fenceSkins';
import type { WallCombatTarget } from './wallPlacement';
import type { WorldContext } from './worldContext';

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

interface DrawnEntity { readonly instance: PrefabInstance<ArchiveSpriteCommands>; readonly display: PrefabDisplay }

/** The fence's drawn sprite in one bank; the placer keeps the other bank ready for a parity change. */
interface FenceArt extends DrawnEntity {
    readonly narrow: boolean;
}

interface FenceInstance {
    readonly buildId: FenceId;
    /** The fence entity: identity, tags and lifecycle; its art is drawn by a child display. */
    readonly instance: PrefabInstance;
    readonly display: PrefabDisplay;
    readonly root: THREE.Group;
    readonly art: Signal<FenceArt>;
    readonly opacity: Signal<number>;
    stopAppearance: () => void;
    stopActivity?: () => void;
    awake: boolean;
    /** The other bank, kept only while previewing, where the camera rotation changes parity. */
    spare?: FenceArt;
    rotation: number;
    readonly skinId: Signal<string | undefined>;
    readonly inventorySkinId?: string;
    readonly preparedSkins: Set<FenceArt>;
    preparedSkin?: FenceArt;
    stopSkin: () => void;
    /** Present once placed: previews are not insts, so they have no tags, components or LIGHT/HAMMER targets. */
    entity?: ReturnType<typeof actionEntity>;
    health?: Health;
    combat?: Combat;
    combatInst?: CombatInst;
    /** inst.Physics; bound to the world once placed. */
    readonly physics: PhysicsState;
    physicsBinding?: PhysicsBinding;
    fire?: DrawnEntity;
    fireSound?: { stop(): void };
    stopBurning?: () => void;
}

/**
 * Places `fence_item` and holds the placed `fence` prefabs of prefabs/fence.lua: an eight-faced animated
 * sprite whose bank (`fence` or `fence_thin`) follows the rotation parity.
 */
export class FencePlacement {
    private readonly world: WorldContext;
    private readonly scene: THREE.Scene;
    private readonly camera: THREE.Camera;
    private readonly canvas: HTMLCanvasElement;
    private readonly player: THREE.Object3D;
    private readonly ground: THREE.Object3D;
    private readonly pointer: PointerRaycaster;
    private readonly cursor: BuildCursor;
    private readonly assets: GroundItemAssets;
    private readonly consumeBufferedBuild: (buildId: FenceId, skinId?: string) => boolean;
    private readonly stopActionEvents: () => void;
    private readonly heading: Signal<number>;
    private readonly cleanups: (() => void)[] = [];
    private readonly mouseRecords = new ModelRecords<FenceInstance>();
    private readonly placed = new Set<FenceInstance>();
    private readonly fires = new Set<DrawnEntity>();
    private readonly effects = new Set<DrawnEntity>();
    private readonly cameraWorldQuaternion = new THREE.Quaternion();
    private active?: FenceInstance;
    private loading?: Promise<void>;
    private previewVersion = 0;
    private lastPreviewKey = '';
    private disposed = false;

    constructor(world: WorldContext, consumeBufferedBuild: (buildId: FenceId, skinId?: string) => boolean) {
        this.world = world;
        this.scene = world.scene;
        this.camera = world.camera;
        this.canvas = world.renderer.domElement;
        this.player = world.player;
        this.ground = world.ground;
        this.consumeBufferedBuild = consumeBufferedBuild;
        this.assets = new GroundItemAssets();
        this.stopActionEvents = bindActionCancellation(world, this, 'building', () => this.cancel());
        this.pointer = new PointerRaycaster(world);
        this.cursor = new BuildCursor(world, this.pointer);
        this.heading = watchSignal(world.cameraHeading, stop => this.cleanups.push(stop));
        // A moving camera re-faces every fence; the preview additionally rotates against it.
        createRenderEffect(() => {
            const heading = this.heading.get();
            if (this.active) this.orientPreview(this.active, heading);
            for (const fence of this.placed) this.applyFacing(fence, heading);
        });
        this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    }

    begin(buildId: FenceId, skinId?: string): Promise<void> {
        if (this.disposed) return Promise.reject(new Error('Placement has been disposed'));
        if (this.active) return Promise.resolve();
        if (this.loading) return this.loading;
        this.world.actionEvents?.emit('action:begin', { owner: this, action: 'BUILD' });
        this.cursor.show(': 建造 栅栏', 'left');
        const version = ++this.previewVersion;
        const request = this.createPreview(buildId, version, skinId)
            .catch((error: unknown) => {
                if (version === this.previewVersion) this.cursor.hide();
                throw error;
            })
            .finally(() => { if (this.loading === request) this.loading = undefined; });
        this.loading = request;
        return request;
    }

    /** c_spawn("fence"): SpawnPrefab leaves rotation 0 (the narrow bank) in front of the player. */
    async spawn(buildId: FenceId, skinId?: string): Promise<void> {
        const fence = await this.createInstance(buildId, 0, skinId, true);
        fence.instance.entityId = newEntityId();
        fence.root.position.copy(this.playerFrontGroundPosition());
        this.place(fence);
    }

    async spawnFromSave(buildId: FenceId, record: PlacementSaveRecord): Promise<THREE.Group> {
        const saved = record.components.fence;
        const fence = await this.createInstance(buildId, (saved?.rot ?? 0) * 45, saved?.skinId, false);
        fence.instance.entityId = record.id;
        fence.instance.saveRecord = record;
        const [x, y, z] = record.transform.position;
        fence.root.position.set(x, y, z);
        this.scene.add(fence.root);
        this.place(fence);
        return fence.root;
    }

    get renderEntities() {
        return [...this.placed, ...(this.active ? [this.active] : [])]
            .filter(({ root, art }) => root.visible && art.peek().instance.sprite.loaded)
            .map(({ root }) => ({ object: root, footPosition: root.position.clone(), cameraDepth: 0 }))
            .concat([...this.fires, ...this.effects].map(({ display }) => ({
                object: display.model, footPosition: display.model.position, cameraDepth: 0 })));
    }

    get hammerTargets(): readonly HammerTarget[] { return this.getHammerTargets(); }

    getHammerTargets(model?: THREE.Object3D): readonly HammerTarget[] {
        const targets: HammerTarget[] = [];
        for (const fence of this.mouseRecords.select(model, this.placed)) {
            const entity = actionEntity(fence.root, FENCE_ID);
            if (!entity.hasTag('HAMMER_workable')) continue;
            targets.push({
                id: String(fence.instance.entityId), model: fence.root, entity,
                position: fence.root.position.clone(),
                isValid: () => this.isLive(fence),
                playHit: () => { performToolWork('HAMMER', entity, {}); },
            });
        }
        return targets;
    }

    /** fence.lua combat.onhitfn turns an attack into one unit of HAMMER work. */
    get combatTargets(): readonly WallCombatTarget[] {
        return Array.from(this.placed, fence => ({
            id: String(fence.instance.entityId), model: fence.root, inst: fence.combatInst!,
            isValid: () => this.isLive(fence) && !fence.health!.IsDead(),
        }));
    }

    get reskinTargets(): readonly ReskinTarget[] { return this.getReskinTargets(); }

    getReskinTargets(model?: THREE.Object3D): readonly ReskinTarget[] {
        const skins = Object.keys(FENCE_SKIN_ARCHIVES);
        return Array.from(this.mouseRecords.select(model, this.placed), (fence) => {
            const isValid = () => this.isLive(fence);
            return {
                id: String(fence.instance.entityId), prefabId: FENCE_ID, model: fence.root,
                skins, get skinId() { return fence.skinId.peek(); },
                get isRemoved() { return !isValid(); }, hasTag: (tag: string) => actionEntity(fence.root, FENCE_ID).hasTag(tag),
                get position() { return fence.root.position.clone(); }, isValid,
                prepareNextSkin: async (tool) => {
                    const previousSkin = fence.skinId.peek();
                    const skinId = nextReskin(skins, previousSkin, tool?._cached_reskinname, FENCE_ID);
                    const replacement = await this.createArt(skinId, fence.art.peek().narrow);
                    if (!isValid() || fence.skinId.peek() !== previousSkin || skinId === previousSkin) {
                        this.disposeArt(replacement);
                        return { apply: () => false, dispose: () => {} };
                    }
                    fence.preparedSkins.add(replacement);
                    let used = false;
                    return {
                        apply: (fx?: ReskinFxMessage) => {
                            if (used || !isValid() || fence.skinId.peek() !== previousSkin
                                || !fence.preparedSkins.has(replacement)) return false;
                            fence.preparedSkin = replacement;
                            fence.skinId.set(skinId);
                            fx?.play(fence.root.position, FENCE_ID);
                            used = true;
                            return true;
                        },
                        dispose: () => {
                            if (used) return;
                            if (fence.preparedSkins.delete(replacement)) this.disposeArt(replacement);
                            used = true;
                        },
                    };
                },
            };
        });
    }

    exportRecords(): PlacedEntitySaveRecord[] {
        // DefaultBurnFn: a burning fence has persists = false and is not saved.
        return Array.from(this.placed).filter(fence => fence.instance.persists !== false).map((fence) => {
            const skinId = fence.skinId.peek(), rot = calcRotationEnum(fence.rotation);
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
        for (const { instance, display } of this.effects) { this.faceCamera(display.model); instance.sprite.update(dt); }
        for (const fire of this.fires) fire.instance.sprite.update(dt);
        this.cursor.update();
        if (this.active) this.updatePreview(this.active);
        for (const fence of this.placed) {
            this.faceCamera(fence.root);
            fence.art.peek().instance.sprite.update(dt);
            const components = fence.entity?.components;
            components?.burnable?.Update(dt);
            components?.propagator?.Update(dt);
            if (fence.fire) {
                fence.fire.instance.position.copy(fence.root.position);
                this.faceCamera(fence.fire.display.model);
            }
        }
    }

    cancel(): void {
        this.previewVersion += 1;
        this.loading = undefined;
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
        for (const effect of [...this.effects]) this.release(effect);
        this.effects.clear();
        this.assets.dispose();
    }

    private isLive(fence: FenceInstance): boolean {
        return !this.disposed && this.placed.has(fence) && fence.root.visible && fence.root.parent !== null;
    }

    private readonly handlePointerDown = (event: PointerEvent) => {
        if (event.button === 2) { this.cancel(); return; }
        if (event.button !== 0 || event.defaultPrevented) return;
        if (this.loading || this.active) event.preventDefault();
        if (!this.active) return;
        this.pointer.trackPointer(event);
        this.cursor.update();
        this.updatePreview(this.active);
        if (!this.pointer.isOverGround || !this.consumeBufferedBuild(this.active.buildId, this.active.inventorySkinId)) return;
        const fence = this.active;
        this.active = undefined;
        this.cursor.hide();
        fence.opacity.set(1);
        if (fence.spare) { this.disposeArt(fence.spare); fence.spare = undefined; }
        fence.instance.entityId = newEntityId();
        this.place(fence);
        PlaySound('dontstarve/common/place_structure_wood', fence.root.position);
    };

    private async createPreview(buildId: FenceId, version: number, skinId?: string): Promise<void> {
        const fence = await this.createInstance(buildId, placerRotation(this.heading.peek()), skinId, true, PREVIEW_OPACITY);
        const spare = await this.createArt(fence.skinId.peek(), !fence.art.peek().narrow, PREVIEW_OPACITY);
        if (version !== this.previewVersion || this.disposed) {
            this.disposeArt(spare);
            this.disposeFence(fence);
            return;
        }
        fence.spare = spare;
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
        this.setOrientation(fence, rotation);
        this.applyFacing(fence, heading);
    }

    /** FindEntities(x, 0, z, 1.5, {"wall"}) as FixUpFenceOrientation sees it. */
    private neighbours(fence: FenceInstance): FenceNeighbour[] {
        return FindEntities(fence.root.position, 1.5 * UNIT, ['wall'])
            .map(found => ({ found, model: (found as unknown as { model?: THREE.Object3D }).model }))
            .filter(({ model }) => model !== undefined && model !== fence.root)
            .map(({ found, model }) => ({ isFence: found.hasTag('fence'), rotation: Number(model!.userData.fenceRotation ?? 0) }));
    }

    /** SetOrientation: the rotation and, for the preview, the bank that matches its parity. */
    private setOrientation(fence: FenceInstance, rotation: number): void {
        fence.rotation = rotation;
        fence.root.userData.fenceRotation = rotation;
        const narrow = isNarrowRotation(rotation);
        if (narrow !== fence.art.peek().narrow && fence.spare?.narrow === narrow) {
            const next = fence.spare;
            fence.spare = fence.art.peek();
            this.attachArt(fence, next);
        }
    }

    private attachArt(fence: FenceInstance, art: FenceArt): void {
        fence.art.peek().display.model.removeFromParent();
        fence.art.set(art);
        fence.root.add(art.display.model);
        fence.root.userData.animationController = art.instance.sprite;
        art.instance.setActive(fence.awake);
        art.instance.sprite.playOnce('idle');
    }

    private applyFacing(fence: FenceInstance, heading: number): void {
        const facing = facingFromRotation(fence.rotation, heading);
        fence.art.peek().instance.sprite.setFacing(facing);
        fence.spare?.instance.sprite.setFacing(facing);
    }

    private async createArt(skinId: string | undefined, narrow: boolean, opacity?: number): Promise<FenceArt> {
        if (this.disposed) throw new Error('Placement has been disposed');
        const skinArchive = skinId === undefined ? undefined : FENCE_SKIN_ARCHIVES[skinId];
        if (skinId !== undefined && skinArchive === undefined) throw new Error(`Unsupported fence skin: ${skinId}`);
        const create = (clip: { name: string; loop: boolean }) => createSharedArchiveSprite(this.assets, {
            animationArchive: narrow ? 'fence_thin.zip' : 'fence.zip', buildArchives: ['fence.zip'],
            bank: narrow ? 'fence_thin' : 'fence', animation: clip.name, loop: clip.loop,
        }, { name: 'fence', skinArchive, opacity: opacity ?? 1 });
        const initial = await create({ name: 'idle', loop: false });
        if (this.disposed) { initial.dispose(); throw new Error('Placement has been disposed'); }
        const { instance, display } = createArchiveEntity(FENCE_ID, { create, initial }, { name: 'idle' }, 'fence');
        instance.sprite.playOnce('idle');
        // The art is the fence's sprite, not an entity of its own: it is never saved.
        instance.persists = false;
        return { instance, display, narrow };
    }

    private disposeArt(art: FenceArt): void { this.release(art); }

    private release({ instance, display }: DrawnEntity): void { instance.remove(); display.dispose(); }

    /** Art and skin state only; a placed fence additionally becomes an inst in `place()`. */
    private async createInstance(buildId: FenceId, rotation: number, requestedSkin: string | undefined, attach: boolean, opacity?: number): Promise<FenceInstance> {
        if (this.disposed) throw new Error('Placement has been disposed');
        await Promise.all([
            this.assets.loadAnimation('structure_collapse_fx.zip'), this.assets.loadBuild('structure_collapse_fx.zip'),
            this.assets.loadAnimation('fire.zip'), this.assets.loadBuild('fire.zip'),
            PreloadSounds('dontstarve/common/destroy_smoke', 'dontstarve/common/destroy_wood', 'dontstarve/common/place_structure_wood',
                'dontstarve/common/campfire', 'dontstarve/common/fireOut'),
        ]);
        const skinId = fenceWorldSkin(buildId, requestedSkin);
        const art = await this.createArt(skinId, isNarrowRotation(rotation), opacity);
        const { instance, display } = createEmptyEntity(FENCE_ID);
        const root = display.model;
        root.userData.billboard = true;
        root.add(art.display.model);
        root.userData.animationController = art.instance.sprite;
        root.userData.fenceRotation = rotation;
        const fence: FenceInstance = {
            buildId, instance, display, root, art: createSignal(art), opacity: createSignal(opacity ?? 1),
            stopAppearance: () => {}, awake: true, rotation, skinId: createSignal(skinId), inventorySkinId: requestedSkin,
            preparedSkins: new Set(), stopSkin: () => {}, physics: new PhysicsState(),
        };
        const stopFacing = createRenderEffect(() => {
            const { sprite } = fence.art.get().instance;
            sprite.setFacing(facingFromRotation(fence.rotation, this.heading.get()));
            sprite.setOpacity(fence.opacity.get());
        });
        // Each drawn sprite is the fence's render group.
        const stopRenderGroup = createEffect(() => {
            const art = fence.art.get();
            art.instance.sprite.art.get();
            const visual = art.display.model.children[0]?.children[0];
            registerSpriteRenderGroup(root, visual instanceof THREE.Group ? visual : art.display.model);
        });
        fence.stopAppearance = () => { stopFacing(); stopRenderGroup(); };
        this.bindSkin(fence);
        instance.skinId = skinId;
        if (attach) this.scene.add(root);
        return fence;
    }

    /** prefabs/fence.lua's components, attached once the preview becomes a placed inst. */
    private initializeEntity(fence: FenceInstance): void {
        const { root } = fence;
        const entity = actionEntity(root, FENCE_ID);
        fence.entity = entity;
        for (const tag of FENCE_TAGS) entity.addTag(tag);
        root.userData.getGroundPosition = () => root.position.clone();
        const combatInst: CombatInst = {
            get isRemoved() { return entity.isRemoved; },
            getPosition: () => root.position.clone(), getPhysicsRadius: () => FENCE_PHYSICS_RADIUS,
            hasTag: tag => entity.hasTag(tag), PushEvent: (name, data) => entity.PushEvent?.(name, data),
            get components() { return entity.components as CombatInst['components']; },
        };
        // SetMaxHealth(1), SetAbsorptionAmount(1), canheal = false, nofadeout = true.
        const health = new Health(1, combatInst);
        health.absorb = 1; health.canheal = false; health.nofadeout = true;
        const combat = new Combat(combatInst, () => 0);
        combat.SetKeepTargetFunction(() => false);
        Object.assign(fence, { health, combat, combatInst });
        Object.assign(entity.components, { health, combat });
        const workable = new Workable(entity);
        entity.components.workable = workable;
        workable.SetWorkAction('HAMMER');
        workable.SetWorkLeft(3);
        // onworked: hit, then idle.
        workable.SetOnWorkCallback(() => this.playHit(fence));
        workable.SetOnFinishCallback(() => this.hammered(fence));
        combat.onhitfn = (_inst, attacker) => {
            workable.WorkedBy({ PushEvent: (name, data) => attacker.PushEvent?.(name, data) });
        };
        (root as unknown as THREE.EventDispatcher<{ death: object }>).addEventListener('death', () => this.hammered(fence));
        this.initializeBurnable(fence);
        new ToolMouseTarget(entity, fence.instance, workable, this.world.handEquipment, { spellTarget: true });
    }

    private playHit(fence: FenceInstance): void {
        const { sprite } = fence.art.peek().instance;
        sprite.playOnce('hit', () => sprite.playOnce('idle'));
    }

    /** Commit prepared art when the authoritative skin changes, keeping the entity and its components. */
    private bindSkin(fence: FenceInstance): void {
        fence.root.userData.skinIdSignal = readonlySignal(fence.skinId);
        fence.stopSkin = fence.skinId.subscribe(skinId => {
            const replacement = fence.preparedSkin;
            if (!replacement || !fence.preparedSkins.delete(replacement)) {
                throw new Error('Skin assets must be prepared before committing a skin change');
            }
            fence.preparedSkin = undefined;
            const previous = fence.art.peek();
            previous.display.adopt(replacement.display);
            this.release(replacement);
            fence.art.set({ ...replacement, instance: previous.instance, display: previous.display });
            this.applyFacing(fence, this.heading.peek());
            fence.instance.skinId = skinId;
        });
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
        const create = (clip: { name: string; loop: boolean }) => createSharedArchiveSprite(this.assets, {
            animationArchive: 'structure_collapse_fx.zip', buildArchives: ['structure_collapse_fx.zip'],
            bank: 'collapse', animation: clip.name, loop: clip.loop,
        });
        void create({ name: 'collapse_small', loop: false }).then(initial => {
            if (this.disposed) { initial.dispose(); return; }
            const effect = createArchiveEntity('collapse_small', { create, initial }, { name: 'collapse_small' }, 'collapse_small');
            for (const tag of ['NOCLICK', 'FX']) effect.instance.addTag(tag);
            effect.instance.persists = false;
            effect.instance.position.copy(position); this.scene.add(effect.display.model); this.effects.add(effect);
            effect.instance.sprite.playOnce('collapse_small', () => { this.release(effect); this.effects.delete(effect); });
        }).catch((error: unknown) => { if (!this.disposed) console.error('Unable to play fence collapse effect', error); });
    }

    private removeFence(fence: FenceInstance): void {
        if (!this.placed.delete(fence)) return;
        this.disposeFence(fence);
    }

    /** MakeMediumBurnable + MakeMediumPropagator, with DefaultBurnFn / DefaultExtinguishFn / DefaultBurntFn. */
    private initializeBurnable(fence: FenceInstance): void {
        const entity = fence.entity!;
        const inst: BurnableInst = entity;
        const burnable = new Burnable(inst);
        entity.components.burnable = burnable;
        burnable.SetBurnTime(FENCE_BURN_TIME);
        entity.components.propagator = new Propagator(inst, 'medium', radius => {
            const targets: BurnableInst[] = [];
            const origin = inst.getPosition();
            this.scene.traverse(model => {
                const target = model.userData.actionEntity as BurnableInst | undefined;
                if (!target?.components.propagator || target.isRemoved || target.hasTag('INLIMBO')) return;
                const position = target.getPosition();
                if (position.distanceToSquared(origin) <= radius ** 2) targets.push(target);
            });
            return targets;
        }, UNIT, undefined, getBoundWatchWorldContent());
        fence.root.userData.burningSignal = burnable.burning;
        burnable.SetOnIgniteFn(() => { fence.instance.persists = false; });
        fence.stopBurning = burnable.burning.subscribe(burning => {
            if (burning && fence.awake) this.showFire(fence); else this.hideFire(fence);
        });
        burnable.SetOnExtinguishFn(() => {
            fence.instance.persists = true;
            PlaySound('dontstarve/common/fireOut', fence.root.position);
        });
        burnable.SetOnBurntFn(() => {
            // DefaultBurntFn: one ash at the fence, then Remove.
            const position = fence.root.position.clone();
            const ash = this.world.spawnItem?.({ itemId: 'ash', count: 1 });
            if (ash) this.world.dropItem?.(ash, position);
            this.removeFence(fence);
        });
    }

    private showFire(fence: FenceInstance): void {
        if (!fence.awake || fence.fire) return;
        const create = (clip: { name: string; loop: boolean }) => createSharedArchiveSprite(this.assets, { animationArchive: 'fire.zip',
            buildArchives: ['fire.zip'], bank: 'fire', animation: clip.name, loop: clip.loop }, { name: 'fire' });
        const level = `level${FENCE_FX_LEVEL}`;
        void create({ name: level, loop: true }).then(initial => {
            if (this.disposed || !this.placed.has(fence) || !fence.awake || !fence.root.userData.burningSignal.peek() || fence.fire) { initial.dispose(); return; }
            const fire = createArchiveEntity('fire', { create, initial }, { name: level }, 'fire');
            for (const tag of ['FX', 'HASHEATER']) fire.instance.addTag(tag);
            fire.instance.persists = false;
            fire.instance.position.copy(fence.root.position);
            this.scene.add(fire.display.model); this.fires.add(fire);
            fence.fire = fire;
            setPrefabLocalLight(fence.root, { colour: [1, 1, 192 / 255], radius: (FENCE_FX_LEVEL + 1) * UNIT, intensity: .8, falloff: .33 });
            fence.fireSound = PlaySound('dontstarve/common/campfire', fence.root.position);
        }).catch((error: unknown) => { if (!this.disposed) console.error('Unable to show fence fire', error); });
    }

    private hideFire(fence: FenceInstance): void {
        if (fence.fire) { this.fires.delete(fence.fire); this.release(fence.fire); fence.fire = undefined; }
        fence.fireSound?.stop(); fence.fireSound = undefined;
        setPrefabLocalLight(fence.root, null);
    }

    private place(fence: FenceInstance): void {
        this.placed.add(fence); this.mouseRecords.set(fence.root, fence);
        fence.root.visible = true;
        this.initializeEntity(fence);
        this.faceCamera(fence.root);
        this.applyFacing(fence, this.heading.peek());
        // fence.lua: MakeObstaclePhysics(inst, .5); Physics:SetDontRemoveOnSleep(true), so pens hold outside the ticking area.
        MakeObstaclePhysics(fence, .5).SetDontRemoveOnSleep(true);
        if (this.world.physics) fence.physicsBinding ??= bindPhysics(this.world.physics, fence.physics, () => fence.root.position);
        fence.stopActivity = watchTileActivity(fence.root, this.world.tickingarea, active => {
            fence.awake = active;
            // Only the art follows the tile: the transform-only root stays in the scene like the pen's physics.
            fence.art.peek().instance.setActive(active);
            if (active && fence.root.userData.burningSignal.peek()) this.showFire(fence);
            else this.hideFire(fence);
        });
    }

    private disposeFence(fence: FenceInstance): void {
        fence.physicsBinding?.dispose(); fence.physicsBinding = undefined;
        fence.root.userData.removed = true;
        fence.stopActivity?.();
        fence.stopAppearance();
        fence.stopSkin();
        fence.stopBurning?.(); fence.stopBurning = undefined;
        this.hideFire(fence);
        const components = fence.entity?.components;
        components?.burnable?.SetOnExtinguishFn(undefined);
        components?.burnable?.dispose(); components?.propagator?.dispose();
        components?.workable?.dispose();
        fence.health?.dispose();
        if (fence.combat) fence.combat.onhitfn = undefined;
        fence.preparedSkin = undefined;
        for (const art of fence.preparedSkins) this.disposeArt(art);
        fence.preparedSkins.clear();
        if (fence.spare) { this.disposeArt(fence.spare); fence.spare = undefined; }
        this.disposeArt(fence.art.peek());
        registerSpriteRenderGroup(fence.root, fence.art.peek().display.model);
        this.release(fence);
    }

    private faceCamera(model: THREE.Object3D): void {
        this.camera.getWorldQuaternion(this.cameraWorldQuaternion);
        model.quaternion.copy(this.cameraWorldQuaternion);
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
