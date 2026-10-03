import definitions from './definitions.json' with { type: 'json' };
import { icebox_init_fn } from '@three-roaming/animation/prefabskin';
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
    type AnimatedBuildingInteractionChange,
} from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';
import { PlaySound, PreloadSounds } from './sound';

export const ICE_BOX_ID = 'icebox' as const;
export type IceBoxId = typeof ICE_BOX_ID;
export const ICE_BOX_SKIN_ARCHIVES: Readonly<Record<string, string>> =
    definitions.animatedBuildings.icebox.skinArchives;

function onbuilt({ animation, onComplete }: AnimatedBuildingBuiltContext): void {
    animation.playOnce('place', () => {
        animation.start('closed');
        onComplete();
    });
}

export const ICE_BOX_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.icebox,
    skinInit: icebox_init_fn,
    prepare: () => PreloadSounds('dontstarve/common/icebox_open', 'dontstarve/common/icebox_close'),
    onopen: () => { PlaySound('dontstarve/common/icebox_open'); },
    onclose: () => { PlaySound('dontstarve/common/icebox_close'); },
    onbuilt,
};

export class IceBoxPlacement extends AnimatedBuildingPlacement<IceBoxId> {
    constructor(
        world: WorldContext,
        consumeBufferedBuild: (buildId: IceBoxId) => boolean,
        onInteractionChange?: (change: AnimatedBuildingInteractionChange<IceBoxId>) => void,
    ) {
        super(world, { [ICE_BOX_ID]: ICE_BOX_DEFINITION }, consumeBufferedBuild, onInteractionChange);
    }
}
