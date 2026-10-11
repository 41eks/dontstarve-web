import definitions from './definitions.json' with { type: 'json' };
import { WallPlacement, type WallDefinition, type WallHammerContext } from './wallPlacement';
import type { WorldContext } from './worldContext';
import { WALL_SKIN_ARCHIVES, wallWorldPrefab } from './wallSkins';
import { PlaySound } from './sound';
import {
    wall_stone_init_fn, wall_ruins_init_fn, wall_moonrock_init_fn,
    wall_dreadstone_init_fn, wall_hay_init_fn, wall_wood_init_fn,
    type PrefabSkinInitializer,
} from '@dontstarve-web/animation/prefabskin';

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

const BASE_WALL_DEFINITIONS: Readonly<Record<WallId, WallDefinition>> = {
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
const WALL_WORK_DEFINITIONS: Readonly<Record<string, Pick<WallDefinition, 'hammerWorkLeft' | 'hammerMaterial' | 'hammerLoot' | 'maxhealth' | 'playerdamagemod'>>> = {
    wall_stone: { hammerMaterial: 'stone', hammerLoot: { itemId: 'rocks', maxCount: 2 }, maxhealth: 400 },
    wall_stone_2: { hammerMaterial: 'stone', hammerLoot: { itemId: 'rocks', maxCount: 2 }, maxhealth: 400 },
    wall_wood: { hammerMaterial: 'wood', hammerLoot: { itemId: 'log', maxCount: 2 }, maxhealth: 200 },
    wall_hay: { hammerMaterial: 'straw', hammerLoot: { itemId: 'cutgrass', maxCount: 2 }, maxhealth: 100 },
    wall_ruins: { hammerMaterial: 'stone', hammerLoot: { itemId: 'thulecite_pieces', maxCount: 2 }, maxhealth: 800 },
    wall_ruins_2: { hammerMaterial: 'stone', hammerLoot: { itemId: 'thulecite_pieces', maxCount: 2 }, maxhealth: 800 },
    wall_moonrock: { hammerWorkLeft: 25, hammerMaterial: 'stone', hammerLoot: { itemId: 'moonrocknugget', maxCount: 2 },
        maxhealth: 600, playerdamagemod: .25 },
    wall_dreadstone: { hammerWorkLeft: 25, hammerMaterial: 'stone', hammerLoot: { itemId: 'dreadstone', maxCount: 2 },
        maxhealth: 800, playerdamagemod: .25 },
    wall_scrap: { hammerWorkLeft: 10, hammerMaterial: 'stone', hammerLoot: { itemId: 'wagpunk_bits', maxCount: 1 },
        maxhealth: 600, playerdamagemod: .25 },
};

/** walls.lua MakeWallType.onhammered: condition-scaled loot, collapse_small, then inst:Remove(). */
function onhammered({ definition, health, position, dropLoot, spawnEffect, remove }: WallHammerContext): void {
    if (definition.hammerLoot) {
        const num_loots = Math.max(1, Math.floor(definition.hammerLoot.maxCount * health.GetPercent()));
        dropLoot([{ itemId: definition.hammerLoot.itemId, count: num_loots }]);
    }
    spawnEffect();
    PlaySound('dontstarve/common/destroy_smoke', position);
    if (definition.hammerMaterial) PlaySound(`dontstarve/common/destroy_${definition.hammerMaterial}`, position);
    remove();
}

export const WALL_DEFINITIONS: Readonly<Record<WallId, WallDefinition>> = Object.fromEntries(
    WALL_IDS.map((id) => [id, {
        ...BASE_WALL_DEFINITIONS[id], skinArchives: WALL_SKIN_ARCHIVES[wallWorldPrefab(id)],
        skinInit: WALL_SKIN_INITIALIZERS[wallWorldPrefab(id)],
        ...WALL_WORK_DEFINITIONS[wallWorldPrefab(id)], onhammered,
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
