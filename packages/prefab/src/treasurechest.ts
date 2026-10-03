import definitions from './definitions.json' with { type: 'json' };
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
} from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';

export const TREASURE_CHEST_ID = 'treasurechest' as const;
export type TreasureChestId = typeof TREASURE_CHEST_ID;

export const TREASURE_CHEST_SKIN_ARCHIVES: Readonly<Record<string, string>> =
    definitions.animatedBuildings.treasurechest.skinArchives;

function onbuilt({ animation, onComplete }: AnimatedBuildingBuiltContext): void {
    animation.playOnce('place', () => {
        animation.start('closed');
        onComplete();
    });
}

export const TREASURE_CHEST_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.treasurechest,
    onbuilt,
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
