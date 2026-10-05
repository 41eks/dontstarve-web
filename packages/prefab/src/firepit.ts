import definitions from './definitions.json' with { type: 'json' };
import { firepit_init_fn } from '@dontstarve-web/animation/prefabskin';
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
} from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';

export const FIRE_PIT_ID = 'firepit' as const;
export type FirePitId = typeof FIRE_PIT_ID;
export const FIRE_PIT_SKIN_ARCHIVES: Readonly<Record<string, string>> =
    definitions.animatedBuildings.firepit.skinArchives;

function onbuilt({ animation, onComplete }: AnimatedBuildingBuiltContext): void {
    animation.playOnce('place', () => {
        animation.start('idle');
        onComplete();
    });
}

export const FIRE_PIT_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.firepit,
    skinInit: firepit_init_fn,
    onbuilt,
};

export class FirePitPlacement extends AnimatedBuildingPlacement<FirePitId> {
    constructor(world: WorldContext, consumeBufferedBuild: (buildId: FirePitId) => boolean) {
        super(world, { [FIRE_PIT_ID]: FIRE_PIT_DEFINITION }, consumeBufferedBuild);
    }
}
