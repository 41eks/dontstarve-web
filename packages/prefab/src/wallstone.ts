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
