import { ruinsRelicRegistration } from '@dontstarve-web/prefab/ruinsrelic';
import { TUNING } from '../tuning';
import { GetTemperatureAtXZ } from '../../packages/componets/src/temperatureoverrider';
import { archivePropsRegistration } from '@dontstarve-web/prefab/archive_props';
import { houndboneRegistration } from '@dontstarve-web/prefab/houndbone';
import { skeletonRegistration } from '@dontstarve-web/prefab/skeleton';
import { pigKingRegistration } from '@dontstarve-web/prefab/pigking';
import { atriumGateRegistration } from '@dontstarve-web/prefab/atrium_gate';
import { chessJunkRegistration } from '@dontstarve-web/prefab/chessjunk';
import { chesspieceRegistration } from '@dontstarve-web/prefab/chesspieces';
import { PlaceableBuildingPlacement } from '../placeableBuilding';
import { SAVE_CATALOG } from '../save/catalog';
import { PREFAB_DEFINITIONS } from '../prefabDefinitions';
import { registerPrefabFamily, type ScenePrefabTarget } from './registry';
import type { ScenePrefabInputs } from './services';

export function registerBuildings(
  target: ScenePrefabTarget,
  {
    worldState,
    world,
    inventory,
    worldFx,
    prefabFire,
    groundItems,
    dynamicMusic,
    onBuildingInteraction,
    isCave,
    pathfinder,
    view,
    playerInstance,
  }: ScenePrefabInputs<
    | 'worldState'
    | 'world'
    | 'inventory'
    | 'worldFx'
    | 'prefabFire'
    | 'groundItems'
    | 'dynamicMusic'
    | 'onBuildingInteraction'
    | 'isCave'
    | 'pathfinder'
    | 'view'
    | 'playerInstance'
  >,
) {
  const { prefabs, registry } = target;
  const buildingPlacement = new PlaceableBuildingPlacement(
    {
      ...view,
      physics: world,
      pathfinder,
      scheduler: worldState.scheduler,
      fire: prefabFire,
      weather: worldState.weather,
      dynamicMusic,
      handEquipment: inventory.handEquipment,
      getLocalTemperature: (x, z) => GetTemperatureAtXZ(() => worldState.temperature.value, x, z),
      itemEntities: inventory.entities,
      cycle: worldState.cycle,
      getWatchWorldContent: worldState.getWatchWorldContent,
      tickingarea: worldState.tickingarea,
      isCave,
      isNight: worldState.isNight,
      perishClock: worldState.perishClock,
      secondsUntilNextDay: now => TUNING.TOTAL_DAY_TIME - (now % TUNING.TOTAL_DAY_TIME),
      fx: worldFx,
      spawnItem: state => {
        const entity = inventory.entities.create(state);
        inventory.configureItem(entity);
        return entity;
      },
      restoreItem: record => {
        const entity = inventory.entities.restore(record);
        inventory.configureItem(entity);
        return entity;
      },
      dropItem: (entity, position) => {
        inventory.DropItem(entity, position);
      },
      registerContainer: (id, container) => inventory.registerContainer(id, container),
      unregisterContainer: (id, container) => inventory.unregisterContainer(id, container),
      dropLoot: (items, position, launch) => {
        groundItems.flingLoot(
          items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })),
          position,
          launch,
        );
      },
    },
    (recipe, point, skin) => playerInstance.components.builder?.CanBuildAtPoint(recipe, point, skin) ?? false,
    onBuildingInteraction,
    prefabs,
  );
  registry.register(PREFAB_DEFINITIONS.buildings, {
    restore: (id, record) => buildingPlacement.spawnFromSave(id, record),
    debugSpawn: id => buildingPlacement.spawn(id),
    exportRecords: () => buildingPlacement.exportRecords(),
    update: dt => buildingPlacement.update(dt),
    renderEntities: () => buildingPlacement.renderEntities,
    dispose: () => buildingPlacement.dispose(),
  });
  return buildingPlacement;
}

