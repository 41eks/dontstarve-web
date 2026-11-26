import { TUNING } from '../tuning';
import { GetTemperatureAtXZ } from '../../packages/componets/src/temperatureoverrider';
import * as THREE from 'three';
import { moonTreeRegistration } from '@dontstarve-web/prefab/moontree';
import { farmRegistration } from '@dontstarve-web/prefab/farm_plow';
import { createFarmMap, type FarmMap } from '@dontstarve-web/prefab/farmMap';
import { bulbPlantRegistration } from '@dontstarve-web/prefab/bulb_plant';
import { oceanTreeRegistration } from '@dontstarve-web/prefab/oceantree';
import { mushroomPlantRegistration } from '@dontstarve-web/prefab/mushroom_plant';
import { mushtreeRegistration } from '@dontstarve-web/prefab/mushtree';
import { marbleShrubRegistration, MarbleShrubInstance } from '@dontstarve-web/prefab/marbleshrub';
import { marbleBeanSaplingRegistration } from '@dontstarve-web/prefab/marblebean_sapling';
import { rockAvocadoSaplingRegistration } from '@dontstarve-web/prefab/rock_avocado_fruit_sprout_sapling';
import { rockAvocadoBushRegistration } from '@dontstarve-web/prefab/rock_avocado_bush';
import { berrybushRegistration } from '@dontstarve-web/prefab/berrybush';
import { monkeytailRegistration } from '@dontstarve-web/prefab/monkeytail';
import { grassRegistration } from '@dontstarve-web/prefab/grass';
import { caveFernRegistration } from '@dontstarve-web/prefab/cave_fern';
import { lichenRegistration } from '@dontstarve-web/prefab/lichen';
import { cactusRegistration } from '@dontstarve-web/prefab/cactus';
import { tumbleweedRegistration } from '@dontstarve-web/prefab/tumbleweed';
import { saplingRegistration } from '@dontstarve-web/prefab/sapling';
import { marshPlantRegistration } from '@dontstarve-web/prefab/marsh_plant';
import { flowerRegistration } from '@dontstarve-web/prefab/flower';
import { WORLD_SCALE } from '../../packages/prefab/src/standardcomponents';
import { SAVE_CATALOG } from '../save/catalog';
import { deciduousRegistration } from '@dontstarve-web/prefab/deciduoustrees';
import { livingTreeRegistration } from '@dontstarve-web/prefab/livingtree';
import { evergreenRegistration } from '@dontstarve-web/prefab/evergreens';
import { registerPrefabFamily, type ScenePrefabTarget } from './registry';
import type { ScenePrefabInputs } from './services';

export function registerFlowers(
  target: ScenePrefabTarget,
  {
    worldState,
    worldEvents,
    prefabFire,
    groundItems,
  }: ScenePrefabInputs<'worldState' | 'worldEvents' | 'prefabFire' | 'groundItems'>,
) {
  registerPrefabFamily(target, flowerRegistration, {
    scheduler: worldState.scheduler,
    fire: prefabFire,
    worldEvents,
    spawnGroundItem: groundItems.spawnGroundItem,
  });
}

export function registerBulbPlants(
  target: ScenePrefabTarget,
  { worldState, dstLighting }: ScenePrefabInputs<'worldState' | 'dstLighting'>,
) {
  registerPrefabFamily(target, bulbPlantRegistration, {
    scheduler: worldState.scheduler,
    getLightLevel: model => dstLighting.sampleLightLevel(model.position, model),
  });
}

export function registerMushroomPlants(
  target: ScenePrefabTarget,
  { worldState, prefabFire, groundItems }: ScenePrefabInputs<'worldState' | 'prefabFire' | 'groundItems'>,
) {
  registerPrefabFamily(target, mushroomPlantRegistration, {
    scheduler: worldState.scheduler,
    fire: prefabFire,
    getWatchWorldContent: worldState.getWatchWorldContent,
    spawnGroundItem: groundItems.spawnGroundItem,
    rain: worldState.weather.preciptype,
    tickingarea: worldState.tickingarea,
  });
}

