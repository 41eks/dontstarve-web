import { LootDropper } from '../../componets/src/lootdropper';
import { addComponent } from './components';
import { ToolMouseTarget } from './toolMouseTarget';
import { SpriteState, type SpriteResources } from '@dontstarve-web/display';
import type { ReadonlySignal } from '@dontstarve-web/signals';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { Combat, type CombatActor } from '../../componets/src/combat';
import { Health } from '../../componets/src/health';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { Workable } from '../../componets/src/workable';
import type { BuildingPlacerSpec } from './buildingPlacer';
import { PrefabInstance, type PrefabEntityDefinition, type PrefabEntityManager } from './prefabInstance';
import type { EntityPersistData } from './saveRecord';
import { PlaySound } from './sound';
import { spawnStructureLoot, STRUCTURE_LOOT_RECIPES } from './structureLoot';
import { PathfindingWall } from './pathfinder';
import { MakeObstaclePhysics } from './standardcomponents';
import { BurnableBinding } from './treeFire';
import { TILE_SIZE } from './tile';
import { FENCE_ID, FENCE_SKIN_ARCHIVES, fenceWorldSkin, type FenceId } from './fenceSkins';
import type { PrefabWorldContext } from './worldContext';

export { FENCE_ID, FENCE_ITEM_ID, FENCE_IDS, isFenceId, fenceWorldSkin, type FenceId, type FenceSaveState } from './fenceSkins';

/** DST distance unit in world units. */
const UNIT = TILE_SIZE / 4;
const ROT_SIDES = 8;
/** fence.lua assets: the wide anim, then the narrow one. */
const FENCE_ANIMATION_ARCHIVES: readonly string[] = ['fence.zip', 'fence_thin.zip'];
/** MakeMediumBurnable(inst): burn time 20, fx level 3; MakeMediumPropagator. */
const FENCE_BURN_TIME = 20;
const FENCE_FX_LEVEL = 3;
/** fence.lua FENCE_LOOT. */
const FENCE_LOOT = ['twigs'];

const mod = (value: number, divisor: number) => value - Math.floor(value / divisor) * divisor;

/** fence.lua CalcRotationEnum. */
export function calcRotationEnum(rotation: number): number {
    return Math.floor(mod(Math.floor(rotation + 0.5) / 45, ROT_SIDES));
}

/** IsEnumNarrow: even rotation enums use the narrow `fence_thin` bank, odd ones the wide `fence` bank. */
export function isNarrowRotation(rotation: number): boolean {
    return calcRotationEnum(rotation) % 2 === 0;
}

export interface FenceNeighbour { readonly isFence: boolean; readonly rotation: number }

/**
 * fence.lua FixUpFenceOrientation for a plain fence: facing a parallel fence from behind (the opposite side of
 * the same line) flips the rotation by 180 degrees so both fences face the same way.
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

/**
 * Transform:GetRotation. The eight-faced fence keeps the source rotation on its sprite declaration, which the display
 * turns into a facing against the camera; the root's own rotation stays 0.
 */
export function GetRotation(inst: PrefabInstance): number {
    return inst.sprite.sprite.peek().facingRotation ?? 0;
}

/**
 * fence.lua SetOrientation: Transform:SetRotation, and SetBank(anims.narrow / anims.wide) when the parity changes;
 * the build stays. `art` is given the first time, with fence.lua's wide and narrow ANIM assets and SetBuild("fence").
 */
export function SetOrientation(inst: PrefabInstance, rotation: number, art?: SpriteResources['archives']): void {
    inst.sprite.setFacingRotation(rotation);
    if (art) {
        inst.AnimState.DeclareAnimationAssets(FENCE_ANIMATION_ARCHIVES, art);
        inst.AnimState.SetBuild('fence.zip');
    }
    inst.AnimState.SetBank(isNarrowRotation(rotation) ? 'fence_thin' : 'fence');
}

/** FixUpFenceOrientation(inst, nil): FindEntities(x, 0, z, 1.5, { "wall" }) around the inst, without itself. */
function FixUpFenceOrientation(inst: PrefabInstance): void {
    const neighbours = inst.TheSim.FindEntities(inst.position, 1.5 * UNIT, ['wall'])
        .filter(found => found !== inst)
        .map(found => ({ isFence: found.hasTag('fence'), rotation: GetRotation(found) }));
    SetOrientation(inst, fixUpFenceRotation(GetRotation(inst), neighbours));
}

