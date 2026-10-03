import definitions from './definitions.json' with { type: 'json' };
import { campfire_init_fn } from '@three-roaming/animation/prefabskin';
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
} from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';

export const CAMPFIRE_ID = 'campfire' as const;
export type CampfireId = typeof CAMPFIRE_ID;
export const CAMPFIRE_SKIN_ARCHIVES: Readonly<Record<string, string>> =
    definitions.animatedBuildings.campfire.skinArchives;

function onbuilt({ animation, onComplete }: AnimatedBuildingBuiltContext): void {
    animation.playOnce('place', () => {
        animation.start('idle');
        onComplete();
    });
}

export const CAMPFIRE_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.campfire,
    skinInit: campfire_init_fn,
    onbuilt,
};

export class CampfirePlacement extends AnimatedBuildingPlacement<CampfireId> {
    constructor(
        world: WorldContext,
        consumeBufferedBuild: (buildId: CampfireId) => boolean,
    ) {
        super(world, { [CAMPFIRE_ID]: CAMPFIRE_DEFINITION }, consumeBufferedBuild);
    }
}

