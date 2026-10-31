import type { PrefabInstance } from './prefabInstance';
import { Workable } from '../../componets/src/workable';
import { createStructureLootDropper } from './structureLoot';
import definitions from './definitions.json' with { type: 'json' };
import { pighouse_init_fn } from '@dontstarve-web/animation/prefabskin';
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
} from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';

export const PIG_HOUSE_ID = 'pighouse' as const;
export type PigHouseId = typeof PIG_HOUSE_ID;
export const PIG_HOUSE_SKIN_ARCHIVES: Readonly<Record<string, string>> =
    definitions.animatedBuildings.pighouse.skinArchives;

function onworked(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) return;
    inst.sprite.playOnce('hit');
    inst.sprite.pushAnimation('idle', false);
}

function onhammered(inst: PrefabInstance): void {
    if (inst.components.burnable?.IsBurning()) inst.components.burnable.Extinguish();
    inst.components.lootdropper!.DropLoot();
    inst.worldServices?.fx?.collapse?.('big', inst.position, 'wood');
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

export const PIG_HOUSE_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.pighouse,
    obstacleRadius: 1,
    skinInit: pighouse_init_fn,
    oninit: ({ instance }) => initializeWorkable(instance),
    onbuilt,
};

export class PigHousePlacement extends AnimatedBuildingPlacement<PigHouseId> {
    constructor(
        world: WorldContext,
        consumeBufferedBuild: (buildId: PigHouseId) => boolean,
    ) {
        super(world, { [PIG_HOUSE_ID]: PIG_HOUSE_DEFINITION }, consumeBufferedBuild);
    }
}