export function registerArchiveProps(
  target: ScenePrefabTarget,
  {
    worldState,
    inventory,
    worldFx,
    groundItems,
    view,
  }: ScenePrefabInputs<'worldState' | 'inventory' | 'worldFx' | 'groundItems' | 'view'>,
) {
  const { prefabs } = target;
  registerPrefabFamily(target, archivePropsRegistration, {
    handEquipment: inventory.handEquipment,
    scheduler: worldState.scheduler,
    cameraFacing: view.cameraFacing,
    spawnGroundItem: groundItems.spawnGroundItem,
    fx: worldFx,
    spawnPrefab: (id, position) => prefabs.spawn(id, position),
  });
}

export function registerHoundbones(
  target: ScenePrefabTarget,
  { inventory, worldFx, groundItems }: ScenePrefabInputs<'inventory' | 'worldFx' | 'groundItems'>,
) {
  registerPrefabFamily(target, houndboneRegistration, {
    fx: worldFx,
    handEquipment: inventory.handEquipment,
    spawnGroundItem: groundItems.spawnGroundItem,
  });
}

export function registerSkeletons(
  target: ScenePrefabTarget,
  { inventory, worldFx, groundItems }: ScenePrefabInputs<'inventory' | 'worldFx' | 'groundItems'>,
) {
  registerPrefabFamily(target, skeletonRegistration, {
    fx: worldFx,
    handEquipment: inventory.handEquipment,
    spawnGroundItem: groundItems.spawnGroundItem,
  });
}

export function registerPigKings(
  target: ScenePrefabTarget,
  { worldState, groundItems, followCamera }: ScenePrefabInputs<'worldState' | 'groundItems' | 'followCamera'>,
) {
  registerPrefabFamily(target, pigKingRegistration, {
    TheCamera: followCamera,
    scheduler: worldState.scheduler,
    getWatchWorldContent: worldState.getWatchWorldContent,
    dropLoot: (items, position, launch) => {
      groundItems.flingLoot(
        items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })),
        position,
        launch,
      );
    },
  });
}

export function registerAtriumGate(
  target: ScenePrefabTarget,
  { worldState, pathfinder }: ScenePrefabInputs<'worldState' | 'pathfinder'>,
) {
  const { prefabs } = target;
  registerPrefabFamily(target, atriumGateRegistration, {
    scheduler: worldState.scheduler,
    pathfinder,
    spawnPrefab: (id, position) => prefabs.spawn(id, position),
  });
}

export function registerRuinsRelics(
  target: ScenePrefabTarget,
  { worldState, worldFx, groundItems }: ScenePrefabInputs<'worldState' | 'worldFx' | 'groundItems'>,
) {
  registerPrefabFamily(target, ruinsRelicRegistration, {
    fx: worldFx,
    dropLoot: (items, position) =>
      groundItems.flingLoot(
        items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })),
        position,
      ),
    scheduler: worldState.scheduler,
  });
}

export function registerChessJunk(
  target: ScenePrefabTarget,
  { worldState, worldFx, groundItems }: ScenePrefabInputs<'worldState' | 'worldFx' | 'groundItems'>,
) {
  registerPrefabFamily(target, chessJunkRegistration, {
    fx: worldFx,
    scheduler: worldState.scheduler,
    dropLoot: (items, position) =>
      groundItems.flingLoot(
        items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })),
        position,
      ),
  });
}

export function registerChesspieces(
  target: ScenePrefabTarget,
  {
    worldState,
    inventory,
    worldFx,
    groundItems,
  }: ScenePrefabInputs<'worldState' | 'inventory' | 'worldFx' | 'groundItems'>,
) {
  registerPrefabFamily(target, chesspieceRegistration, {
    fx: worldFx,
    handEquipment: inventory.handEquipment,
    scheduler: worldState.scheduler,
    spawnGroundItem: groundItems.spawnGroundItem,
  });
}
