import type { ItemEntity, ItemEntityFactory } from '@dontstarve-web/inventory';
import * as THREE from 'three';
import { GROUND_ART_DEFINITIONS } from '@dontstarve-web/prefab/groundItems';
import { WORLD_TILES } from '@dontstarve-web/prefab/turfMap';
import type { FarmMap } from '@dontstarve-web/prefab/farmMap';
import type { PrefabWorldContext } from '@dontstarve-web/prefab/worldContext';
import { IsGroundTargetBlocked } from '../../packages/prefab/src/mapEntities';
import { WORLD_SCALE } from '../../packages/prefab/src/standardcomponents';
import type { ItemPrefabWorld } from '@dontstarve-web/prefab/groundPrefab';
import { BERNIE_ITEM_ID, type BernieWorld } from '@dontstarve-web/prefab/bernie';
import { SAVE_CATALOG } from '../save/catalog';
import { ITEM_PREFAB_REGISTRATION } from '../prefabDefinitions';
import { registerPrefabFamily, type ScenePrefabTarget } from './registry';
import type { ScenePrefabInputs } from './services';

type ItemCompanionWorlds = Required<Pick<ItemPrefabWorld, 'moleWorld' | 'lightflierWorld' | 'bernieWorld'>>;

type ItemWorldInputs = ScenePrefabInputs<
  | 'worldState'
  | 'world'
  | 'inventory'
  | 'worldFx'
  | 'itemSprites'
  | 'prefabBaseUrl'
  | 'groundItems'
  | 'mapHalfSize'
  | 'turfMap'
  | 'isCave'
  | 'topology'
  | 'worldEvents'
>;

/**
 * The item prefabs on the shared manager, which the inventory's item registry spawns through (prefabWorld.ts): every
 * item inst is SpawnPrefab'd into this world, saved by the world while it lies in the scene and by its holder while held.
 */
export function registerItems(
  target: ScenePrefabTarget,
  services: ItemWorldInputs,
  companions: ItemCompanionWorlds,
  farmMap: FarmMap,
  reskinEffects: PrefabWorldContext['reskinEffects'],
) {
  const icons = Object.fromEntries(
    Object.entries(SAVE_CATALOG.items)
      .filter(([id]) => !Object.hasOwn(GROUND_ART_DEFINITIONS, id))
      .map(([id, spec]) => [id, { atlas: spec.atlas ?? 'images/inventoryimages.xml', image: spec.icon }]),
  );
  registerPrefabFamily(
    target,
    ITEM_PREFAB_REGISTRATION,
    createItemWorld(target, services, companions, farmMap, reskinEffects),
    icons,
  );
}

/** TheWorld as the item prefabs reach it. */
function createItemWorld(
  { prefabs, registry }: ScenePrefabTarget,
  {
    worldState,
    world,
    inventory,
    worldFx,
    itemSprites,
    prefabBaseUrl,
    groundItems,
    mapHalfSize,
    turfMap,
    isCave,
    topology,
    worldEvents,
  }: ItemWorldInputs,
  companions: ItemCompanionWorlds,
  farmMap: FarmMap,
  reskinEffects: PrefabWorldContext['reskinEffects'],
): ItemPrefabWorld {
  function newItem(prefab: string): ItemEntity;
  function newItem<Entity extends ItemEntity>(prefab: string, factory: ItemEntityFactory<Entity>): Entity;
  function newItem(prefab: string, factory?: ItemEntityFactory): ItemEntity {
    const state = { itemId: prefab, count: 1 };
    return factory ? inventory.entities.construct(state, factory) : inventory.entities.construct(state);
  }
  return {
    newItem,
    spawnItem: state => inventory.entities.create(state),
    restoreItem: record => inventory.entities.restore(record),
    isInventoryItem: prefab => inventory.hasItemSpec(prefab),
    configureItem: entity => {
      inventory.entities.adopt(entity);
      inventory.configureItem(entity);
    },
    dropItem: (entity, position) => inventory.DropItem(entity, position),
    sprites: itemSprites,
    animationBaseUrl: prefabBaseUrl,
    scheduler: worldState.scheduler,
    componentUpdates: worldState.componentUpdates,
    map: {
      // map.lua IsPassableAtPointWithPlatformRadiusBias: land, the land's overhang, and the ocean when allowed.
      isPassableAtPoint: (point, allowWater) =>
        turfMap.isPassableAtPoint(point) || (allowWater && turfMap.isOceanAtWorld(point)),
      isOceanAtPoint: point => turfMap.isOceanAtPoint(point),
    },
    actionMap: {
      isAboveGroundAtPoint: point => turfMap.getTileAtWorld(point) !== WORLD_TILES.INVALID,
      isLandTileAtPoint: point => turfMap.isLandTileAtPoint(point),
      isOceanAtPoint: point => turfMap.isOceanAtPoint(point),
      isPassableAtPoint: point => turfMap.isPassableAtPoint(point),
      isGroundTargetBlocked: point => IsGroundTargetBlocked(prefabs, point, 0.5 * WORLD_SCALE),
      canTerraform: point => turfMap.canTerraform(point),
      dig: point => turfMap.dig(point),
      canTill: farmMap.canTill,
      till: farmMap.till,
    },
    topology,
    isCave,
    worldEvents,
    spawnPrefab: (prefab, position) => registry.SpawnPrefab(prefab, position),
    reskinEffects,
    physics: world,
    fx: worldFx,
    ...companions,
    handEquipment: inventory.handEquipment,
    butterflyWorld: {
      getWatchWorldContent: worldState.getWatchWorldContent,
      constrainPosition: position => {
        const edge = mapHalfSize - 0.5;
        position.x = THREE.MathUtils.clamp(position.x, -edge, edge);
        position.z = THREE.MathUtils.clamp(position.z, -edge, edge);
      },
    },
    firefliesWorld: { getWatchWorldContent: worldState.getWatchWorldContent, tickingarea: worldState.tickingarea },
    dropLoot: groundItems.flingLoot,
    spawnGroundItem: groundItems.spawnGroundItem,
  };
}

/** AllPlayers and SpawnPrefab for bernie_inactive.lua's tryreanimate and the reanimated Bernies. */
export function createBernieWorld(
  target: ScenePrefabTarget,
  { worldState, groundItems, playerInstance }: ScenePrefabInputs<'worldState' | 'groundItems' | 'playerInstance'>,
): BernieWorld {
  const { prefabs } = target;
  return {
    scheduler: worldState.scheduler,
    getPlayers: () => [playerInstance],
    spawnPrefab: (prefab, position, skinId) =>
      prefabs.spawn(prefab, new THREE.Vector3(position.x, 0, position.z), undefined, skinId),
    spawnInactive: (position, skinId) =>
      groundItems.spawnGroundItem(
        {
          ...SAVE_CATALOG.items[BERNIE_ITEM_ID],
          itemId: BERNIE_ITEM_ID,
          count: 1,
          ...(skinId === undefined ? {} : { skinId }),
        },
        position,
      ),
  };
}
