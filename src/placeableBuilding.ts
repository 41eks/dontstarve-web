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
import { TREASURE_CHEST_ID, TREASURE_CHEST_PLACER, treasureChestPrefabs } from '@dontstarve-web/prefab/treasurechest';
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
import { PANDORAS_CHEST_ID, PANDORAS_CHEST_PLACER, pandorasChestPrefabs } from '@dontstarve-web/prefab/pandoraschest';
import { MOONBASE_DEFINITION, MOONBASE_ID } from '@dontstarve-web/prefab/moonbase';
import { SCULPTING_TABLE_DEFINITION, SCULPTING_TABLE_ID, type SculptingTableId } from '@dontstarve-web/prefab/sculptingtable';
import { WARDROBE_ID, WARDROBE_PLACER, wardrobePrefabs } from '@dontstarve-web/prefab/wardrobe';
import { BuildingPlacer } from '@dontstarve-web/prefab/buildingPlacer';
import type { PrefabEntityManager, PrefabInstance } from '@dontstarve-web/prefab/prefabInstance';
import { Vector3 } from 'three';
import { FIRE_PIT_ID, FIRE_PIT_PLACER, firePitPrefabs } from '@dontstarve-web/prefab/firepit';
import { ICE_BOX_ID, ICE_BOX_PLACER, iceBoxPrefabs } from '@dontstarve-web/prefab/icebox';
import { DRAGONFLY_CHEST_ID, DRAGONFLY_CHEST_PLACER, dragonflyChestPrefabs } from '@dontstarve-web/prefab/dragonfly_chest';
import { BOOKSTATION_DEFINITION, BOOKSTATION_ID, type BookstationId } from '@dontstarve-web/prefab/bookstation';
import { CAMPFIRE_ID, CAMPFIRE_PLACER, campfirePrefabs } from '@dontstarve-web/prefab/campfire';
import { SALT_BOX_ID, SALT_BOX_PLACER, saltBoxPrefabs } from '@dontstarve-web/prefab/saltbox';
import { NIGHT_LIGHT_ID, NIGHT_LIGHT_PLACER, nightLightPrefabs } from '@dontstarve-web/prefab/nightlight';
import { PIG_HOUSE_ID, PIG_HOUSE_PLACER, pigHousePrefabs } from '@dontstarve-web/prefab/pighouse';
import { BIRDCAGE_DEFINITION, BIRDCAGE_ID, type BirdcageId } from '@dontstarve-web/prefab/birdcage';
import { MOONDIAL_DEFINITION, MOONDIAL_ID } from '@dontstarve-web/prefab/moondial';
import { PIG_HEAD_DEFINITION, PIG_HEAD_ID, MERM_HEAD_DEFINITION, MERM_HEAD_ID, type PigHeadId, type MermHeadId } from '@dontstarve-web/prefab/stickheads';
import { WINTEROMETER_DEFINITION, WINTEROMETER_ID, type WinterometerId } from '@dontstarve-web/prefab/winterometer';
import { LIGHTNING_ROD_DEFINITION, LIGHTNING_ROD_ID, type LightningRodId } from '@dontstarve-web/prefab/lightning_rod';
import { MUSHROOM_LIGHT_PLACERS, mushroomLightPrefabs } from '@dontstarve-web/prefab/mushroom_light';

export { TREASURE_CHEST_ID } from '@dontstarve-web/prefab/treasurechest';

export { TENT_ID } from '@dontstarve-web/prefab/tent';

export type AnimatedBuildingId = CookPotId | ResearchLabId | typeof TENT_ID
    | BookstationId | WinterometerId | LightningRodId | PigHeadId | MermHeadId | BirdcageId | SculptingTableId | typeof MOONBASE_ID | typeof MOONDIAL_ID;
/** Buildings declared on the shared PrefabEntityManager; the rest move here as they migrate. */
const MANAGED_BUILDING_PLACERS = { [WARDROBE_ID]: WARDROBE_PLACER, [CAMPFIRE_ID]: CAMPFIRE_PLACER, [NIGHT_LIGHT_ID]: NIGHT_LIGHT_PLACER, [PIG_HOUSE_ID]: PIG_HOUSE_PLACER,
    [TREASURE_CHEST_ID]: TREASURE_CHEST_PLACER, [PANDORAS_CHEST_ID]: PANDORAS_CHEST_PLACER, [ICE_BOX_ID]: ICE_BOX_PLACER, [DRAGONFLY_CHEST_ID]: DRAGONFLY_CHEST_PLACER, [SALT_BOX_ID]: SALT_BOX_PLACER,
    ...MUSHROOM_LIGHT_PLACERS, [FIRE_PIT_ID]: FIRE_PIT_PLACER } as const;
export type ManagedBuildingId = keyof typeof MANAGED_BUILDING_PLACERS;
const isManagedBuildingId = (value: string): value is ManagedBuildingId => Object.hasOwn(MANAGED_BUILDING_PLACERS, value);
export type PlaceableBuildingId = AnimatedBuildingId | ManagedBuildingId | WallId | FenceId;
export type PlaceableBuildingInteractionChange = AnimatedBuildingInteractionChange<AnimatedBuildingId | ManagedBuildingId>;