export function registerMushtrees(
  target: ScenePrefabTarget,
  {
    worldState,
    inventory,
    worldEvents,
    prefabFire,
    itemSprites,
    groundItems,
  }: ScenePrefabInputs<'worldState' | 'inventory' | 'worldEvents' | 'prefabFire' | 'itemSprites' | 'groundItems'>,
) {
  const { prefabs } = target;
  registerPrefabFamily(target, mushtreeRegistration, {
    handEquipment: inventory.handEquipment,
    scheduler: worldState.scheduler,
    fire: prefabFire,
    getWatchWorldContent: worldState.getWatchWorldContent,
    tickingarea: worldState.tickingarea,
    worldEvents,
    sprites: itemSprites,
    dropLoot: (items, position) => {
      groundItems.flingLoot(
        items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })),
        position,
      );
    },
    spawnPrefab: (id, position) => prefabs.spawn(id, position),
  });
}

export function registerMarbleShrubs(
  target: ScenePrefabTarget,
  { worldState, inventory, groundItems }: ScenePrefabInputs<'worldState' | 'inventory' | 'groundItems'>,
) {
  registerPrefabFamily(target, marbleShrubRegistration, {
    handEquipment: inventory.handEquipment,
    scheduler: worldState.scheduler,
    spawnGroundItem: groundItems.spawnGroundItem,
  });
}

export function registerMarbleBeanSaplings(
  target: ScenePrefabTarget,
  { worldState, inventory, groundItems }: ScenePrefabInputs<'worldState' | 'inventory' | 'groundItems'>,
) {
  const { prefabs } = target;
  registerPrefabFamily(target, marbleBeanSaplingRegistration, {
    handEquipment: inventory.handEquipment,
    scheduler: worldState.scheduler,
    spawnPrefab: (id, position) => prefabs.spawnAs(MarbleShrubInstance, id, position),
    spawnGroundItem: groundItems.spawnGroundItem,
  });
}

export function registerRockAvocadoBushes(
  target: ScenePrefabTarget,
  {
    worldState,
    world,
    prefabFire,
    groundItems,
  }: ScenePrefabInputs<'worldState' | 'world' | 'prefabFire' | 'groundItems'>,
) {
  registerPrefabFamily(target, rockAvocadoBushRegistration, {
    scheduler: worldState.scheduler,
    fire: prefabFire,
    getWatchWorldContent: worldState.getWatchWorldContent,
    tickingarea: worldState.tickingarea,
    rain: worldState.weather.preciptype,
    physics: world,
    getLocalTemperature: position => GetTemperatureAtXZ(() => worldState.temperature.value, position.x, position.z),
    spawnGroundItem: groundItems.spawnGroundItem,
  });
}

export function registerRockAvocadoSaplings(
  target: ScenePrefabTarget,
  {
    worldState,
    inventory,
    prefabFire,
    groundItems,
  }: ScenePrefabInputs<'worldState' | 'inventory' | 'prefabFire' | 'groundItems'>,
) {
  const { prefabs } = target;
  registerPrefabFamily(target, rockAvocadoSaplingRegistration, {
    handEquipment: inventory.handEquipment,
    scheduler: worldState.scheduler,
    fire: prefabFire,
    spawnPrefab: (id, position) => prefabs.spawn(id, position),
    spawnGroundItem: groundItems.spawnGroundItem,
  });
}

export function registerBerrybushes(
  target: ScenePrefabTarget,
  {
    worldState,
    world,
    prefabFire,
    groundItems,
  }: ScenePrefabInputs<'worldState' | 'world' | 'prefabFire' | 'groundItems'>,
) {
  registerPrefabFamily(target, berrybushRegistration, {
    scheduler: worldState.scheduler,
    fire: prefabFire,
    getWatchWorldContent: worldState.getWatchWorldContent,
    tickingarea: worldState.tickingarea,
    rain: worldState.weather.preciptype,
    physics: world,
    getLocalTemperature: position => GetTemperatureAtXZ(() => worldState.temperature.value, position.x, position.z),
    spawnGroundItem: groundItems.spawnGroundItem,
  });
}

