import definitions from './definitions.json' with { type: 'json' };
import { pighouse_init_fn } from '@dontstarve-web/animation/prefabskin';
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
} from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';

export const PIG_HOUSE_ID = 'pighouse' as const;
export type PigHouseId = typeof PIG_HOUSE_ID;
export const PIG_HOUSE_SKIN_ARCHIVES: Readonly<Record<string, string>> =
    definitions.animatedBuildings.pighouse.skinArchives;

function onbuilt({ animation, onComplete }: AnimatedBuildingBuiltContext): void {
    animation.playOnce('place', () => {
        animation.start('idle');
        onComplete();
    });
}

export const PIG_HOUSE_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.pighouse,
    skinInit: pighouse_init_fn,
    onbuilt,
};

export class PigHousePlacement extends AnimatedBuildingPlacement<PigHouseId> {
    constructor(
        world: WorldContext,
        consumeBufferedBuild: (buildId: PigHouseId) => boolean,
    ) {
        super(world, { [PIG_HOUSE_ID]: PIG_HOUSE_DEFINITION }, consumeBufferedBuild);
    }
}

