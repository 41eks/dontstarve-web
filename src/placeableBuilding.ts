import { AnimatedBuildingPlacement } from '@three-roaming/prefab/animatedBuildingPlacement';
import {
    RESEARCH_LAB_DEFINITIONS,
    RESEARCH_LAB_IDS,
    type ResearchLabId,
} from '@three-roaming/prefab/researchlab';
import {
    TREASURE_CHEST_DEFINITION,
    TREASURE_CHEST_ID,
    type TreasureChestId,
} from '@three-roaming/prefab/treasurechest';
import {
    WallStonePlacement,
    isWallStoneId,
    type WallStoneId,
} from '@three-roaming/prefab/wallstone';
import type { WorldContext } from '@three-roaming/prefab/worldContext';

export const TENT_ID = 'tent' as const;

export type AnimatedBuildingId = ResearchLabId | TreasureChestId | typeof TENT_ID;
export type PlaceableBuildingId = AnimatedBuildingId | WallStoneId;

const ANIMATED_BUILDING_IDS: readonly AnimatedBuildingId[] = [
    ...RESEARCH_LAB_IDS,
    TREASURE_CHEST_ID,
    TENT_ID,
];

const ANIMATED_BUILDING_DEFINITIONS = {
    ...RESEARCH_LAB_DEFINITIONS,
    [TREASURE_CHEST_ID]: TREASURE_CHEST_DEFINITION,
    tent: {
        archive: 'tent.zip',
        buildLabel: '帐篷',
        name: 'Tent',
        scale: 0.02,
    },
} as const;

export function isPlaceableBuildingId(value: string): value is PlaceableBuildingId {
    return ANIMATED_BUILDING_IDS.some((buildingId) => buildingId === value) || isWallStoneId(value);
}

/**
 * Places every buildable prefab. Animated buildings consume a buffered build,
 * walls consume one wall item and therefore place from the inventory.
 */
export class PlaceableBuildingPlacement {
    private readonly animated: AnimatedBuildingPlacement<AnimatedBuildingId>;
    private readonly walls: WallStonePlacement;

    constructor(
        world: WorldContext,
        consumeBufferedBuild: (buildId: PlaceableBuildingId) => boolean,
    ) {
        this.animated = new AnimatedBuildingPlacement<AnimatedBuildingId>(
            world,
            ANIMATED_BUILDING_DEFINITIONS,
            consumeBufferedBuild,
        );
        this.walls = new WallStonePlacement(world, consumeBufferedBuild);
    }

    begin(buildId: PlaceableBuildingId, skinId?: string): Promise<void> {
        if (isWallStoneId(buildId)) {
            this.animated.cancel();
            return this.walls.begin(buildId);
        }
        this.walls.cancel();
        return this.animated.begin(buildId, skinId);
    }

    spawn(buildId: PlaceableBuildingId, skinId?: string): Promise<void> {
        return isWallStoneId(buildId)
            ? this.walls.spawn(buildId)
            : this.animated.spawn(buildId, skinId);
    }

    update(dt: number): void {
        this.animated.update(dt);
        this.walls.update();
    }
}