export function registerMonkeytails(
  target: ScenePrefabTarget,
  { worldState, prefabFire, groundItems }: ScenePrefabInputs<'worldState' | 'prefabFire' | 'groundItems'>,
) {
  registerPrefabFamily(target, monkeytailRegistration, {
    scheduler: worldState.scheduler,
    fire: prefabFire,
    getWatchWorldContent: worldState.getWatchWorldContent,
    tickingarea: worldState.tickingarea,
    rain: worldState.weather.preciptype,
    getLocalTemperature: position => GetTemperatureAtXZ(() => worldState.temperature.value, position.x, position.z),
    spawnGroundItem: groundItems.spawnGroundItem,
  });
}

export function registerGrasses(
  target: ScenePrefabTarget,
  { worldState, prefabFire, groundItems }: ScenePrefabInputs<'worldState' | 'prefabFire' | 'groundItems'>,
) {
  registerPrefabFamily(target, grassRegistration, {
    scheduler: worldState.scheduler,
    fire: prefabFire,
    getWatchWorldContent: worldState.getWatchWorldContent,
    tickingarea: worldState.tickingarea,
    spawnGroundItem: groundItems.spawnGroundItem,
  });
}

export function registerSaplings(
  target: ScenePrefabTarget,
  { worldState, prefabFire, groundItems }: ScenePrefabInputs<'worldState' | 'prefabFire' | 'groundItems'>,
) {
  registerPrefabFamily(target, saplingRegistration, {
    scheduler: worldState.scheduler,
    fire: prefabFire,
    getWatchWorldContent: worldState.getWatchWorldContent,
    tickingarea: worldState.tickingarea,
    spawnGroundItem: groundItems.spawnGroundItem,
  });
}

export function registerCaveFerns(
  target: ScenePrefabTarget,
  { worldState, prefabFire, groundItems }: ScenePrefabInputs<'worldState' | 'prefabFire' | 'groundItems'>,
) {
  registerPrefabFamily(target, caveFernRegistration, {
    scheduler: worldState.scheduler,
    fire: prefabFire,
    getWatchWorldContent: worldState.getWatchWorldContent,
    tickingarea: worldState.tickingarea,
    spawnGroundItem: groundItems.spawnGroundItem,
  });
}

export function registerLichens(
  target: ScenePrefabTarget,
  { worldState, prefabFire, groundItems }: ScenePrefabInputs<'worldState' | 'prefabFire' | 'groundItems'>,
) {
  registerPrefabFamily(target, lichenRegistration, {
    scheduler: worldState.scheduler,
    fire: prefabFire,
    getWatchWorldContent: worldState.getWatchWorldContent,
    tickingarea: worldState.tickingarea,
    spawnGroundItem: groundItems.spawnGroundItem,
  });
}

export function registerCacti(
  target: ScenePrefabTarget,
  {
    worldState,
    world,
    inventory,
    prefabFire,
    groundItems,
  }: ScenePrefabInputs<'worldState' | 'world' | 'inventory' | 'prefabFire' | 'groundItems'>,
) {
  registerPrefabFamily(target, cactusRegistration, {
    scheduler: worldState.scheduler,
    fire: prefabFire,
    getWatchWorldContent: worldState.getWatchWorldContent,
    tickingarea: worldState.tickingarea,
    physics: world,
    spawnGroundItem: groundItems.spawnGroundItem,
    spawnItem: state => {
      const entity = inventory.entities.create(state);
      inventory.configureItem(entity);
      return entity;
    },
    dropItem: (entity, position) => {
      inventory.DropItem(entity, position);
    },
  });
}

