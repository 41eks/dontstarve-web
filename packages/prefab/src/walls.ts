import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import definitions from './definitions.json' with { type: 'json' };
import { WallPlacement, type WallDefinition } from './wallPlacement';
import type { WorldContext } from './worldContext';
import { WALL_SKIN_ARCHIVES, wallWorldPrefab } from './wallSkins';
import { PlaySound } from './sound';
import { PrefabInstance } from './prefabInstance';
import type { SpriteState } from '@dontstarve-web/display';
import { Health } from '../../componets/src/health';
import { Combat } from '../../componets/src/combat';
import { Workable } from '../../componets/src/workable';
import { MakeObstaclePhysics } from './standardcomponents';
import { createStructureLootDropper } from './structureLoot';
import { TILE_SIZE } from './tile';
import {
    wall_stone_init_fn, wall_ruins_init_fn, wall_moonrock_init_fn,
    wall_dreadstone_init_fn, wall_hay_init_fn, wall_wood_init_fn,
    type PrefabSkinInitializer,
} from '@dontstarve-web/animation/prefabskin';

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
export function resolveWallAnim(percent: number, position: ReadonlyVector3): string {
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

/**
 * `wall_*` is the placed world prefab, `wall_*_item` the deployable stack.
 * Both IDs resolve to the constructed wall, matching `prefabs/walls.lua`.
 */
export const WALL_IDS = [
    'wall_stone',
    'wall_stone_item',
    'wall_stone_2',
    'wall_stone_2_item',
    'wall_wood',
    'wall_wood_item',
    'wall_hay',
    'wall_hay_item',
    'wall_ruins',
    'wall_ruins_item',
    'wall_ruins_2',
    'wall_ruins_2_item',
    'wall_moonrock',
    'wall_moonrock_item',
    'wall_dreadstone',
    'wall_dreadstone_item',
    'wall_scrap',
    'wall_scrap_item',
] as const;

export type WallId = typeof WALL_IDS[number];

const WALL_SKIN_INITIALIZERS: Readonly<Record<string, PrefabSkinInitializer>> = {
    wall_stone: wall_stone_init_fn,
    wall_ruins: wall_ruins_init_fn,
    wall_moonrock: wall_moonrock_init_fn,
    wall_dreadstone: wall_dreadstone_init_fn,
    wall_hay: wall_hay_init_fn,
    wall_wood: wall_wood_init_fn,
};

const BASE_WALL_DEFINITIONS: Readonly<Record<WallId, Omit<WallDefinition, 'createPrefab' | 'onplaced'>>> = {
    wall_stone: definitions.walls.wall_stone,
    wall_stone_item: definitions.walls.wall_stone,
    wall_stone_2: definitions.walls.wall_stone_2,
    wall_stone_2_item: definitions.walls.wall_stone_2,
    wall_wood: definitions.walls.wall_wood,
    wall_wood_item: definitions.walls.wall_wood,
    wall_hay: definitions.walls.wall_hay,
    wall_hay_item: definitions.walls.wall_hay,
    wall_ruins: definitions.walls.wall_ruins,
    wall_ruins_item: definitions.walls.wall_ruins,
    wall_ruins_2: definitions.walls.wall_ruins_2,
    wall_ruins_2_item: definitions.walls.wall_ruins_2,
    wall_moonrock: definitions.walls.wall_moonrock,
    wall_moonrock_item: definitions.walls.wall_moonrock,
    wall_dreadstone: definitions.walls.wall_dreadstone,
    wall_dreadstone_item: definitions.walls.wall_dreadstone,
    wall_scrap: definitions.walls.wall_scrap,
    wall_scrap_item: definitions.walls.wall_scrap,
};

// walls.lua walldata with tuning.lua *WALL_HEALTH / *WALL_PLAYERDAMAGEMOD; health is independent of HAMMER work.
const WALL_WORK_DEFINITIONS: Readonly<Record<string, Pick<WallDefinition, 'tags' | 'hammerWorkLeft' | 'hammerMaterial' | 'hammerLoot' | 'maxhealth' | 'playerdamagemod'>>> = {
    wall_stone: { tags: ['stone'], hammerMaterial: 'stone', hammerLoot: { itemId: 'rocks', maxCount: 2 }, maxhealth: 400 },
    wall_stone_2: { tags: ['stone'], hammerMaterial: 'stone', hammerLoot: { itemId: 'rocks', maxCount: 2 }, maxhealth: 400 },
    wall_wood: { tags: ['wood'], hammerMaterial: 'wood', hammerLoot: { itemId: 'log', maxCount: 2 }, maxhealth: 200 },
    wall_hay: { tags: ['grass'], hammerMaterial: 'straw', hammerLoot: { itemId: 'cutgrass', maxCount: 2 }, maxhealth: 100 },
    wall_ruins: { tags: ['stone', 'ruins'], hammerMaterial: 'stone', hammerLoot: { itemId: 'thulecite_pieces', maxCount: 2 }, maxhealth: 800 },
    wall_ruins_2: { tags: ['stone', 'ruins'], hammerMaterial: 'stone', hammerLoot: { itemId: 'thulecite_pieces', maxCount: 2 }, maxhealth: 800 },
    wall_moonrock: { tags: ['stone', 'moonrock'], hammerWorkLeft: 25, hammerMaterial: 'stone', hammerLoot: { itemId: 'moonrocknugget', maxCount: 2 },
        maxhealth: 600, playerdamagemod: .25 },
    wall_dreadstone: { tags: ['stone', 'dreadstone'], hammerWorkLeft: 25, hammerMaterial: 'stone', hammerLoot: { itemId: 'dreadstone', maxCount: 2 },
        maxhealth: 800, playerdamagemod: .25 },
    wall_scrap: { tags: ['stone', 'scrap'], hammerWorkLeft: 10, hammerMaterial: 'stone', hammerLoot: { itemId: 'wagpunk_bits', maxCount: 1 },
        maxhealth: 600, playerdamagemod: .25 },
};

class WallPrefabInstance extends PrefabInstance {
    readonly wallData: WallDefinition;
    constructor(prefab: string, sprite: SpriteState, data: WallDefinition) { super(prefab, sprite); this.wallData = data; }
}

function onhit(inst: WallPrefabInstance): void {
    const { hammerMaterial } = inst.wallData;
    if (hammerMaterial) PlaySound(`dontstarve/common/destroy_${hammerMaterial}`, inst.position);
    if (inst.components.health!.GetPercent() > 0) {
        const anim = resolveWallAnim(inst.components.health!.GetPercent(), inst.position);
        inst.sprite.playOnce(`${anim}_hit`);
        inst.sprite.pushAnimation(anim, false);
    }
}

function onhealthchange(inst: WallPrefabInstance, oldPercent: number, newPercent: number): void {
    const anim = resolveWallAnim(newPercent, inst.position);
    inst.sprite.setPose(anim === 'half' ? undefined : anim);
    if (newPercent > 0) {
        if (oldPercent <= 0) inst.physics.SetActive(true);
        inst.sprite.playOnce(`${anim}_hit`);
        inst.sprite.pushAnimation(anim, false);
    } else {
        if (oldPercent > 0) inst.physics.SetActive(false);
        inst.sprite.playOnce(anim);
    }
}

/** MakeWallType.onhammered: condition-scaled loot, collapse_small, then Remove. */
function onhammered(inst: WallPrefabInstance): void {
    const { hammerLoot, hammerMaterial } = inst.wallData;
    if (hammerLoot) {
        const count = Math.max(1, Math.floor(hammerLoot.maxCount * inst.components.health!.GetPercent()));
        for (let i = 0; i < count; i++) inst.components.lootdropper!.SpawnLootPrefab(hammerLoot.itemId);
    }
    inst.worldServices?.fx?.collapse?.('small', inst.position, hammerMaterial);
    inst.remove();
}

function initializeWall(instance: PrefabInstance, saved?: { current: number; maximum: number }): void {
    const inst = instance as WallPrefabInstance;
    const data = inst.wallData;
    for (const tag of ['wall', 'noauradamage', 'electricdamageimmune', ...(data.tags ?? [])]) inst.addTag(tag);
    const health = inst.components.health = new Health(data.maxhealth ?? 100, inst);
    health.SetCurrentHealth(health.maxhealth * .5);
    health.canheal = false; health.nofadeout = true;
    if (data.playerdamagemod !== undefined) health.SetAbsorptionAmountFromPlayer(data.playerdamagemod);
    if (saved) health.OnLoad({ health: saved.current, maxhealth: saved.maximum });
    const anim = resolveWallAnim(health.GetPercent(), inst.position);
    inst.sprite.setPose(anim === 'half' ? undefined : anim);
    inst.sprite.playOnce(anim);
    health.ondelta = onhealthchange;
    const combat = inst.components.combat = new Combat(inst, () => inst.worldServices?.scheduler?.now ?? 0);
    combat.SetKeepTargetFunction(() => false);
    combat.onhitfn = onhit;
    inst.components.lootdropper = createStructureLootDropper(inst);
    const workable = inst.components.workable = new Workable(inst);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(data.hammerWorkLeft ?? 3);
    workable.SetOnWorkCallback(onhit);
    workable.SetOnFinishCallback(onhammered);
    MakeObstaclePhysics(inst, .5).SetDontRemoveOnSleep(true);
    inst.physics.SetActive(!health.IsDead());
    if (inst.worldServices?.physics) inst.bindPhysics(inst.worldServices.physics);
    inst.onRemove(() => { workable.dispose(); health.dispose(); combat.onhitfn = undefined; });
}

export const WALL_DEFINITIONS: Readonly<Record<WallId, WallDefinition>> = Object.fromEntries(
    WALL_IDS.map((id): [WallId, WallDefinition] => [id, {
        ...BASE_WALL_DEFINITIONS[id], skinArchives: WALL_SKIN_ARCHIVES[wallWorldPrefab(id)],
        skinInit: WALL_SKIN_INITIALIZERS[wallWorldPrefab(id)],
        ...WALL_WORK_DEFINITIONS[wallWorldPrefab(id)],
        createPrefab: (prefab, sprite) => new WallPrefabInstance(prefab, sprite, WALL_DEFINITIONS[id]),
        onplaced: initializeWall,
    }]),
) as Record<WallId, WallDefinition>;

export function isWallId(value: string): value is WallId {
    return WALL_IDS.some((wallId) => wallId === value);
}

export class WallsPlacement extends WallPlacement<WallId> {
    override exportRecords() {
        // The deployable item places a wall entity; its item ID is not a world prefab.
        return super.exportRecords().map(({ prefabId, record }) => ({
            prefabId: prefabId.endsWith('_item') ? prefabId.slice(0, -'_item'.length) : prefabId,
            record,
        }));
    }

    constructor(
        world: WorldContext,
        consumeBufferedBuild: (buildId: WallId) => boolean,
    ) {
        super(
            world,
            WALL_DEFINITIONS,
            consumeBufferedBuild,
        );
    }
}
