import definitions from './definitions.json' with { type: 'json' };
import { dragonflychest_init_fn } from '@three-roaming/animation/prefabskin';
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
    type AnimatedBuildingInteractionChange,
} from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';

export const DRAGONFLY_CHEST_ID = 'dragonflychest' as const;
export type DragonflyChestId = typeof DRAGONFLY_CHEST_ID;
export const DRAGONFLY_CHEST_SKIN_ARCHIVES: Readonly<Record<string, string>> =
    definitions.animatedBuildings.dragonflychest.skinArchives;

function onbuilt({ animation, onComplete }: AnimatedBuildingBuiltContext): void {
    animation.playOnce('place', () => {
        animation.start('closed');
        onComplete();
    });
}

export const DRAGONFLY_CHEST_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.dragonflychest,
    skinInit: dragonflychest_init_fn,
    onbuilt,
};

export class DragonflyChestPlacement extends AnimatedBuildingPlacement<DragonflyChestId> {
    constructor(
        world: WorldContext,
        consumeBufferedBuild: (buildId: DragonflyChestId) => boolean,
        onInteractionChange?: (change: AnimatedBuildingInteractionChange<DragonflyChestId>) => void,
    ) {
        super(world, { [DRAGONFLY_CHEST_ID]: DRAGONFLY_CHEST_DEFINITION }, consumeBufferedBuild, onInteractionChange);
    }
}