export function registerTumbleweeds(
  target: ScenePrefabTarget,
  {
    worldState,
    groundItems,
    mapHalfSize,
    turfMap,
  }: ScenePrefabInputs<'worldState' | 'groundItems' | 'mapHalfSize' | 'turfMap'>,
) {
  const { prefabs } = target;
  registerPrefabFamily(target, tumbleweedRegistration, {
    scheduler: worldState.scheduler,
    wind: worldState.worldwind,
    getWatchWorldContent: worldState.getWatchWorldContent,
    componentUpdates: worldState.componentUpdates,
    spawnPrefab: (prefab, position) => prefabs.spawn(prefab, position),
    // EntityScript:IsOnValidGround.
    isOnValidGround: position => turfMap.isVisualGroundAtPoint(position),
    constrainPosition: position => {
      const edge = mapHalfSize - WORLD_SCALE;
      position.x = THREE.MathUtils.clamp(position.x, -edge, edge);
      position.z = THREE.MathUtils.clamp(position.z, -edge, edge);
    },
    dropLoot: (items, position) => {
      // Prefabs this project cannot spawn yet (trinkets, creatures, blueprints) are not dropped.
      const counts = new Map<string, number>();
      for (const itemId of items) {
        if (Object.hasOwn(SAVE_CATALOG.items, itemId)) {
          counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
        }
      }
      if (counts.size === 0) {
        return;
      }
      groundItems.flingLoot(
        [...counts].map(([itemId, count]) => ({ ...SAVE_CATALOG.items[itemId], itemId, count })),
        position,
      );
    },
  });
}

export function registerEvergreens(
  target: ScenePrefabTarget,
  {
    worldState,
    inventory,
    worldEvents,
    prefabFire,
    groundItems,
    camera,
  }: ScenePrefabInputs<'worldState' | 'inventory' | 'worldEvents' | 'prefabFire' | 'groundItems' | 'camera'>,
) {
  const { prefabs } = target;
  registerPrefabFamily(target, evergreenRegistration, {
    handEquipment: inventory.handEquipment,
    camera,
    worldEvents,
    scheduler: worldState.scheduler,
    fire: prefabFire,
    spawnPrefab: (id, position) => prefabs.spawn(id, position),
    growthDuration: seconds => seconds * (worldState.season.value.season === 'spring' ? 0.75 : 1),
    dropLoot: (items, position) => {
      groundItems.flingLoot(
        items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })),
        position,
      );
    },
  });
}

export function registerDeciduousTrees(
  target: ScenePrefabTarget,
  {
    worldState,
    inventory,
    worldEvents,
    prefabFire,
    groundItems,
    camera,
  }: ScenePrefabInputs<'worldState' | 'inventory' | 'worldEvents' | 'prefabFire' | 'groundItems' | 'camera'>,
) {
  const { prefabs } = target;
  registerPrefabFamily(target, deciduousRegistration, {
    handEquipment: inventory.handEquipment,
    camera,
    worldEvents,
    scheduler: worldState.scheduler,
    fire: prefabFire,
    spawnPrefab: (id, position) => prefabs.spawn(id, position),
    growthDuration: seconds => seconds * (worldState.season.value.season === 'spring' ? 0.75 : 1),
    dropLoot: (items, position) => {
      groundItems.flingLoot(
        items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })),
        position,
      );
    },
    season: worldState.season,
    secondsUntilNextDay: now => TUNING.TOTAL_DAY_TIME - (now % TUNING.TOTAL_DAY_TIME),
  });
}

export function registerLivingTrees(
  target: ScenePrefabTarget,
  {
    worldState,
    world,
    prefabFire,
    groundItems,
    turfMap,
    followCamera,
  }: ScenePrefabInputs<'worldState' | 'world' | 'prefabFire' | 'groundItems' | 'turfMap' | 'followCamera'>,
) {
  registerPrefabFamily(target, livingTreeRegistration, {
    scheduler: worldState.scheduler,
    fire: prefabFire,
    physics: world,
    TheCamera: followCamera,
    getWatchWorldContent: worldState.getWatchWorldContent,
    spawnGroundItem: groundItems.spawnGroundItem,
    // The browser world supports the offline skin catalog.
    supportsOfflineSkins: true,
    isOcean: position => turfMap.isOceanAtWorld(position),
    shakeCamera: (position, duration, speed, scale, radius) =>
      followCamera.shakeFullAt(position, duration, speed, scale, radius),
  });
}

