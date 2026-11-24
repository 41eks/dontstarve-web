import { stalagmiteRegistration } from '@dontstarve-web/prefab/stalagmite';
import { ruinsRelicRegistration } from '@dontstarve-web/prefab/ruinsrelic';
import { LIGHTFLIER_FLOWER_ID, lightflierFlowerRegistration } from '@dontstarve-web/prefab/lightflier_flower';
import { LightFlierHabitat } from '../packages/prefab/src/lightflier';
import { MAX_PHYSICS_FRAME_TIME } from './physicsTiming';
import { createMoleHabitat, molehillRegistration, MolehillInstance } from '../packages/prefab/src/molehill';
import { TUNING } from './tuning';
import { DynamicMusic } from '../packages/componets/src/dynamicmusic';
import { RopeBridgeManager } from '../packages/componets/src/ropebridgemanager';
import { GetTemperatureAtXZ } from '../packages/componets/src/temperatureoverrider';
import { PlaySound } from '@dontstarve-web/prefab/sound';
import {
  type InventoryStack,
  type InventoryStore,
  ItemEntity,
  type ItemEntityFactory,
} from '@dontstarve-web/inventory';
import type { ReadonlyVector3 } from '@dontstarve-web/animation/transformRoot';
import * as CANNON from 'cannon-es';
import { getRegisteredPhysicsBodies } from '../packages/componets/src/physicsWorld';
import * as THREE from 'three';
import { EventEmitter } from '@dontstarve-web/signals';
import type { WorldEvents } from '../packages/prefab/src/worldContext';

import { groundDisplay, pathfinder, turfMap } from './building';
import { moonTreeRegistration } from '@dontstarve-web/prefab/moontree';
import { WORLD_TILES, isLandTile } from '@dontstarve-web/prefab/turfMap';
import { camera, followCamera } from './camera';
import { flingLoot, spawnGroundStack } from '@dontstarve-web/prefab/itemPrefabs';
import { turfItemForTile } from '@dontstarve-web/prefab/turfs';
import {
  GROUND_ART_DEFINITIONS,
  GROUND_ITEM_DISPLAY_SPECS,
  GroundItemAssets,
} from '@dontstarve-web/prefab/groundItems';
import { farmRegistration } from '@dontstarve-web/prefab/farm_plow';
import { createFarmMap } from '@dontstarve-web/prefab/farmMap';
import { playerStats } from './playerStats';
import { SpriteResources } from '@dontstarve-web/display';
import { staffCastingLightRegistration } from '@dontstarve-web/prefab/staff_castinglight';
import { staffLightRegistration } from '@dontstarve-web/prefab/stafflight';
import { bulbPlantRegistration } from '@dontstarve-web/prefab/bulb_plant';
import { moonglassRockRegistration, rockRegistration } from '@dontstarve-web/prefab/rocks';
import { caveinBoulderRegistration } from '@dontstarve-web/prefab/cavein_boulder';
import { moonrockseedRegistration } from '@dontstarve-web/prefab/moonrockseed';
import type {
  GroundItemDefinition,
  GroundSpawnOptions,
  ItemPrefabWorld,
  SpawnGroundItem,
} from '@dontstarve-web/prefab/groundPrefab';
import { caveHoleRegistration } from '@dontstarve-web/prefab/cave_hole';
import { pillarRegistration } from '@dontstarve-web/prefab/pillar';
import { atriumPillarRegistration } from '@dontstarve-web/prefab/atrium_pillar';
import { moonFissureRegistration } from '@dontstarve-web/prefab/moon_fissure';
import { watertreePillarRegistration } from '@dontstarve-web/prefab/watertree_pillar';
import { oceanTreeRegistration } from '@dontstarve-web/prefab/oceantree';
import { oceanTreePillarRegistration } from '@dontstarve-web/prefab/oceantree_pillar';
import { oceanVineRegistration } from '@dontstarve-web/prefab/oceanvine';
import { reedsRegistration } from '@dontstarve-web/prefab/reeds';
import { ROPE_BRIDGE_FX_ID, RopeBridgeFxInstance, ropeBridgePrefabs } from '@dontstarve-web/prefab/rope_bridge';
import { mastMalbatrossRegistration } from '@dontstarve-web/prefab/mast_malbatross';
import { supportPillarRegistration } from '@dontstarve-web/prefab/support_pillar';
import { oasislakeRegistration } from '@dontstarve-web/prefab/oasislake';
import { beehiveRegistration } from '@dontstarve-web/prefab/beehive';
import { shadowForgeRegistration } from '@dontstarve-web/prefab/shadow_forge';
import { spiderdenRegistration } from '@dontstarve-web/prefab/spiderden';
import { seastackRegistration } from '@dontstarve-web/prefab/seastack';
import { wasphiveRegistration } from '@dontstarve-web/prefab/wasphive';
import { oceanVineDecoRegistration } from '@dontstarve-web/prefab/oceanvine_deco';
import { archivePillarRegistration } from '@dontstarve-web/prefab/archive_pillar';
import { vaultPillarRegistration } from '@dontstarve-web/prefab/vault_pillar';
import { monkeyPillarRegistration } from '@dontstarve-web/prefab/monkeypillar';
import { staffProjectileRegistration } from '@dontstarve-web/prefab/staff_projectile';
import { caveEntranceRegistration, CAVES_SHARD } from '@dontstarve-web/prefab/cave_entrance';
import { caveExitRegistration, MASTER_SHARD } from '@dontstarve-web/prefab/cave_exit';
import type { WorldMigratorShard } from '../packages/componets/src/worldmigrator';
import { grottoPoolRegistration } from '@dontstarve-web/prefab/grotto_pool';
import { mushroomPlantRegistration } from '@dontstarve-web/prefab/mushroom_plant';
import { mushtreeRegistration } from '@dontstarve-web/prefab/mushtree';
import { marbleShrubRegistration, MarbleShrubInstance } from '@dontstarve-web/prefab/marbleshrub';
import { archivePropsRegistration } from '@dontstarve-web/prefab/archive_props';
import { houndboneRegistration } from '@dontstarve-web/prefab/houndbone';
import { beeQueenHiveRegistration } from '@dontstarve-web/prefab/beequeenhivegrown';
import { dragonflyRegistration, DRAGONFLY_ID } from '@dontstarve-web/prefab/dragonfly';
import { dragonflySpawnerRegistration } from '@dontstarve-web/prefab/dragonfly_spawner';
import { skeletonRegistration } from '@dontstarve-web/prefab/skeleton';
import { marbleBeanSaplingRegistration } from '@dontstarve-web/prefab/marblebean_sapling';
import { rockAvocadoSaplingRegistration } from '@dontstarve-web/prefab/rock_avocado_fruit_sprout_sapling';
import { rockAvocadoBushRegistration } from '@dontstarve-web/prefab/rock_avocado_bush';
import { berrybushRegistration } from '@dontstarve-web/prefab/berrybush';
import { monkeytailRegistration } from '@dontstarve-web/prefab/monkeytail';
import { grassRegistration } from '@dontstarve-web/prefab/grass';
import { caveFernRegistration } from '@dontstarve-web/prefab/cave_fern';
import { lichenRegistration } from '@dontstarve-web/prefab/lichen';
import { cactusRegistration } from '@dontstarve-web/prefab/cactus';
import type { GameTimeScheduler } from '@dontstarve-web/prefab/gameTimeScheduler';
import { tumbleweedRegistration } from '@dontstarve-web/prefab/tumbleweed';
import { saplingRegistration } from '@dontstarve-web/prefab/sapling';
import { pondRegistration } from '@dontstarve-web/prefab/pond';
import { marshPlantRegistration } from '@dontstarve-web/prefab/marsh_plant';
import { FireFxHost } from '@dontstarve-web/prefab/treeFire';
import { hotspringRegistration } from '@dontstarve-web/prefab/hotspring';
import { lavaPondRegistration } from '@dontstarve-web/prefab/lava_pond';
import { wormholeRegistration } from '@dontstarve-web/prefab/wormhole';
import { portalRegistration } from '@dontstarve-web/prefab/portal';
import { nightmareGrowthRegistration, NightmareGrowthCrackInstance } from '@dontstarve-web/prefab/nightmaregrowth';
import { stagehandRegistration } from '@dontstarve-web/prefab/stagehand';
import { nightmareRockRegistration } from '@dontstarve-web/prefab/nightmarerock';
import { pigKingRegistration } from '@dontstarve-web/prefab/pigking';
import { BERNIE_ITEM_ID, bernieRegistration, type BernieWorld } from '@dontstarve-web/prefab/bernie';
import { statueGlommerRegistration } from '@dontstarve-web/prefab/statueglommer';
import { atriumGateRegistration } from '@dontstarve-web/prefab/atrium_gate';
import { ruinsStatueRegistration } from '@dontstarve-web/prefab/ruins_statue_mage';
import { atriumStatueRegistration } from '@dontstarve-web/prefab/atrium_statue';
import { atriumOvergrowthRegistration } from '@dontstarve-web/prefab/atrium_overgrowth';
import { chessJunkRegistration } from '@dontstarve-web/prefab/chessjunk';
import { chesspieceRegistration } from '@dontstarve-web/prefab/chesspieces';
import { archiveCentipedeHuskRegistration } from '@dontstarve-web/prefab/archive_centipede';
import {
  BEEFALO_BEHAVIOR,
  beefaloRegistration,
  findBeefaloSpawnPoint,
  type BeefaloWorld,
} from '@dontstarve-web/prefab/beefalo';
import {
  LIGHTNING_GOAT_RADIUS,
  lightningGoatRegistration,
  type LightningGoatWorld,
} from '@dontstarve-web/prefab/lightninggoat';
import type { LootLaunch } from '../packages/componets/src/inventoryphysics';

