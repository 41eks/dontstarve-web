import definitions from './definitions.json' with { type: 'json' };
import { saltbox_init_fn } from '@dontstarve-web/animation/prefabskin';
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
    type AnimatedBuildingInteractionChange,
} from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';

export const SALT_BOX_ID = 'saltbox' as const;
export type SaltBoxId = typeof SALT_BOX_ID;
export const SALT_BOX_SKIN_ARCHIVES: Readonly<Record<string, string>> =
    definitions.animatedBuildings.saltbox.skinArchives;

function onbuilt({ animation, onComplete }: AnimatedBuildingBuiltContext): void {
    animation.playOnce('place', () => {
        animation.start('closed');
        onComplete();
    });
}

export const SALT_BOX_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.saltbox,
    skinInit: saltbox_init_fn,
    onbuilt,
};

export class SaltBoxPlacement extends AnimatedBuildingPlacement<SaltBoxId> {
    constructor(
        world: WorldContext,
        consumeBufferedBuild: (buildId: SaltBoxId) => boolean,
        onInteractionChange?: (change: AnimatedBuildingInteractionChange<SaltBoxId>) => void,
    ) {
        super(world, { [SALT_BOX_ID]: SALT_BOX_DEFINITION }, consumeBufferedBuild, onInteractionChange);
    }
}

