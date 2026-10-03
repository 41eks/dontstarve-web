import definitions from './definitions.json' with { type: 'json' };
import { mushroom_light_init_fn, mushroom_light2_init_fn } from '@three-roaming/animation/prefabskin';
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
    type AnimatedBuildingInteractionChange,
} from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';

/** mushroom_light.lua defines both the white mushroom light and the coloured light. */
export const MUSHROOM_LIGHT_IDS = ['mushroom_light', 'mushroom_light2'] as const;
export type MushroomLightId = typeof MUSHROOM_LIGHT_IDS[number];
export const MUSHROOM_LIGHT_SKIN_ARCHIVES = {
    mushroom_light: definitions.animatedBuildings.mushroom_light.skinArchives,
    mushroom_light2: definitions.animatedBuildings.mushroom_light2.skinArchives,
} as const;

function onbuilt({ animation, onComplete }: AnimatedBuildingBuiltContext): void {
    animation.playOnce('place', () => {
        animation.start('idle');
        onComplete();
    });
}

export const MUSHROOM_LIGHT_DEFINITIONS: Readonly<Record<MushroomLightId, AnimatedBuildingDefinition>> = {
    mushroom_light: {
        ...definitions.animatedBuildings.mushroom_light,
        skinInit: mushroom_light_init_fn,
        onbuilt,
    },
    mushroom_light2: {
        ...definitions.animatedBuildings.mushroom_light2,
        skinInit: mushroom_light2_init_fn,
        onbuilt,
    },
};

export class MushroomLightPlacement extends AnimatedBuildingPlacement<MushroomLightId> {
    constructor(
        world: WorldContext,
        consumeBufferedBuild: (buildId: MushroomLightId) => boolean,
        onInteractionChange?: (change: AnimatedBuildingInteractionChange<MushroomLightId>) => void,
    ) {
        super(world, MUSHROOM_LIGHT_DEFINITIONS, consumeBufferedBuild, onInteractionChange);
    }
}
