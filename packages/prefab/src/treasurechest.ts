import definitions from './definitions.json' with { type: 'json' };
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
} from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';
import { PlaySound, PreloadSounds } from './sound';

export const TREASURE_CHEST_ID = 'treasurechest' as const;
export type TreasureChestId = typeof TREASURE_CHEST_ID;

export const TREASURE_CHEST_SKIN_ARCHIVES: Readonly<Record<string, string>> =
    definitions.animatedBuildings.treasurechest.skinArchives;

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
    hammerWorkLeft: 2, hammerMaterial: 'wood',
    burnable: { burnTime: 10, fxLevel: 2, propagator: 'medium' },
    hammerEffect: { archive: 'structure_collapse_fx.zip', animation: 'collapse_small', name: 'collapse' },
    hammerDropContentsOnHit: true,
    prepare: () => PreloadSounds('dontstarve/wilson/chest_open', 'dontstarve/wilson/chest_close'),
    onopen: ({ model }) => { PlaySound('dontstarve/wilson/chest_open', model.position); },
    onclose: ({ model }) => { PlaySound('dontstarve/wilson/chest_close', model.position); },
    // MakeChest: inst:AddTag("structure") comes with the burnable building; "chest" is added here.
    oninit: ({ instance }) => { instance.addTag('chest'); },
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
