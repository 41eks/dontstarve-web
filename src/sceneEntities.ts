import { LightFlierFlowerManager, type LightFlierFlowerRecord } from '../packages/prefab/src/lightflier_flower';
import { MAX_PHYSICS_FRAME_TIME } from './physicsTiming';
import { MolehillManager, type MolehillRecord } from '../packages/prefab/src/molehill';
import { MoleBait } from '../packages/prefab/src/molebait';
import { TUNING } from './tuning';
import { DynamicMusic } from '../packages/componets/src/dynamicmusic';
import { GetTemperatureAtXZ } from '../packages/componets/src/temperatureoverrider';
import { FindEntities } from '../packages/prefab/src/actionEntity';
import type { TemperatureSource } from '../packages/componets/src/temperature';
import { PlaySound } from '@dontstarve-web/prefab/sound';
import type { ItemEntityRegistry, InventoryStore } from '@dontstarve-web/inventory';
import { createInventoryStore } from './inventory';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { EventEmitter } from '@dontstarve-web/signals';
import type { WorldEvents } from '../packages/prefab/src/worldContext';

import { turfMap, moonTreeForest } from './building';
import { WORLD_TILES, isLandTile } from '@dontstarve-web/prefab/turfMap';
import { placeStaticLayout } from '@dontstarve-web/prefab/staticLayout';
import { camera, followCamera } from './camera';
import { GroundItemManager } from './groundItems';
import { turfItemForTile } from '@dontstarve-web/prefab/turfs';
import { GROUND_ITEM_DISPLAY_SPECS } from '@dontstarve-web/prefab/groundItems';
import { DockKitPlacement } from '@dontstarve-web/prefab/dock_kit';
import { FarmPlowPlacement, FARM_PLOW_ID } from '@dontstarve-web/prefab/farm_plow';
import { playerStats } from './playerStats';
import { DwarfStarManager, DWARF_STAR_ID, POLAR_LIGHT_ID } from '@dontstarve-web/prefab/stafflight';
import { BulbPlantManager } from '@dontstarve-web/prefab/bulb_plant';
import { RockManager } from '@dontstarve-web/prefab/rocks';
import { StaffProjectileManager } from '@dontstarve-web/prefab/staff_projectile';
import { CaveEntranceManager } from '@dontstarve-web/prefab/cave_entrance';
import { CaveExitManager } from '@dontstarve-web/prefab/cave_exit';
import { GrottoPoolManager } from '@dontstarve-web/prefab/grotto_pool';
import { MushroomPlantManager } from '@dontstarve-web/prefab/mushroom_plant';
import { MushtreeManager } from '@dontstarve-web/prefab/mushtree';
import { MarbleShrubManager, MARBLESHRUB_ID } from '@dontstarve-web/prefab/marbleshrub';
import { ArchivePropsManager, type ArchivePropId } from '@dontstarve-web/prefab/archive_props';
import { HoundboneManager } from '@dontstarve-web/prefab/houndbone';
import { SkeletonManager, type SkeletonId } from '@dontstarve-web/prefab/skeleton';
import { MarbleBeanSaplingManager, MARBLEBEAN_SAPLING_ID } from '@dontstarve-web/prefab/marblebean_sapling';
import { RockAvocadoSaplingManager, ROCK_AVOCADO_SAPLING_ID } from '@dontstarve-web/prefab/rock_avocado_fruit_sprout_sapling';
import { RockAvocadoBushManager, ROCK_AVOCADO_BUSH_ID } from '@dontstarve-web/prefab/rock_avocado_bush';
import { BerrybushManager, BERRYBUSH_ID } from '@dontstarve-web/prefab/berrybush';
import { MonkeytailManager, MONKEYTAIL_ID } from '@dontstarve-web/prefab/monkeytail';
import { GrassManager, GRASS_ID } from '@dontstarve-web/prefab/grass';
import { CaveFernManager } from '@dontstarve-web/prefab/cave_fern';
import type { GameTimeScheduler } from '@dontstarve-web/prefab/gameTimeScheduler';
import { TumbleweedManager, TUMBLEWEED_ID } from '@dontstarve-web/prefab/tumbleweed';
import { SaplingManager } from '@dontstarve-web/prefab/sapling';
import { PondManager, POND_ID } from '@dontstarve-web/prefab/pond';
import { HotspringManager } from '@dontstarve-web/prefab/hotspring';
import { LavaPondManager, LAVA_POND_ID } from '@dontstarve-web/prefab/lava_pond';
import { WormholeManager, WORMHOLE_ID } from '@dontstarve-web/prefab/wormhole';
import { PortalManager, PORTAL_ID } from '@dontstarve-web/prefab/portal';
import { NightmareGrowthManager, NIGHTMAREGROWTH_ID } from '@dontstarve-web/prefab/nightmaregrowth';
import { NightmareRockManager } from '@dontstarve-web/prefab/nightmarerock';
import { BeefaloManager, BEEFALO_BEHAVIOR } from '@dontstarve-web/prefab/beefalo';
import { newEntityId } from '@dontstarve-web/prefab/saveRecord';
import { pigKings } from './pigking';
import { player } from './player';
import {
  PlaceableBuildingPlacement,
  type PlaceableBuildingInteractionChange,
  type PlaceableBuildingId,
} from './placeableBuilding';
import { dstLighting, renderer, scene } from './universal';
import { FlowerPlanting } from '@dontstarve-web/prefab/flower';
import { view } from './view';
import { initialSave } from './save/initialSave';
import { ReskinEffects } from '@dontstarve-web/prefab/reskin_tool';
import { RainEffect } from '@dontstarve-web/prefab/rain';
import { SnowEffect } from '@dontstarve-web/prefab/snow';
import { WorldFx } from '@dontstarve-web/prefab/world_fx';
import { OceanWaves } from '@dontstarve-web/prefab/ocean_waves';
import { WaveManager, type WaveMap } from '../packages/componets/src/wavemanager';
import { WORLD_SCALE } from '../packages/prefab/src/standardcomponents';
import { TILE_SIZE } from '../packages/prefab/src/tile';
import { SAVE_CATALOG } from './save/catalog';
import { findGroundPath } from '@dontstarve-web/prefab/locomotor';
import { createDeciduousForest, type DeciduousSpawnId } from '@dontstarve-web/prefab/deciduoustrees';
import { createEvergreenForest, type EvergreenSpawnId } from '@dontstarve-web/prefab/evergreens';

import { EntityRegistry } from './entityRegistry';
import { PREFAB_DEFINITIONS } from './prefabDefinitions';
import { disposeSprite } from '@dontstarve-web/prefab/disposeSprite';
import type { WorldState } from './worldState';

type SceneWorldState = Pick<WorldState, 'clock' | 'season' | 'isNight' | 'cycle' | 'getWatchWorldContent' | 'tickingarea' | 'worldwind' | 'scheduler' | 'portalRez' | 'componentUpdates' | 'temperature' | 'weather' | 'perishClock'>;

const MANAGER_DEFINITIONS = {
  'buildings': PREFAB_DEFINITIONS.buildings,
  'reskinEffects': PREFAB_DEFINITIONS.reskinEffects,
  'flower': PREFAB_DEFINITIONS.flowers,
  'world_fx': PREFAB_DEFINITIONS.worldFx,
  'staff_projectile': PREFAB_DEFINITIONS.staffProjectiles,
  'molehill': PREFAB_DEFINITIONS.molehills,
  'lightflier_flower': PREFAB_DEFINITIONS.lightflierFlowers,
  'ground_item': PREFAB_DEFINITIONS.groundItems,
  'bulb_plant': PREFAB_DEFINITIONS.bulbPlants,
  'rocks': PREFAB_DEFINITIONS.rocks,
  'cave_entrance': PREFAB_DEFINITIONS.caveEntrances,
  'cave_exit': PREFAB_DEFINITIONS.caveExits,
  'grotto_pool': PREFAB_DEFINITIONS.grottoPools,
  'mushtree': PREFAB_DEFINITIONS.mushtrees,
  'mushroom_plant': PREFAB_DEFINITIONS.mushroomPlants,
  'marbleshrub': PREFAB_DEFINITIONS.marbleShrubs,
  'archive_props': PREFAB_DEFINITIONS.archiveProps,
  'skeleton': PREFAB_DEFINITIONS.skeletons,
  'houndbone': PREFAB_DEFINITIONS.houndbones,
  'marblebean_sapling': PREFAB_DEFINITIONS.marbleBeanSaplings,
  'rock_avocado_bush': PREFAB_DEFINITIONS.rockAvocadoBushes,
  'rock_avocado_fruit_sprout_sapling': PREFAB_DEFINITIONS.rockAvocadoSaplings,
  'berrybush': PREFAB_DEFINITIONS.berrybushes,
  'monkeytail': PREFAB_DEFINITIONS.monkeytails,
  'grass': PREFAB_DEFINITIONS.grasses,
  'sapling': PREFAB_DEFINITIONS.saplings,
  'cave_fern': PREFAB_DEFINITIONS.caveFerns,
  'lava_pond': PREFAB_DEFINITIONS.lavaPonds,
  'tumbleweed': PREFAB_DEFINITIONS.tumbleweeds,
  'hotspring': PREFAB_DEFINITIONS.hotsprings,
  'wormhole': PREFAB_DEFINITIONS.wormholes,
  'multiplayer_portal_moonrock': PREFAB_DEFINITIONS.portals,
  'nightmaregrowth': PREFAB_DEFINITIONS.nightmareGrowths,
  'beefalo': PREFAB_DEFINITIONS.beefalos,
  'evergreen': PREFAB_DEFINITIONS.evergreens,
  'deciduoustree': PREFAB_DEFINITIONS.deciduousTrees,
  'farm_plow': PREFAB_DEFINITIONS.farmPlow,
  'dock_kit': PREFAB_DEFINITIONS.dockKit,
  'moon_tree': PREFAB_DEFINITIONS.moonTrees,
  'pigking': PREFAB_DEFINITIONS.pigKings,
  'sanityrock': PREFAB_DEFINITIONS.nightmareRocks,
  'rain': PREFAB_DEFINITIONS.rain,
  'snow': PREFAB_DEFINITIONS.snow,
  'ocean_waves': PREFAB_DEFINITIONS.oceanWaves,
  'stafflight': PREFAB_DEFINITIONS.dwarfStars,
  'staffcoldlight': PREFAB_DEFINITIONS.polarLights,
  'pond': PREFAB_DEFINITIONS.ponds,
} as const;

