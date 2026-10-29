import { ToolMouseTarget } from './toolMouseTarget';
import { ModelRecords } from './modelRecords';
import * as THREE from 'three';
import { disposeSprite } from './disposeSprite';
import {
    createStaticSpriteFactory,
    type StaticSpriteFactory,
} from '@dontstarve-web/animation/wallSprite';
import { BuildCursor } from './buildCursor';
import { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import { snapToWallSlotCenter } from './tile';
import type { WorldContext } from './worldContext';
import { bindActionCancellation } from '@dontstarve-web/stategraphs/actionEvents';
import { newEntityId, saveGroundPosition, type PlacementSaveRecord, type PlacedEntitySaveRecord } from './saveRecord';
import type { HammerTarget } from '@dontstarve-web/stategraphs/hammer';
import { createArchiveEntity, createPrefabEntity, type PrefabInstance } from './prefabInstance';
import type { PrefabDisplay, SpriteState } from '@dontstarve-web/display';
import { watchTileActivity } from './tileActivity';
import { nextReskin } from './reskin_tool';
import { type ReskinFxMessage, type ReskinTarget } from '@dontstarve-web/stategraphs/reskin_tool';
import { wallWorldPrefab, wallWorldSkin } from './wallSkins';
import { actionEntity, findActionEntity } from './actionEntity';
import { Workable } from '../../componets/src/workable';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { GroundItemAssets } from './groundItems';
import { createSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { PlaySound } from './sound';
import { TILE_SIZE } from './tile';
import { MakeObstaclePhysics } from './standardcomponents';
import { Health } from '../../componets/src/health';
import { Combat, type CombatInst } from '../../componets/src/combat';
import { createRenderEffect, createMemo, createSignal, readonlySignal, watchSignal, type Memo, type Signal } from '@dontstarve-web/signals';
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
export function resolveWallAnim(percent: number, position: { x: number; z: number }): string {
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

interface WallArt {
    model: THREE.Group;
    readonly instance: PrefabInstance;
    readonly display: PrefabDisplay;
    animation: SpriteState;
    opacity: Signal<number>;
    stopAppearance: () => void;
    groundOffset: number;
}

interface WallInstance<BuildId extends string> extends WallArt {
    buildId: BuildId;
    readonly skinId: Signal<string | undefined>;
    stopActivity?: () => void;
    inventorySkinId?: string;
    health: Health;
    combat: Combat;
    combatInst: CombatInst;
    /** resolveanimtoplay(health percent), derived from the health signal. */
    healthAnim: Memo<string>;
    stopHealthAnim: () => void;
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
 * Places wall prefabs. A wall build archive ships no anim.bin, so its model is a
 * single build image instead of the animated sprite used by
 * `AnimatedBuildingPlacement`.
 */
export class WallPlacement<BuildId extends string> {
    private readonly actionEvents: WorldContext['actionEvents'];
    private readonly stopActionEvents: () => void;
    private disposed = false;
    private readonly canvas: HTMLCanvasElement;
    private readonly scene: THREE.Scene;
    private readonly camera: THREE.Camera;
    private readonly ground: THREE.Object3D;
    private readonly player: THREE.Object3D;
    private readonly definitions: Readonly<Record<BuildId, WallDefinition>>;
    private readonly consumeBufferedBuild: (buildId: BuildId, skinId?: string) => boolean;
    private readonly cursor: BuildCursor;
    private readonly pointer: PointerRaycaster;
    private active?: WallInstance<BuildId>;
    private loading?: Promise<void>;
    private previewVersion = 0;
    private readonly mouseRecords = new ModelRecords<WallInstance<BuildId>>();
    private readonly placed = new Set<WallInstance<BuildId>>();
    private readonly cameraWorldQuaternion = new THREE.Quaternion();
    private readonly facing: Signal<number>;
    private readonly cleanups: (() => void)[] = [];
    private readonly world: WorldContext;
    private readonly effectAssets = new GroundItemAssets();
    private readonly effects = new Set<ReturnType<typeof createArchiveEntity>>();
    private readonly sources = new Map<string, Promise<StaticSpriteFactory>>();

    constructor(
        world: WorldContext,
        definitions: Readonly<Record<BuildId, WallDefinition>>,
        consumeBufferedBuild: (buildId: BuildId, skinId?: string) => boolean,
    ) {
        this.world = world;
        this.actionEvents = world.actionEvents;
        this.stopActionEvents = bindActionCancellation(world, this, 'building', () => this.cancel());
        this.canvas = world.renderer.domElement;
        this.scene = world.scene;
        this.camera = world.camera;
        this.ground = world.ground;
        this.player = world.player;
        this.definitions = definitions;
        this.consumeBufferedBuild = consumeBufferedBuild;
        this.pointer = new PointerRaycaster(world);
        this.cursor = new BuildCursor(world, this.pointer);
        this.facing = watchSignal(world.cameraFacing, stop => this.cleanups.push(stop));
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
        const wall = await this.createInstance(buildId, true, skinId);
        const target = this.playerFrontGroundPosition();
        wall.model.position.set(target.x, target.y + wall.groundOffset, target.z);
        wall.model.visible = true;
        wall.opacity.set(1);
        this.faceCamera(wall.model);
        this.place(wall);
    }

    async spawnFromSave(buildId: BuildId, record: PlacementSaveRecord): Promise<THREE.Group> {
        const wall = await this.createInstance(buildId, false, record.components.wall?.skinId);
        wall.instance.entityId = record.id;
        wall.instance.saveRecord = record;
        const [x, y, z] = record.transform.position;
        wall.model.position.set(x, y + wall.groundOffset, z);
        // health:OnLoad after the position is known, so a full wall picks its stable variant.
        const saved = record.components.health;
        if (saved) wall.health.OnLoad({ health: saved.current, maxhealth: saved.maximum });
        this.faceCamera(wall.model);
        this.scene.add(wall.model);
        this.place(wall);
        return wall.model;
    }

    get renderEntities() {
        return [...this.placed, ...(this.active ? [this.active] : [])]
            .filter(({ model, animation }) => model.visible && animation.loaded)
            .map(({ model, groundOffset }) => ({
                object: model,
                footPosition: model.position.clone().add(new THREE.Vector3(0, -groundOffset, 0)),
                cameraDepth: 0,
            })).concat([...this.effects].map(({ display: { model } }) => ({ object: model, footPosition: model.position, cameraDepth: 0 })));
    }

    get hammerTargets(): readonly HammerTarget[] { return this.getHammerTargets(); }

    getHammerTargets(model?: THREE.Object3D): readonly HammerTarget[] {
        const targets: HammerTarget[] = [];
        for (const wall of this.mouseRecords.select(model, this.placed)) {
            const entity = actionEntity(wall.model, wallWorldPrefab(wall.buildId));
            if (!entity.hasTag('HAMMER_workable')) continue;
            targets.push({
                id: String(wall.instance.entityId), model: wall.model, entity,
                position: wall.model.position.clone().add(new THREE.Vector3(0, -wall.groundOffset, 0)),
                isValid: () => !this.disposed && this.placed.has(wall) && wall.model.visible && wall.model.parent !== null,
                playHit: () => { performToolWork('HAMMER', entity, {}); },
            });
        }
        return targets;
    }

    /** Live walls that combat:CanTarget; broken walls are dead and excluded. */
    get combatTargets(): readonly WallCombatTarget[] {
        return Array.from(this.placed, (wall) => ({
            id: String(wall.instance.entityId), model: wall.model, inst: wall.combatInst,
            isValid: () => !this.disposed && this.placed.has(wall) && wall.model.visible && wall.model.parent !== null
                && !wall.health.IsDead(),
        }));
    }

    get reskinTargets(): readonly ReskinTarget[] {
        return Array.from(this.placed, wall => findActionEntity(wall.model)?.reskinTarget)
            .filter((target): target is ReskinTarget => target !== undefined);
    }

    private createReskinTarget(wall: WallInstance<BuildId>): ReskinTarget {
        const isValid = () => !this.disposed && this.placed.has(wall)
            && wall.model.visible;
        return {
            get id() { return String(wall.instance.entityId); }, prefabId: wallWorldPrefab(wall.buildId), model: wall.model,
            skins: Object.keys(this.definitions[wall.buildId].skinArchives ?? {}), get skinId() { return wall.skinId.peek(); },
            get isRemoved() { return !isValid(); }, hasTag: tag => actionEntity(wall.model, wallWorldPrefab(wall.buildId)).hasTag(tag),
            get position() { return wall.model.position.clone().add(new THREE.Vector3(0, -wall.groundOffset, 0)); }, isValid,
            prepareNextSkin: async (tool) => {
                const previousSkin = wall.skinId.peek();
                const skinId = nextReskin(Object.keys(this.definitions[wall.buildId].skinArchives ?? {}), previousSkin, tool?._cached_reskinname, wallWorldPrefab(wall.buildId));
                let used = false;
                return {
                    skinId,
                    apply: (fx?: ReskinFxMessage) => {
                        if (used || !isValid() || wall.skinId.peek() !== previousSkin) return false;
                        wall.skinId.set(skinId);
                        fx?.play(wall.model.position.clone().add(new THREE.Vector3(0, -wall.groundOffset, 0)), wallWorldPrefab(wall.buildId));
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
            const health = { current: wall.health.currenthealth, maximum: wall.health.maxhealth };
            const skinId = wall.skinId.peek();
            return {
                prefabId: wall.buildId,
                record: {
                    id: wall.instance.entityId as string,
                    transform: {
                        position: saveGroundPosition(wall.model.position, wall.groundOffset),
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
        this.cleanups.splice(0).forEach(stop => stop());
        this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
        this.pointer.dispose();
        this.cancel();
        for (const instance of this.placed) {
            this.disposeWallComponents(instance);
            disposeSprite(instance.model);
        }
        for (const { instance, display } of this.effects) { instance.remove(); display.dispose(); }
        this.effects.clear(); this.effectAssets.dispose();
        this.placed.clear();
        for (const source of this.sources.values()) void source.then(factory => factory.dispose(), () => {});
        this.sources.clear();
    }

    cancel() {
        this.previewVersion += 1;
        this.loading = undefined;
        if (this.active) { this.disposeWallComponents(this.active); disposeSprite(this.active.model); }
        this.active = undefined;
        this.cursor.hide();
    }

    update(dt = 0) {
        for (const { instance, display } of this.effects) { this.faceCamera(display.model); instance.sprite.update(dt); }
        this.cursor.update();
        for (const wall of this.placed) {
            this.faceCamera(wall.model);
            wall.animation.update(dt);
        }
    }

    private readonly handlePointerDown = (event: PointerEvent) => {
        if (event.button === 2) {
            this.cancel();
            return;
        }
        if (event.button !== 0 || event.defaultPrevented) return;
        if (this.loading || this.active) event.preventDefault();
        if (!this.active) return;
        this.pointer.trackPointer(event);
        this.cursor.update();
        if (!this.pointer.isOverGround || !this.consumeBufferedBuild(this.active.buildId, this.active.inventorySkinId)) return;

        const placedWall = this.active;
        placedWall.model.visible = true;
        placedWall.opacity.set(1);
        this.place(placedWall);
        this.active = undefined;
        this.cursor.hide();
    };

    private async createPreview(buildId: BuildId, previewVersion: number, skinId?: string) {
        const instance = await this.createInstance(buildId, true, skinId);
        if (previewVersion !== this.previewVersion) {
            this.disposeWallComponents(instance);
            disposeSprite(instance.model);
            return;
        }
        instance.opacity.set(0.65);
        instance.model.visible = false;
        this.active = instance;
        this.updateFacing(instance, this.facing.peek());
        this.cursor.setPreview(instance.model, instance.groundOffset, snapToWallSlot);
        this.cursor.update();
    }

    /** prefabskin.lua's wall initializers change only the build, without creating components. */
    private async createArt(buildId: BuildId, skinId?: string): Promise<WallArt> {
        if (this.disposed) throw new Error('Placement has been disposed');
        const definition = this.definitions[buildId];
        const skinArchive = skinId === undefined ? undefined : definition.skinArchives?.[skinId];
        if (skinId !== undefined && skinArchive === undefined) throw new Error(`Unsupported ${buildId} skin: ${skinId}`);
        const skin = skinId === undefined ? undefined : definition.skinInit?.(skinId);
        const options = {
            imageIndices: [definition.sideImageIndex, definition.frontImageIndex],
            name: definition.name, scale: definition.scale, symbol: definition.symbol,
            ...(definition.overlay ? { overlay: { symbol: definition.overlay.symbol,
                imageIndices: [definition.overlay.sideImageIndex, definition.overlay.frontImageIndex] } } : {}),
            animationArchive: definition.animationArchive ?? 'wall.zip', restAnimation: 'half',
        };
        const archive = skin?.archive ?? definition.archive;
        const key = JSON.stringify([archive, options]);
        let request = this.sources.get(key);
        if (!request) {
            request = createStaticSpriteFactory(`${import.meta.env.BASE_URL}dst/data/anim`, archive, options);
            this.sources.set(key, request);
            void request.catch(() => { if (this.sources.get(key) === request) this.sources.delete(key); });
        }
        const source = await request;
        if (this.disposed) throw new Error('Placement has been disposed');
        const opacity = createSignal(1);
        const dress = (animation: SpriteState) => {
            const facing = this.facing.peek();
            animation.showImage(this.isFrontFacing(facing) ? definition.frontImageIndex : definition.sideImageIndex);
            animation.setFacing(facing);
            if (definition.multColour) animation.setColour(definition.multColour);
            animation.setOpacity(opacity.peek());
        };
        const { instance, display } = createPrefabEntity(buildId, { create: () => source.create(), release: sprite => source.disposeSprite(sprite) },
            { name: 'half', held: true }, definition.name, entity => {
                entity.skinId = skinId;
                entity.sprite.setSkinSource({ art: this.effectAssets,
                    archives: Object.fromEntries(Object.entries(definition.skinArchives ?? {}).map(([id, archive]) =>
                        [id, definition.skinInit?.(id).skinArchive ?? archive])) });
                entity.sprite.setPose(undefined); dress(entity.sprite);
            });
        const { model } = display;
        const animation = instance.sprite;
        const stopAppearance = createRenderEffect(() => {
            animation.art.get();
            const facing = this.facing.get();
            animation.showImage(this.isFrontFacing(facing) ? definition.frontImageIndex : definition.sideImageIndex);
            animation.setFacing(facing);
            if (definition.multColour) animation.setColour(definition.multColour);
            animation.setOpacity(opacity.get());
        });
        model.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3().setFromObject(model);
        return { model, instance, display, animation, opacity, stopAppearance, groundOffset: -bounds.min.y };
    }

    private async createInstance(buildId: BuildId, attach = true, requestedSkin?: string): Promise<WallInstance<BuildId>> {
        if (this.disposed) throw new Error('Placement has been disposed');
        const definition = this.definitions[buildId];
        await Promise.all([this.effectAssets.loadAnimation('structure_collapse_fx.zip'), this.effectAssets.loadBuild('structure_collapse_fx.zip')]);
        const skinId = requestedSkin === undefined ? undefined : wallWorldSkin(buildId, requestedSkin);
        const art = await this.createArt(buildId, skinId);
        const { model } = art;
        const entity = actionEntity(model, wallWorldPrefab(buildId));
        // Reskinning replaces the art and its ground offset on the same instance.
        let instance: WallInstance<BuildId> | undefined;
        const groundPosition = () => model.position.clone().setY(model.position.y - (instance?.groundOffset ?? art.groundOffset));
        model.userData.getGroundPosition = groundPosition;
        entity.addTag('wall');
        entity.addTag('noauradamage');
        entity.addTag('electricdamageimmune');
        const combatInst: CombatInst = {
            get isRemoved() { return entity.isRemoved; },
            getPosition: groundPosition,
            getPhysicsRadius: () => WALL_PHYSICS_RADIUS,
            hasTag: tag => entity.hasTag(tag),
            PushEvent: (name, data) => entity.PushEvent?.(name, data),
            get components() { return entity.components as CombatInst['components']; },
        };
        // walls.lua: SetMaxHealth(maxhealth), SetCurrentHealth(maxhealth * .5), canheal = false.
        const health = new Health(definition.maxhealth ?? 100, combatInst);
        health.SetCurrentHealth(health.maxhealth * .5);
        health.canheal = false;
        health.nofadeout = true;
        if (definition.playerdamagemod !== undefined) health.SetAbsorptionAmountFromPlayer(definition.playerdamagemod);
        const combat = new Combat(combatInst, () => 0);
        combat.SetKeepTargetFunction(() => false);
        const healthAnim = createMemo(() => resolveWallAnim(health.percent.get(), groundPosition()));
        const wall: WallInstance<BuildId> = {
            ...art,
            buildId,
            skinId: art.instance.sprite.skinId,
            inventorySkinId: requestedSkin,
            health, combat, combatInst, healthAnim,
            // The held pose follows health; `half` is the static build image.
            stopHealthAnim: healthAnim.subscribe(anim => wall.animation.setPose(anim === 'half' ? undefined : anim)),
        };
        instance = wall;
        entity.reskinTarget = this.createReskinTarget(wall);
        wall.model.userData.skinIdSignal = readonlySignal(wall.skinId);
        Object.assign(entity.components, { health, combat });
        // onhealthchange: a live wall plays <anim>_hit then holds <anim>; a broken wall holds `broken`.
        health.ondelta = (_inst, _oldPercent, newPercent) => {
            if (newPercent > 0) wall.animation.playTransient(`${healthAnim.peek()}_hit`);
            this.setObstacle(wall, newPercent > 0);
        };
        // onhit, shared by combat.onhitfn and workable:SetOnWorkCallback.
        const onhit = () => {
            if (definition.hammerMaterial) PlaySound(`dontstarve/common/destroy_${definition.hammerMaterial}`, model.position);
            if (health.GetPercent() > 0) wall.animation.playTransient(`${healthAnim.peek()}_hit`);
        };
        combat.onhitfn = onhit;
        const workable = new Workable(entity);
        entity.components.workable = workable;
        workable.SetWorkAction('HAMMER');
        workable.SetWorkLeft(definition.hammerWorkLeft ?? 3);
        new ToolMouseTarget(entity, wall.instance, workable, this.world.handEquipment);
        workable.SetOnWorkCallback(onhit);
        workable.SetOnFinishCallback(() => {
            if (!this.placed.has(wall)) return;
            const context = this.hammerContext(wall);
            if (definition.onhammered) definition.onhammered(context);
            else context.remove();
        });
        if (skinId !== undefined) wall.instance.skinId = skinId;
        if (attach) wall.instance.entityId = newEntityId();
        if (attach) this.scene.add(model);
        return wall;
    }

    private hammerContext(wall: WallInstance<BuildId>): WallHammerContext {
        const position = wall.model.position.clone().setY(wall.model.position.y - wall.groundOffset);
        return {
            definition: this.definitions[wall.buildId], health: wall.health, position,
            dropLoot: items => this.world.dropLoot?.(items, position),
            spawnEffect: () => {
                const create = (clip: { name: string; loop: boolean }) => createSharedArchiveSprite(this.effectAssets, {
                    animationArchive: 'structure_collapse_fx.zip', buildArchives: ['structure_collapse_fx.zip'],
                    bank: 'collapse', animation: clip.name, loop: clip.loop,
                });
                void create({ name: 'collapse_small', loop: false }).then(initial => {
                    if (this.disposed) { initial.dispose(); return; }
                    const effect = createArchiveEntity('collapse_small', { create, initial }, { name: 'collapse_small' }, 'collapse_small');
                    for (const tag of ['NOCLICK', 'FX']) effect.instance.addTag(tag);
                    effect.instance.persists = false;
                    effect.instance.position.copy(position); this.scene.add(effect.display.model); this.effects.add(effect);
                    effect.instance.sprite.playOnce('collapse_small', () => {
                        effect.instance.remove(); effect.display.dispose(); this.effects.delete(effect);
                    });
                }).catch((error: unknown) => { if (!this.disposed) console.error('Unable to play wall collapse effect', error); });
            },
            remove: () => {
                if (!this.placed.delete(wall)) return;
                this.disposeWallComponents(wall);
                disposeSprite(wall.model);
            },
        };
    }

    private place(wall: WallInstance<BuildId>): void {
        this.placed.add(wall); this.mouseRecords.set(wall.model, wall);
        this.updateFacing(wall, this.facing.peek());
        // walls.lua: MakeObstaclePhysics(inst, .5); Physics:SetDontRemoveOnSleep(true), so pens hold outside the ticking area.
        MakeObstaclePhysics(wall.instance, .5).SetDontRemoveOnSleep(true);
        this.setObstacle(wall, !wall.health.IsDead());
        if (this.world.physics) wall.instance.bindPhysics(this.world.physics, wall.model.userData.getGroundPosition);
        wall.stopActivity = watchTileActivity(wall.model, this.world.tickingarea, active => wall.instance.setActive(active));
    }

    /** walls.lua makeobstacle/clearobstacle: Physics:SetActive follows health > 0. Previews have no physics. */
    private setObstacle(wall: WallInstance<BuildId>, active: boolean): void {
        if (this.placed.has(wall)) wall.instance.physics.SetActive(active);
    }

    private disposeWallComponents(wall: WallInstance<BuildId>): void {
        wall.model.userData.removed = true;
        wall.stopActivity?.();
        wall.stopAppearance();
        actionEntity(wall.model, wallWorldPrefab(wall.buildId)).components.workable?.dispose();
        wall.stopHealthAnim();
        wall.healthAnim.dispose();
        wall.health.dispose();
        wall.combat.onhitfn = undefined;
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

    private updateFacing(wall: WallInstance<BuildId>, facing: number) {
        const definition = this.definitions[wall.buildId];
        wall.animation.showImage(
            this.isFrontFacing(facing) ? definition.frontImageIndex : definition.sideImageIndex,
        );
        wall.animation.setFacing(facing);
    }

    /** `facing=15` animations cover RIGHT/UP/LEFT/DOWN; `facing=240` covers the four diagonals. */
    private isFrontFacing(facing: number): boolean {
        return (facing & FACING_CARDINAL) !== 0;
    }

    private faceCamera(model: THREE.Object3D) {
        this.camera.getWorldQuaternion(this.cameraWorldQuaternion);
        model.quaternion.copy(this.cameraWorldQuaternion);
    }

}
