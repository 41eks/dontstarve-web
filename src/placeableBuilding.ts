import { AnimatedBuildingPlacement } from '@three-roaming/prefab/animatedBuildingPlacement';
import {
    RESEARCH_LAB_DEFINITIONS,
    RESEARCH_LAB_IDS,
    type ResearchLabId,
} from '@three-roaming/prefab/researchlab';
import {
    WallStonePlacement,
    isWallStoneId,
    type WallStoneId,
} from '@three-roaming/prefab/wallstone';
import type { WorldContext } from '@three-roaming/prefab/worldContext';

export const TREASURE_CHEST_ID = 'treasurechest' as const;
export const TENT_ID = 'tent' as const;

export type AnimatedBuildingId = ResearchLabId | typeof TREASURE_CHEST_ID | typeof TENT_ID;
export type PlaceableBuildingId = AnimatedBuildingId | WallStoneId;

const ANIMATED_BUILDING_IDS: readonly AnimatedBuildingId[] = [
    ...RESEARCH_LAB_IDS,
    TREASURE_CHEST_ID,
    TENT_ID,
];

const ANIMATED_BUILDING_DEFINITIONS = {
    ...RESEARCH_LAB_DEFINITIONS,
    treasurechest: {
        archive: 'treasure_chest.zip',
        buildLabel: '箱子',
        idleAnimation: 'closed',
        name: 'TreasureChest',
        scale: 0.02,
    },
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

    begin(buildId: PlaceableBuildingId): Promise<void> {
        if (isWallStoneId(buildId)) {
            this.animated.cancel();
            return this.walls.begin(buildId);
        }
        this.walls.cancel();
        return this.animated.begin(buildId);
    }

    spawn(buildId: PlaceableBuildingId): Promise<void> {
        return isWallStoneId(buildId)
            ? this.walls.spawn(buildId)
            : this.animated.spawn(buildId);
    }

    update(dt: number): void {
        this.animated.update(dt);
        this.walls.update();
    }
}
