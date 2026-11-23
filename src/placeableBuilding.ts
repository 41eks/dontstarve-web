import { COOK_POT_ID, COOK_POT_PLACER, cookPotPrefabs } from '@dontstarve-web/prefab/cook_pot';
import { performCookAction } from '@dontstarve-web/stategraphs/cook';
import { RESEARCH_LAB_PLACERS, researchLabPrefabs } from '@dontstarve-web/prefab/scienceprototyper';
import { TREASURE_CHEST_ID, TREASURE_CHEST_PLACER, treasureChestPrefabs } from '@dontstarve-web/prefab/treasurechest';
import { isWallId, WALL_IDS, wallPrefabs, type WallId } from '@dontstarve-web/prefab/walls';
import { wallWorldPrefab, wallWorldSkin } from '@dontstarve-web/prefab/wallSkins';
import {
  FENCE_ID,
  FENCE_IDS,
  fencePlacer,
  fencePrefabs,
  fenceWorldSkin,
  GetRotation,
  isFenceId,
  ondeploywall,
  type FenceId,
} from '@dontstarve-web/prefab/fence';
import { snapToWallSlotCenter } from '@dontstarve-web/prefab/tile';
import type { WorldContext } from '@dontstarve-web/prefab/worldContext';
import type { EntitySaveRecord } from '@dontstarve-web/prefab/saveRecord';
import { TENT_ID, TENT_PLACER, tentPrefabs } from '@dontstarve-web/prefab/tent';
import { PANDORAS_CHEST_ID, PANDORAS_CHEST_PLACER, pandorasChestPrefabs } from '@dontstarve-web/prefab/pandoraschest';
import { MOONBASE_ID, MOONBASE_PLACER, moonbasePrefabs } from '@dontstarve-web/prefab/moonbase';
import {
  SCULPTING_TABLE_ID,
  SCULPTING_TABLE_PLACER,
  sculptingTablePrefabs,
} from '@dontstarve-web/prefab/sculptingtable';
import { WARDROBE_ID, WARDROBE_PLACER, wardrobePrefabs } from '@dontstarve-web/prefab/wardrobe';
import { BuildingPlacer } from '@dontstarve-web/prefab/buildingPlacer';
import { prefabInstance, type PrefabEntityManager, type PrefabInstance } from '@dontstarve-web/prefab/prefabInstance';
import { Vector3, type Group, type Object3D } from 'three';
import { FIRE_PIT_ID, FIRE_PIT_PLACER, firePitPrefabs } from '@dontstarve-web/prefab/firepit';
import { ICE_BOX_ID, ICE_BOX_PLACER, iceBoxPrefabs } from '@dontstarve-web/prefab/icebox';
import {
  DRAGONFLY_CHEST_ID,
  DRAGONFLY_CHEST_PLACER,
  dragonflyChestPrefabs,
} from '@dontstarve-web/prefab/dragonfly_chest';
import {
  DRAGONFLY_FURNACE_ID,
  DRAGONFLY_FURNACE_PLACER,
  dragonflyFurnacePrefabs,
} from '@dontstarve-web/prefab/dragonfly_furnace';
import type { ContainerButtonAction } from '@dontstarve-web/prefab/containers';
import { BOOKSTATION_ID, BOOKSTATION_PLACER, bookstationPrefabs } from '@dontstarve-web/prefab/bookstation';
import { CAMPFIRE_ID, CAMPFIRE_PLACER, campfirePrefabs } from '@dontstarve-web/prefab/campfire';
import { SALT_BOX_ID, SALT_BOX_PLACER, saltBoxPrefabs } from '@dontstarve-web/prefab/saltbox';
import { NIGHT_LIGHT_ID, NIGHT_LIGHT_PLACER, nightLightPrefabs } from '@dontstarve-web/prefab/nightlight';
import { PIG_HOUSE_ID, PIG_HOUSE_PLACER, pigHousePrefabs } from '@dontstarve-web/prefab/pighouse';
import { BIRDCAGE_ID, BIRDCAGE_PLACER, birdcagePrefabs } from '@dontstarve-web/prefab/birdcage';
import { MOONDIAL_ID, MOONDIAL_PLACER, moondialPrefabs } from '@dontstarve-web/prefab/moondial';
import { WOOD_CHAIR_ID, WOOD_CHAIR_PLACER, woodChairPrefabs } from '@dontstarve-web/prefab/furniture_chairs';
import { STICK_HEAD_PLACERS, stickHeadPrefabs } from '@dontstarve-web/prefab/stickheads';
import { WINTEROMETER_ID, WINTEROMETER_PLACER, winterometerPrefabs } from '@dontstarve-web/prefab/winterometer';
import { LIGHTNING_ROD_ID, LIGHTNING_ROD_PLACER, lightningRodPrefabs } from '@dontstarve-web/prefab/lightning_rod';
import { MUSHROOM_LIGHT_PLACERS, mushroomLightPrefabs } from '@dontstarve-web/prefab/mushroom_light';