export function prepareFarmMap(
  { prefabs }: ScenePrefabTarget,
  { turfMap }: ScenePrefabInputs<'turfMap'>,
  retain: (dispose: () => void) => void,
): FarmMap {
  const map = createFarmMap({ turf: turfMap, entities: prefabs });
  retain(() => map.dispose());
  return map;
}

/** farm_plow, farm_soil, farm_soil_debris and the sown seeds, with TheWorld.Map's soil functions they share. */
export function registerFarm(
  target: ScenePrefabTarget,
  {
    worldState,
    inventory,
    worldFx,
    groundItems,
    view,
  }: ScenePrefabInputs<'worldState' | 'inventory' | 'worldFx' | 'groundItems' | 'view'>,
  farmMap: FarmMap,
) {
  const { prefabs } = target;
  registerPrefabFamily(target, farmRegistration, {
    scheduler: worldState.scheduler,
    map: farmMap,
    fx: worldFx,
    worldEvents: view.worldEvents,
    handEquipment: inventory.handEquipment,
    spawnPrefab: (prefab, position) => prefabs.spawn(prefab, position),
    getEntity: id => prefabs.get(id),
    spawnSaveRecord: (position, item) => {
      inventory.entities.restore(item).setPosition(position.x, 0, position.z);
    },
    spawnLoot: (itemId, position) =>
      groundItems.flingLoot([{ ...SAVE_CATALOG.items[itemId], itemId, count: 1 }], position),
  });
}

export function registerMoonTrees(
  target: ScenePrefabTarget,
  {
    worldState,
    inventory,
    worldEvents,
    prefabFire,
    groundItems,
    camera,
  }: ScenePrefabInputs<'worldState' | 'inventory' | 'worldEvents' | 'prefabFire' | 'groundItems' | 'camera'>,
) {
  const { prefabs } = target;
  registerPrefabFamily(target, moonTreeRegistration, {
    handEquipment: inventory.handEquipment,
    camera,
    worldEvents,
    scheduler: worldState.scheduler,
    fire: prefabFire,
    spawnPrefab: (id, position) => prefabs.spawn(id, position),
    growthDuration: seconds => seconds * (worldState.season.value.season === 'spring' ? 0.75 : 1),
    dropLoot: (items, position) => {
      groundItems.flingLoot(
        items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })),
        position,
      );
    },
  });
}

export function registerOceanTrees(
  target: ScenePrefabTarget,
  { worldState, groundItems }: ScenePrefabInputs<'worldState' | 'groundItems'>,
) {
  registerPrefabFamily(target, oceanTreeRegistration, {
    scheduler: worldState.scheduler,
    getWatchWorldContent: worldState.getWatchWorldContent,
    growthDuration: seconds => seconds * (worldState.season.value.season === 'spring' ? 0.75 : 1),
    spawnLoot: (prefab, position) => {
      groundItems.flingLoot([{ ...SAVE_CATALOG.items[prefab], itemId: prefab, count: 1 }], position);
      return undefined;
    },
  });
}

export function registerMarshPlants(
  target: ScenePrefabTarget,
  { worldState, prefabFire, groundItems }: ScenePrefabInputs<'worldState' | 'prefabFire' | 'groundItems'>,
) {
  registerPrefabFamily(target, marshPlantRegistration, {
    scheduler: worldState.scheduler,
    tickingarea: worldState.tickingarea,
    fire: prefabFire,
    spawnGroundItem: groundItems.spawnGroundItem,
  });
}