export class FenceInstance extends PrefabInstance {
    declare readonly components: PrefabInstance['components'] & {
        health: Health; combat: Combat; lootdropper: LootDropper; workable: Workable; inspectable: Inspectable;
    };
    /** inst.SetOrientation. */
    declare SetOrientation: typeof SetOrientation;
}

function onhammered(inst: PrefabInstance): void {
    if (inst.isRemoved) return;
    inst.components.lootdropper!.DropLoot();
    inst.worldServices?.fx?.collapse?.('small', inst.position, 'wood');
    inst.remove();
}

function onworked(inst: PrefabInstance): void {
    inst.sprite.playOnce('hit');
    inst.sprite.pushAnimation('idle', false);
}

function onhit(inst: PrefabInstance, attacker: CombatActor): void {
    inst.components.workable!.WorkedBy(attacker);
}

/** InitializePathFinding: inst._ispathfinding is set, so TheWorld.Pathfinder:AddWall at the fence; onremove clears it. */
function InitializePathFinding(inst: PrefabInstance): void {
    const pathfinding = new PathfindingWall(inst.worldServices?.pathfinder, () => inst.position);
    pathfinding.set(true);
    inst.onRemove(() => pathfinding.set(false));
}

/** DefaultBurntFn: one ash at the fence, then Remove. */
function onburnt(inst: PrefabInstance): void {
    const world = inst.worldServices, position = inst.position.clone();
    const ash = world?.spawnItem?.({ itemId: 'ash', count: 1 });
    if (ash) world?.dropItem?.(ash, position);
    inst.remove();
}

/**
 * onsave: data.rot unless it is 0, and the skin this project saves with it. A standing fence always has its one full
 * health, so health:OnSave carries nothing its OnLoad would change; the record keeps the fence's own shape without it.
 */
function onsave(inst: PrefabInstance, data: EntityPersistData): void {
    delete data.health;
    const rot = calcRotationEnum(GetRotation(inst));
    data.fence = { ...(rot > 0 ? { rot } : {}), ...(inst.skinId === undefined ? {} : { skinId: inst.skinId }) };
}

/** onload: SetOrientation(inst, data.rot * 45). */
function onload(inst: PrefabInstance, data: EntityPersistData): void {
    const saved = data.fence;
    if (!saved) return;
    if (saved.skinId !== undefined) inst.skinId = fenceWorldSkin(FENCE_ID, saved.skinId);
    SetOrientation(inst, (saved.rot ?? 0) * 45);
}

/** fence.lua MakeWall("fence", { wide = "fence", narrow = "fence_thin" }, false) fn, as far as it is ported. */
function fn(world: PrefabWorldContext, sprites: SpriteResources): FenceInstance {
    const inst = new FenceInstance(FENCE_ID, new SpriteState({ name: 'idle', billboard: true }));
    inst.worldServices = world;
    // Transform:SetEightFaced; SetBank(anims.wide), SetBuild("fence"), PlayAnimation("idle"). SpawnPrefab leaves rotation 0.
    SetOrientation(inst, 0, sprites.archives);
    inst.sprite.playOnce('idle');
    for (const tag of ['wall', 'fence', 'alignwall', 'noauradamage', 'electricdamageimmune', 'rotatableobject']) inst.addTag(tag);
    inst.DoTaskInTime(0, InitializePathFinding);
    addComponent(inst, 'inspectable', Inspectable);
    const lootdropper = addComponent(inst, 'lootdropper', LootDropper, spawnStructureLoot(inst), STRUCTURE_LOOT_RECIPES);
    lootdropper.SetLoot(FENCE_LOOT);
    lootdropper.droprecipeloot = false;
    const workable = addComponent(inst, 'workable', Workable);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(3);
    workable.SetOnFinishCallback(onhammered);
    workable.SetOnWorkCallback(onworked);
    const combat = addComponent(inst, 'combat', Combat, () => inst.worldServices?.scheduler?.now ?? 0);
    combat.SetKeepTargetFunction(() => false);
    combat.onhitfn = onhit;
    const health = addComponent(inst, 'health', Health, 1);
    health.absorb = 1; health.canheal = false; health.nofadeout = true;
    inst.ListenForEvent('death', onhammered);
    // MakeMediumBurnable + MakeMediumPropagator, with DefaultBurnFn / DefaultExtinguishFn / DefaultBurntFn.
    const { fire, scheduler } = world;
    if (!fire) throw new Error('A fence needs the world\'s fire effects');
    const burn = new BurnableBinding(inst, {
        propagator: 'medium', burnTime: FENCE_BURN_TIME, fxLevel: FENCE_FX_LEVEL,
        onIgnite: () => { inst.persists = false; },
        onExtinguish: () => { inst.persists = true; },
        onBurnt: () => onburnt(inst),
    }, { fire, scheduler });
    inst.onRemove(() => { burn.dispose(); combat.onhitfn = undefined; });
    inst.OnSave = onsave;
    inst.OnLoad = onload;
    inst.SetOrientation = SetOrientation;
    return inst;
}

