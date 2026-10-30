import type { Object3D } from 'three';
import {
    COOK_POT_DEFINITION,
    COOK_POT_ID,
    type CookPotId,
} from '@dontstarve-web/prefab/cook_pot';
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingInteractionChange,
} from '@dontstarve-web/prefab/animatedBuildingPlacement';
import {
    RESEARCH_LAB_DEFINITIONS,
    RESEARCH_LAB_IDS,
    type ResearchLabId,
} from '@dontstarve-web/prefab/scienceprototyper';
import {
    TREASURE_CHEST_DEFINITION,
    TREASURE_CHEST_ID,
    type TreasureChestId,
} from '@dontstarve-web/prefab/treasurechest';
import {
    WallsPlacement,
    WALL_IDS,
    isWallId,
    type WallId,
} from '@dontstarve-web/prefab/walls';
import { FencePlacement, FENCE_IDS, isFenceId, type FenceId } from '@dontstarve-web/prefab/fence';
import type { WorldContext } from '@dontstarve-web/prefab/worldContext';
import type { PlacementSaveRecord } from '@dontstarve-web/prefab/saveRecord';
import { TENT_DEFINITION, TENT_ID } from '@dontstarve-web/prefab/tent';
import { MOONBASE_DEFINITION, MOONBASE_ID } from '@dontstarve-web/prefab/moonbase';
import { SCULPTING_TABLE_DEFINITION, SCULPTING_TABLE_ID, type SculptingTableId } from '@dontstarve-web/prefab/sculptingtable';
import { WARDROBE_DEFINITION, WARDROBE_ID } from '@dontstarve-web/prefab/wardrobe';
import { FIRE_PIT_DEFINITION, FIRE_PIT_ID, type FirePitId } from '@dontstarve-web/prefab/firepit';
import { ICE_BOX_DEFINITION, ICE_BOX_ID, type IceBoxId } from '@dontstarve-web/prefab/icebox';
import { DRAGONFLY_CHEST_DEFINITION, DRAGONFLY_CHEST_ID, type DragonflyChestId } from '@dontstarve-web/prefab/dragonfly_chest';
import { BOOKSTATION_DEFINITION, BOOKSTATION_ID, type BookstationId } from '@dontstarve-web/prefab/bookstation';
import { CAMPFIRE_DEFINITION, CAMPFIRE_ID, type CampfireId } from '@dontstarve-web/prefab/campfire';
import { SALT_BOX_DEFINITION, SALT_BOX_ID, type SaltBoxId } from '@dontstarve-web/prefab/saltbox';
import { NIGHT_LIGHT_DEFINITION, NIGHT_LIGHT_ID, type NightLightId } from '@dontstarve-web/prefab/nightlight';
import { PIG_HOUSE_DEFINITION, PIG_HOUSE_ID, type PigHouseId } from '@dontstarve-web/prefab/pighouse';
import { BIRDCAGE_DEFINITION, BIRDCAGE_ID, type BirdcageId } from '@dontstarve-web/prefab/birdcage';
import { MOONDIAL_DEFINITION, MOONDIAL_ID } from '@dontstarve-web/prefab/moondial';
import { PIG_HEAD_DEFINITION, PIG_HEAD_ID, MERM_HEAD_DEFINITION, MERM_HEAD_ID, type PigHeadId, type MermHeadId } from '@dontstarve-web/prefab/stickheads';
import { WINTEROMETER_DEFINITION, WINTEROMETER_ID, type WinterometerId } from '@dontstarve-web/prefab/winterometer';
import { LIGHTNING_ROD_DEFINITION, LIGHTNING_ROD_ID, type LightningRodId } from '@dontstarve-web/prefab/lightning_rod';
import { MUSHROOM_LIGHT_DEFINITIONS, MUSHROOM_LIGHT_IDS, type MushroomLightId } from '@dontstarve-web/prefab/mushroom_light';

