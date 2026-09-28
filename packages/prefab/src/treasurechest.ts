import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingDefinition,
} from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';

export const TREASURE_CHEST_ID = 'treasurechest' as const;
export type TreasureChestId = typeof TREASURE_CHEST_ID;

const TREASURE_CHEST_SKIN_NAMES = [
    'ancient',
    'cake',
    'carpetbag',
    'clock',
    'corruption',
    'cotl_basic',
    'cotl_fancy',
    'crimson',
    'cupid',
    'gingerbread',
    'monster',
    'posh',
    'poshprint',
    'sacred',
    'steamertrunk',
    'traincase',
    'traveltrunk',
    'vintage',
] as const;

export const TREASURE_CHEST_SKIN_ARCHIVES: Readonly<Record<string, string>> =
    Object.fromEntries(TREASURE_CHEST_SKIN_NAMES.flatMap((name) => {
        const skinId = `treasurechest_${name}`;
        const archive = `dynamic/${skinId}.zip`;
        return [
            [skinId, archive],
            [`treasurechest_upgraded_${name}`, archive],
        ];
    }).concat([
        ['treasurechest_cupidalt', 'dynamic/treasurechest_cupid.zip'],
    ]));

/**
 * The regular DST treasure chest uses `open` as a non-looping animation whose
 * last frame remains visible. Closing plays `close` and then returns to the
 * static `closed` animation, matching scripts/prefabs/treasurechest.lua.
 */
export const TREASURE_CHEST_DEFINITION: AnimatedBuildingDefinition = {
    archive: 'treasure_chest.zip',
    buildLabel: '箱子',
    idleAnimation: 'closed',
    interaction: {
        closeAnimation: 'close',
        closedAnimation: 'closed',
        openAnimation: 'open',
    },
    name: 'TreasureChest',
    scale: 0.02,
    skinArchives: TREASURE_CHEST_SKIN_ARCHIVES,
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