/** Where SpawnPrefab makes an inst before it is set down or given to its holder. */
import { player, playerInstance } from './player';
import { PlaceableBuildingPlacement, type PlaceableBuildingInteractionChange } from './placeableBuilding';
import { dstLighting, scene } from './universal';
import { PREFAB_BASE_URL, prefabDisplays, prefabs } from './prefabWorld';
import { flowerRegistration } from '@dontstarve-web/prefab/flower';
import { view } from './view';
import { initialSave, shardSaveSearch } from './save/initialSave';
import { ReskinEffects } from '@dontstarve-web/prefab/reskin_tool';
import { RainEffect } from '@dontstarve-web/prefab/rain';
import { SnowEffect } from '@dontstarve-web/prefab/snow';
import { worldFxRegistration, worldFxSpawner } from '@dontstarve-web/prefab/world_fx';
import { OceanWaves } from '@dontstarve-web/prefab/ocean_waves';
import { WaveManager, type WaveMap } from '../packages/componets/src/wavemanager';
import { WORLD_SCALE } from '../packages/prefab/src/standardcomponents';
import { TILE_SIZE } from '../packages/prefab/src/tile';
import { SAVE_CATALOG } from './save/catalog';
import { staticObstacleTest } from '@dontstarve-web/prefab/locomotor';
import { deciduousRegistration } from '@dontstarve-web/prefab/deciduoustrees';
import { livingTreeRegistration } from '@dontstarve-web/prefab/livingtree';
import { evergreenRegistration } from '@dontstarve-web/prefab/evergreens';

import { EntityRegistry } from './entityRegistry';
import { ITEM_PREFAB_REGISTRATION, PREFAB_DEFINITIONS, type PrefabDefinition } from './prefabDefinitions';
import type { PrefabRegistration } from '@dontstarve-web/prefab/prefabRegistration';
import type { WorldState } from './worldState';

type SceneWorldState = Pick<
  WorldState,
  | 'clock'
  | 'season'
  | 'isNight'
  | 'cycle'
  | 'getWatchWorldContent'
  | 'tickingarea'
  | 'worldwind'
  | 'scheduler'
  | 'portalRez'
  | 'componentUpdates'
  | 'temperature'
  | 'weather'
  | 'perishClock'
  | 'soundPresentation'
>;

// Keep frame callbacks and reverse disposal in their existing order, independently of construction dependencies.
const SCENE_LIFECYCLE_ORDER = [
  PREFAB_DEFINITIONS.farmPlow,
  PREFAB_DEFINITIONS.farmDecor,
  PREFAB_DEFINITIONS.plantedSeeds,
  PREFAB_DEFINITIONS.moonTrees,
  PREFAB_DEFINITIONS.moonTreeSaplings,
  PREFAB_DEFINITIONS.evergreens,
  PREFAB_DEFINITIONS.livingtree,
  PREFAB_DEFINITIONS.deciduousTrees,
  PREFAB_DEFINITIONS.pigKings,
  PREFAB_DEFINITIONS.glommerStatues,
  PREFAB_DEFINITIONS.moonFissures,
  PREFAB_DEFINITIONS.watertreePillars,
  PREFAB_DEFINITIONS.oceanTrees,
  PREFAB_DEFINITIONS.oceanTreePillars,
  PREFAB_DEFINITIONS.oceanVines,
  PREFAB_DEFINITIONS.reeds,
  PREFAB_DEFINITIONS.mastMalbatross,
  PREFAB_DEFINITIONS.supportPillars,
  PREFAB_DEFINITIONS.oasislakes,
  PREFAB_DEFINITIONS.beehives,
  PREFAB_DEFINITIONS.shadowForges,
  PREFAB_DEFINITIONS.spiderDens,
  PREFAB_DEFINITIONS.seastacks,
  PREFAB_DEFINITIONS.wasphives,
  PREFAB_DEFINITIONS.oceanVineDecos,
  PREFAB_DEFINITIONS.atriumGates,
  PREFAB_DEFINITIONS.ruinsStatueMages,
  PREFAB_DEFINITIONS.ruinsStatueMagesNoGem,
  PREFAB_DEFINITIONS.ruinsStatueHeads,
  PREFAB_DEFINITIONS.ruinsStatueHeadsNoGem,
  PREFAB_DEFINITIONS.atriumStatues,
  PREFAB_DEFINITIONS.atriumOvergrowths,
  PREFAB_DEFINITIONS.buildings,
  PREFAB_DEFINITIONS.lightflierFlowers,
  PREFAB_DEFINITIONS.groundItems,
  PREFAB_DEFINITIONS.flowers,
  PREFAB_DEFINITIONS.staffLights,
  PREFAB_DEFINITIONS.staffCastingLights,
  PREFAB_DEFINITIONS.bulbPlants,
  PREFAB_DEFINITIONS.molehills,
  PREFAB_DEFINITIONS.beefalos,
  PREFAB_DEFINITIONS.lightningGoats,
  PREFAB_DEFINITIONS.stalagmites,
  PREFAB_DEFINITIONS.rocks,
  PREFAB_DEFINITIONS.caveinBoulders,
  PREFAB_DEFINITIONS.moonrockSeeds,
  PREFAB_DEFINITIONS.moonglassRocks,
  PREFAB_DEFINITIONS.caveHoles,
  PREFAB_DEFINITIONS.pillarRuins,
  PREFAB_DEFINITIONS.cavePillars,
  PREFAB_DEFINITIONS.atriumPillars,
  PREFAB_DEFINITIONS.archivePillars,
  PREFAB_DEFINITIONS.vaultPillars,
  PREFAB_DEFINITIONS.monkeyPillars,
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
  PREFAB_DEFINITIONS.beeQueenHives,
  PREFAB_DEFINITIONS.dragonflies,
  PREFAB_DEFINITIONS.dragonflySpawners,
  PREFAB_DEFINITIONS.rockAvocadoSaplings,
  PREFAB_DEFINITIONS.rockAvocadoBushes,
  PREFAB_DEFINITIONS.berrybushes,
  PREFAB_DEFINITIONS.monkeytails,
  PREFAB_DEFINITIONS.grasses,
  PREFAB_DEFINITIONS.saplings,
  PREFAB_DEFINITIONS.caveFerns,
  PREFAB_DEFINITIONS.lichens,
  PREFAB_DEFINITIONS.ponds,
  PREFAB_DEFINITIONS.marshPlants,
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
  PREFAB_DEFINITIONS.rain,
  PREFAB_DEFINITIONS.snow,
  PREFAB_DEFINITIONS.oceanWaves,
];

