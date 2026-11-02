import type { PrefabInstance } from './prefabInstance';
import { addComponent } from './components';
import { createStructureLootDropper } from './structureLoot';
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

function onopen(inst: PrefabInstance): void {
    inst.sprite.playOnce('open');
    PlaySound('dontstarve/common/icebox_open', inst.position);
}

function onclose(inst: PrefabInstance): void {
    inst.sprite.playOnce('close');
    PlaySound('dontstarve/common/icebox_close', inst.position);
}

function onworked(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) return;
    inst.sprite.playOnce('hit');
    inst.sprite.pushAnimation('closed', false);
    inst.components.container?.DropEverything(inst.position);
    inst.components.container?.Close();
}

function onhammered(inst: PrefabInstance): void {
    inst.components.lootdropper!.DropLoot();
    inst.components.container?.DropEverything(inst.position);
    inst.worldServices?.fx?.collapse?.('small', inst.position, 'metal');
    inst.remove();
}

function initializeWorkable(instance: PrefabInstance): void {
    instance.addTag('structure');
    const workable = addComponent(instance, 'workable');
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

export const ICE_BOX_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.icebox,
    skinInit: icebox_init_fn,
    oninit: ({ instance }) => {
        instance.components.container!.onopenfn = onopen;
        instance.components.container!.onclosefn = onclose;
        initializeWorkable(instance);
    },
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
