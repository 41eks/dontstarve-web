import {
    COOK_POT_DEFINITION,
    COOK_POT_ID,
    type CookPotId,
} from '@three-roaming/prefab/cook_pot';
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingInteractionChange,
} from '@three-roaming/prefab/animatedBuildingPlacement';
import {
    RESEARCH_LAB_DEFINITIONS,
    RESEARCH_LAB_IDS,
    type ResearchLabId,
} from '@three-roaming/prefab/scienceprototyper';
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
import type { PlacementSaveRecord } from '@three-roaming/prefab/saveRecord';
import { TENT_DEFINITION, TENT_ID } from '@three-roaming/prefab/tent';
import { FIRE_PIT_DEFINITION, FIRE_PIT_ID, type FirePitId } from '@three-roaming/prefab/firepit';
import { ICE_BOX_DEFINITION, ICE_BOX_ID, type IceBoxId } from '@three-roaming/prefab/icebox';
import { DRAGONFLY_CHEST_DEFINITION, DRAGONFLY_CHEST_ID, type DragonflyChestId } from '@three-roaming/prefab/dragonfly_chest';
import { CAMPFIRE_DEFINITION, CAMPFIRE_ID, type CampfireId } from '@three-roaming/prefab/campfire';
import { SALT_BOX_DEFINITION, SALT_BOX_ID, type SaltBoxId } from '@three-roaming/prefab/saltbox';
import { NIGHT_LIGHT_DEFINITION, NIGHT_LIGHT_ID, type NightLightId } from '@three-roaming/prefab/nightlight';
import { PIG_HOUSE_DEFINITION, PIG_HOUSE_ID, type PigHouseId } from '@three-roaming/prefab/pighouse';
import { MUSHROOM_LIGHT_DEFINITIONS, MUSHROOM_LIGHT_IDS, type MushroomLightId } from '@three-roaming/prefab/mushroom_light';

export { TREASURE_CHEST_ID } from '@three-roaming/prefab/treasurechest';

export { TENT_ID } from '@three-roaming/prefab/tent';

export type AnimatedBuildingId = CookPotId | FirePitId | IceBoxId | ResearchLabId | TreasureChestId | typeof TENT_ID
    | DragonflyChestId | CampfireId | SaltBoxId | NightLightId | PigHouseId | MushroomLightId;
export type PlaceableBuildingId = AnimatedBuildingId | WallStoneId;
export type PlaceableBuildingInteractionChange = AnimatedBuildingInteractionChange<AnimatedBuildingId>;

const ANIMATED_BUILDING_IDS: readonly AnimatedBuildingId[] = [
    COOK_POT_ID,
    FIRE_PIT_ID,
    ICE_BOX_ID,
    ...RESEARCH_LAB_IDS,
    TREASURE_CHEST_ID,
    TENT_ID,
    DRAGONFLY_CHEST_ID,
    CAMPFIRE_ID,
    SALT_BOX_ID,
    NIGHT_LIGHT_ID,
    PIG_HOUSE_ID,
    ...MUSHROOM_LIGHT_IDS,
];

const ANIMATED_BUILDING_DEFINITIONS = {
    [COOK_POT_ID]: COOK_POT_DEFINITION,
    [FIRE_PIT_ID]: FIRE_PIT_DEFINITION,
    [ICE_BOX_ID]: ICE_BOX_DEFINITION,
    ...RESEARCH_LAB_DEFINITIONS,
    [TREASURE_CHEST_ID]: TREASURE_CHEST_DEFINITION,
    [TENT_ID]: TENT_DEFINITION,
    [DRAGONFLY_CHEST_ID]: DRAGONFLY_CHEST_DEFINITION,
    [CAMPFIRE_ID]: CAMPFIRE_DEFINITION,
    [SALT_BOX_ID]: SALT_BOX_DEFINITION,
    [NIGHT_LIGHT_ID]: NIGHT_LIGHT_DEFINITION,
    [PIG_HOUSE_ID]: PIG_HOUSE_DEFINITION,
    ...MUSHROOM_LIGHT_DEFINITIONS,
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
        onInteractionChange?: (change: PlaceableBuildingInteractionChange) => void,
    ) {
        this.animated = new AnimatedBuildingPlacement<AnimatedBuildingId>(
            world,
            ANIMATED_BUILDING_DEFINITIONS,
            consumeBufferedBuild,
            onInteractionChange,
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

    spawnFromSave(buildId: PlaceableBuildingId, record: PlacementSaveRecord) {
        return isWallStoneId(buildId)
            ? this.walls.spawnFromSave(buildId, record)
            : this.animated.spawnFromSave(buildId, record);
    }

    exportRecords() {
        return [...this.animated.exportRecords(), ...this.walls.exportRecords()];
    }

    cancel(): void {
        this.animated.cancel();
        this.walls.cancel();
    }

    get renderEntities() {
        return [...this.animated.renderEntities, ...this.walls.renderEntities];
    }

    update(dt: number): void {
        this.animated.update(dt);
        this.walls.update();
    }
}
