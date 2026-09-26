import { WallPlacement, type WallDefinition } from './wallPlacement';
import type { WorldContext } from './worldContext';

/** `wall_stone` is the prefab name, `wall_stone_item` the craftable recipe. */
export const WALL_STONE_IDS = [
    'wall_stone',
    'wall_stone_item',
] as const;

export type WallStoneId = typeof WALL_STONE_IDS[number];

export const WALL_STONE_DEFINITIONS: Readonly<Record<WallStoneId, WallDefinition>> = {
    wall_stone: {
        archive: 'wall_stone.zip',
        buildLabel: '石墙',
        frontImageIndex: 14,
        name: 'WallStone',
        scale: 0.02,
        sideImageIndex: 4,
        symbol: 'wall_segment',
    },
    wall_stone_item: {
        archive: 'wall_stone.zip',
        buildLabel: '石墙',
        frontImageIndex: 14,
        name: 'WallStone',
        scale: 0.02,
        sideImageIndex: 4,
        symbol: 'wall_segment',
    },
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
