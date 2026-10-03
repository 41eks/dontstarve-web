import definitions from './definitions.json' with { type: 'json' };
import type {
    AnimatedBuildingBuiltContext,
    AnimatedBuildingDefinition,
} from './animatedBuildingPlacement';

export const TENT_ID = 'tent' as const;

function onbuilt({ animation, onComplete }: AnimatedBuildingBuiltContext): void {
    animation.playOnce('place', () => {
        animation.start('idle');
        onComplete();
    });
}

export const TENT_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.tent,
    onbuilt,
};
