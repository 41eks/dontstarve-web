import definitions from './definitions.json' with { type: 'json' };
import { WallPlacement, type WallDefinition } from './wallPlacement';
import type { WorldContext } from './worldContext';
import { WALL_SKIN_ARCHIVES, wallWorldPrefab } from './wallSkins';

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

export const WALL_DEFINITIONS: Readonly<Record<WallId, WallDefinition>> = Object.fromEntries(
    WALL_IDS.map((id) => [id, {
        ...BASE_WALL_DEFINITIONS[id], skinArchives: WALL_SKIN_ARCHIVES[wallWorldPrefab(id)],
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