export async function createSceneEntities(
  world: CANNON.World,
  worldState: SceneWorldState,
  onBuildingInteraction: ((change: PlaceableBuildingInteractionChange) => void) | undefined,
  inventory: InventoryStore,
  scheduler?: GameTimeScheduler,
) {
  const prefabBaseUrl = PREFAB_BASE_URL;
  const prefabFire = FireFxHost.create(prefabBaseUrl, worldState.componentUpdates);
  // Shared by the ground Bernie item and the bernie_active / bernie_big prefabs, built on first use.
  let bernieWorldInstance: BernieWorld | undefined;
  let itemWorldInstance: ItemPrefabWorld | undefined;
  /** The art of the effects items spawn as their children (fire, flies). */
  const itemSprites = new SpriteResources(undefined, undefined, new GroundItemAssets());
  /** SpawnPrefab of a ground stack and lootdropper's DropLoot, in this world. */
  const itemSpawner = { spawnItem: (state: InventoryStack) => sceneInventory.entities.create(state) };
  const groundItems = {
    spawnGroundItem: (definition: GroundItemDefinition, position: ReadonlyVector3, options?: GroundSpawnOptions) =>
      spawnGroundStack(itemSpawner, definition, position, options),
    flingLoot: (definitions: readonly GroundItemDefinition[], position: ReadonlyVector3, launch?: () => LootLaunch) =>
      flingLoot(itemSpawner, definitions, position, launch),
  };
  const registry = new EntityRegistry(SCENE_LIFECYCLE_ORDER, prefabs, () => player.position, prefabDisplays);
  const worldEvents = new EventEmitter<WorldEvents>();
  type SceneManagers = {
    buildings: ReturnType<typeof registerBuildings>;
    reskinEffects: ReturnType<typeof registerReskinEffects>;
    world_fx: ReturnType<typeof registerWorldFx>;
    molehill: ReturnType<typeof registerMolehills>;
    lightflier_flower: ReturnType<typeof registerLightFlierFlowers>;
    bulb_plant: ReturnType<typeof registerBulbPlants>;
    moonglass_rock: ReturnType<typeof registerMoonglassRocks>;
    cave_hole: ReturnType<typeof registerCaveHoles>;
    pillar_ruins: ReturnType<typeof registerPillarRuins>;
    cave_pillar: typeof prefabs;
    pillar_atrium: ReturnType<typeof registerAtriumPillars>;
    archive_pillar: ReturnType<typeof registerArchivePillars>;
    vault_pillar: ReturnType<typeof registerVaultPillars>;
    monkeypillar: ReturnType<typeof registerMonkeyPillars>;
    cave_exit: ReturnType<typeof registerCaveExits>;
    grotto_pool: ReturnType<typeof registerGrottoPools>;
    mushroom_plant: ReturnType<typeof registerMushroomPlants>;
    marbleshrub: ReturnType<typeof registerMarbleShrubs>;
    archive_props: ReturnType<typeof registerArchiveProps>;
    marblebean_sapling: ReturnType<typeof registerMarbleBeanSaplings>;
    rock_avocado_bush: ReturnType<typeof registerRockAvocadoBushes>;
    rock_avocado_fruit_sprout_sapling: ReturnType<typeof registerRockAvocadoSaplings>;
    grass: ReturnType<typeof registerGrasses>;
    sapling: ReturnType<typeof registerSaplings>;
    cave_fern: ReturnType<typeof registerCaveFerns>;
    multiplayer_portal_moonrock: ReturnType<typeof registerPortals>;
    evergreen: ReturnType<typeof registerEvergreens>;
    deciduoustree: ReturnType<typeof registerDeciduousTrees>;
    moon_tree: ReturnType<typeof registerMoonTrees>;
    atrium_gate: typeof prefabs;
    ruins_statue_mage: typeof prefabs;
    ruins_statue_mage_nogem: typeof prefabs;
    ruins_statue_head: typeof prefabs;
    ruins_statue_head_nogem: typeof prefabs;
    rain: ReturnType<typeof registerRain>;
    snow: ReturnType<typeof registerSnow>;
    ocean_waves: ReturnType<typeof registerOceanWaves>;
    staff_castinglight: ReturnType<typeof registerStaffCastingLights>;
    pond: ReturnType<typeof registerPonds>;
    marsh_plant: ReturnType<typeof registerMarshPlants>;
  };
  // Filled in dependency order below; deferred callbacks run after scene setup.
  const Managers = {} as SceneManagers;

  const sceneInventory = inventory;
  sceneInventory.entities.bindPerishWorld({ perishClock: worldState.perishClock, scheduler: worldState.scheduler });
  sceneInventory.entities.bindTemperatureWorld({
    componentUpdates: worldState.componentUpdates,
    temperature: worldState.temperature,
    clock: worldState.clock,
    unitScale: WORLD_SCALE,
    findHeaters: (position, radius, ignoredTags) => prefabs.FindEntities(position, radius, ['HASHEATER'], ignoredTags),
  });
  const dynamicMusic = scheduler ? new DynamicMusic(scheduler, path => PlaySound(path)) : undefined;

  Managers['buildings'] = registerBuildings();
  Managers['reskinEffects'] = registerReskinEffects();
  registerFlowers();
  Managers['world_fx'] = registerWorldFx();
  registerStaffProjectiles();
  Managers['molehill'] = registerMolehills();
  Managers['lightflier_flower'] = registerLightFlierFlowers();
  registerItems();

  registerStaffLights();
  Managers['staff_castinglight'] = registerStaffCastingLights();
  Managers['bulb_plant'] = registerBulbPlants();
  registerStalagmites();
  registerRocks();
  Managers['moonglass_rock'] = registerMoonglassRocks();
  Managers['cave_hole'] = registerCaveHoles();
  Managers['pillar_ruins'] = registerPillarRuins();
  Managers['cave_pillar'] = prefabs;
  Managers['pillar_atrium'] = registerAtriumPillars();
  Managers['archive_pillar'] = registerArchivePillars();
  Managers['vault_pillar'] = registerVaultPillars();
  Managers['monkeypillar'] = registerMonkeyPillars();
  /** ms_playerdespawnandmigrate: the destination shard is the cluster's other save, loaded by reloading the page. */
  const shardLink: WorldMigratorShard = {
    isWorldAvailable: shard => shard === CAVES_SHARD || shard === MASTER_SHARD,
    isWorldFull: () => false,
    migratePlayer: (_player, _portal, shard) => {
      window.location.search = shardSaveSearch(window.location.search, shard);
    },
  };

  registerCaveEntrances();
  Managers['cave_exit'] = registerCaveExits();
  Managers['grotto_pool'] = registerGrottoPools();
  registerMushtrees();
  Managers['mushroom_plant'] = registerMushroomPlants();
  Managers['marbleshrub'] = registerMarbleShrubs();
  Managers['archive_props'] = registerArchiveProps();
  registerSkeletons();
  registerHoundbones();
  registerBeeQueenHives();
  registerDragonflies();
  registerDragonflySpawners();
  Managers['marblebean_sapling'] = registerMarbleBeanSaplings();
  Managers['rock_avocado_bush'] = registerRockAvocadoBushes();
  Managers['rock_avocado_fruit_sprout_sapling'] = registerRockAvocadoSaplings();
  registerBerrybushes();
  registerMonkeytails();
  Managers['grass'] = registerGrasses();
  Managers['sapling'] = registerSaplings();
  Managers['cave_fern'] = registerCaveFerns();
  registerLichens();
  registerCacti();
  registerLavaPonds();

  const worldWind = worldState.worldwind;
  registerTumbleweeds();
  registerHotsprings();
  registerWormholes();
  Managers['multiplayer_portal_moonrock'] = registerPortals();
  registerNightmareGrowths();
  registerBeefalos();
  registerLightningGoats();
  registerPrefabFamily(stagehandRegistration, {
    scheduler: worldState.scheduler,
    componentUpdates: worldState.componentUpdates,
    fire: prefabFire,
    fx: Managers['world_fx'],
    physics: world,
    pathfinder,
    getWatchWorldContent: worldState.getWatchWorldContent,
    getLightLevel: position => dstLighting.sampleLightLevel(position),
    spawnLoot(id, position) {
      const item = SAVE_CATALOG.items[id];
      if (item) {
        groundItems.flingLoot([{ ...item, itemId: id, count: 1 }], position);
      }
      return undefined;
    },
  });
  registerPrefabFamily(livingTreeRegistration, {
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
  Managers['evergreen'] = registerEvergreens();
  Managers['deciduoustree'] = registerDeciduousTrees();
  const farmMap = registerFarm();
  Managers['moon_tree'] = registerMoonTrees();
  registerPigKings();
  registerBernies();
  registerStatueGlommer();
  registerMoonFissures();
  registerWatertreePillars();
  registerOceanTrees();
  registerOceanTreePillars();
  registerOceanVines();
  registerReeds();
  registerMastMalbatross();
  registerPrefabFamily(supportPillarRegistration);
  registerPrefabFamily(oasislakeRegistration, { scheduler: worldState.scheduler });
  registerPrefabFamily(beehiveRegistration, {
    scheduler: worldState.scheduler,
    getWatchWorldContent: worldState.getWatchWorldContent,
    fx: Managers['world_fx'],
  });
  registerPrefabFamily(shadowForgeRegistration, { scheduler: worldState.scheduler });
  registerPrefabFamily(spiderdenRegistration, {
    scheduler: worldState.scheduler,
    getWatchWorldContent: worldState.getWatchWorldContent,
  });
  registerPrefabFamily(seastackRegistration, { scheduler: worldState.scheduler });
  registerPrefabFamily(wasphiveRegistration, {
    scheduler: worldState.scheduler,
    getWatchWorldContent: worldState.getWatchWorldContent,
  });
  registerPrefabFamily(oceanVineDecoRegistration);
  Managers['atrium_gate'] = registerAtriumGate();
  // statueruins.lua returns the four prefabs together.
  registerPrefabFamily(ruinsStatueRegistration, { scheduler: worldState.scheduler });
  Managers['ruins_statue_mage'] = prefabs;
  Managers['ruins_statue_mage_nogem'] = prefabs;
  Managers['ruins_statue_head'] = prefabs;
  Managers['ruins_statue_head_nogem'] = prefabs;
  registerRuinsRelics();
  registerAtriumStatue();
  registerPrefabFamily(atriumOvergrowthRegistration);
  registerChessJunk();
  registerChesspieces();
  registerArchiveCentipedeHusks();
  Managers['marsh_plant'] = registerMarshPlants();
  Managers['pond'] = registerPonds();
  registerNightmareRocks();
  Managers['rain'] = registerRain();
  Managers['snow'] = registerSnow();
  Managers['ocean_waves'] = registerOceanWaves();

  registry.assertDefinitions(Object.values(PREFAB_DEFINITIONS));
  // cave.lua AddComponent("ropebridgemanager"): its OnLoad spawns the bridge art of the saved ROPE_BRIDGE tiles.
  const ropebridgemanager = initialSave.world.prefab === 'cave' ? registerRopeBridges() : undefined;

  const stopDugTurf = turfMap.onDig((point, tileId) => {
    const itemId = turfItemForTile(tileId);
    if (!itemId) {
      return;
    }
    const spec = GROUND_ITEM_DISPLAY_SPECS[itemId];
    groundItems.flingLoot(
      [{ itemId, count: 1, name: spec.name, icon: spec.icon, atlas: spec.atlas }],
      new THREE.Vector3(point.x, 0, point.z),
    );
  });

  const dispose = () => {
    stopDugTurf();
    farmMap.dispose();
    Managers['lightflier_flower'].dispose();
    ropebridgemanager?.dispose();
    try {
      registry.dispose();
    } finally {
      prefabDisplays.dispose();
      prefabFire.dispose();
      itemSprites.dispose();
      dynamicMusic?.dispose();
    }
  };

  return {
    Managers,
    registry,
    prefabs,
    worldEvents,
    dispose,
    worldWind,
    buildingPlacement: Managers['buildings'],
    groundItems,
    mushroomPlants: Managers['mushroom_plant'],
    rockAvocadoBushes: Managers['rock_avocado_bush'],
    grasses: Managers['grass'],
    saplings: Managers['sapling'],
    ponds: Managers['pond'],
    reskinEffects: Managers['reskinEffects'],
    worldFx: Managers['world_fx'],
    farmMap,
  };

  function registerPrefabFamily<Args extends unknown[], Family extends keyof typeof PREFAB_DEFINITIONS>(
    registration: PrefabRegistration<Args, Family>,
    ...args: Args
  ) {
    prefabs.register(registration.create(...args));
    for (const family of Object.keys(registration.families) as Family[]) {
      const definition: PrefabDefinition = PREFAB_DEFINITIONS[family];
      registry.registerPrefabs(definition);
    }
  }

  function registerBuildings() {
    const buildingPlacement = new PlaceableBuildingPlacement(
      {
        ...view,
        physics: world,
        pathfinder,
        scheduler: scheduler ?? worldState.scheduler,
        fire: prefabFire,
        weather: worldState.weather,
        dynamicMusic,
        handEquipment: sceneInventory.handEquipment,
        getLocalTemperature: (x, z) => GetTemperatureAtXZ(() => worldState.temperature.peek(), x, z),
        itemEntities: sceneInventory.entities,
        cycle: worldState.cycle,
        getWatchWorldContent: worldState.getWatchWorldContent,
        tickingarea: worldState.tickingarea,
        isCave: initialSave.world.prefab === 'cave',
        isNight: worldState.isNight,
        perishClock: worldState.perishClock,
        secondsUntilNextDay: now => TUNING.TOTAL_DAY_TIME - (now % TUNING.TOTAL_DAY_TIME),
        // world_fx registers after the buildings; the manager is read when an fx is played.
        fx: {
          spawn: (prefab, position) => {
            Managers['world_fx'].spawn(prefab, position);
          },
          collapse: (size, position, material) => Managers['world_fx'].collapse(size, position, material),
        },
        spawnItem: state => {
          const entity = sceneInventory.entities.create(state);
          sceneInventory.configureItem(entity);
          return entity;
        },
        restoreItem: record => {
          const entity = sceneInventory.entities.restore(record);
          sceneInventory.configureItem(entity);
          return entity;
        },
        dropItem: (entity, position) => {
          sceneInventory.DropItem(entity, position);
        },
        registerContainer: (id, container) => sceneInventory.registerContainer(id, container),
        unregisterContainer: (id, container) => sceneInventory.unregisterContainer(id, container),
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

  function registerReskinEffects() {
    const reskinEffects = new ReskinEffects(scene);
    registry.register(PREFAB_DEFINITIONS.reskinEffects, {
      exportRecords: () => [],
      update: dt => reskinEffects.update(dt),
      renderEntities: () => reskinEffects.renderEntities,
      dispose: () => reskinEffects.dispose(),
    });
    return reskinEffects;
  }

  function registerFlowers() {
    registerPrefabFamily(flowerRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      fire: prefabFire,
      worldEvents,
      spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
    });
  }

  function registerWorldFx() {
    registerPrefabFamily(worldFxRegistration, { scheduler: scheduler ?? worldState.scheduler });
    return worldFxSpawner(prefabs);
  }

  function registerStaffProjectiles() {
    registerPrefabFamily(staffProjectileRegistration, {
      fx: Managers['world_fx'],
      componentUpdates: worldState.componentUpdates,
    });
  }

  function registerMolehills() {
    const moleWalkable = (point: THREE.Vector3) => {
      const radius = 0.5 * WORLD_SCALE;
      const edge = initialSave.world.map.generator.options.size / 2 - radius;
      return (
        turfMap.isLandTileAtPoint(point) &&
        Math.abs(point.x) <= edge &&
        Math.abs(point.z) <= edge &&
        !getRegisteredPhysicsBodies(world).some(
          body =>
            body.type === CANNON.Body.STATIC &&
            body.collisionResponse &&
            body.shapes.some(
              shape => shape instanceof CANNON.Box || shape instanceof CANNON.Sphere || shape instanceof CANNON.Trimesh,
            ) &&
            (() => {
              body.updateAABB();
              const b = body.aabb;
              return (
                point.x >= b.lowerBound.x - radius &&
                point.x <= b.upperBound.x + radius &&
                point.z >= b.lowerBound.z - radius &&
                point.z <= b.upperBound.z + radius
              );
            })(),
        )
      );
    };
    const habitat = createMoleHabitat({
      handEquipment: sceneInventory.handEquipment,
      itemSpecs: SAVE_CATALOG.items,
      getWatchWorldContent: worldState.getWatchWorldContent,
      cameraHeading: view.cameraHeading,
      isWalkable: moleWalkable,
      pathfinder,
      spawnItem: state => {
        const entity = sceneInventory.entities.create(state);
        sceneInventory.configureItem(entity);
        return entity;
      },
      restoreItem: record => {
        const entity = sceneInventory.entities.restore(record);
        sceneInventory.configureItem(entity);
        return entity;
      },
      dropItem: (entity, position) => sceneInventory.DropItem(entity, position),
      // The spawned mole is set down where it comes out, as SpawnPrefab and Transform:SetPosition do.
      showMole: (entity, position) => {
        entity.setPosition(position.x, 0, position.z);
      },
      dropLoot: (itemId, position) => {
        groundItems.flingLoot([{ ...SAVE_CATALOG.items[itemId], itemId, count: 1 }], position);
      },
      spawnPrefab: (prefab, position) => prefabs.spawnAs(MolehillInstance, prefab, position),
      fx: Managers['world_fx'],
    });
    registerPrefabFamily(molehillRegistration, habitat);
    return { habitat };
  }

  /**
   * The item prefabs on the shared manager, which the inventory's item registry spawns through (prefabWorld.ts): every
   * item inst is SpawnPrefab'd into this world, saved by the world while it lies in the scene and by its holder while held.
   */
  function registerItems() {
    const icons = Object.fromEntries(
      Object.entries(SAVE_CATALOG.items)
        .filter(([id]) => !Object.hasOwn(GROUND_ART_DEFINITIONS, id))
        .map(([id, spec]) => [id, { atlas: spec.atlas ?? 'images/inventoryimages.xml', image: spec.icon }]),
    );
    registerPrefabFamily(ITEM_PREFAB_REGISTRATION, itemWorld(), icons);
  }

  /** TheWorld as the item prefabs reach it. */
  function itemWorld(): ItemPrefabWorld {
    if (itemWorldInstance) {
      return itemWorldInstance;
    }
    function newItem(prefab: string): ItemEntity;
    function newItem<Entity extends ItemEntity>(prefab: string, factory: ItemEntityFactory<Entity>): Entity;
    function newItem(prefab: string, factory?: ItemEntityFactory): ItemEntity {
      const state = { itemId: prefab, count: 1 };
      return factory ? sceneInventory.entities.construct(state, factory) : sceneInventory.entities.construct(state);
    }
    const items: ItemPrefabWorld = (itemWorldInstance = {
      newItem,
      spawnItem: state => sceneInventory.entities.create(state),
      restoreItem: record => sceneInventory.entities.restore(record),
      isInventoryItem: prefab => sceneInventory.hasItemSpec(prefab),
      configureItem: entity => {
        sceneInventory.entities.adopt(entity);
        sceneInventory.configureItem(entity);
      },
      dropItem: (entity, position) => sceneInventory.DropItem(entity, position),
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
      physics: world,
      fx: Managers['world_fx'],
      moleWorld: Managers['molehill'].habitat,
      lightflierWorld: Managers['lightflier_flower'].habitat,
      handEquipment: sceneInventory.handEquipment,
      bernieWorld: bernieWorld(),
      butterflyWorld: {
        getWatchWorldContent: worldState.getWatchWorldContent,
        constrainPosition: position => {
          const edge = initialSave.world.map.generator.options.size / 2 - 0.5;
          position.x = THREE.MathUtils.clamp(position.x, -edge, edge);
          position.z = THREE.MathUtils.clamp(position.z, -edge, edge);
        },
      },
      firefliesWorld: { getWatchWorldContent: worldState.getWatchWorldContent, tickingarea: worldState.tickingarea },
      dropLoot: (items, position) => groundItems.flingLoot(items, position),
      spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
    });
    return items;
  }

  /** lightflier_flower on the shared manager, and the lightfliers' world: their formations and SpawnPrefab("lightflier"). */
  function registerLightFlierFlowers() {
    const lightFlierPlayer = {
      position: player.position,
      isValid: () => !playerStats.health.IsDead(),
      hasLightFlier: () => sceneInventory.Has('lightflier'),
      getFacing: () => playerInstance.worldHeading,
      getWalkSpeed: () => 4 * WORLD_SCALE,
      wantsToMove: () => playerInstance.wantsToMoveForward,
    };
    const dropLoot = (itemId: string, count: number, position: THREE.Vector3) => {
      groundItems.flingLoot([{ ...SAVE_CATALOG.items[itemId], itemId, count }], position);
    };
    const habitat = new LightFlierHabitat({
      maxMovementStep: MAX_PHYSICS_FRAME_TIME,
      scheduler: scheduler ?? worldState.scheduler,
      getWatchWorldContent: worldState.getWatchWorldContent,
      tickingarea: worldState.tickingarea,
      cameraHeading: view.cameraHeading,
      getPlayers: () => [lightFlierPlayer],
      fx: Managers['world_fx'],
      spawnItem: state => {
        const entity = sceneInventory.entities.create(state);
        sceneInventory.configureItem(entity);
        return entity;
      },
      dropLoot,
      getHomes: () =>
        prefabs.instances(LIGHTFLIER_FLOWER_ID) as Iterable<
          import('../packages/prefab/src/lightflier_flower').LightFlierFlowerInstance
        >,
    });
    // The formation leaders move every frame after physics.
    const stopFormations = worldState.componentUpdates.register({ OnUpdate: dt => habitat.update(dt) });
    registerPrefabFamily(lightflierFlowerRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      habitat,
      dropLoot,
      getWatchWorldContent: worldState.getWatchWorldContent,
      getLightLevel: model => dstLighting.sampleLightLevel(model.position, model),
    });
    return {
      habitat,
      dispose: () => {
        stopFormations();
        habitat.dispose();
      },
    };
  }

  function registerBulbPlants() {
    registerPrefabFamily(bulbPlantRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      getLightLevel: model => dstLighting.sampleLightLevel(model.position, model),
    });
    return prefabs;
  }

  function registerStalagmites() {
    registerPrefabFamily(stalagmiteRegistration, {
      scheduler: worldState.scheduler,
      spawnLoot: (id, position) => {
        const definition = GROUND_ART_DEFINITIONS[id];
        return definition
          ? groundItems.spawnGroundItem(
              { ...definition, icon: definition.icon ?? '', itemId: id, count: 1 },
              position,
              { fling: true },
            )
          : undefined;
      },
    });
  }

  function registerRocks() {
    const spawnGroundItem: SpawnGroundItem = (definition, position, options) =>
      groundItems.spawnGroundItem(definition, position, options);
    registerPrefabFamily(rockRegistration, {
      handEquipment: sceneInventory.handEquipment,
      scheduler: scheduler ?? worldState.scheduler,
      spawnGroundItem,
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
    });
    registerPrefabFamily(caveinBoulderRegistration, { handEquipment: sceneInventory.handEquipment, spawnGroundItem });
    registerPrefabFamily(moonrockseedRegistration);
  }

  function registerMoonglassRocks() {
    registerPrefabFamily(moonglassRockRegistration, {
      handEquipment: sceneInventory.handEquipment,
      scheduler: scheduler ?? worldState.scheduler,
      spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
    });
    return prefabs;
  }

  function registerCaveHoles() {
    registerPrefabFamily(caveHoleRegistration, {
      getWatchWorldContent: worldState.getWatchWorldContent,
      cameraFacing: view.cameraFacing,
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
    });
    return prefabs;
  }

  function registerPillarRuins() {
    registerPrefabFamily(pillarRegistration);
    return prefabs;
  }

  function registerAtriumPillars() {
    registerPrefabFamily(atriumPillarRegistration);
    return prefabs;
  }

  function registerArchivePillars() {
    registerPrefabFamily(archivePillarRegistration);
    return prefabs;
  }

  function registerVaultPillars() {
    registerPrefabFamily(vaultPillarRegistration, { spawnPrefab: (id, position) => prefabs.spawn(id, position) });
    return prefabs;
  }

  function registerMonkeyPillars() {
    registerPrefabFamily(monkeyPillarRegistration, { scheduler: worldState.scheduler });
    return prefabs;
  }

  function registerCaveEntrances() {
    registerPrefabFamily(caveEntranceRegistration, {
      handEquipment: sceneInventory.handEquipment,
      spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
      spawnPrefab: (prefab, position) => prefabs.spawn(prefab, position),
      shard: shardLink,
    });
  }

  function registerMushroomPlants() {
    registerPrefabFamily(mushroomPlantRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      fire: prefabFire,
      getWatchWorldContent: worldState.getWatchWorldContent,
      spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
      rain: worldState.weather.preciptype,
      tickingarea: worldState.tickingarea,
    });
    return prefabs;
  }

  function registerMushtrees() {
    registerPrefabFamily(mushtreeRegistration, {
      handEquipment: sceneInventory.handEquipment,
      scheduler: scheduler ?? worldState.scheduler,
      fire: prefabFire,
      getWatchWorldContent: worldState.getWatchWorldContent,
      tickingarea: worldState.tickingarea,
      worldEvents,
      dropLoot: (items, position) => {
        groundItems.flingLoot(
          items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })),
          position,
        );
      },
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
    });
  }

  function registerGrottoPools() {
    registerPrefabFamily(grottoPoolRegistration, {
      handEquipment: sceneInventory.handEquipment,
      scheduler: scheduler ?? worldState.scheduler,
      registerWaterfallPool: (position, radius, large) =>
        worldState.soundPresentation.registerWaterfallPool(position, radius, large),
      getWatchWorldContent: worldState.getWatchWorldContent,
      fx: { spawn: (prefab, position) => Managers['world_fx'].spawn(prefab, position) },
      spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
      getEntity: entityId => prefabs.get(entityId),
    });
    return prefabs;
  }

  function registerCaveExits() {
    registerPrefabFamily(caveExitRegistration, { shard: shardLink });
    return prefabs;
  }

  function registerMarbleShrubs() {
    registerPrefabFamily(marbleShrubRegistration, {
      handEquipment: sceneInventory.handEquipment,
      scheduler: scheduler ?? worldState.scheduler,
      spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
    });
    return prefabs;
  }

  function registerArchiveProps() {
    registerPrefabFamily(archivePropsRegistration, {
      handEquipment: sceneInventory.handEquipment,
      scheduler: worldState.scheduler,
      cameraFacing: view.cameraFacing,
      spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
      fx: Managers['world_fx'],
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
    });
    return prefabs;
  }

  function registerHoundbones() {
    registerPrefabFamily(houndboneRegistration, {
      fx: Managers['world_fx'],
      handEquipment: sceneInventory.handEquipment,
      spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
    });
  }

  function registerBeeQueenHives() {
    registerPrefabFamily(beeQueenHiveRegistration, {
      handEquipment: sceneInventory.handEquipment,
      scheduler: worldState.scheduler,
    });
  }

  function registerDragonflies() {
    registerPrefabFamily(dragonflyRegistration, {
      scheduler: worldState.scheduler,
      getWatchWorldContent: worldState.getWatchWorldContent,
    });
  }

  function registerDragonflySpawners() {
    registerPrefabFamily(dragonflySpawnerRegistration, {
      scheduler: worldState.scheduler,
      spawnDragonfly: position => prefabs.spawn(DRAGONFLY_ID, position).transform.model,
      // childspawner SpawnChild's FindWalkableOffset: Map:IsAboveGroundAtPoint, a land tile.
      isPassable: position => turfMap.isLandTileAtPoint(position),
    });
  }

  function registerSkeletons() {
    registerPrefabFamily(skeletonRegistration, {
      fx: { collapse: (size, position, material) => Managers['world_fx'].collapse(size, position, material) },
      handEquipment: sceneInventory.handEquipment,
      spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
    });
  }

  function registerMarbleBeanSaplings() {
    registerPrefabFamily(marbleBeanSaplingRegistration, {
      handEquipment: sceneInventory.handEquipment,
      scheduler: scheduler ?? worldState.scheduler,
      spawnPrefab: (id, position) => prefabs.spawnAs(MarbleShrubInstance, id, position),
      spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
    });
    return prefabs;
  }

  function registerRockAvocadoBushes() {
    registerPrefabFamily(rockAvocadoBushRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      fire: prefabFire,
      getWatchWorldContent: worldState.getWatchWorldContent,
      tickingarea: worldState.tickingarea,
      rain: worldState.weather.preciptype,
      physics: world,
      getLocalTemperature: position => GetTemperatureAtXZ(() => worldState.temperature.peek(), position.x, position.z),
      spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
    });
    return prefabs;
  }

  function registerRockAvocadoSaplings() {
    registerPrefabFamily(rockAvocadoSaplingRegistration, {
      handEquipment: sceneInventory.handEquipment,
      scheduler: scheduler ?? worldState.scheduler,
      fire: prefabFire,
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
      spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
    });
    return prefabs;
  }

  function registerBerrybushes() {
    registerPrefabFamily(berrybushRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      fire: prefabFire,
      getWatchWorldContent: worldState.getWatchWorldContent,
      tickingarea: worldState.tickingarea,
      rain: worldState.weather.preciptype,
      physics: world,
      getLocalTemperature: position => GetTemperatureAtXZ(() => worldState.temperature.peek(), position.x, position.z),
      spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
    });
  }

  function registerMonkeytails() {
    registerPrefabFamily(monkeytailRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      fire: prefabFire,
      getWatchWorldContent: worldState.getWatchWorldContent,
      tickingarea: worldState.tickingarea,
      rain: worldState.weather.preciptype,
      getLocalTemperature: position => GetTemperatureAtXZ(() => worldState.temperature.peek(), position.x, position.z),
      spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
    });
  }

  function registerGrasses() {
    registerPrefabFamily(grassRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      fire: prefabFire,
      getWatchWorldContent: worldState.getWatchWorldContent,
      tickingarea: worldState.tickingarea,
      spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
    });
    return prefabs;
  }

  function registerSaplings() {
    registerPrefabFamily(saplingRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      fire: prefabFire,
      getWatchWorldContent: worldState.getWatchWorldContent,
      tickingarea: worldState.tickingarea,
      spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
    });
    return prefabs;
  }

  function registerCaveFerns() {
    registerPrefabFamily(caveFernRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      fire: prefabFire,
      getWatchWorldContent: worldState.getWatchWorldContent,
      tickingarea: worldState.tickingarea,
      spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
    });
    return prefabs;
  }

  function registerLichens() {
    registerPrefabFamily(lichenRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      fire: prefabFire,
      getWatchWorldContent: worldState.getWatchWorldContent,
      tickingarea: worldState.tickingarea,
      spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
    });
  }

  function registerCacti() {
    registerPrefabFamily(cactusRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      fire: prefabFire,
      getWatchWorldContent: worldState.getWatchWorldContent,
      tickingarea: worldState.tickingarea,
      physics: world,
      spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
      spawnItem: state => {
        const entity = sceneInventory.entities.create(state);
        sceneInventory.configureItem(entity);
        return entity;
      },
      dropItem: (entity, position) => {
        sceneInventory.DropItem(entity, position);
      },
    });
  }

  function registerLavaPonds() {
    registerPrefabFamily(lavaPondRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      spawnPrefab: (prefab, position) => prefabs.spawn(prefab, position),
    });
  }

  function registerTumbleweeds() {
    registerPrefabFamily(tumbleweedRegistration, {
      scheduler: worldState.scheduler,
      wind: worldWind,
      getWatchWorldContent: worldState.getWatchWorldContent,
      componentUpdates: worldState.componentUpdates,
      spawnPrefab: (prefab, position) => prefabs.spawn(prefab, position),
      // EntityScript:IsOnValidGround.
      isOnValidGround: position => turfMap.isVisualGroundAtPoint(position),
      constrainPosition: position => {
        const edge = initialSave.world.map.generator.options.size / 2 - WORLD_SCALE;
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

  function registerHotsprings() {
    registerPrefabFamily(hotspringRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      fx: { spawn: (prefab, position) => Managers['world_fx'].spawn(prefab, position) },
    });
  }

  function registerWormholes() {
    registerPrefabFamily(wormholeRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      getWatchWorldContent: worldState.getWatchWorldContent,
    });
  }

  function registerPortals() {
    registerPrefabFamily(portalRegistration, {
      scheduler: worldState.scheduler,
      portalRez: worldState.portalRez,
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
    });
    return prefabs;
  }

  function registerNightmareGrowths() {
    registerPrefabFamily(nightmareGrowthRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      spawnPrefab: (prefab, position) => prefabs.spawnAs(NightmareGrowthCrackInstance, prefab, position),
    });
  }

  function registerBeefalos() {
    // Colliders only change between frames, so one frame's wander and path queries share an obstacle grid.
    let planningAt: number | undefined;
    let planningObstacles: ((point: THREE.Vector3) => boolean) | undefined;
    const beefaloWorld: BeefaloWorld = {
      scheduler: scheduler ?? worldState.scheduler,
      componentUpdates: worldState.componentUpdates,
      // The scheduler runs on world seconds (src/scene.ts), so the next boundary is the next multiple of the day length.
      secondsUntilNextDay: now => TUNING.TOTAL_DAY_TIME - (now % TUNING.TOTAL_DAY_TIME),
      clock: worldState.clock,
      getWatchWorldContent: worldState.getWatchWorldContent,
      pathfinder,
      isWalkable(point) {
        const radius = BEEFALO_BEHAVIOR.radius;
        const edge = initialSave.world.map.generator.options.size / 2 - radius;
        const now = beefaloWorld.scheduler.now;
        if (planningAt !== now || !planningObstacles) {
          planningAt = now;
          planningObstacles = staticObstacleTest(getRegisteredPhysicsBodies(world), radius);
        }
        return (
          Math.abs(point.x) <= edge &&
          Math.abs(point.z) <= edge &&
          turfMap.isLandTileAtPoint(point) &&
          !planningObstacles(point)
        );
      },
      constrainPosition(position) {
        const edge = initialSave.world.map.generator.options.size / 2 - BEEFALO_BEHAVIOR.radius;
        position.x = THREE.MathUtils.clamp(position.x, -edge, edge);
        position.z = THREE.MathUtils.clamp(position.z, -edge, edge);
      },
      spawnPrize(prefab, count, position) {
        groundItems.flingLoot([{ ...SAVE_CATALOG.items[prefab], itemId: prefab, count }], position);
      },
      *getPoopPositions() {
        for (const poop of prefabs.instances('poop')) {
          if (!poop.inlimbo) {
            yield poop.position;
          }
        }
      },
      // SpawnPrefab("poop") and Transform:SetPosition.
      spawnPoop(position) {
        sceneInventory.entities.create({ itemId: 'poop', count: 1 }).setPosition(position.x, 0, position.z);
      },
    };
    prefabs.register(beefaloRegistration.create(beefaloWorld));
    registry.register(PREFAB_DEFINITIONS.beefalos, {
      restore: (id, record) => prefabs.restore(id, record),
      debugSpawn: id => prefabs.spawn(id, findBeefaloSpawnPoint(world, beefaloWorld, player.position)),
      exportRecords: () => [],
      dispose: () => {},
    });
  }

  function registerLightningGoats() {
    // Colliders only change between frames, so one frame's wander and path queries share an obstacle grid.
    let planningAt: number | undefined;
    let planningObstacles: ((point: THREE.Vector3) => boolean) | undefined;
    const edge = initialSave.world.map.generator.options.size / 2 - LIGHTNING_GOAT_RADIUS;
    const goatWorld: LightningGoatWorld = {
      scheduler: scheduler ?? worldState.scheduler,
      componentUpdates: worldState.componentUpdates,
      // The scheduler runs on world seconds (src/scene.ts), so the next boundary is the next multiple of the day length.
      secondsUntilNextDay: now => TUNING.TOTAL_DAY_TIME - (now % TUNING.TOTAL_DAY_TIME),
      clock: worldState.clock,
      getWatchWorldContent: worldState.getWatchWorldContent,
      pathfinder,
      isWalkable(point) {
        const now = goatWorld.scheduler.now;
        if (planningAt !== now || !planningObstacles) {
          planningAt = now;
          planningObstacles = staticObstacleTest(getRegisteredPhysicsBodies(world), LIGHTNING_GOAT_RADIUS);
        }
        return (
          Math.abs(point.x) <= edge &&
          Math.abs(point.z) <= edge &&
          turfMap.isLandTileAtPoint(point) &&
          !planningObstacles(point)
        );
      },
      constrainPosition(position) {
        position.x = THREE.MathUtils.clamp(position.x, -edge, edge);
        position.z = THREE.MathUtils.clamp(position.z, -edge, edge);
      },
      spawnLoot(prefab, position) {
        groundItems.flingLoot(
          [{ ...SAVE_CATALOG.items[prefab], itemId: prefab, count: 1 }],
          new THREE.Vector3(position.x, position.y, position.z),
        );
        return undefined;
      },
    };
    prefabs.register(lightningGoatRegistration.create(goatWorld));
    registry.register(PREFAB_DEFINITIONS.lightningGoats, {
      restore: (id, record) => prefabs.restore(id, record),
      // The same clear ring search as c_spawn("beefalo"), for a goat-sized collider.
      debugSpawn: id => prefabs.spawn(id, findBeefaloSpawnPoint(world, goatWorld, player.position)),
      exportRecords: () => [],
      dispose: () => {},
    });
  }

  function registerEvergreens() {
    registerPrefabFamily(evergreenRegistration, {
      handEquipment: sceneInventory.handEquipment,
      camera,
      worldEvents,
      scheduler: scheduler ?? worldState.scheduler,
      fire: prefabFire,
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
      growthDuration: seconds => seconds * (worldState.season.peek().season === 'spring' ? 0.75 : 1),
      dropLoot: (items, position) => {
        groundItems.flingLoot(
          items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })),
          position,
        );
      },
    });
    return prefabs;
  }

  function registerDeciduousTrees() {
    registerPrefabFamily(deciduousRegistration, {
      handEquipment: sceneInventory.handEquipment,
      camera,
      worldEvents,
      scheduler: scheduler ?? worldState.scheduler,
      fire: prefabFire,
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
      growthDuration: seconds => seconds * (worldState.season.peek().season === 'spring' ? 0.75 : 1),
      dropLoot: (items, position) => {
        groundItems.flingLoot(
          items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })),
          position,
        );
      },
      season: worldState.season,
      secondsUntilNextDay: now => TUNING.TOTAL_DAY_TIME - (now % TUNING.TOTAL_DAY_TIME),
    });
    return prefabs;
  }

  /** farm_plow, farm_soil, farm_soil_debris and the sown seeds, with TheWorld.Map's soil functions they share. */
  function registerFarm() {
    const farmMap = createFarmMap({ turf: turfMap, entities: prefabs });
    registerPrefabFamily(farmRegistration, {
      scheduler: worldState.scheduler,
      map: farmMap,
      fx: Managers['world_fx'],
      worldEvents: view.worldEvents,
      handEquipment: sceneInventory.handEquipment,
      spawnPrefab: (prefab, position) => prefabs.spawn(prefab, position),
      getEntity: id => prefabs.get(id),
      spawnSaveRecord: (position, item) => {
        sceneInventory.entities.restore(item).setPosition(position.x, 0, position.z);
      },
      spawnLoot: (itemId, position) =>
        groundItems.flingLoot([{ ...SAVE_CATALOG.items[itemId], itemId, count: 1 }], position),
    });
    return farmMap;
  }

  function registerMoonTrees() {
    registerPrefabFamily(moonTreeRegistration, {
      handEquipment: sceneInventory.handEquipment,
      camera,
      worldEvents,
      scheduler: scheduler ?? worldState.scheduler,
      fire: prefabFire,
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
      growthDuration: seconds => seconds * (worldState.season.peek().season === 'spring' ? 0.75 : 1),
      dropLoot: (items, position) => {
        groundItems.flingLoot(
          items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })),
          position,
        );
      },
    });
    return prefabs;
  }

  /** AllPlayers and SpawnPrefab for bernie_inactive.lua's tryreanimate and the reanimated Bernies. */
  function bernieWorld(): BernieWorld {
    return (bernieWorldInstance ??= {
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
    });
  }

  function registerBernies() {
    registerPrefabFamily(bernieRegistration, bernieWorld());
  }

  function registerPigKings() {
    registerPrefabFamily(pigKingRegistration, {
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

  function registerMoonFissures() {
    registerPrefabFamily(moonFissureRegistration, {
      scheduler: worldState.scheduler,
      getWatchWorldContent: worldState.getWatchWorldContent,
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
    });
  }

  function registerWatertreePillars() {
    registerPrefabFamily(watertreePillarRegistration, {
      scheduler: worldState.scheduler,
      getWatchWorldContent: worldState.getWatchWorldContent,
    });
  }

  function registerOceanTrees() {
    registerPrefabFamily(oceanTreeRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      getWatchWorldContent: worldState.getWatchWorldContent,
      growthDuration: seconds => seconds * (worldState.season.peek().season === 'spring' ? 0.75 : 1),
      spawnLoot: (prefab, position) => {
        groundItems.flingLoot([{ ...SAVE_CATALOG.items[prefab], itemId: prefab, count: 1 }], position);
        return undefined;
      },
    });
  }

  function registerOceanTreePillars() {
    registerPrefabFamily(oceanTreePillarRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      getWatchWorldContent: worldState.getWatchWorldContent,
      spawnLoot: (prefab, position) => {
        groundItems.flingLoot([{ ...SAVE_CATALOG.items[prefab], itemId: prefab, count: 1 }], position);
        return undefined;
      },
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
    });
  }

  function registerMastMalbatross() {
    registerPrefabFamily(mastMalbatrossRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      getWatchWorldContent: worldState.getWatchWorldContent,
    });
  }

  /** rope_bridge.lua's rope_bridge_fx (with its rope and icon entities) and the cave's ropebridgemanager. */
  function registerRopeBridges(): RopeBridgeManager {
    prefabs.register(
      ropeBridgePrefabs({
        cameraFacing: view.cameraFacing,
        spawnPrefab: (id, position) => prefabs.spawn(id, position),
      }),
    );
    return new RopeBridgeManager(
      {
        *ropeBridges() {
          for (const tile of turfMap.exportTiles()) {
            if (tile.tileId === WORLD_TILES.ROPE_BRIDGE && tile.ropeBridge) {
              yield [tile.col, tile.row, tile.ropeBridge] as const;
            }
          }
        },
        tileCenter: (col, row) => ({ x: (col + 0.5) * TILE_SIZE, z: (row + 0.5) * TILE_SIZE }),
      },
      (x, z) => prefabs.spawnAs(RopeBridgeFxInstance, ROPE_BRIDGE_FX_ID, new THREE.Vector3(x, 0, z)),
    );
  }

  function registerReeds() {
    registerPrefabFamily(reedsRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      getWatchWorldContent: worldState.getWatchWorldContent,
    });
  }

  function registerOceanVines() {
    registerPrefabFamily(oceanVineRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      getWatchWorldContent: worldState.getWatchWorldContent,
    });
  }

  function registerStatueGlommer() {
    registerPrefabFamily(statueGlommerRegistration, { scheduler: worldState.scheduler });
  }

  function registerAtriumGate() {
    registerPrefabFamily(atriumGateRegistration, {
      scheduler: worldState.scheduler,
      pathfinder,
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
    });
    return prefabs;
  }

  function registerRuinsRelics() {
    registerPrefabFamily(ruinsRelicRegistration, {
      fx: Managers['world_fx'],
      dropLoot: (items, position) =>
        groundItems.flingLoot(
          items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })),
          position,
        ),
      scheduler: worldState.scheduler,
    });
  }

  function registerAtriumStatue() {
    registerPrefabFamily(atriumStatueRegistration);
  }

  function registerChessJunk() {
    registerPrefabFamily(chessJunkRegistration, {
      fx: Managers['world_fx'],
      scheduler: worldState.scheduler,
      dropLoot: (items, position) =>
        groundItems.flingLoot(
          items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })),
          position,
        ),
    });
  }

  function registerChesspieces() {
    registerPrefabFamily(chesspieceRegistration, {
      fx: Managers['world_fx'],
      handEquipment: sceneInventory.handEquipment,
      scheduler: worldState.scheduler,
      spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
    });
  }

  function registerArchiveCentipedeHusks() {
    registerPrefabFamily(archiveCentipedeHuskRegistration, { scheduler: worldState.scheduler });
  }

  function registerNightmareRocks() {
    registerPrefabFamily(nightmareRockRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      spawnPrefab: (prefab, position) => prefabs.spawn(prefab, position),
      // AllPlayers: the local player, once its sanity component is attached.
      getPlayers: () =>
        playerInstance.components.sanity
          ? [{ position: player.position, sanity: playerInstance.components.sanity }]
          : [],
    });
  }

  function registerRain() {
    const rain = new RainEffect({
      scene,
      dataBaseUrl: `${import.meta.env.BASE_URL}dst/data`,
      animationBaseUrl: `${import.meta.env.BASE_URL}dst/data/anim`,
      getFocus: () => player.position,
      camera,
      rate: worldState.weather.rainRate,
    });
    registry.register(PREFAB_DEFINITIONS.rain, {
      exportRecords: () => [],
      update: (dt, quaternion) => rain.update(dt, quaternion),
      renderEntities: () => rain.renderEntities,
      dispose: () => rain.dispose(),
    });
    return rain;
  }

  function registerSnow() {
    const snow = new SnowEffect({
      scene,
      dataBaseUrl: `${import.meta.env.BASE_URL}dst/data`,
      getFocus: () => player.position,
      camera,
      rate: worldState.weather.snowRate,
      cover: worldState.weather.snowCover,
      groundOverlay: groundDisplay,
    });
    registry.register(PREFAB_DEFINITIONS.snow, {
      exportRecords: () => [],
      update: (dt, quaternion) => snow.update(dt, quaternion),
      dispose: () => snow.dispose(),
    });
    return snow;
  }

  function registerOceanWaves() {
    // The only ocean tile is OCEAN_COASTAL; INVALID (outside the map) is neither land nor water.
    const waveMap: WaveMap = {
      tileSize: TILE_SIZE,
      tileAt: (x, z) => turfMap.getTileAtWorld({ x, z }),
      isLandTile,
      isOceanTile: tile => tile === WORLD_TILES.OCEAN_COASTAL,
    };
    const oceanWaves = new OceanWaves(scene, waveMap, WORLD_SCALE, worldState.tickingarea);
    const waveManager = new WaveManager({
      map: waveMap,
      spawner: oceanWaves,
      scale: WORLD_SCALE,
      tiles: new Map([[WORLD_TILES.OCEAN_COASTAL, 'shore']]),
      cameraDistance: () => followCamera.getDistance() / WORLD_SCALE,
      playerPosition: () => player.position,
    });
    registry.register(PREFAB_DEFINITIONS.oceanWaves, {
      exportRecords: () => [],
      update: (dt, quaternion) => {
        waveManager.OnUpdate(dt);
        oceanWaves.update(dt, quaternion);
      },
      dispose: () => oceanWaves.dispose(),
    });
    return oceanWaves;
  }

  function registerStaffLights() {
    registerPrefabFamily(staffLightRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      tickingarea: worldState.tickingarea,
      getWatchWorldContent: worldState.getWatchWorldContent,
    });
  }

  /** No renderEntities: these prefabs have nothing to draw, only a light their displays list. */
  function registerStaffCastingLights() {
    registerPrefabFamily(staffCastingLightRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      tickingarea: worldState.tickingarea,
    });
    return prefabs;
  }

  function registerMarshPlants() {
    registerPrefabFamily(marshPlantRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      tickingarea: worldState.tickingarea,
      fire: prefabFire,
      spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
    });
    return prefabs;
  }

  function registerPonds() {
    registerPrefabFamily(pondRegistration, {
      scheduler: scheduler ?? worldState.scheduler,
      tickingarea: worldState.tickingarea,
      getWatchWorldContent: worldState.getWatchWorldContent,
      physics: world,
      spawnPrefab: (prefab, position) => registry.SpawnPrefab(prefab, position),
    });
    return prefabs;
  }
}