const ANIMATED_BUILDING_IDS: readonly AnimatedBuildingId[] = [
    COOK_POT_ID,
    ...RESEARCH_LAB_IDS,
    TENT_ID,
    MOONBASE_ID,
    MOONDIAL_ID,
    BOOKSTATION_ID,
    SCULPTING_TABLE_ID,
    WINTEROMETER_ID,
    LIGHTNING_ROD_ID,
    PIG_HEAD_ID,
    MERM_HEAD_ID,
    BIRDCAGE_ID,
];

const ANIMATED_BUILDING_DEFINITIONS = {
    [COOK_POT_ID]: COOK_POT_DEFINITION,
    ...RESEARCH_LAB_DEFINITIONS,
    [TENT_ID]: TENT_DEFINITION,
    [MOONBASE_ID]: MOONBASE_DEFINITION,
    [MOONDIAL_ID]: MOONDIAL_DEFINITION,
    [BOOKSTATION_ID]: BOOKSTATION_DEFINITION,
    [SCULPTING_TABLE_ID]: SCULPTING_TABLE_DEFINITION,
    [WINTEROMETER_ID]: WINTEROMETER_DEFINITION,
    [LIGHTNING_ROD_ID]: LIGHTNING_ROD_DEFINITION,
    [PIG_HEAD_ID]: PIG_HEAD_DEFINITION,
    [MERM_HEAD_ID]: MERM_HEAD_DEFINITION,
    [BIRDCAGE_ID]: BIRDCAGE_DEFINITION,
} as const;

export const PLACEABLE_BUILDING_IDS: readonly PlaceableBuildingId[] = [...ANIMATED_BUILDING_IDS, ...Object.keys(MANAGED_BUILDING_PLACERS) as ManagedBuildingId[], ...WALL_IDS, ...FENCE_IDS];

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
    private readonly managed: BuildingPlacer<ManagedBuildingId>;
    private readonly prefabs: Pick<PrefabEntityManager<string, PrefabInstance>, 'spawn' | 'register'>;

    constructor(
        world: WorldContext,
        consumeBufferedBuild: (buildId: PlaceableBuildingId, skinId?: string) => boolean,
        onInteractionChange: ((change: PlaceableBuildingInteractionChange) => void) | undefined,
        prefabs: Pick<PrefabEntityManager<string, PrefabInstance>, 'spawn' | 'register'>,
    ) {
        this.prefabs = prefabs;
        const { scene: _scene, ...rest } = world;
        const services = { ...rest, onContainerInteraction: onInteractionChange as WorldContext['onContainerInteraction'] };
        prefabs.register({ ...wardrobePrefabs(services), ...campfirePrefabs(services), ...nightLightPrefabs(services), ...pigHousePrefabs(services),
            ...treasureChestPrefabs(services), ...pandorasChestPrefabs(services), ...iceBoxPrefabs(services), ...dragonflyChestPrefabs(services), ...saltBoxPrefabs(services), ...mushroomLightPrefabs(services), ...firePitPrefabs(services) });
        this.animated = new AnimatedBuildingPlacement<AnimatedBuildingId>(
            world,
            ANIMATED_BUILDING_DEFINITIONS,
            consumeBufferedBuild,
            onInteractionChange,
        );
        this.walls = new WallsPlacement(world, consumeBufferedBuild);
        this.fences = new FencePlacement(world, consumeBufferedBuild);
        this.managed = new BuildingPlacer<ManagedBuildingId>(world, buildId => MANAGED_BUILDING_PLACERS[buildId], consumeBufferedBuild,
            (buildId, position, skinId) => { prefabs.spawn(buildId, position, undefined, skinId).PushEvent('onbuilt', undefined); });
    }

    /** Animated buildings draw their placer at once; fences and walls still resolve once their art has loaded. */
    async begin(buildId: PlaceableBuildingId, skinId?: string): Promise<void> {
        if (isManagedBuildingId(buildId)) {
            this.animated.cancel(); this.walls.cancel(); this.fences.cancel();
            return this.managed.begin(buildId, skinId);
        }
        this.managed.cancel();
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
        if (isManagedBuildingId(buildId)) { this.prefabs.spawn(buildId, this.managed.groundInFrontOfPlayer(), undefined, skinId); return; }
        return isFenceId(buildId) ? this.fences.spawn(buildId, skinId)
            : isWallId(buildId) ? this.walls.spawn(buildId, skinId)
            : this.animated.spawn(buildId, skinId);
    }

    spawnFromSave(buildId: PlaceableBuildingId, record: PlacementSaveRecord) {
        if (isManagedBuildingId(buildId)) return this.prefabs.spawn(buildId, new Vector3(...record.transform.position), record).transform.model;
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
        this.managed.dispose();
    }

    cancel(): void {
        this.animated.cancel();
        this.walls.cancel();
        this.fences.cancel();
        this.managed.cancel();
    }


    get renderEntities() {
        return [...this.animated.renderEntities, ...this.walls.renderEntities, ...this.fences.renderEntities, ...this.managed.renderEntities];
    }




    get giveTargets() { return this.animated.giveTargets; }

    get reskinTargets() {
        return [...this.animated.reskinTargets, ...this.walls.reskinTargets, ...this.fences.reskinTargets];
    }

    update(dt: number): void {
        this.animated.update(dt);
        this.walls.update(dt);
        this.fences.update(dt);
        this.managed.update(dt);
    }
}