// Keep frame callbacks and reverse disposal in their existing order, independently of construction dependencies.
const SCENE_LIFECYCLE_ORDER = [
  PREFAB_DEFINITIONS.dockKit,
  PREFAB_DEFINITIONS.farmPlow,
  PREFAB_DEFINITIONS.farmDecor,
  PREFAB_DEFINITIONS.plantedSeeds,
  PREFAB_DEFINITIONS.moonTrees,
  PREFAB_DEFINITIONS.moonTreeSaplings,
  PREFAB_DEFINITIONS.evergreens,
  PREFAB_DEFINITIONS.deciduousTrees,
  PREFAB_DEFINITIONS.pigKings,
  PREFAB_DEFINITIONS.buildings,
  PREFAB_DEFINITIONS.lightflierFlowers,
  PREFAB_DEFINITIONS.groundItems,
  PREFAB_DEFINITIONS.flowers,
  PREFAB_DEFINITIONS.dwarfStars,
  PREFAB_DEFINITIONS.polarLights,
  PREFAB_DEFINITIONS.bulbPlants,
  PREFAB_DEFINITIONS.molehills,
  PREFAB_DEFINITIONS.beefalos,
  PREFAB_DEFINITIONS.rocks,
  PREFAB_DEFINITIONS.caveEntrances,
  PREFAB_DEFINITIONS.caveExits,
  PREFAB_DEFINITIONS.grottoPools,
  PREFAB_DEFINITIONS.mushtrees,
  PREFAB_DEFINITIONS.mushroomPlants,
  PREFAB_DEFINITIONS.marbleBeanSaplings,
  PREFAB_DEFINITIONS.marbleShrubs,
  PREFAB_DEFINITIONS.archiveProps,
  PREFAB_DEFINITIONS.skeletons,
  PREFAB_DEFINITIONS.houndbones,
  PREFAB_DEFINITIONS.rockAvocadoSaplings,
  PREFAB_DEFINITIONS.rockAvocadoBushes,
  PREFAB_DEFINITIONS.berrybushes,
  PREFAB_DEFINITIONS.monkeytails,
  PREFAB_DEFINITIONS.grasses,
  PREFAB_DEFINITIONS.saplings,
  PREFAB_DEFINITIONS.caveFerns,
  PREFAB_DEFINITIONS.ponds,
  PREFAB_DEFINITIONS.lavaPonds,
  PREFAB_DEFINITIONS.lavaPondRocks,
  PREFAB_DEFINITIONS.tumbleweeds,
  PREFAB_DEFINITIONS.hotsprings,
  PREFAB_DEFINITIONS.nightmareGrowths,
  PREFAB_DEFINITIONS.wormholes,
  PREFAB_DEFINITIONS.portals,
  PREFAB_DEFINITIONS.reskinEffects,
  PREFAB_DEFINITIONS.worldFx,
  PREFAB_DEFINITIONS.staffProjectiles,
  PREFAB_DEFINITIONS.nightmareRocks,
  PREFAB_DEFINITIONS.rain,
  PREFAB_DEFINITIONS.snow,
  PREFAB_DEFINITIONS.oceanWaves,
];

