import type { PrefabInstance } from './prefabInstance';
import { Workable } from '../../componets/src/workable';
import { createStructureLootDropper } from './structureLoot';
import definitions from './definitions.json' with { type: 'json' };
import { saltbox_init_fn } from '@dontstarve-web/animation/prefabskin';
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingDefinition,
    type AnimatedBuildingInteractionChange,
} from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';

export const SALT_BOX_ID = 'saltbox' as const;
export type SaltBoxId = typeof SALT_BOX_ID;
export const SALT_BOX_SKIN_ARCHIVES: Readonly<Record<string, string>> =
    definitions.animatedBuildings.saltbox.skinArchives;

function onopen(inst: PrefabInstance): void { inst.sprite.playOnce('open'); }

function onclose(inst: PrefabInstance): void { inst.sprite.playOnce('close'); }

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
    const workable = instance.components.workable = new Workable(instance);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(2);
    workable.SetOnWorkCallback(onworked);
    workable.SetOnFinishCallback(onhammered);
    instance.components.lootdropper = createStructureLootDropper(instance);
}

function onbuilt(inst: PrefabInstance): void {
    inst.sprite.playOnce('place');
    inst.sprite.pushAnimation('closed', false);
}

export const SALT_BOX_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.saltbox,
    skinInit: saltbox_init_fn,
    oninit: ({ instance }) => {
        instance.components.container!.onopenfn = onopen;
        instance.components.container!.onclosefn = onclose;
        initializeWorkable(instance);
        instance.ListenForEvent('onbuilt', () => onbuilt(instance));
    },
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