/** What the mouse and the tools find on a fence: the hammer and the reskin tool. */
function onspawned(inst: FenceInstance, world: Pick<PrefabWorldContext, 'handEquipment'>): void {
    new ToolMouseTarget(inst, world.handEquipment);
}

/** The Prefab fence.lua returns for the placed fence; fence_item is a ground and inventory item. */
export function fencePrefabs(world: PrefabWorldContext): Readonly<Record<typeof FENCE_ID, PrefabEntityDefinition<FenceInstance>>> {
    return {
        [FENCE_ID]: {
            fn: (_position, sprites) => fn(world, sprites),
            // The bank comes from SetOrientation's AnimState SetBank, which fn and onload declare before the display
            // starts; a later rotation that changes the bank reaches the drawn sprite the same way.
            assets: { animationArchive: 'fence.zip', buildArchives: ['fence.zip'], bank: 'fence' },
            // idle is a held one-shot, hit plays once: every clip is drawn by the shared batches.
            assetOptions: { instancedAnimations: 'all' },
            skins: FENCE_SKIN_ARCHIVES,
            // MakeObstaclePhysics(inst, .5); inst.Physics:SetDontRemoveOnSleep(true).
            physics: { make: (inst, radius) => MakeObstaclePhysics(inst, radius).SetDontRemoveOnSleep(true), radius: .5 },
            onSpawned: inst => onspawned(inst, world),
        },
    };
}

/**
 * fence.lua MakeWallPlacer -> MakePlacer("fence_item_placer", "fence", "fence", "idle", ..., fixedcameraoffset 0, ...):
 * looping, eight-faced, snapped to the wall grid, turned against the camera and fixed up against its neighbours each frame.
 */
export function fencePlacer(buildId: FenceId, cameraHeading: ReadonlySignal<number>, snap: BuildingPlacerSpec['snap']): BuildingPlacerSpec {
    return {
        buildLabel: '栅栏', name: FENCE_ID, animation: 'idle', alignBottom: false, snap,
        // The shared archive of the bank SetOrientation picks for the first rotation; a later rotation that changes the
        // bank reaches the archive sprite as AnimState SetBank (setArtSource).
        art: (resources, skinId) => {
            const rotation = placerRotation(cameraHeading.peek()), bank = isNarrowRotation(rotation) ? 'fence_thin' : 'fence';
            return {
                archive: { animationArchive: `${bank}.zip`, buildArchives: ['fence.zip'], bank },
                initialize: placer => {
                    placer.skinId = fenceWorldSkin(buildId, skinId);
                    placer.sprite.setSkinSource({ art: resources.archives, archives: FENCE_SKIN_ARCHIVES });
                    SetOrientation(placer, rotation, resources.archives);
                },
            };
        },
        // placer:OnUpdate sets the camera-relative rotation, then placerupdate -> FixUpFenceOrientation(inst, nil).
        onupdatetransform: placer => {
            SetOrientation(placer, placerRotation(cameraHeading.peek()));
            FixUpFenceOrientation(placer);
        },
    };
}

/**
 * fence_item ondeploywall: SpawnPrefab("fence", linked skin) at the wall slot, the placer's fixed-up rotation, and the
 * place sound. Consuming the item is the build flow's.
 */
export function ondeploywall(prefabs: Pick<PrefabEntityManager<string, PrefabInstance>, 'spawnAs'>, buildId: FenceId,
    pt: ReadonlyVector3, skinId: string | undefined, rot: number): FenceInstance {
    const wall = prefabs.spawnAs(FenceInstance, FENCE_ID, pt, undefined, fenceWorldSkin(buildId, skinId));
    wall.SetOrientation(wall, rot);
    PlaySound('dontstarve/common/place_structure_wood', wall.position);
    return wall;
}
