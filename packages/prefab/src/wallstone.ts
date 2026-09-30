import definitions from './definitions.json' with { type: 'json' };
import { WallPlacement, type WallDefinition } from './wallPlacement';
import type { WorldContext } from './worldContext';

/** `wall_stone` is the prefab name, `wall_stone_item` the craftable recipe. */
export const WALL_STONE_IDS = [
    'wall_stone',
    'wall_stone_item',
] as const;

export type WallStoneId = typeof WALL_STONE_IDS[number];

export const WALL_STONE_DEFINITIONS: Readonly<Record<WallStoneId, WallDefinition>> = {
    wall_stone: definitions.walls.wall_stone,
    wall_stone_item: definitions.walls.wall_stone,
};

export function isWallStoneId(value: string): value is WallStoneId {
    return WALL_STONE_IDS.some((wallStoneId) => wallStoneId === value);
}

export class WallStonePlacement extends WallPlacement<WallStoneId> {
    override exportRecords() {
        // The craftable item places a wall entity; its item ID is not a world prefab.
        return super.exportRecords().map(({ record }) => ({ prefabId: 'wall_stone', record }));
    }

    constructor(
        world: WorldContext,
        consumeBufferedBuild: (buildId: WallStoneId) => boolean,
    ) {
        super(
            world,
            WALL_STONE_DEFINITIONS,
            consumeBufferedBuild,
        );
    }
}