export async function createSceneEntities(
  world: CANNON.World,
  worldState: SceneWorldState,
  consumeBufferedBuild: (buildingId: PlaceableBuildingId, skinId?: string) => boolean,
  onBuildingInteraction?: (change: PlaceableBuildingInteractionChange) => void,
  itemEntities?: ItemEntityRegistry,
  inventory?: InventoryStore,
  scheduler?: GameTimeScheduler,
) {
  const registry = new EntityRegistry(SCENE_LIFECYCLE_ORDER);
  const worldEvents = new EventEmitter<WorldEvents>();
  type SceneManagers = {
    'buildings': ReturnType<typeof registerBuildings>;
    'reskinEffects': ReturnType<typeof registerReskinEffects>;
    'flower': ReturnType<typeof registerFlowers>;
    'world_fx': ReturnType<typeof registerWorldFx>;
    'staff_projectile': ReturnType<typeof registerStaffProjectiles>;
    'molehill': ReturnType<typeof registerMolehills>;
    'lightflier_flower': ReturnType<typeof registerLightFlierFlowers>;
    'ground_item': ReturnType<typeof registerGroundItems>;
    'bulb_plant': ReturnType<typeof registerBulbPlants>;
    'rocks': ReturnType<typeof registerRocks>;
    'cave_entrance': ReturnType<typeof registerCaveEntrances>;
    'cave_exit': ReturnType<typeof registerCaveExits>;
    'grotto_pool': ReturnType<typeof registerGrottoPools>;
    'mushtree': ReturnType<typeof registerMushtrees>;
    'mushroom_plant': ReturnType<typeof registerMushroomPlants>;
    'marbleshrub': ReturnType<typeof registerMarbleShrubs>;
    'archive_props': ReturnType<typeof registerArchiveProps>;
    'skeleton': ReturnType<typeof registerSkeletons>;
    'houndbone': ReturnType<typeof registerHoundbones>;
    'marblebean_sapling': ReturnType<typeof registerMarbleBeanSaplings>;
    'rock_avocado_bush': ReturnType<typeof registerRockAvocadoBushes>;
    'rock_avocado_fruit_sprout_sapling': ReturnType<typeof registerRockAvocadoSaplings>;
    'berrybush': ReturnType<typeof registerBerrybushes>;
    'monkeytail': ReturnType<typeof registerMonkeytails>;
    'grass': ReturnType<typeof registerGrasses>;
    'sapling': ReturnType<typeof registerSaplings>;
    'cave_fern': ReturnType<typeof registerCaveFerns>;
    'lava_pond': ReturnType<typeof registerLavaPonds>;
    'tumbleweed': ReturnType<typeof registerTumbleweeds>;
    'hotspring': ReturnType<typeof registerHotsprings>;
    'wormhole': ReturnType<typeof registerWormholes>;
    'multiplayer_portal_moonrock': ReturnType<typeof registerPortals>;
    'nightmaregrowth': ReturnType<typeof registerNightmareGrowths>;
    'beefalo': ReturnType<typeof registerBeefalos>;
    'evergreen': Awaited<ReturnType<typeof registerEvergreens>>;
    'deciduoustree': Awaited<ReturnType<typeof registerDeciduousTrees>>;
    'farm_plow': ReturnType<typeof registerFarmPlow>;
    'dock_kit': ReturnType<typeof registerDockKit>;
    'moon_tree': ReturnType<typeof registerMoonTrees>;
    'pigking': ReturnType<typeof registerPigKings>;
    'sanityrock': ReturnType<typeof registerNightmareRocks>;
    'rain': ReturnType<typeof registerRain>;
    'snow': ReturnType<typeof registerSnow>;
    'ocean_waves': Awaited<ReturnType<typeof registerOceanWaves>>;
    'stafflight': ReturnType<typeof registerStaffLights>;
    'staffcoldlight': ReturnType<typeof registerStaffLights>;
    'pond': ReturnType<typeof registerPonds>;
  };
  // Filled in dependency order below; deferred callbacks run after scene setup.
  const Managers = {} as SceneManagers;

  const sceneInventory = inventory ?? createInventoryStore();
  sceneInventory.entities.bindPerishWorld({ perishClock: worldState.perishClock, scheduler: worldState.scheduler });
  sceneInventory.entities.bindTemperatureWorld({
    componentUpdates: worldState.componentUpdates,
    temperature: worldState.temperature, clock: worldState.clock, unitScale: WORLD_SCALE,
    findHeaters: (position, radius, ignoredTags) => FindEntities(scene, position, radius, ['HASHEATER'], ignoredTags) as TemperatureSource[],
  });
  const dynamicMusic = scheduler ? new DynamicMusic(scheduler, path => PlaySound(path)) : undefined;

  Managers['buildings'] = registerBuildings(registry, 'buildings', worldState);
  Managers['reskinEffects'] = registerReskinEffects(registry, 'reskinEffects', worldState);
  Managers['flower'] = registerFlowers(registry, 'flower', worldState);
  Managers['world_fx'] = registerWorldFx(registry, 'world_fx', worldState);
  Managers['staff_projectile'] = registerStaffProjectiles(registry, 'staff_projectile', worldState);
  Managers['molehill'] = registerMolehills(registry, 'molehill', worldState);
  Managers['lightflier_flower'] = registerLightFlierFlowers(registry, 'lightflier_flower', worldState);
  Managers['ground_item'] = registerGroundItems(registry, 'ground_item', worldState);

  Managers['stafflight'] = registerStaffLights(registry, 'stafflight', worldState);
  Managers['staffcoldlight'] = registerStaffLights(registry, 'staffcoldlight', worldState);
  Managers['bulb_plant'] = registerBulbPlants(registry, 'bulb_plant', worldState);
  Managers['rocks'] = registerRocks(registry, 'rocks', worldState);
  Managers['cave_entrance'] = registerCaveEntrances(registry, 'cave_entrance', worldState);
  Managers['cave_exit'] = registerCaveExits(registry, 'cave_exit');
  Managers['grotto_pool'] = registerGrottoPools(registry, 'grotto_pool', worldState);
  Managers['mushtree'] = registerMushtrees(registry, 'mushtree', worldState);
  Managers['mushroom_plant'] = registerMushroomPlants(registry, 'mushroom_plant', worldState);
  Managers['marbleshrub'] = registerMarbleShrubs(registry, 'marbleshrub', worldState);
  Managers['archive_props'] = registerArchiveProps(registry, 'archive_props', worldState);
  Managers['skeleton'] = registerSkeletons(registry, 'skeleton', worldState);
  Managers['houndbone'] = registerHoundbones(registry, 'houndbone', worldState);
  Managers['marblebean_sapling'] = registerMarbleBeanSaplings(registry, 'marblebean_sapling', worldState);
  Managers['rock_avocado_bush'] = registerRockAvocadoBushes(registry, 'rock_avocado_bush', worldState);
  Managers['rock_avocado_fruit_sprout_sapling'] = registerRockAvocadoSaplings(registry, 'rock_avocado_fruit_sprout_sapling', worldState);
  Managers['berrybush'] = registerBerrybushes(registry, 'berrybush', worldState);
  Managers['monkeytail'] = registerMonkeytails(registry, 'monkeytail', worldState);
  Managers['grass'] = registerGrasses(registry, 'grass', worldState);
  Managers['sapling'] = registerSaplings(registry, 'sapling', worldState);
  Managers['cave_fern'] = registerCaveFerns(registry, 'cave_fern', worldState);
  Managers['lava_pond'] = registerLavaPonds(registry, 'lava_pond', worldState);

  const worldWind = worldState.worldwind;
  Managers['tumbleweed'] = registerTumbleweeds(registry, 'tumbleweed', worldState);
  Managers['hotspring'] = registerHotsprings(registry, 'hotspring', worldState);
  Managers['wormhole'] = registerWormholes(registry, 'wormhole', worldState);
  Managers['multiplayer_portal_moonrock'] = registerPortals(registry, 'multiplayer_portal_moonrock', worldState);
  Managers['nightmaregrowth'] = registerNightmareGrowths(registry, 'nightmaregrowth', worldState);
  Managers['beefalo'] = registerBeefalos(registry, 'beefalo', worldState);
  Managers['evergreen'] = await registerEvergreens(registry, 'evergreen', worldState);
  Managers['deciduoustree'] = await registerDeciduousTrees(registry, 'deciduoustree', worldState);
  Managers['farm_plow'] = registerFarmPlow(registry, 'farm_plow', worldState);
  Managers['dock_kit'] = registerDockKit(registry, 'dock_kit', worldState);
  Managers['moon_tree'] = registerMoonTrees(registry, 'moon_tree', worldState);
  Managers['pigking'] = registerPigKings(registry, 'pigking', worldState);
  Managers['pond'] = registerPonds(registry, 'pond', worldState);
  Managers['sanityrock'] = registerNightmareRocks(registry, 'sanityrock', worldState);
  Managers['rain'] = registerRain(registry, 'rain', worldState);
  Managers['snow'] = registerSnow(registry, 'snow', worldState);
  Managers['ocean_waves'] = await registerOceanWaves(registry, 'ocean_waves', worldState);

  registry.assertDefinitions(Object.values(PREFAB_DEFINITIONS));

  const stopDugTurf = turfMap.onDig((point, tileId) => {
    const itemId = turfItemForTile(tileId);
    if (!itemId) return;
    const spec = GROUND_ITEM_DISPLAY_SPECS[itemId];
    void Managers['ground_item'].flingLoot([{ itemId, count: 1, name: spec.name, icon: spec.icon, atlas: spec.atlas }],
      new THREE.Vector3(point.x, 0, point.z)).catch((error: unknown) => console.error('Unable to drop dug turf', error));
  });

  const dispose = () => {
    stopDugTurf();
    try { registry.dispose(); }
    finally { dynamicMusic?.dispose(); if (!inventory) sceneInventory.dispose(); }
  };

  return {
    Managers, registry, worldEvents, dispose, moonTreeForest, worldWind,
    evergreenForest: Managers['evergreen'],
    deciduousForest: Managers['deciduoustree'],
    buildingPlacement: Managers['buildings'],
    groundItems: Managers['ground_item'],
    dwarfStars: Managers['stafflight'],
    polarLights: Managers['staffcoldlight'],
    flowerPlanting: Managers['flower'],
    bulbPlants: Managers['bulb_plant'],
    beefalos: Managers['beefalo'],
    molehills: Managers['molehill'],
    rockManager: Managers['rocks'],
    caveEntrances: Managers['cave_entrance'],
    mushtrees: Managers['mushtree'],
    mushroomPlants: Managers['mushroom_plant'],
    grottoPools: Managers['grotto_pool'],
    marbleShrubs: Managers['marbleshrub'],
    archiveProps: Managers['archive_props'],
    skeletons: Managers['skeleton'],
    houndbones: Managers['houndbone'],
    marbleBeanSaplings: Managers['marblebean_sapling'],
    rockAvocadoSaplings: Managers['rock_avocado_fruit_sprout_sapling'],
    rockAvocadoBushes: Managers['rock_avocado_bush'],
    berrybushes: Managers['berrybush'],
    monkeytails: Managers['monkeytail'],
    grasses: Managers['grass'],
    saplings: Managers['sapling'],
    ponds: Managers['pond'],
    lavaPonds: Managers['lava_pond'],
    hotsprings: Managers['hotspring'],
    tumbleweeds: Managers['tumbleweed'],
    wormholes: Managers['wormhole'],
    portals: Managers['multiplayer_portal_moonrock'],
    nightmareGrowths: Managers['nightmaregrowth'],
    reskinEffects: Managers['reskinEffects'],
    worldFx: Managers['world_fx'],
    staffProjectiles: Managers['staff_projectile'],
    farmPlow: Managers['farm_plow'],
    dockKit: Managers['dock_kit'],
  };

  function registerBuildings(registry: EntityRegistry, prefabId: 'buildings', worldState: SceneWorldState) {
    const buildingPlacement = new PlaceableBuildingPlacement(
      { ...view, physics: world, scheduler, dynamicMusic,
        getLocalTemperature: (x, z) => GetTemperatureAtXZ(() => worldState.temperature.peek(), x, z), itemEntities: sceneInventory.entities,
        cycle: worldState.cycle, getWatchWorldContent: worldState.getWatchWorldContent, isNight: worldState.isNight, perishClock: worldState.perishClock,
        secondsUntilNextDay: now => TUNING.TOTAL_DAY_TIME - now % TUNING.TOTAL_DAY_TIME,
        // world_fx registers after the buildings; the manager is read when an fx is played.
        fx: { prepare: prefab => Managers['world_fx'].prepare(prefab), spawn: (prefab, position) => { Managers['world_fx'].spawn(prefab, position); } },
        spawnItem: state => { const entity = sceneInventory.entities.create(state); sceneInventory.configureItem(entity); return entity; },
        dropItem: (entity, position) => { sceneInventory.DropItem(entity, position); },
        registerContainer: (id, container, saved) => sceneInventory.registerContainer(id, container, saved),
        unregisterContainer: (id, container) => sceneInventory.unregisterContainer(id, container), dropLoot: (items, position, launch) => {
        void Managers['ground_item'].flingLoot(items.map((item) => ({ ...SAVE_CATALOG.items[item.itemId], ...item })), position, launch)
          .catch((error: unknown) => console.error('Unable to drop building loot', error));
      } },
      consumeBufferedBuild,
      onBuildingInteraction,
    );
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (id, record) => buildingPlacement.spawnFromSave(id, record),
      debugSpawn: (id) => buildingPlacement.spawn(id),
      exportRecords: () => buildingPlacement.exportRecords(),
      update: (dt) => buildingPlacement.update(dt),
      renderEntities: () => buildingPlacement.renderEntities,
      dispose: () => buildingPlacement.dispose(),
    });
    return buildingPlacement;
  }

  function registerReskinEffects(registry: EntityRegistry, prefabId: 'reskinEffects', _worldState: SceneWorldState) {
    const reskinEffects = new ReskinEffects(scene);
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      exportRecords: () => [],
      update: (dt, quaternion) => reskinEffects.update(dt, quaternion),
      renderEntities: () => reskinEffects.renderEntities,
      dispose: () => reskinEffects.dispose(),
    });
    return reskinEffects;
  }

  function registerFlowers(registry: EntityRegistry, prefabId: 'flower', _worldState: SceneWorldState) {
    const flowerPlanting = new FlowerPlanting(view, Math.random, scheduler ? { scheduler, worldEvents } : undefined);
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => flowerPlanting.spawnFromSave(record.id,
        record.components.flower!.animation, new THREE.Vector3(...record.transform.position)),
      debugSpawn: async () => {
        const prepared = await flowerPlanting.prepareTransplant();
        try { prepared.spawn(view.player.position); } finally { prepared.dispose(); }
      },
      exportRecords: () => flowerPlanting.exportRecords().map((record) => ({ prefabId: 'flower', record })),
      update: (dt, quaternion) => flowerPlanting.update(quaternion, dt),
      renderEntities: () => flowerPlanting.renderEntities,
      dispose: () => flowerPlanting.dispose(),
    });
    return flowerPlanting;
  }

  function registerWorldFx(registry: EntityRegistry, prefabId: 'world_fx', _worldState: SceneWorldState) {
    const worldFx = new WorldFx(scene);
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      debugSpawn: async prefab => { await worldFx.prepare(prefab); worldFx.spawn(prefab, player.position); },
      exportRecords: () => [],
      update: (dt, quaternion) => worldFx.update(dt, quaternion),
      renderEntities: () => worldFx.renderEntities,
      dispose: () => worldFx.dispose(),
    });
    return worldFx;
  }

  function registerStaffProjectiles(registry: EntityRegistry, prefabId: 'staff_projectile', _worldState: SceneWorldState) {
    const staffProjectiles = new StaffProjectileManager(scene, { fx: Managers['world_fx'] });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      exportRecords: () => [],
      update: (dt, quaternion) => staffProjectiles.update(dt, quaternion),
      renderEntities: () => staffProjectiles.renderEntities,
      dispose: () => staffProjectiles.dispose(),
    });
    return staffProjectiles;
  }

  function registerMolehills(registry: EntityRegistry, prefabId: 'molehill', worldState: SceneWorldState) {
    const moleScheduler = scheduler ?? worldState.scheduler;
    const moleBaits = new Map<string, MoleBait>();
    const moleWalkable = (point: THREE.Vector3) => {
      const radius = .5 * WORLD_SCALE;
      const edge = initialSave.world.map.generator.options.size / 2 - radius;
      return turfMap.isPassableAtPoint(point) && Math.abs(point.x) <= edge && Math.abs(point.z) <= edge
        && !world.bodies.some(body => body.type === CANNON.Body.STATIC && body.collisionResponse &&
          body.shapes.some(shape => shape instanceof CANNON.Box || shape instanceof CANNON.Sphere) && (() => {
            body.updateAABB(); const b = body.aabb;
            return point.x >= b.lowerBound.x - radius && point.x <= b.upperBound.x + radius && point.z >= b.lowerBound.z - radius && point.z <= b.upperBound.z + radius;
          })());
    };
    const molehills: MolehillManager = new MolehillManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
      itemSpecs: SAVE_CATALOG.items, getWatchWorldContent: worldState.getWatchWorldContent, cameraHeading: view.cameraHeading,
      isWalkable: moleWalkable,
      findPath: (start, target) => findGroundPath(new THREE.Vector3(start.x, start.y, start.z),
        new THREE.Vector3(target.x, target.y, target.z), { cellSize: 1.5, isWalkable: moleWalkable }),
      spawnItem: state => { const entity = sceneInventory.entities.create(state); sceneInventory.configureItem(entity); return entity; },
      dropItem: (entity, position) => sceneInventory.DropItem(entity, position),
      showMole: (entity, position) => { void Managers['ground_item'].spawnFromSave(entity.id, {
        ...SAVE_CATALOG.items.mole, ...entity.snapshot(), entity,
      }, position).catch((error: unknown) => console.error('Unable to render mole', error)); },
      dropLoot: (itemId, position) => { void Managers['ground_item'].flingLoot([{ ...SAVE_CATALOG.items[itemId], itemId, count: 1 }], position)
        .catch((error: unknown) => console.error('Unable to drop mole loot', error)); },
      getEntities: () => {
        for (const entity of sceneInventory.entities.values()) if (entity.components.bait && !moleBaits.has(entity.id))
          moleBaits.set(entity.id, new MoleBait(entity, moleScheduler, moleWalkable));
        for (const [id, bait] of moleBaits) if (bait.entity.isRemoved) { bait.dispose(); moleBaits.delete(id); }
        return [...moleBaits.values(), ...molehills.habitat.getMoles(),
          { prefab: 'wilson', components: {}, isValid: () => true, hasTag: (tag: string) => tag === 'scarytoprey',
            getPosition: () => player.position, getPhysicsRadius: () => .5 * WORLD_SCALE }];
      },
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => molehills.spawn(new THREE.Vector3(...record.transform.position), record as MolehillRecord),
      debugSpawn: () => molehills.spawn(player.position.clone().setY(0)),
      exportRecords: () => molehills.exportRecords().map(record => ({ prefabId: 'molehill', record })),
      beforePhysics: dt => { if (!scheduler) moleScheduler.advance(dt); },
      update: (dt, quaternion) => molehills.update(dt, quaternion), renderEntities: () => molehills.renderEntities,
      dispose: () => { molehills.dispose(); for (const bait of moleBaits.values()) bait.dispose(); moleBaits.clear(); },
    });
    return molehills;
  }

  function registerGroundItems(registry: EntityRegistry, prefabId: 'ground_item', worldState: SceneWorldState) {
    const groundItems = new GroundItemManager(
      scene,
      camera,
      renderer,
      `${import.meta.env.BASE_URL}dst/data/databundles/images.zip`,
      sceneInventory,
      `${import.meta.env.BASE_URL}dst/data/anim`,
      player,
      {
        getWatchWorldContent: worldState.getWatchWorldContent,
        getThreatPositions: () => [player.position],
        getFlowers: () => Managers['flower'].plantedFlowers,
        constrainPosition: (position) => {
          const edge = initialSave.world.map.generator.options.size / 2 - 0.5;
          position.x = THREE.MathUtils.clamp(position.x, -edge, edge);
          position.z = THREE.MathUtils.clamp(position.z, -edge, edge);
        },
      },
      {
        getWatchWorldContent: worldState.getWatchWorldContent,
      },
      { getSanityPercent: () => playerStats.sanity.percent.peek() },
      itemEntities ?? sceneInventory.entities,
      scheduler,
      Managers['world_fx'],
      Managers['molehill'].habitat,
      worldEvents,
      worldState.getWatchWorldContent,
      view.mouseActions,
      Managers['lightflier_flower'].habitat,
    );
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => {
        const item = record.components.stack!;
        const spec = SAVE_CATALOG.items[item.itemId];
        const skin = item.skinId ? SAVE_CATALOG.skins[item.skinId] : undefined;
        return groundItems.spawnFromSave(record.id, {
          ...item, name: skin?.name ?? spec.name, icon: skin?.icon ?? spec.icon, atlas: skin?.atlas ?? spec.atlas,
          ...(record.components.phonograph ? { playbackRemaining: record.components.phonograph.remainingSeconds } : {}),
          ...(record.components.torch ? { torchLit: true } : {}),
          ...(record.components.lantern ? { lanternOn: record.components.lantern.ison } : {}),
        }, new THREE.Vector3(...record.transform.position));
      },
      debugSpawn: (id) => groundItems.spawnFromSave(newEntityId(), {
        ...SAVE_CATALOG.items[id], itemId: id, count: 1,
      }, player.position.clone().setY(0)),
      exportRecords: () => groundItems.exportRecords().map((record) => ({ prefabId: 'ground_item', record })),
      update: (dt, quaternion) => groundItems.update(dt, quaternion),
      renderEntities: () => groundItems.renderEntities,
      miniMapEntities: () => groundItems.miniMapEntities,
      dispose: () => groundItems.dispose(),
    });
    return groundItems;
  }

  function registerLightFlierFlowers(registry: EntityRegistry, prefabId: 'lightflier_flower', worldState: SceneWorldState) {
    const lightFlierPlayer = { position: player.position, isValid: () => playerStats.health.peek() > 0,
      hasLightFlier: () => sceneInventory.Has('lightflier'),
      getFacing: () => player.userData.worldHeading ?? 0, getWalkSpeed: () => 4 * WORLD_SCALE,
      wantsToMove: () => player.userData.wantsToMoveForward === true };
    const flowers = new LightFlierFlowerManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
      maxMovementStep: MAX_PHYSICS_FRAME_TIME,
      scheduler: scheduler ?? worldState.scheduler, getWatchWorldContent: worldState.getWatchWorldContent, tickingarea: worldState.tickingarea, cameraHeading: view.cameraHeading,
      getPlayers: () => [lightFlierPlayer],
      spawnItem: state => { const entity = sceneInventory.entities.create(state); sceneInventory.configureItem(entity); return entity; },
      showItem: (entity, position) => Managers['ground_item'].spawnPreparedEntity(entity, position),
      dropLoot: (itemId, count, position) => { void Managers['ground_item'].flingLoot([{ ...SAVE_CATALOG.items[itemId], itemId, count }], position)
        .catch((error: unknown) => console.error('Unable to drop lightflier loot', error)); },
    }, model => dstLighting.sampleLightLevel(model.position, model));
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => flowers.spawn(new THREE.Vector3(...record.transform.position), record as LightFlierFlowerRecord),
      debugSpawn: () => flowers.spawn(player.position.clone()),
      exportRecords: () => flowers.exportRecords().map(record => ({ prefabId, record })),
      update: (dt, quaternion) => flowers.update(dt, quaternion), renderEntities: () => flowers.renderEntities,
      miniMapEntities: () => flowers.miniMapEntities,
      dispose: () => flowers.dispose(),
    });
    return flowers;
  }

  function registerBulbPlants(registry: EntityRegistry, prefabId: 'bulb_plant', worldState: SceneWorldState) {
    const bulbPlants = new BulbPlantManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
      scheduler, tickingarea: worldState.tickingarea,
      getLightLevel: (model) => dstLighting.sampleLightLevel(model.position, model),
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (id, record) => bulbPlants.spawn(id, new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: { bulbPlant: record.components.bulbPlant! },
      }),
      debugSpawn: (id) => bulbPlants.spawn(id, player.position.clone()),
      exportRecords: () => bulbPlants.exportRecords(),
      update: (dt, quaternion) => bulbPlants.update(dt, quaternion),
      renderEntities: () => bulbPlants.renderEntities,
      dispose: () => bulbPlants.dispose(),
    });
    return bulbPlants;
  }

  function registerRocks(registry: EntityRegistry, prefabId: 'rocks', _worldState: SceneWorldState) {
    const rockManager = new RockManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
      scheduler,
      prepareSpawn: (definition, fling) => Managers['ground_item'].prepareSpawn(definition, fling),
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (id, record) => rockManager.spawn(id, new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: { caveinBoulder: record.components.caveinBoulder },
      }),
      debugSpawn: (id) => rockManager.spawn(id, player.position.clone()),
      exportRecords: () => rockManager.exportRecords(),
      update: (dt, quaternion) => rockManager.update(dt, quaternion),
      renderEntities: () => rockManager.renderEntities,
      dispose: () => rockManager.dispose(),
    });
    return rockManager;
  }

  function registerCaveEntrances(registry: EntityRegistry, prefabId: 'cave_entrance', _worldState: SceneWorldState) {
    const caveEntrances = new CaveEntranceManager(scene, {
      physics: world, prepareSpawn: (definition, fling) => Managers['ground_item'].prepareSpawn(definition, fling),
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (id, record) => caveEntrances.spawn(id, new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: {},
      }),
      debugSpawn: id => caveEntrances.spawn(id, player.position.clone()),
      exportRecords: () => caveEntrances.exportRecords(),
      update: (dt, quaternion) => caveEntrances.update(dt, quaternion),
      renderEntities: () => caveEntrances.renderEntities,
      miniMapEntities: () => caveEntrances.miniMapEntities,
      dispose: () => caveEntrances.dispose(),
    });
    return caveEntrances;
  }

  function registerMushroomPlants(registry: EntityRegistry, prefabId: 'mushroom_plant', worldState: SceneWorldState) {
    const mushrooms = new MushroomPlantManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
      prepareSpawn: (definition, fling) => Managers['ground_item'].prepareSpawn(definition, fling),
      rain: worldState.weather.preciptype,
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (id, record) => mushrooms.spawn(new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: { pickable: record.components.pickable, mushroom: record.components.mushroom },
      }, id),
      debugSpawn: (id) => mushrooms.spawn(player.position.clone(), undefined, id),
      exportRecords: () => mushrooms.exportRecords(),
      update: (dt, quaternion) => mushrooms.update(dt, quaternion),
      renderEntities: () => mushrooms.renderEntities,
      dispose: () => mushrooms.dispose(),
    });
    return mushrooms;
  }

  function registerMushtrees(registry: EntityRegistry, prefabId: 'mushtree', worldState: SceneWorldState) {
    const mushtrees = new MushtreeManager(scene, {
      physics: world, scheduler, scene, getWatchWorldContent: worldState.getWatchWorldContent, worldEvents,
      dropLoot: (items, position) => {
        void Managers['ground_item'].flingLoot(items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })), position)
          .catch((error: unknown) => console.error('Unable to drop mushtree loot', error));
      },
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (id, record) => mushtrees.spawn(id, new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: record.components,
      }),
      debugSpawn: id => mushtrees.spawn(id, player.position.clone()),
      exportRecords: () => mushtrees.exportRecords(),
      update: (dt, quaternion) => mushtrees.update(dt, quaternion, player.position),
      renderEntities: () => mushtrees.renderEntities,
      miniMapEntities: () => mushtrees.miniMapEntities,
      dispose: () => mushtrees.dispose(),
    });
    return mushtrees;
  }

  function registerGrottoPools(registry: EntityRegistry, prefabId: 'grotto_pool', worldState: SceneWorldState) {
    const grottoPools = new GrottoPoolManager(scene, {
      physics: world, scheduler: scheduler ?? worldState.scheduler, playerPosition: () => player.position,
      getWatchWorldContent: worldState.getWatchWorldContent, tickingarea: worldState.tickingarea, fx: Managers['world_fx'],
      prepareSpawn: (definition, fling) => Managers['ground_item'].prepareSpawn(definition, fling),
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (id, record) => grottoPools.spawn(id, new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: record.components,
      }),
      debugSpawn: id => grottoPools.spawn(id, player.position.clone()),
      exportRecords: () => grottoPools.exportRecords(),
      update: (dt, quaternion) => grottoPools.update(dt, quaternion),
      renderEntities: () => grottoPools.renderEntities,
      miniMapEntities: () => grottoPools.miniMapEntities,
      dispose: () => grottoPools.dispose(),
    });
    return grottoPools;
  }

  function registerCaveExits(registry: EntityRegistry, prefabId: 'cave_exit') {
    const caveExits = new CaveExitManager(scene, { physics: world });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_id, record) => caveExits.spawn(new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: {},
      }),
      debugSpawn: () => caveExits.spawn(player.position.clone()),
      exportRecords: () => caveExits.exportRecords(),
      update: (dt, quaternion) => caveExits.update(dt, quaternion),
      renderEntities: () => caveExits.renderEntities,
      miniMapEntities: () => caveExits.miniMapEntities,
      dispose: () => caveExits.dispose(),
    });
    return caveExits;
  }

  function registerMarbleShrubs(registry: EntityRegistry, prefabId: 'marbleshrub', _worldState: SceneWorldState) {
    const marbleShrubs = new MarbleShrubManager(scene, {
      scheduler, physics: world, getWatchWorldContent: worldState.getWatchWorldContent,
      prepareSpawn: (definition, fling) => Managers['ground_item'].prepareSpawn(definition, fling),
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => marbleShrubs.spawn(MARBLESHRUB_ID, new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform,
        components: { growable: record.components.growable!, marbleShrub: record.components.marbleShrub! },
      }),
      debugSpawn: id => marbleShrubs.spawn(id, player.position.clone()),
      exportRecords: () => marbleShrubs.exportRecords().map(record => ({ prefabId: MARBLESHRUB_ID, record })),
      update: (dt, quaternion) => marbleShrubs.update(dt, quaternion),
      renderEntities: () => marbleShrubs.renderEntities,
      miniMapEntities: () => marbleShrubs.miniMapEntities,
      dispose: () => marbleShrubs.dispose(),
    });
    return marbleShrubs;
  }

  function registerArchiveProps(registry: EntityRegistry, prefabId: 'archive_props', _worldState: SceneWorldState) {
    const archiveProps = new ArchivePropsManager(scene, {
      physics: world, cameraFacing: view.cameraFacing,
      prepareSpawn: (definition, fling) => Managers['ground_item'].prepareSpawn(definition, fling),
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (id, record) => archiveProps.spawn(id, new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: { archiveProp: record.components.archiveProp },
      }).then(model => model!),
      debugSpawn: id => archiveProps.spawn(id, player.position.clone()),
      exportRecords: () => archiveProps.exportRecords() as { prefabId: ArchivePropId; record: ReturnType<typeof archiveProps.exportRecords>[number]['record'] }[],
      update: (dt, quaternion) => archiveProps.update(dt, quaternion),
      renderEntities: () => archiveProps.renderEntities,
      miniMapEntities: () => archiveProps.miniMapEntities,
      dispose: () => archiveProps.dispose(),
    });
    return archiveProps;
  }

  function registerHoundbones(registry: EntityRegistry, prefabId: 'houndbone', _worldState: SceneWorldState) {
    const houndbones = new HoundboneManager(scene, {
      prepareSpawn: (definition, fling) => Managers['ground_item'].prepareSpawn(definition, fling),
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => houndbones.spawn(new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: { houndbone: record.components.houndbone },
      }),
      debugSpawn: () => houndbones.spawn(player.position.clone()),
      exportRecords: () => houndbones.exportRecords(),
      update: (dt, quaternion) => houndbones.update(dt, quaternion),
      renderEntities: () => houndbones.renderEntities,
      dispose: () => houndbones.dispose(),
    });
    return houndbones;
  }

  function registerSkeletons(registry: EntityRegistry, prefabId: 'skeleton', _worldState: SceneWorldState) {
    const skeletons = new SkeletonManager(scene, {
      physics: world,
      prepareSpawn: (definition, fling) => Managers['ground_item'].prepareSpawn(definition, fling),
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (id, record) => skeletons.spawn(id, new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: { skeleton: record.components.skeleton },
      }),
      debugSpawn: id => skeletons.spawn(id, player.position.clone()),
      exportRecords: () => skeletons.exportRecords() as { prefabId: SkeletonId; record: ReturnType<typeof skeletons.exportRecords>[number]['record'] }[],
      update: (dt, quaternion) => skeletons.update(dt, quaternion),
      renderEntities: () => skeletons.renderEntities,
      dispose: () => skeletons.dispose(),
    });
    return skeletons;
  }

  function registerMarbleBeanSaplings(registry: EntityRegistry, prefabId: 'marblebean_sapling', _worldState: SceneWorldState) {
    const marbleBeanSaplings = new MarbleBeanSaplingManager(scene, {
      scheduler, shrubs: Managers['marbleshrub'],
      prepareSpawn: (definition, fling) => Managers['ground_item'].prepareSpawn(definition, fling),
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => marbleBeanSaplings.spawn(new THREE.Vector3(...record.transform.position), record),
      debugSpawn: () => marbleBeanSaplings.spawn(player.position.clone()),
      exportRecords: () => marbleBeanSaplings.exportRecords().map(record => ({ prefabId: MARBLEBEAN_SAPLING_ID, record })),
      update: (dt, quaternion) => marbleBeanSaplings.update(dt, quaternion),
      renderEntities: () => marbleBeanSaplings.renderEntities,
      dispose: () => marbleBeanSaplings.dispose(),
    });
    return marbleBeanSaplings;
  }

  function registerRockAvocadoBushes(registry: EntityRegistry, prefabId: 'rock_avocado_bush', worldState: SceneWorldState) {
    const rockAvocadoBushes = new RockAvocadoBushManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
      rain: worldState.weather.preciptype,
      physics: world, getLocalTemperature: position => GetTemperatureAtXZ(() => worldState.temperature.peek(), position.x, position.z),
      prepareSpawn: (definition, fling) => Managers['ground_item'].prepareSpawn(definition, fling),
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => rockAvocadoBushes.spawn(new THREE.Vector3(...record.transform.position), record),
      debugSpawn: () => rockAvocadoBushes.spawn(player.position.clone()),
      exportRecords: () => rockAvocadoBushes.exportRecords().map(record => ({ prefabId: ROCK_AVOCADO_BUSH_ID, record })),
      update: (dt, quaternion) => rockAvocadoBushes.update(dt, quaternion),
      renderEntities: () => rockAvocadoBushes.renderEntities,
      dispose: () => rockAvocadoBushes.dispose(),
    });
    return rockAvocadoBushes;
  }

  function registerRockAvocadoSaplings(registry: EntityRegistry, prefabId: 'rock_avocado_fruit_sprout_sapling', _worldState: SceneWorldState) {
    const rockAvocadoSaplings = new RockAvocadoSaplingManager(scene, {
      scheduler, bushes: Managers['rock_avocado_bush'],
      prepareSpawn: definition => Managers['ground_item'].prepareSpawn(definition),
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => rockAvocadoSaplings.spawn(new THREE.Vector3(...record.transform.position), record),
      debugSpawn: () => rockAvocadoSaplings.spawn(player.position.clone()),
      exportRecords: () => rockAvocadoSaplings.exportRecords().map(record => ({ prefabId: ROCK_AVOCADO_SAPLING_ID, record })),
      update: (dt, quaternion) => rockAvocadoSaplings.update(dt, quaternion),
      renderEntities: () => rockAvocadoSaplings.renderEntities,
      dispose: () => rockAvocadoSaplings.dispose(),
    });
    return rockAvocadoSaplings;
  }

  function registerBerrybushes(registry: EntityRegistry, prefabId: 'berrybush', worldState: SceneWorldState) {
    const berrybushes = new BerrybushManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
      rain: worldState.weather.preciptype,
      physics: world, getLocalTemperature: position => GetTemperatureAtXZ(() => worldState.temperature.peek(), position.x, position.z),
      prepareSpawn: (definition, fling) => Managers['ground_item'].prepareSpawn(definition, fling),
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => berrybushes.spawn(new THREE.Vector3(...record.transform.position), record),
      debugSpawn: () => berrybushes.spawn(player.position.clone()),
      exportRecords: () => berrybushes.exportRecords().map(record => ({ prefabId: BERRYBUSH_ID, record })),
      update: (dt, quaternion) => berrybushes.update(dt, quaternion),
      renderEntities: () => berrybushes.renderEntities,
      dispose: () => berrybushes.dispose(),
    });
    return berrybushes;
  }

  function registerMonkeytails(registry: EntityRegistry, prefabId: 'monkeytail', worldState: SceneWorldState) {
    const monkeytails = new MonkeytailManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
      rain: worldState.weather.preciptype,
      getLocalTemperature: position => GetTemperatureAtXZ(() => worldState.temperature.peek(), position.x, position.z),
      prepareSpawn: (definition, fling) => Managers['ground_item'].prepareSpawn(definition, fling),
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => monkeytails.spawn(new THREE.Vector3(...record.transform.position), record),
      debugSpawn: () => monkeytails.spawn(player.position.clone()),
      exportRecords: () => monkeytails.exportRecords().map(record => ({ prefabId: MONKEYTAIL_ID, record })),
      update: (dt, quaternion) => monkeytails.update(dt, quaternion),
      renderEntities: () => monkeytails.renderEntities,
      dispose: () => monkeytails.dispose(),
    });
    return monkeytails;
  }

  function registerGrasses(registry: EntityRegistry, prefabId: 'grass', _worldState: SceneWorldState) {
    const grasses = new GrassManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
      prepareSpawn: (definition, fling) => Managers['ground_item'].prepareSpawn(definition, fling),
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => grasses.spawn(new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: { pickable: record.components.pickable },
      }),
      debugSpawn: () => grasses.spawn(player.position.clone()),
      exportRecords: () => grasses.exportRecords().map((record) => ({ prefabId: GRASS_ID, record })),
      update: (dt, quaternion) => grasses.update(dt, quaternion),
      renderEntities: () => grasses.renderEntities,
      dispose: () => grasses.dispose(),
    });
    return grasses;
  }

  function registerSaplings(registry: EntityRegistry, prefabId: 'sapling', _worldState: SceneWorldState) {
    const saplings = new SaplingManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
      prepareSpawn: (definition, fling) => Managers['ground_item'].prepareSpawn(definition, fling),
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (id, record) => saplings.spawn(id, new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: { pickable: record.components.pickable },
      }),
      debugSpawn: (id) => saplings.spawn(id, player.position.clone()),
      exportRecords: () => saplings.exportRecords(),
      update: (dt, quaternion) => saplings.update(dt, quaternion),
      renderEntities: () => saplings.renderEntities,
      dispose: () => saplings.dispose(),
    });
    return saplings;
  }

  function registerCaveFerns(registry: EntityRegistry, prefabId: 'cave_fern', _worldState: SceneWorldState) {
    const caveFerns = new CaveFernManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
      prepareSpawn: (definition, fling) => Managers['ground_item'].prepareSpawn(definition, fling),
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (id, record) => caveFerns.spawn(id, new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: { pickable: record.components.pickable, variant: record.components.variant },
      }),
      debugSpawn: (id) => caveFerns.spawn(id, player.position.clone()),
      exportRecords: () => caveFerns.exportRecords(),
      update: (dt, quaternion) => caveFerns.update(dt, quaternion),
      renderEntities: () => caveFerns.renderEntities,
      dispose: () => caveFerns.dispose(),
    });
    return caveFerns;
  }

  function registerLavaPonds(registry: EntityRegistry, prefabId: 'lava_pond', _worldState: SceneWorldState) {
    const lavaPonds = new LavaPondManager(scene, world, `${import.meta.env.BASE_URL}dst/data/anim`, { scheduler });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => lavaPonds.spawn(new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: { lavaPond: record.components.lavaPond },
      }),
      debugSpawn: () => lavaPonds.spawn(player.position.clone().setY(0)),
      exportRecords: () => lavaPonds.exportRecords().filter(record => record.prefabId === LAVA_POND_ID),
      update: (dt, quaternion) => lavaPonds.update(dt, quaternion),
      renderEntities: () => lavaPonds.renderEntities,
      dispose: () => lavaPonds.dispose(),
    });
    registry.register(PREFAB_DEFINITIONS.lavaPondRocks, {
      restore: (id, record) => lavaPonds.spawnRock(id, new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: {},
      }),
      debugSpawn: (id) => lavaPonds.spawnRock(id, player.position.clone().setY(0)),
      exportRecords: () => lavaPonds.exportRecords().filter(record => record.prefabId !== LAVA_POND_ID),
      // The pool family owns the shared manager's update, rendering and disposal.
      dispose: () => {},
    });
    return lavaPonds;
  }

  function registerTumbleweeds(registry: EntityRegistry, prefabId: 'tumbleweed', worldState: SceneWorldState) {
    const tumbleweeds = new TumbleweedManager(scene, world, {
      scheduler: worldState.scheduler, wind: worldWind, getWatchWorldContent: worldState.getWatchWorldContent, cameraHeading: view.cameraHeading,
      isOnValidGround: position => turfMap.isPassableAtPoint(position),
      constrainPosition: position => {
        const edge = initialSave.world.map.generator.options.size / 2 - WORLD_SCALE;
        position.x = THREE.MathUtils.clamp(position.x, -edge, edge);
        position.z = THREE.MathUtils.clamp(position.z, -edge, edge);
      },
      dropLoot: (items, position) => {
        // Prefabs this project cannot spawn yet (trinkets, creatures, blueprints) are not dropped.
        const counts = new Map<string, number>();
        for (const itemId of items) if (Object.hasOwn(SAVE_CATALOG.items, itemId)) counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
        if (counts.size === 0) return;
        void Managers['ground_item'].flingLoot([...counts].map(([itemId, count]) => ({ ...SAVE_CATALOG.items[itemId], itemId, count })), position)
          .catch((error: unknown) => console.error('Unable to drop tumbleweed loot', error));
      },
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => tumbleweeds.spawn(new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: {},
      }),
      debugSpawn: () => tumbleweeds.spawn(player.position.clone().setY(0)),
      exportRecords: () => tumbleweeds.exportRecords().map(record => ({ prefabId: TUMBLEWEED_ID, record })),
      beforePhysics: dt => tumbleweeds.beforePhysics(dt),
      update: (_, quaternion) => tumbleweeds.sync(quaternion),
      renderEntities: () => tumbleweeds.renderEntities,
      dispose: () => tumbleweeds.dispose(),
    });
    return tumbleweeds;
  }

  function registerHotsprings(registry: EntityRegistry, prefabId: 'hotspring', worldState: SceneWorldState) {
    const hotsprings = new HotspringManager(scene, world, `${import.meta.env.BASE_URL}dst/data/anim`, worldState.tickingarea, { scheduler });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => hotsprings.spawn(new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: { hotspring: record.components.hotspring },
      }),
      debugSpawn: () => hotsprings.spawn(player.position.clone().setY(0)),
      exportRecords: () => hotsprings.exportRecords(),
      update: (dt, quaternion) => hotsprings.update(dt, quaternion),
      renderEntities: () => hotsprings.renderEntities,
      dispose: () => hotsprings.dispose(),
    });
    return hotsprings;
  }

  function registerWormholes(registry: EntityRegistry, prefabId: 'wormhole', _worldState: SceneWorldState) {
    const wormholes = new WormholeManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, () => [player.position]);
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => wormholes.spawn(new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: { wormhole: record.components.wormhole },
      }),
      debugSpawn: () => wormholes.spawn(player.position.clone()),
      exportRecords: () => wormholes.exportRecords().map((record) => ({ prefabId: WORMHOLE_ID, record })),
      update: (dt, quaternion) => wormholes.update(dt, quaternion),
      renderEntities: () => wormholes.renderEntities,
      dispose: () => wormholes.dispose(),
    });
    return wormholes;
  }

  function registerPortals(registry: EntityRegistry, prefabId: 'multiplayer_portal_moonrock', worldState: SceneWorldState) {
    const portals = new PortalManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`,
      { scheduler: worldState.scheduler, portalRez: worldState.portalRez });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => portals.spawn(new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: {},
      }),
      debugSpawn: () => portals.spawn(player.position.clone()),
      exportRecords: () => portals.exportRecords().map((record) => ({ prefabId: PORTAL_ID, record })),
      update: (dt, quaternion) => portals.update(dt, quaternion),
      renderEntities: () => portals.renderEntities,
      miniMapEntities: () => portals.miniMapEntities,
      dispose: () => portals.dispose(),
    });
    return portals;
  }

  function registerNightmareGrowths(registry: EntityRegistry, prefabId: 'nightmaregrowth', _worldState: SceneWorldState) {
    const nightmareGrowths = new NightmareGrowthManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`);
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => nightmareGrowths.spawn(new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: { nightmareGrowth: record.components.nightmareGrowth! },
      }),
      debugSpawn: () => nightmareGrowths.spawn(player.position.clone()),
      exportRecords: () => nightmareGrowths.exportRecords().map((record) => ({ prefabId: NIGHTMAREGROWTH_ID, record })),
      update: (_, quaternion) => nightmareGrowths.update(quaternion),
      renderEntities: () => nightmareGrowths.renderEntities,
      dispose: () => nightmareGrowths.dispose(),
    });
    return nightmareGrowths;
  }

  function registerBeefalos(registry: EntityRegistry, prefabId: 'beefalo', worldState: SceneWorldState) {
    const beefalos = new BeefaloManager(scene, world, `${import.meta.env.BASE_URL}dst/data/anim`, {
      scheduler,
      // The scheduler runs on world seconds (src/scene.ts), so the next boundary is the next multiple of the day length.
      secondsUntilNextDay: now => TUNING.TOTAL_DAY_TIME - now % TUNING.TOTAL_DAY_TIME,
      clock: worldState.clock,
      getWatchWorldContent: worldState.getWatchWorldContent,
      season: worldState.season,
      getPlayerPositions: () => [player.position],
      findPath(start, target) {
        const radius = BEEFALO_BEHAVIOR.radius;
        const edge = initialSave.world.map.generator.options.size / 2 - radius;
        const obstacles = world.bodies.filter((body) => body.type === CANNON.Body.STATIC && body.collisionResponse
          && body.shapes.some((shape) => shape instanceof CANNON.Box || shape instanceof CANNON.Sphere))
          .map((body) => { body.updateAABB(); return body.aabb; });
        return findGroundPath(start, target, { cellSize: radius,
          isWalkable: (point) => Math.abs(point.x) <= edge && Math.abs(point.z) <= edge
            && turfMap.isPassableAtPoint(point)
            && !obstacles.some((box) => point.x >= box.lowerBound.x - radius && point.x <= box.upperBound.x + radius
              && point.z >= box.lowerBound.z - radius && point.z <= box.upperBound.z + radius),
        });
      },
      constrainPosition(position) {
        const edge = initialSave.world.map.generator.options.size / 2 - BEEFALO_BEHAVIOR.radius;
        position.x = THREE.MathUtils.clamp(position.x, -edge, edge);
        position.z = THREE.MathUtils.clamp(position.z, -edge, edge);
      },
      spawnPrize(prefab, count, position) {
        void Managers['ground_item'].flingLoot([{ ...SAVE_CATALOG.items[prefab], itemId: prefab, count }], position)
          .catch((error: unknown) => console.error(`Unable to spawn beefalo ${prefab}`, error));
      },
      getPoopPositions() {
        return Managers['ground_item'].iteratePrefabPositions('poop');
      },
      spawnPoop(position) {
        void Managers['ground_item'].spawnFromSave(newEntityId(), {
          ...SAVE_CATALOG.items.poop, itemId: 'poop', count: 1,
        }, position).catch((error: unknown) => console.error('Unable to spawn beefalo manure', error));
      },
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => beefalos.spawn(new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: { beefalo: record.components.beefalo! },
      }),
      debugSpawn: () => beefalos.spawnNear(player.position),
      exportRecords: () => beefalos.exportRecords().map((record) => ({ prefabId: 'beefalo', record })),
      beforePhysics: (dt) => beefalos.update(dt),
      update: (_, quaternion) => beefalos.sync(quaternion),
      renderEntities: () => beefalos.renderEntities,
      dispose: () => beefalos.dispose(),
    });
    return beefalos;
  }

  async function registerEvergreens(registry: EntityRegistry, prefabId: 'evergreen', worldState: SceneWorldState) {
    const evergreenForest = await createEvergreenForest(`${import.meta.env.BASE_URL}dst/data/anim`, {
      camera, scene, scheduler, physics: world, worldEvents,
      growthDuration: seconds => seconds * (worldState.season.peek().season === 'spring' ? .75 : 1),
      dropLoot: (items, position) => {
        void Managers['ground_item'].flingLoot(items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })), position)
          .catch((error: unknown) => console.error('Unable to drop evergreen loot', error));
      },
    });
    scene.add(evergreenForest.group);
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => evergreenForest.spawn('evergreen', new THREE.Vector3(...record.transform.position),
        { ...record, components: { ...record.components, growable: record.components.growable! } }),
      debugSpawn: async prefab => { evergreenForest.spawn(prefab as EvergreenSpawnId, new THREE.Vector3(player.position.x, 0, player.position.z)); },
      exportRecords: () => evergreenForest.exportRecords().map(record => ({ prefabId: 'evergreen', record })),
      update: (dt, quaternion) => { evergreenForest.updateNearby(player.position); evergreenForest.update(dt, quaternion); },
      renderEntities: () => evergreenForest.renderEntities,
      dispose: () => evergreenForest.dispose(),
    });
    return evergreenForest;
  }

  async function registerDeciduousTrees(registry: EntityRegistry, prefabId: 'deciduoustree', worldState: SceneWorldState) {
    const deciduousForest = await createDeciduousForest(`${import.meta.env.BASE_URL}dst/data/anim`, {
      camera, scene, scheduler, physics: world, season: worldState.season, worldEvents,
      secondsUntilNextDay: now => TUNING.TOTAL_DAY_TIME - now % TUNING.TOTAL_DAY_TIME,
      growthDuration: seconds => seconds * (worldState.season.peek().season === 'spring' ? .75 : 1),
      dropLoot: (items, position) => {
        void Managers['ground_item'].flingLoot(items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })), position)
          .catch((error: unknown) => console.error('Unable to drop deciduous tree loot', error));
      },
    });
    scene.add(deciduousForest.group);
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => deciduousForest.spawn('deciduoustree', new THREE.Vector3(...record.transform.position),
        { ...record, components: { deciduoustree: record.components.deciduoustree!, growable: record.components.growable! } }),
      debugSpawn: async prefab => { deciduousForest.spawn(prefab as DeciduousSpawnId, new THREE.Vector3(player.position.x, 0, player.position.z)); },
      exportRecords: () => deciduousForest.exportRecords().map(record => ({ prefabId: 'deciduoustree', record })),
      update: (dt, quaternion) => { deciduousForest.updateNearby(player.position); deciduousForest.update(dt, quaternion); },
      renderEntities: () => deciduousForest.renderEntities,
      dispose: () => deciduousForest.dispose(),
    });
    return deciduousForest;
  }

  function registerFarmPlow(registry: EntityRegistry, prefabId: 'farm_plow', _worldState: SceneWorldState) {
    const farmPlow = new FarmPlowPlacement(view, turfMap,
      async (position, item) => { await Managers['ground_item'].spawnFromSave(item.entityId ?? newEntityId(), {
        ...SAVE_CATALOG.items[item.itemId], ...item,
      }, position); },
    );
    farmPlow.setDebrisLootHandler((itemId, position) => Managers['ground_item'].flingLoot([
      { ...SAVE_CATALOG.items[itemId], itemId, count: 1 },
    ], position));
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => farmPlow.spawn(new THREE.Vector3(...record.transform.position), {
        id: record.id, state: record.components.farmPlow!,
      }),
      debugSpawn: () => farmPlow.spawn(player.position.clone()),
      exportRecords: () => farmPlow.exportRecords().map((record) => ({ prefabId: FARM_PLOW_ID, record })),
      update: (dt, quaternion) => farmPlow.update(dt, quaternion),
      renderEntities: () => farmPlow.renderEntities,
      dispose: () => farmPlow.dispose(),
    });
    registry.register(PREFAB_DEFINITIONS.farmDecor, {
      restore: (id, record) => farmPlow.spawnDecor(id, new THREE.Vector3(...record.transform.position),
        id === 'farm_soil' ? record.components.farmSoil : record.components.farmDebris, undefined, record.id),
      debugSpawn: (id) => farmPlow.spawnDecor(id, player.position.clone()),
      exportRecords: () => farmPlow.exportDecorRecords(), dispose: () => {},
    });
    registry.register(PREFAB_DEFINITIONS.plantedSeeds, {
      restore: (id, record) => farmPlow.spawnPlantedSeed(new THREE.Vector3(...record.transform.position), record.id, id),
      debugSpawn: (id) => farmPlow.spawnPlantedSeed(player.position.clone(), undefined, id),
      exportRecords: () => farmPlow.exportPlantedSeedRecords(), dispose: () => {},
    });
    return farmPlow;
  }

  function registerDockKit(registry: EntityRegistry, prefabId: 'dock_kit', _worldState: SceneWorldState) {
    // Docks stand in the water: any registered entity there blocks, trees and grass included.
    const dockKit = new DockKitPlacement(view, turfMap);
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      exportRecords: () => [],
      update: () => dockKit.update(),
      renderEntities: () => dockKit.renderEntities,
      dispose: () => dockKit.dispose(),
    });
    return dockKit;
  }

  function registerMoonTrees(registry: EntityRegistry, prefabId: 'moon_tree', worldState: SceneWorldState) {
    scene.add(moonTreeForest.group);
    const treesById = new Map(moonTreeForest.entities.map((entity) => [entity.saveId!, entity]));
    const unbindTrees = moonTreeForest.bindWorld({
      camera,
      scene,
      scheduler,
      season: worldState.season,
      worldEvents,
      growthDuration: seconds => seconds * (worldState.season.peek().season === 'spring' ? .75 : 1),
      dropLoot: (items, position) => {
        void Managers['ground_item'].flingLoot(items.map((item) => ({ ...SAVE_CATALOG.items[item.itemId], ...item })), position)
          .catch((error: unknown) => console.error('Unable to drop tree loot', error));
      },
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => {
        const tree = treesById.get(record.id);
        if (!tree) throw new Error(`Missing logical tree: ${record.id}`);
        moonTreeForest.restoreState(record.id, record.components.moonTree, record.components.growable);
        return tree;
      },
      debugSpawn: async id => {
        moonTreeForest.spawnTree(id as 'moon_tree' | 'moon_tree_short' | 'moon_tree_normal' | 'moon_tree_tall',
          new THREE.Vector3(player.position.x, 0, player.position.z));
      },
      exportRecords: () => moonTreeForest.entities.map((entity) => ({ prefabId: 'moon_tree', record: {
        id: entity.saveId!, transform: { position: entity.position.toArray(), rotationY: 0 },
        components: moonTreeForest.exportState(entity),
      } })),
      update: (dt, quaternion) => {
        moonTreeForest.updateNearby(player.position);
        moonTreeForest.update(dt);
        moonTreeForest.setNormals(quaternion);
      },
      renderEntities: () => moonTreeForest.renderEntities,
      dispose: () => { unbindTrees(); moonTreeForest.dispose(); },
    });
    registry.register(PREFAB_DEFINITIONS.moonTreeSaplings, {
      restore: (_, record) => moonTreeForest.spawnSapling(new THREE.Vector3(...record.transform.position),
        { ...record, components: { saplingTimer: record.components.saplingTimer! } }),
      debugSpawn: async () => { moonTreeForest.spawnSapling(new THREE.Vector3(player.position.x, 0, player.position.z)); },
      exportRecords: () => moonTreeForest.exportSaplings().map(record => ({ prefabId: 'moonbutterfly_sapling', record })),
      dispose() {},
    });
    return moonTreeForest;
  }

  function registerPigKings(registry: EntityRegistry, prefabId: 'pigking', worldState: SceneWorldState) {
    const kingsById = new Map(pigKings.map((king) => [king.record.id, king]));
    pigKings.forEach((king) => {
      world.addBody(king.body);
      scene.add(king.standee);
      // default_pigking.lua BG_TILES: the layout's grass and woodfloor tiles around the king.
      for (const { tile, position } of placeStaticLayout('default_pigking', king.feet, 'pigking').tiles) {
        turfMap.setOriginalTile(position, WORLD_TILES[tile]);
      }
      king.bind({
        camera, scheduler, isNight: worldState.isNight,
        dropLoot: (items, position, launch) => {
          void Managers['ground_item'].flingLoot(items.map((item) => ({ ...SAVE_CATALOG.items[item.itemId], ...item })), position, launch)
            .catch((error: unknown) => console.error('Unable to drop pig king gold', error));
        },
      });
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => {
        const king = kingsById.get(record.id);
        if (!king) throw new Error(`Missing pig king: ${record.id}`);
        return king.standee;
      },
      exportRecords: () => pigKings.map((king) => ({ prefabId: 'pigking', record: {
        id: king.record.id,
        transform: { position: [king.standee.position.x, 0, king.standee.position.z] as const, rotationY: 0 }, components: {},
      } })),
      beforePhysics: (dt) => pigKings.forEach((king) => king.update(dt)),
      update: (_, quaternion) => pigKings.forEach((king) => king.setNormal(quaternion)),
      renderEntities: () => pigKings.map((king) => ({
        object: king.standee, footPosition: king.feet, cameraDepth: 0,
      })),
      miniMapEntities: () => pigKings.map(king => king.MiniMapEntity),
      dispose: () => {
        for (const king of pigKings) { king.dispose(); world.removeBody(king.body); disposeSprite(king.standee); }
      },
    });
    return pigKings;
  }

  function registerNightmareRocks(registry: EntityRegistry, prefabId: 'sanityrock', _worldState: SceneWorldState) {
    const nightmareRocks = new NightmareRockManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
      scheduler, physics: world, fx: Managers['world_fx'],
      // AllPlayers: the local player, once its sanity component is attached.
      getPlayers: () => player.userData.components?.sanity
        ? [{ position: player.position, sanity: player.userData.components.sanity }] : [],
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (id, record) => nightmareRocks.spawn(id, new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: {},
      }),
      debugSpawn: (id) => nightmareRocks.spawn(id, player.position.clone()),
      exportRecords: () => nightmareRocks.exportRecords(),
      update: (dt, quaternion) => nightmareRocks.update(dt, quaternion),
      renderEntities: () => nightmareRocks.renderEntities,
      dispose: () => nightmareRocks.dispose(),
    });
    return nightmareRocks;
  }

  function registerRain(registry: EntityRegistry, prefabId: 'rain', worldState: SceneWorldState) {
    const rain = new RainEffect({
      scene, dataBaseUrl: `${import.meta.env.BASE_URL}dst/data`, animationBaseUrl: `${import.meta.env.BASE_URL}dst/data/anim`,
      getFocus: () => player.position, camera, rate: worldState.weather.rainRate,
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      exportRecords: () => [],
      update: (dt, quaternion) => rain.update(dt, quaternion),
      renderEntities: () => rain.renderEntities,
      dispose: () => rain.dispose(),
    });
    return rain;
  }

  function registerSnow(registry: EntityRegistry, prefabId: 'snow', worldState: SceneWorldState) {
    const snow = new SnowEffect({
      scene, dataBaseUrl: `${import.meta.env.BASE_URL}dst/data`,
      getFocus: () => player.position, camera, rate: worldState.weather.snowRate, cover: worldState.weather.snowCover,
      groundSize: initialSave.world.map.generator.options.size,
      groundOverlay: turfMap,
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      exportRecords: () => [],
      update: (dt, quaternion) => snow.update(dt, quaternion),
      dispose: () => snow.dispose(),
    });
    return snow;
  }

  async function registerOceanWaves(registry: EntityRegistry, prefabId: 'ocean_waves', worldState: SceneWorldState) {
    // The only ocean tile is OCEAN_COASTAL; INVALID (outside the map) is neither land nor water.
    const waveMap: WaveMap = {
      tileSize: TILE_SIZE,
      tileAt: (x, z) => turfMap.getTileAtWorld({ x, z }),
      isLandTile,
      isOceanTile: tile => tile === WORLD_TILES.OCEAN_COASTAL,
    };
    const oceanWaves = new OceanWaves(scene, waveMap, WORLD_SCALE, worldState.tickingarea);
    await oceanWaves.prepare();
    const waveManager = new WaveManager({
      map: waveMap, spawner: oceanWaves, scale: WORLD_SCALE,
      tiles: new Map([[WORLD_TILES.OCEAN_COASTAL, 'shore']]),
      cameraDistance: () => followCamera.getDistance() / WORLD_SCALE,
      playerPosition: () => player.position,
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      exportRecords: () => [],
      update: (dt, quaternion) => { waveManager.OnUpdate(dt); oceanWaves.update(dt, quaternion); },
      dispose: () => oceanWaves.dispose(),
    });
    return oceanWaves;
  }

  function registerStaffLights(registry: EntityRegistry, prefabId: typeof DWARF_STAR_ID | typeof POLAR_LIGHT_ID, _worldState: SceneWorldState) {
    const lights = new DwarfStarManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, prefabId, () => player.position);
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => lights.spawn(new THREE.Vector3(...record.transform.position), {
        id: record.id, remainingSeconds: record.components.timer!.remainingSeconds,
      }),
      debugSpawn: () => lights.spawn(player.position.clone()),
      exportRecords: () => lights.exportRecords().map((record) => ({ prefabId, record })),
      update: (dt, quaternion) => lights.update(dt, quaternion),
      renderEntities: () => lights.renderEntities,
      dispose: () => lights.dispose(),
    });
    return lights;
  }

  function registerPonds(registry: EntityRegistry, prefabId: 'pond', worldState: SceneWorldState) {
    const ponds = new PondManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, scheduler ?? worldState.scheduler, worldState.getWatchWorldContent);
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => ponds.spawn(new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: record.components.fishable ? { fishable: record.components.fishable } : {},
      }),
      debugSpawn: () => ponds.spawn(player.position.clone()),
      exportRecords: () => ponds.exportRecords().map((record) => ({ prefabId: POND_ID, record })),
      update: (dt) => ponds.update(dt),
      // Ponds are ground layers, below the foot-sorted billboards.
      dispose: () => ponds.dispose(),
    });
    return ponds;
  }
}