export { TREASURE_CHEST_ID } from '@dontstarve-web/prefab/treasurechest';

export { TENT_ID } from '@dontstarve-web/prefab/tent';

/** Buildings declared on the shared PrefabEntityManager; the rest move here as they migrate. */
const MANAGED_BUILDING_PLACERS = {
  [WARDROBE_ID]: WARDROBE_PLACER,
  [CAMPFIRE_ID]: CAMPFIRE_PLACER,
  [NIGHT_LIGHT_ID]: NIGHT_LIGHT_PLACER,
  [PIG_HOUSE_ID]: PIG_HOUSE_PLACER,
  [TREASURE_CHEST_ID]: TREASURE_CHEST_PLACER,
  [PANDORAS_CHEST_ID]: PANDORAS_CHEST_PLACER,
  [ICE_BOX_ID]: ICE_BOX_PLACER,
  [DRAGONFLY_CHEST_ID]: DRAGONFLY_CHEST_PLACER,
  [DRAGONFLY_FURNACE_ID]: DRAGONFLY_FURNACE_PLACER,
  [SALT_BOX_ID]: SALT_BOX_PLACER,
  ...MUSHROOM_LIGHT_PLACERS,
  [FIRE_PIT_ID]: FIRE_PIT_PLACER,
  [TENT_ID]: TENT_PLACER,
  [MOONBASE_ID]: MOONBASE_PLACER,
  [MOONDIAL_ID]: MOONDIAL_PLACER,
  [WOOD_CHAIR_ID]: WOOD_CHAIR_PLACER,
  [SCULPTING_TABLE_ID]: SCULPTING_TABLE_PLACER,
  [WINTEROMETER_ID]: WINTEROMETER_PLACER,
  [LIGHTNING_ROD_ID]: LIGHTNING_ROD_PLACER,
  ...STICK_HEAD_PLACERS,
  [BIRDCAGE_ID]: BIRDCAGE_PLACER,
  ...RESEARCH_LAB_PLACERS,
  [COOK_POT_ID]: COOK_POT_PLACER,
  [BOOKSTATION_ID]: BOOKSTATION_PLACER,
} as const;
export type ManagedBuildingId = keyof typeof MANAGED_BUILDING_PLACERS;
const isManagedBuildingId = (value: string): value is ManagedBuildingId =>
  Object.hasOwn(MANAGED_BUILDING_PLACERS, value);
export type PlaceableBuildingId = ManagedBuildingId | WallId | FenceId;
/** A building container's onopen / onclose, for the storage panel that follows it. */
export interface PlaceableBuildingInteractionChange {
  buildId: ManagedBuildingId;
  isOpen: boolean;
  model: Group;
}

export const PLACEABLE_BUILDING_IDS: readonly PlaceableBuildingId[] = [
  ...(Object.keys(MANAGED_BUILDING_PLACERS) as ManagedBuildingId[]),
  ...WALL_IDS,
  ...FENCE_IDS,
];

export function isPlaceableBuildingId(value: string): value is PlaceableBuildingId {
  return PLACEABLE_BUILDING_IDS.some(buildingId => buildingId === value);
}

/**
 * Places every buildable prefab: a build consumes its buffered build, or the deployed fence / wall item, and the prefab
 * spawns on the shared PrefabEntityManager.
 */
export class PlaceableBuildingPlacement {
  private readonly managed: BuildingPlacer<PlaceableBuildingId>;
  private readonly prefabs: Pick<
    PrefabEntityManager<string, PrefabInstance>,
    'spawn' | 'spawnAs' | 'restore' | 'register' | 'track'
  >;
  private readonly snapToWallSlot: (point: Vector3) => Vector3;