export { TREASURE_CHEST_ID } from '@dontstarve-web/prefab/treasurechest';

export { TENT_ID } from '@dontstarve-web/prefab/tent';

export type AnimatedBuildingId = CookPotId | FirePitId | IceBoxId | ResearchLabId | TreasureChestId | typeof TENT_ID
    | DragonflyChestId | BookstationId | CampfireId | SaltBoxId | NightLightId | PigHouseId | MushroomLightId | WinterometerId | LightningRodId | PigHeadId | MermHeadId | BirdcageId | SculptingTableId | typeof MOONBASE_ID | typeof MOONDIAL_ID | typeof WARDROBE_ID;
export type PlaceableBuildingId = AnimatedBuildingId | WallId | FenceId;
export type PlaceableBuildingInteractionChange = AnimatedBuildingInteractionChange<AnimatedBuildingId>;

const ANIMATED_BUILDING_IDS: readonly AnimatedBuildingId[] = [
    COOK_POT_ID,
    FIRE_PIT_ID,
    ICE_BOX_ID,
    ...RESEARCH_LAB_IDS,
    TREASURE_CHEST_ID,
    TENT_ID,
    MOONBASE_ID,
    MOONDIAL_ID,
    WARDROBE_ID,
    DRAGONFLY_CHEST_ID,
    BOOKSTATION_ID,
    CAMPFIRE_ID,
    SALT_BOX_ID,
    NIGHT_LIGHT_ID,
    PIG_HOUSE_ID,
    SCULPTING_TABLE_ID,
    WINTEROMETER_ID,
    LIGHTNING_ROD_ID,
    PIG_HEAD_ID,
    MERM_HEAD_ID,
    BIRDCAGE_ID,
    ...MUSHROOM_LIGHT_IDS,
];

const ANIMATED_BUILDING_DEFINITIONS = {
    [COOK_POT_ID]: COOK_POT_DEFINITION,
    [FIRE_PIT_ID]: FIRE_PIT_DEFINITION,
    [ICE_BOX_ID]: ICE_BOX_DEFINITION,
    ...RESEARCH_LAB_DEFINITIONS,
    [TREASURE_CHEST_ID]: TREASURE_CHEST_DEFINITION,
    [TENT_ID]: TENT_DEFINITION,
    [MOONBASE_ID]: MOONBASE_DEFINITION,
    [MOONDIAL_ID]: MOONDIAL_DEFINITION,
    [WARDROBE_ID]: WARDROBE_DEFINITION,
    [DRAGONFLY_CHEST_ID]: DRAGONFLY_CHEST_DEFINITION,
    [BOOKSTATION_ID]: BOOKSTATION_DEFINITION,
    [CAMPFIRE_ID]: CAMPFIRE_DEFINITION,
    [SALT_BOX_ID]: SALT_BOX_DEFINITION,
    [NIGHT_LIGHT_ID]: NIGHT_LIGHT_DEFINITION,
    [PIG_HOUSE_ID]: PIG_HOUSE_DEFINITION,
    [SCULPTING_TABLE_ID]: SCULPTING_TABLE_DEFINITION,
    [WINTEROMETER_ID]: WINTEROMETER_DEFINITION,
    [LIGHTNING_ROD_ID]: LIGHTNING_ROD_DEFINITION,
    [PIG_HEAD_ID]: PIG_HEAD_DEFINITION,
    [MERM_HEAD_ID]: MERM_HEAD_DEFINITION,
    [BIRDCAGE_ID]: BIRDCAGE_DEFINITION,
    ...MUSHROOM_LIGHT_DEFINITIONS,
} as const;

export const PLACEABLE_BUILDING_IDS: readonly PlaceableBuildingId[] = [...ANIMATED_BUILDING_IDS, ...WALL_IDS, ...FENCE_IDS];

