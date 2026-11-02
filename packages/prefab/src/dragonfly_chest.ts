import type { PrefabInstance } from './prefabInstance';
import { Workable } from '../../componets/src/workable';
import { createStructureLootDropper } from './structureLoot';
import definitions from './definitions.json' with { type: 'json' };
import { dragonflychest_init_fn } from '@dontstarve-web/animation/prefabskin';
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
    type AnimatedBuildingInteractionChange,
} from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';
import { PlaySound } from './sound';

export const DRAGONFLY_CHEST_ID = 'dragonflychest' as const;
export type DragonflyChestId = typeof DRAGONFLY_CHEST_ID;
export const DRAGONFLY_CHEST_SKIN_ARCHIVES: Readonly<Record<string, string>> =
    definitions.animatedBuildings.dragonflychest.skinArchives;

function onopen(inst: PrefabInstance): void {
    inst.sprite.playOnce('open');
    PlaySound('dontstarve/wilson/chest_open', inst.position);
}

function onclose(inst: PrefabInstance): void {
    inst.sprite.playOnce('close');
    PlaySound('dontstarve/wilson/chest_close', inst.position);
}

function onworked(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) return;
    inst.components.container?.DropEverything(inst.position);
    inst.components.container?.Close();
    inst.sprite.playOnce('hit');
    inst.sprite.pushAnimation('closed', false);
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
    workable.SetWorkLeft(2);
    workable.SetOnWorkCallback(onworked);
    workable.SetOnFinishCallback(onhammered);
    instance.components.lootdropper = createStructureLootDropper(instance);
}

function onbuilt({ animation, onComplete }: AnimatedBuildingBuiltContext): void {
    animation.playOnce('place', () => {
        animation.start('closed');
        onComplete();
    });
}

export const DRAGONFLY_CHEST_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.dragonflychest,
    skinInit: dragonflychest_init_fn,
    oninit: ({ instance }) => {
        instance.components.container!.onopenfn = onopen;
        instance.components.container!.onclosefn = onclose;
        initializeWorkable(instance);
    },
    onbuilt,
};

export class DragonflyChestPlacement extends AnimatedBuildingPlacement<DragonflyChestId> {
    constructor(
        world: WorldContext,
        consumeBufferedBuild: (buildId: DragonflyChestId) => boolean,
        onInteractionChange?: (change: AnimatedBuildingInteractionChange<DragonflyChestId>) => void,
    ) {
        super(world, { [DRAGONFLY_CHEST_ID]: DRAGONFLY_CHEST_DEFINITION }, consumeBufferedBuild, onInteractionChange);
    }
}

