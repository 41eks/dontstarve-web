import type { PrefabInstance } from './prefabInstance';
import { addComponent } from './components';
import { createStructureLootDropper } from './structureLoot';
import definitions from './definitions.json' with { type: 'json' };
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
} from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';
import { PlaySound } from './sound';

export const TREASURE_CHEST_ID = 'treasurechest' as const;
export type TreasureChestId = typeof TREASURE_CHEST_ID;

export const TREASURE_CHEST_SKIN_ARCHIVES: Readonly<Record<string, string>> =
    definitions.animatedBuildings.treasurechest.skinArchives;

/** treasurechest.lua MakeChest: shared by the chests it builds, each with its own burnt and sound branches here. */
export function onopen(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) return;
    inst.sprite.playOnce('open');
    PlaySound('dontstarve/wilson/chest_open', inst.position);
}

export function onclose(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) return;
    inst.sprite.playOnce('close');
    inst.sprite.pushAnimation('closed', false);
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
    if (inst.components.burnable?.IsBurning()) inst.components.burnable.Extinguish();
    inst.components.lootdropper!.DropLoot();
    inst.components.container?.DropEverything(inst.position);
    inst.worldServices?.fx?.collapse?.('small', inst.position, 'wood');
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

export const TREASURE_CHEST_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.treasurechest,
    // treasurechest.lua MakeChest: MiniMapEntity:SetIcon(name..".png").
    minimapIcon: 'treasurechest.png',

    burnable: { burnTime: 10, fxLevel: 2, propagator: 'medium' },
    // MakeChest adds the chest tag; initializeWorkable assembles this prefab’s work and loot components.
    oninit: ({ instance }) => {
        instance.addTag('chest');
        instance.components.container!.onopenfn = onopen;
        instance.components.container!.onclosefn = onclose;
        initializeWorkable(instance);
    },
    onbuilt,
};

const TREASURE_CHEST_DEFINITIONS: Readonly<Record<TreasureChestId, AnimatedBuildingDefinition>> = {
    [TREASURE_CHEST_ID]: TREASURE_CHEST_DEFINITION,
};

export class TreasureChestPlacement extends AnimatedBuildingPlacement<TreasureChestId> {
    constructor(
        world: WorldContext,
        consumeBufferedBuild: (buildId: TreasureChestId) => boolean,
    ) {
        super(world, TREASURE_CHEST_DEFINITIONS, consumeBufferedBuild);
    }
}