export function isPlaceableBuildingId(value: string): value is PlaceableBuildingId {
    return PLACEABLE_BUILDING_IDS.some((buildingId) => buildingId === value);
}

/**
 * Places every buildable prefab. Animated buildings consume a buffered build,
 * walls consume one wall item and therefore place from the inventory.
 */
export class PlaceableBuildingPlacement {
    private readonly animated: AnimatedBuildingPlacement<AnimatedBuildingId>;
    private readonly walls: WallsPlacement;
    private readonly fences: FencePlacement;

    constructor(
        world: WorldContext,
        consumeBufferedBuild: (buildId: PlaceableBuildingId, skinId?: string) => boolean,
        onInteractionChange?: (change: PlaceableBuildingInteractionChange) => void,
    ) {
        this.animated = new AnimatedBuildingPlacement<AnimatedBuildingId>(
            world,
            ANIMATED_BUILDING_DEFINITIONS,
            consumeBufferedBuild,
            onInteractionChange,
        );
        this.walls = new WallsPlacement(world, consumeBufferedBuild);
        this.fences = new FencePlacement(world, consumeBufferedBuild);
    }

    /** Animated buildings draw their placer at once; fences and walls still resolve once their art has loaded. */
    async begin(buildId: PlaceableBuildingId, skinId?: string): Promise<void> {
        if (isFenceId(buildId)) {
            this.animated.cancel(); this.walls.cancel();
            return this.fences.begin(buildId, skinId);
        }
        if (isWallId(buildId)) {
            this.animated.cancel(); this.fences.cancel();
            return this.walls.begin(buildId, skinId);
        }
        this.walls.cancel(); this.fences.cancel();
        return this.animated.begin(buildId, skinId);
    }

    async spawn(buildId: PlaceableBuildingId, skinId?: string): Promise<void> {
        return isFenceId(buildId) ? this.fences.spawn(buildId, skinId)
            : isWallId(buildId) ? this.walls.spawn(buildId, skinId)
            : this.animated.spawn(buildId, skinId);
    }

    spawnFromSave(buildId: PlaceableBuildingId, record: PlacementSaveRecord) {
        return isFenceId(buildId) ? this.fences.spawnFromSave(buildId, record)
            : isWallId(buildId) ? this.walls.spawnFromSave(buildId, record)
            : this.animated.spawnFromSave(buildId, record);
    }

    exportRecords() {
        return [...this.animated.exportRecords(), ...this.walls.exportRecords(), ...this.fences.exportRecords()];
    }

    performContainerAction(model: import('three').Object3D, action: 'COOK', doer: object): boolean {
        return this.animated.performContainerAction(model, action, doer);
    }

    dispose(): void {
        this.animated.dispose();
        this.walls.dispose();
        this.fences.dispose();
    }

    cancel(): void {
        this.animated.cancel();
        this.walls.cancel();
        this.fences.cancel();
    }


    get renderEntities() {
        return [...this.animated.renderEntities, ...this.walls.renderEntities, ...this.fences.renderEntities];
    }

    get hammerTargets() { return this.getHammerTargets(); }
    getHammerTargets(model?: Object3D) {
        return [...this.animated.getHammerTargets(model), ...this.walls.getHammerTargets(model), ...this.fences.getHammerTargets(model)];
    }

    /** Placed insts with combat and live health; walls and fences are the only ported structures with combat. */
    get combatTargets() {
        return [...this.walls.combatTargets, ...this.fences.combatTargets];
    }

    get spellTargets() { return this.getSpellTargets(); }
    getSpellTargets(model?: Object3D) { return this.animated.getSpellTargets(model); }

    get giveTargets() { return this.animated.giveTargets; }

    get reskinTargets() {
        return [...this.animated.reskinTargets, ...this.walls.reskinTargets, ...this.fences.reskinTargets];
    }

    update(dt: number): void {
        this.animated.update(dt);
        this.walls.update(dt);
        this.fences.update(dt);
    }
}