  constructor(
    world: WorldContext,
    consumeBufferedBuild: (buildId: PlaceableBuildingId, skinId?: string) => boolean,
    onInteractionChange: ((change: PlaceableBuildingInteractionChange) => void) | undefined,
    prefabs: Pick<PrefabEntityManager<string, PrefabInstance>, 'spawn' | 'spawnAs' | 'restore' | 'register' | 'track'>,
  ) {
    this.prefabs = prefabs;
    const { scene: _scene, ...rest } = world;
    const services = { ...rest, onContainerInteraction: onInteractionChange as WorldContext['onContainerInteraction'] };
    prefabs.register({
      ...wardrobePrefabs(services),
      ...campfirePrefabs(services),
      ...nightLightPrefabs(services),
      ...pigHousePrefabs(services),
      ...treasureChestPrefabs(services),
      ...pandorasChestPrefabs(services),
      ...iceBoxPrefabs(services),
      ...dragonflyChestPrefabs(services),
      ...dragonflyFurnacePrefabs(services),
      ...saltBoxPrefabs(services),
      ...mushroomLightPrefabs(services),
      ...firePitPrefabs(services),
      ...tentPrefabs(services),
      ...moonbasePrefabs(services),
      ...moondialPrefabs(services),
      ...woodChairPrefabs(services),
      ...sculptingTablePrefabs(services),
      ...winterometerPrefabs(services),
      ...lightningRodPrefabs(services),
      ...stickHeadPrefabs(services),
      ...birdcagePrefabs(services),
      ...researchLabPrefabs(services),
      ...cookPotPrefabs(services),
      ...bookstationPrefabs(services),
      ...fencePrefabs(services),
    });
    const walls = wallPrefabs(services);
    prefabs.register(walls.prefabs);
    const snapToWallSlot = (point: Vector3) => {
      const { x, z } = snapToWallSlotCenter(point);
      return new Vector3(x, point.y, z);
    };
    this.managed = new BuildingPlacer<PlaceableBuildingId>(
      world,
      buildId =>
        isFenceId(buildId)
          ? fencePlacer(buildId, world.cameraHeading, snapToWallSlot)
          : isWallId(buildId)
            ? walls.placer(buildId, snapToWallSlot)
            : MANAGED_BUILDING_PLACERS[buildId],
      consumeBufferedBuild,
      (buildId, position, skinId, placer) => {
        if (isFenceId(buildId)) {
          ondeploywall(prefabs, buildId, position, skinId, GetRotation(placer));
          return;
        }
        if (isWallId(buildId)) {
          walls.ondeploywall(prefabs, buildId, position, skinId);
          return;
        }
        prefabs.spawn(buildId, position, undefined, skinId).PushEvent('onbuilt', undefined);
      },
      prefabs,
    );
    this.snapToWallSlot = snapToWallSlot;
  }

  /** Every build draws its placer at once; its display draws the preview once the art has loaded. */
  async begin(buildId: PlaceableBuildingId, skinId?: string): Promise<void> {
    return this.managed.begin(buildId, skinId);
  }

  /** c_spawn: SpawnPrefab ahead of the player; fences (at rotation 0) and walls stand on the wall slot there. */
  async spawn(buildId: PlaceableBuildingId, skinId?: string): Promise<void> {
    if (isManagedBuildingId(buildId)) {
      this.prefabs.spawn(buildId, this.managed.groundInFrontOfPlayer(), undefined, skinId);
      return;
    }
    if (isFenceId(buildId)) {
      this.prefabs.spawn(
        FENCE_ID,
        this.snapToWallSlot(this.managed.groundInFrontOfPlayer()),
        undefined,
        fenceWorldSkin(buildId, skinId),
      );
      return;
    }
    this.prefabs.spawn(
      wallWorldPrefab(buildId),
      this.snapToWallSlot(this.managed.groundInFrontOfPlayer()),
      undefined,
      wallWorldSkin(buildId, skinId),
    );
  }

  /** The saved world prefabs; a fence or wall item in the save is an ordinary item and is not restored here. */
  spawnFromSave(buildId: PlaceableBuildingId, record: EntitySaveRecord) {
    return this.prefabs.restore(buildId, record).transform.model;
  }

  /** Every placed prefab is saved by the shared PrefabEntityManager. */
  exportRecords(): readonly never[] {
    return [];
  }

  /**
   * The container widget's button: BufferedAction(doer, inst, ACTIONS.COOK / ACTIONS.INCINERATE):Do() on the entity
   * whose container is open.
   */
  performContainerAction(model: Object3D, action: ContainerButtonAction, doer: object): boolean {
    const inst = prefabInstance(model);
    if (inst === undefined || inst.isRemoved || !model.visible) {
      return false;
    }
    return action === 'COOK' ? performCookAction(inst, doer) : (inst.components.incinerator?.Incinerate(doer) ?? false);
  }

  dispose(): void {
    this.managed.dispose();
  }

  cancel(): void {
    this.managed.cancel();
  }

  get renderEntities() {
    return this.managed.renderEntities;
  }

  update(dt: number): void {
    this.managed.update(dt);
  }
}
