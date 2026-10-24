import * as THREE from 'three';
import { disposeSprite } from './disposeSprite';
import {
    createStaticSprite,
    type StaticSpriteController,
} from '@dontstarve-web/animation/wallSprite';
import { BuildCursor } from './buildCursor';
import { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import { snapToWallSlotCenter } from './tile';
import type { WorldContext } from './worldContext';
import { bindActionCancellation } from '@dontstarve-web/stategraphs/actionEvents';
import { newEntityId, saveGroundPosition, type PlacementSaveRecord, type PlacedEntitySaveRecord } from './saveRecord';
import type { HammerTarget } from '@dontstarve-web/stategraphs/hammer';
import { registerSpriteRenderGroup } from '@dontstarve-web/animation/renderOrder';
import { nextReskin } from './reskin_tool';
import { type ReskinTarget } from '@dontstarve-web/stategraphs/reskin_tool';
import { wallWorldPrefab, wallWorldSkin } from './wallSkins';
import { actionEntity } from './actionEntity';
import { Workable } from '../../componets/src/workable';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { GroundItemAssets } from './groundItems';
import { createArchiveSprite, type ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { PlaySound, PreloadSounds } from './sound';
import { TILE_SIZE } from './tile';
import { Health } from '../../componets/src/health';
import { Combat, type CombatInst } from '../../componets/src/combat';
import { createMemo, createSignal, readonlySignal, type Memo, type Signal } from '@dontstarve-web/signals';
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
    animation: StaticSpriteController;
    groundOffset: number;
}

interface WallInstance<BuildId extends string> extends WallArt {
    buildId: BuildId;
    readonly skinId: Signal<string | undefined>;
    readonly preparedSkins: Set<WallArt>;
    preparedSkin?: WallArt;
    stopSkin: () => void;
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

const HEADING_STEP = 45;

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
    private readonly placed = new Set<WallInstance<BuildId>>();
    private readonly cameraWorldQuaternion = new THREE.Quaternion();
    private readonly cameraDirection = new THREE.Vector3();
    private readonly world: WorldContext;
    private readonly effectAssets = new GroundItemAssets(`${import.meta.env.BASE_URL}dst/data/anim`);
    private readonly effects = new Set<ArchiveSprite>();

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
        wall.model.position.set(
            target.x,
            target.y + wall.groundOffset,
            target.z,
        );
        wall.model.visible = true;
        this.setOpacity(wall.model, 1);
        this.faceCamera(wall.model);
        this.placed.add(wall);
    }

    async spawnFromSave(buildId: BuildId, record: PlacementSaveRecord): Promise<THREE.Group> {
        const wall = await this.createInstance(buildId, false, record.components.wall?.skinId);
        wall.model.userData.entityId = record.id;
        wall.model.userData.saveRecord = record;
        const [x, y, z] = record.transform.position;
        wall.model.position.set(x, y + wall.groundOffset, z);
        // health:OnLoad after the position is known, so a full wall picks its stable variant.
        const saved = record.components.health;
        if (saved) wall.health.OnLoad({ health: saved.current, maxhealth: saved.maximum });
        this.faceCamera(wall.model);
        this.scene.add(wall.model);
        this.placed.add(wall);
        return wall.model;
    }

    get renderEntities() {
        return [...this.placed, ...(this.active ? [this.active] : [])]
            .filter(({ model }) => model.visible)
            .map(({ model, groundOffset }) => ({
                object: model,
                footPosition: model.position.clone().add(new THREE.Vector3(0, -groundOffset, 0)),
                cameraDepth: 0,
            })).concat([...this.effects].map(effect => ({ object: effect.model, footPosition: effect.model.position, cameraDepth: 0 })));
    }

    get hammerTargets(): readonly HammerTarget[] {
        const targets: HammerTarget[] = [];
        for (const wall of this.placed) {
            const entity = actionEntity(wall.model, wallWorldPrefab(wall.buildId));
            if (!entity.hasTag('HAMMER_workable')) continue;
            targets.push({
                id: String(wall.model.userData.entityId), model: wall.model, entity,
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
            id: String(wall.model.userData.entityId), model: wall.model, inst: wall.combatInst,
            isValid: () => !this.disposed && this.placed.has(wall) && wall.model.visible && wall.model.parent !== null
                && !wall.health.IsDead(),
        }));
    }

    get reskinTargets(): readonly ReskinTarget[] {
        return Array.from(this.placed, (wall) => {
                const isValid = () => !this.disposed && this.placed.has(wall)
                    && wall.model.visible && wall.model.parent !== null;
                return {
                    id: String(wall.model.userData.entityId), prefabId: wallWorldPrefab(wall.buildId), model: wall.model,
                    skins: Object.keys(this.definitions[wall.buildId].skinArchives ?? {}), get skinId() { return wall.skinId.peek(); },
                    get isRemoved() { return !isValid(); }, hasTag: tag => actionEntity(wall.model, wallWorldPrefab(wall.buildId)).hasTag(tag),
                    get position() { return wall.model.position.clone().add(new THREE.Vector3(0, -wall.groundOffset, 0)); }, isValid,
                    prepareNextSkin: async (tool) => {
                        const previousSkin = wall.skinId.peek();
                        const skinId = nextReskin(Object.keys(this.definitions[wall.buildId].skinArchives ?? {}), previousSkin, tool?._cached_reskinname, wallWorldPrefab(wall.buildId));
                        const replacement = await this.createArt(wall.buildId, skinId);
                        if (!isValid() || wall.skinId.peek() !== previousSkin || skinId === previousSkin) {
                            disposeSprite(replacement.model);
                            return { apply: () => false, dispose: () => {} };
                        }
                        wall.preparedSkins.add(replacement);
                        let used = false;
                        return {
                            apply: () => {
                                if (used || !isValid() || wall.skinId.peek() !== previousSkin
                                    || !wall.preparedSkins.has(replacement)) return false;
                                wall.preparedSkin = replacement;
                                wall.skinId.set(skinId);
                                used = true;
                                return true;
                            },
                            dispose: () => {
                                if (used) return;
                                this.releasePreparedSkin(wall, replacement);
                                used = true;
                            },
                        };
                    },
                };
            });
    }

    exportRecords(): PlacedEntitySaveRecord[] {
        return Array.from(this.placed, (wall) => {
            const health = { current: wall.health.currenthealth, maximum: wall.health.maxhealth };
            const skinId = wall.skinId.peek();
            return {
                prefabId: wall.buildId,
                record: {
                    id: wall.model.userData.entityId as string,
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
        this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
        this.pointer.dispose();
        this.cancel();
        for (const instance of this.placed) {
            this.disposeWallComponents(instance);
            disposeSprite(instance.model);
        }
        for (const effect of this.effects) effect.dispose();
        this.effects.clear(); this.effectAssets.dispose();
        this.placed.clear();
    }

    cancel() {
        this.previewVersion += 1;
        this.loading = undefined;
        if (this.active) { this.disposeWallComponents(this.active); disposeSprite(this.active.model); }
        this.active = undefined;
        this.cursor.hide();
    }

    update(dt = 0) {
        for (const effect of this.effects) { this.faceCamera(effect.model); effect.update(dt); }
        this.cursor.update();
        const showFront = !this.isDiagonalHeading();
        if (this.active) this.updateFacing(this.active, showFront);
        for (const wall of this.placed) {
            this.faceCamera(wall.model);
            this.updateFacing(wall, showFront);
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
        this.setOpacity(placedWall.model, 1);
        this.placed.add(placedWall);
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
        this.setOpacity(instance.model, 0.65);
        instance.model.visible = false;
        this.active = instance;
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
        const model = await createStaticSprite(
            `${import.meta.env.BASE_URL}dst/data/anim`,
            skin?.archive ?? definition.archive,
            {
                imageIndices: [definition.sideImageIndex, definition.frontImageIndex],
                imageIndex: this.isDiagonalHeading()
                    ? definition.sideImageIndex
                    : definition.frontImageIndex,
                name: definition.name,
                scale: definition.scale,
                symbol: definition.symbol,
                skinArchive: skin?.skinArchive ?? skinArchive,
                ...(definition.overlay ? {
                    overlay: {
                        symbol: definition.overlay.symbol,
                        imageIndices: [definition.overlay.sideImageIndex, definition.overlay.frontImageIndex],
                    },
                } : {}),
                animationArchive: definition.animationArchive ?? 'wall.zip',
                restAnimation: 'half',
            },
        );
        if (definition.multColour) this.setMultColour(model, definition.multColour);
        if (this.disposed) { disposeSprite(model); throw new Error('Placement has been disposed'); }
        model.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3().setFromObject(model);
        return { model, animation: model.userData.animationController as StaticSpriteController, groundOffset: -bounds.min.y };
    }

    private async createInstance(buildId: BuildId, attach = true, requestedSkin?: string): Promise<WallInstance<BuildId>> {
        if (this.disposed) throw new Error('Placement has been disposed');
        const definition = this.definitions[buildId];
        await Promise.all([this.effectAssets.loadAnimation('structure_collapse_fx.zip'), this.effectAssets.loadBuild('structure_collapse_fx.zip'),
            definition.hammerMaterial ? PreloadSounds('dontstarve/common/destroy_smoke', `dontstarve/common/destroy_${definition.hammerMaterial}`) : undefined]);
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
            skinId: createSignal(skinId),
            preparedSkins: new Set(),
            stopSkin: () => {},
            inventorySkinId: requestedSkin,
            health, combat, combatInst, healthAnim,
            // The held pose follows health; `half` is the static build image.
            stopHealthAnim: healthAnim.subscribe(anim => wall.animation.setPose(anim === 'half' ? undefined : anim)),
        };
        instance = wall;
        this.bindSkin(wall);
        Object.assign(entity.components, { health, combat });
        // onhealthchange: a live wall plays <anim>_hit then holds <anim>; a broken wall holds `broken`.
        health.ondelta = (_inst, _oldPercent, newPercent) => {
            if (newPercent > 0) wall.animation.playTransient(`${healthAnim.peek()}_hit`);
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
        workable.SetOnWorkCallback(onhit);
        workable.SetOnFinishCallback(() => {
            if (!this.placed.has(wall)) return;
            const context = this.hammerContext(wall);
            if (definition.onhammered) definition.onhammered(context);
            else context.remove();
        });
        if (skinId !== undefined) model.userData.skinId = skinId;
        if (attach) model.userData.entityId = newEntityId();
        if (attach) this.scene.add(model);
        return wall;
    }

    /** Commit prepared art when the authoritative skin changes; keep the original entity and components. */
    private bindSkin(wall: WallInstance<BuildId>): void {
        wall.model.userData.skinIdSignal = readonlySignal(wall.skinId);
        wall.stopSkin = wall.skinId.subscribe(skinId => {
            const replacement = wall.preparedSkin;
            if (!replacement || !wall.preparedSkins.delete(replacement)) {
                throw new Error('Skin assets must be prepared before committing a skin change');
            }
            wall.preparedSkin = undefined;
            const footY = wall.model.position.y - wall.groundOffset;
            replacement.animation.copyPlaybackFrom(wall.animation);
            // Include unused fallback atlas materials when releasing the old art.
            const oldVisuals = new THREE.Group();
            oldVisuals.userData.ownedSpriteMaterials = wall.model.userData.ownedSpriteMaterials;
            for (const child of [...wall.model.children]) oldVisuals.add(child);
            disposeSprite(oldVisuals);
            for (const child of [...replacement.model.children]) wall.model.add(child);
            wall.model.userData.ownedSpriteMaterials = replacement.model.userData.ownedSpriteMaterials;
            registerSpriteRenderGroup(wall.model, wall.model.children[0] as THREE.Group);
            wall.animation = replacement.animation;
            wall.model.userData.animationController = replacement.animation;
            wall.groundOffset = replacement.groundOffset;
            wall.model.position.y = footY + wall.groundOffset;
            if (skinId === undefined) delete wall.model.userData.skinId;
            else wall.model.userData.skinId = skinId;
            this.updateFacing(wall, !this.isDiagonalHeading());
        });
    }

    private releasePreparedSkin(wall: WallInstance<BuildId>, art: WallArt): void {
        if (wall.preparedSkins.delete(art)) disposeSprite(art.model);
    }

    private hammerContext(wall: WallInstance<BuildId>): WallHammerContext {
        const position = wall.model.position.clone().setY(wall.model.position.y - wall.groundOffset);
        return {
            definition: this.definitions[wall.buildId], health: wall.health, position,
            dropLoot: items => this.world.dropLoot?.(items, position),
            spawnEffect: () => {
                void createArchiveSprite(this.effectAssets, {
                    animationArchive: 'structure_collapse_fx.zip', buildArchives: ['structure_collapse_fx.zip'],
                    bank: 'collapse', animation: 'collapse_small', loop: false,
                }).then(effect => {
                    if (this.disposed) { effect.dispose(); return; }
                    effect.model.position.copy(position); this.scene.add(effect.model); this.effects.add(effect);
                    effect.playOnce('collapse_small', () => { effect.dispose(); this.effects.delete(effect); });
                }).catch((error: unknown) => { if (!this.disposed) console.error('Unable to play wall collapse effect', error); });
            },
            remove: () => {
                if (!this.placed.delete(wall)) return;
                this.disposeWallComponents(wall);
                disposeSprite(wall.model);
            },
        };
    }

    private disposeWallComponents(wall: WallInstance<BuildId>): void {
        wall.model.userData.removed = true;
        wall.stopSkin();
        wall.preparedSkin = undefined;
        for (const art of wall.preparedSkins) this.releasePreparedSkin(wall, art);
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

    private updateFacing(wall: WallInstance<BuildId>, showFront: boolean) {
        const definition = this.definitions[wall.buildId];
        wall.animation.showImage(
            showFront ? definition.frontImageIndex : definition.sideImageIndex,
        );
        wall.animation.setFacing(showFront ? 8 : 128);
    }

    /**
     * The wall is eight-faced and never rotated, so the game picks its art from
     * `rotation + camera heading` (see `components/placer.lua`, "rotate against
     * the camera"). A diagonal heading therefore selects the oblique `facing=240`
     * art, a cardinal one the front `facing=15` art.
     */
    private isDiagonalHeading(): boolean {
        this.camera.getWorldDirection(this.cameraDirection);
        this.cameraDirection.y = 0;
        if (this.cameraDirection.lengthSq() === 0) return false;
        const heading = Math.atan2(-this.cameraDirection.z, -this.cameraDirection.x);
        const steps = Math.round(THREE.MathUtils.radToDeg(heading) / HEADING_STEP);
        return THREE.MathUtils.euclideanModulo(steps, 2) === 1;
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

    private setMultColour(model: THREE.Object3D, colour: readonly number[]) {
        const [red, green, blue] = [colour[0] ?? 1, colour[1] ?? 1, colour[2] ?? 1];
        model.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => {
                material.color.setRGB(red, green, blue);
            });
        });
    }
}
