import type { PrefabInstance } from './prefabInstance';
import { Workable, type Worker } from '../../componets/src/workable';
import { createStructureLootDropper } from './structureLoot';
import definitions from './definitions.json' with { type: 'json' };
import { mushroom_light_init_fn, mushroom_light2_init_fn } from '@dontstarve-web/animation/prefabskin';
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

function onworked(inst: PrefabInstance, _worker: Worker, workleft: number): void {
    if (inst.hasTag('burnt')) return;
    if (workleft <= 0) return;
    const on = inst.light.json.peek() !== undefined;
    inst.sprite.playOnce(on ? 'hit_on' : 'hit');
    inst.sprite.pushAnimation(on ? 'idle_on' : 'idle', false);
    inst.components.container?.DropEverything(inst.position);
    inst.components.container?.Close();
}

function onhammered(inst: PrefabInstance): void {
    inst.components.lootdropper!.DropLoot();
    inst.components.container?.DropEverything(inst.position);
    inst.worldServices?.fx?.collapse?.('small', inst.position, 'wood');
    inst.remove();
}

function initializeWorkable(instance: PrefabInstance): void {
    instance.addTag('structure');
    const workable = instance.components.workable = new Workable(instance);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(3);
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

export const MUSHROOM_LIGHT_DEFINITIONS: Readonly<Record<MushroomLightId, AnimatedBuildingDefinition>> = {
    mushroom_light: {
        ...definitions.animatedBuildings.mushroom_light,
        obstacleRadius: 0.25,
        skinInit: mushroom_light_init_fn,
        oninit: ({ instance }) => initializeWorkable(instance),
        onbuilt,
    },
    mushroom_light2: {
        ...definitions.animatedBuildings.mushroom_light2,
        obstacleRadius: 0.4,
        skinInit: mushroom_light2_init_fn,
        oninit: ({ instance }) => initializeWorkable(instance),
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
