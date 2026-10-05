import definitions from './definitions.json' with { type: 'json' };
import { nightlight_init_fn } from '@dontstarve-web/animation/prefabskin';
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
} from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';

export const NIGHT_LIGHT_ID = 'nightlight' as const;
export type NightLightId = typeof NIGHT_LIGHT_ID;
export const NIGHT_LIGHT_SKIN_ARCHIVES: Readonly<Record<string, string>> =
    definitions.animatedBuildings.nightlight.skinArchives;

function onbuilt({ animation, onComplete }: AnimatedBuildingBuiltContext): void {
    animation.playOnce('place', () => {
        animation.start('idle');
        onComplete();
    });
}

export const NIGHT_LIGHT_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.nightlight,
    skinInit: nightlight_init_fn,
    onbuilt,
};

export class NightLightPlacement extends AnimatedBuildingPlacement<NightLightId> {
    constructor(
        world: WorldContext,
        consumeBufferedBuild: (buildId: NightLightId) => boolean,
    ) {
        super(world, { [NIGHT_LIGHT_ID]: NIGHT_LIGHT_DEFINITION }, consumeBufferedBuild);
    }
}

