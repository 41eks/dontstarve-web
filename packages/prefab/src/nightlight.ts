import type { PrefabInstance } from './prefabInstance';
import { Workable } from '../../componets/src/workable';
import { createStructureLootDropper } from './structureLoot';
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

function onworked(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) return;
    inst.sprite.playOnce('hit');
    inst.sprite.pushAnimation('idle', false);
}

function onhammered(inst: PrefabInstance): void {
    inst.components.lootdropper!.DropLoot();
    inst.worldServices?.fx?.collapse?.('small', inst.position, 'stone');
    inst.remove();
}

function initializeWorkable(instance: PrefabInstance): void {
    instance.addTag('structure');
    const workable = instance.components.workable = new Workable(instance);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(4);
    workable.SetOnWorkCallback(onworked);
    workable.SetOnFinishCallback(onhammered);
    instance.components.lootdropper = createStructureLootDropper(instance);
}

function onbuilt({ animation, onComplete }: AnimatedBuildingBuiltContext): void {
    animation.playOnce('place', () => {
        animation.start('idle');
        onComplete();
    });
}

export const NIGHT_LIGHT_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.nightlight,
    obstacleRadius: 0.1,
    skinInit: nightlight_init_fn,
    oninit: ({ instance }) => initializeWorkable(instance),
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

