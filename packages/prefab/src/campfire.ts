import definitions from './definitions.json' with { type: 'json' };
import { campfire_init_fn } from '@dontstarve-web/animation/prefabskin';
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingDefinition,
} from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';
import type { PrefabInstance } from './prefabInstance';
import { PlaySound } from './sound';

export const CAMPFIRE_ID = 'campfire' as const;
export type CampfireId = typeof CAMPFIRE_ID;
export const CAMPFIRE_SKIN_ARCHIVES: Readonly<Record<string, string>> =
    definitions.animatedBuildings.campfire.skinArchives;

function onbuilt(inst: PrefabInstance): void {
    inst.sprite.playOnce('place');
    inst.sprite.pushAnimation('idle', false);
    PlaySound('dontstarve/common/fireAddFuel', inst.position);
}

export const CAMPFIRE_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.campfire,
    obstacleRadius: 0.2,
    skinInit: campfire_init_fn,
    oninit: ({ instance }) => { instance.ListenForEvent('onbuilt', () => onbuilt(instance)); },
};

export class CampfirePlacement extends AnimatedBuildingPlacement<CampfireId> {
    constructor(
        world: WorldContext,
        consumeBufferedBuild: (buildId: CampfireId) => boolean,
    ) {
        super(world, { [CAMPFIRE_ID]: CAMPFIRE_DEFINITION }, consumeBufferedBuild);
    }
}

