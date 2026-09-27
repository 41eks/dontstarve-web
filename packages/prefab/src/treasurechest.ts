import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingDefinition,
} from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';

export const TREASURE_CHEST_ID = 'treasurechest' as const;
export type TreasureChestId = typeof TREASURE_CHEST_ID;

/**
 * The regular DST treasure chest uses `open` as a non-looping animation whose
 * last frame remains visible. Closing plays `close` and then returns to the
 * static `closed` animation, matching scripts/prefabs/treasurechest.lua.
 */
export const TREASURE_CHEST_DEFINITION: AnimatedBuildingDefinition = {
    archive: 'treasure_chest.zip',
    buildLabel: '箱子',
    idleAnimation: 'closed',
    interaction: {
        closeAnimation: 'close',
        closedAnimation: 'closed',
        openAnimation: 'open',
    },
    name: 'TreasureChest',
    scale: 0.02,
};

const TREASURE_CHEST_DEFINITIONS: Readonly<Record<TreasureChestId, AnimatedBuildingDefinition>> = {
    [TREASURE_CHEST_ID]: TREASURE_CHEST_DEFINITION,
};

export class TreasureChestPlacement extends AnimatedBuildingPlacement<TreasureChestId> {
    constructor(
        world: WorldContext,
        consumeBufferedBuild: (buildId: TreasureChestId) => boolean,
    ) {
        super(world, TREASURE_CHEST_DEFINITIONS, consumeBufferedBuild);
    }
}
