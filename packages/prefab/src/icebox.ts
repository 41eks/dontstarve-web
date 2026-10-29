import definitions from './definitions.json' with { type: 'json' };
import { icebox_init_fn } from '@dontstarve-web/animation/prefabskin';
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
    type AnimatedBuildingInteractionChange,
} from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';
import { PlaySound } from './sound';

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
    hammerWorkLeft: 2, hammerMaterial: 'metal',
    hammerEffect: { archive: 'structure_collapse_fx.zip', animation: 'collapse_small', name: 'collapse' },
    hammerDropContentsOnHit: true,
    skinInit: icebox_init_fn,
    onopen: ({ model }) => { PlaySound('dontstarve/common/icebox_open', model.position); },
    onclose: ({ model }) => { PlaySound('dontstarve/common/icebox_close', model.position); },
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
