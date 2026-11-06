import { stalagmitePrefabs } from '@dontstarve-web/prefab/stalagmite';
import { ruinsRelicPrefabs } from '@dontstarve-web/prefab/ruinsrelic';
import { LightFlierFlowerManager, type LightFlierFlowerRecord } from '../packages/prefab/src/lightflier_flower';
import { MAX_PHYSICS_FRAME_TIME } from './physicsTiming';
import { createMoleHabitat, molehillPrefabs, type MolehillInstance } from '../packages/prefab/src/molehill';
import { MoleBait } from '../packages/prefab/src/molebait';
import { TUNING } from './tuning';
import { DynamicMusic } from '../packages/componets/src/dynamicmusic';
import { GetTemperatureAtXZ } from '../packages/componets/src/temperatureoverrider';
import { activePrefabs, FindEntities } from '../packages/prefab/src/actionEntity';
import type { TemperatureSource } from '../packages/componets/src/temperature';
import { PlaySound } from '@dontstarve-web/prefab/sound';
import type { ItemEntityRegistry, InventoryStore } from '@dontstarve-web/inventory';
import { createInventoryStore } from './inventory';
import * as CANNON from 'cannon-es';
import { getRegisteredPhysicsBodies } from '../packages/componets/src/physicsWorld';
import * as THREE from 'three';
import { EventEmitter } from '@dontstarve-web/signals';
import type { WorldEvents } from '../packages/prefab/src/worldContext';

import { groundDisplay, pathfinder, turfMap } from './building';
import { moonTreePrefabs } from '@dontstarve-web/prefab/moontree';
import { WORLD_TILES, isLandTile } from '@dontstarve-web/prefab/turfMap';
import { placeStaticLayout } from '@dontstarve-web/prefab/staticLayout';
import { camera, followCamera } from './camera';
import { GroundItemManager } from '@dontstarve-web/prefab/groundItemManager';
import { turfItemForTile } from '@dontstarve-web/prefab/turfs';
import { GROUND_ART_DEFINITIONS, GROUND_ITEM_DISPLAY_SPECS } from '@dontstarve-web/prefab/groundItems';
import { FarmPlowPlacement, FARM_PLOW_ID } from '@dontstarve-web/prefab/farm_plow';
import { playerStats } from './playerStats';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import { PrefabEntityManager, PrefabInstance, prefabInstance } from '@dontstarve-web/prefab/prefabInstance';
import { staffCastingLightPrefabs } from '@dontstarve-web/prefab/staff_castinglight';
import { staffLightPrefabs } from '@dontstarve-web/prefab/stafflight';
import { bulbPlantPrefabs } from '@dontstarve-web/prefab/bulb_plant';
import { moonglassRockPrefabs, rockPrefabs } from '@dontstarve-web/prefab/rocks';
import { caveinBoulderPrefabs } from '@dontstarve-web/prefab/cavein_boulder';
import { moonrockseedPrefabs } from '@dontstarve-web/prefab/moonrockseed';
import type { SpawnGroundItem } from '@dontstarve-web/prefab/groundPrefab';
import { caveHolePrefabs } from '@dontstarve-web/prefab/cave_hole';
import { pillarPrefabs } from '@dontstarve-web/prefab/pillar';
import { atriumPillarPrefabs } from '@dontstarve-web/prefab/atrium_pillar';
import { archivePillarPrefabs } from '@dontstarve-web/prefab/archive_pillar';
import { vaultPillarPrefabs } from '@dontstarve-web/prefab/vault_pillar';
import { monkeyPillarPrefabs } from '@dontstarve-web/prefab/monkeypillar';
import { StaffProjectileManager } from '@dontstarve-web/prefab/staff_projectile';
import { caveEntrancePrefabs, CAVES_SHARD } from '@dontstarve-web/prefab/cave_entrance';
import { caveExitPrefabs, MASTER_SHARD } from '@dontstarve-web/prefab/cave_exit';
import type { WorldMigratorShard } from '../packages/componets/src/worldmigrator';
import { grottoPoolPrefabs } from '@dontstarve-web/prefab/grotto_pool';
import { mushroomPlantPrefabs } from '@dontstarve-web/prefab/mushroom_plant';
import { mushtreePrefabs } from '@dontstarve-web/prefab/mushtree';
import { marbleShrubPrefabs, type MarbleShrubInstance } from '@dontstarve-web/prefab/marbleshrub';
import { archivePropsPrefabs } from '@dontstarve-web/prefab/archive_props';
import { houndbonePrefabs } from '@dontstarve-web/prefab/houndbone';
import { beeQueenHivePrefabs } from '@dontstarve-web/prefab/beequeenhivegrown';
import { dragonflyPrefabs, DRAGONFLY_ID } from '@dontstarve-web/prefab/dragonfly';
import { dragonflySpawnerPrefabs } from '@dontstarve-web/prefab/dragonfly_spawner';
import { skeletonPrefabs } from '@dontstarve-web/prefab/skeleton';
import { marbleBeanSaplingPrefabs } from '@dontstarve-web/prefab/marblebean_sapling';
import { rockAvocadoSaplingPrefabs } from '@dontstarve-web/prefab/rock_avocado_fruit_sprout_sapling';
import { rockAvocadoBushPrefabs } from '@dontstarve-web/prefab/rock_avocado_bush';
import { berrybushPrefabs } from '@dontstarve-web/prefab/berrybush';
import { monkeytailPrefabs } from '@dontstarve-web/prefab/monkeytail';
import { grassPrefabs } from '@dontstarve-web/prefab/grass';
import { caveFernPrefabs } from '@dontstarve-web/prefab/cave_fern';
import { lichenPrefabs } from '@dontstarve-web/prefab/lichen';
import { cactusPrefabs } from '@dontstarve-web/prefab/cactus';
import type { GameTimeScheduler } from '@dontstarve-web/prefab/gameTimeScheduler';
import { tumbleweedPrefabs } from '@dontstarve-web/prefab/tumbleweed';
import { saplingPrefabs } from '@dontstarve-web/prefab/sapling';
import { pondPrefabs } from '@dontstarve-web/prefab/pond';
import { marshPlantPrefabs } from '@dontstarve-web/prefab/marsh_plant';
import { FireFxHost } from '@dontstarve-web/prefab/treeFire';
import { hotspringPrefabs } from '@dontstarve-web/prefab/hotspring';
import { lavaPondPrefabs } from '@dontstarve-web/prefab/lava_pond';
import { WormholeManager, WORMHOLE_ID } from '@dontstarve-web/prefab/wormhole';
import { portalPrefabs } from '@dontstarve-web/prefab/portal';
import { nightmareGrowthPrefabs, type NightmareGrowthCrackInstance } from '@dontstarve-web/prefab/nightmaregrowth';
import { NightmareRockManager } from '@dontstarve-web/prefab/nightmarerock';
import { pigKingPrefabs } from '@dontstarve-web/prefab/pigking';
import { BERNIE_ITEM_ID, berniePrefabs, type BernieWorld } from '@dontstarve-web/prefab/bernie';
import { StatueGlommerManager } from '@dontstarve-web/prefab/statueglommer';
import { atriumGatePrefabs } from '@dontstarve-web/prefab/atrium_gate';
import { ruinsStatuePrefabs, type RuinsStatueId } from '@dontstarve-web/prefab/ruins_statue_mage';
import { AtriumStatueManager } from '@dontstarve-web/prefab/atrium_statue';
import { ChessJunkManager } from '@dontstarve-web/prefab/chessjunk';
import { chesspiecePrefabs } from '@dontstarve-web/prefab/chesspieces';
import { archiveCentipedeHuskPrefabs } from '@dontstarve-web/prefab/archive_centipede';
import { BeefaloManager, BEEFALO_BEHAVIOR } from '@dontstarve-web/prefab/beefalo';
import { newEntityId } from '@dontstarve-web/prefab/saveRecord';
import { player, playerInstance } from './player';
import {
  PlaceableBuildingPlacement,
  type PlaceableBuildingInteractionChange,
  type PlaceableBuildingId,
} from './placeableBuilding';
import { dstLighting, renderer, scene } from './universal';
import { flowerPrefabs } from '@dontstarve-web/prefab/flower';
import { view } from './view';
import { initialSave, shardSaveSearch } from './save/initialSave';
import { ReskinEffects } from '@dontstarve-web/prefab/reskin_tool';
import { RainEffect } from '@dontstarve-web/prefab/rain';
import { SnowEffect } from '@dontstarve-web/prefab/snow';
import { worldFxPrefabs, worldFxSpawner } from '@dontstarve-web/prefab/world_fx';
import { OceanWaves } from '@dontstarve-web/prefab/ocean_waves';
import { WaveManager, type WaveMap } from '../packages/componets/src/wavemanager';
import { WORLD_SCALE } from '../packages/prefab/src/standardcomponents';
import { TILE_SIZE } from '../packages/prefab/src/tile';
import { SAVE_CATALOG } from './save/catalog';
import { staticObstacleTest } from '@dontstarve-web/prefab/locomotor';
import { deciduousPrefabs } from '@dontstarve-web/prefab/deciduoustrees';
import { evergreenPrefabs } from '@dontstarve-web/prefab/evergreens';

import { EntityRegistry } from './entityRegistry';
import { PREFAB_DEFINITIONS } from './prefabDefinitions';
import type { WorldState } from './worldState';

type SceneWorldState = Pick<WorldState, 'clock' | 'season' | 'isNight' | 'cycle' | 'getWatchWorldContent' | 'tickingarea' | 'worldwind' | 'scheduler' | 'portalRez' | 'componentUpdates' | 'temperature' | 'weather' | 'perishClock' | 'soundPresentation'>;

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
  'stalagmite': PREFAB_DEFINITIONS.stalagmites,
  'rocks': PREFAB_DEFINITIONS.rocks,
  'moonglass_rock': PREFAB_DEFINITIONS.moonglassRocks,
  'cave_hole': PREFAB_DEFINITIONS.caveHoles,
  'pillar_ruins': PREFAB_DEFINITIONS.pillarRuins,
  'cave_pillar': PREFAB_DEFINITIONS.cavePillars,
  'pillar_atrium': PREFAB_DEFINITIONS.atriumPillars,
  'archive_pillar': PREFAB_DEFINITIONS.archivePillars,
  'vault_pillar': PREFAB_DEFINITIONS.vaultPillars,
  'monkeypillar': PREFAB_DEFINITIONS.monkeyPillars,
  'cave_entrance': PREFAB_DEFINITIONS.caveEntrances,
  'cave_exit': PREFAB_DEFINITIONS.caveExits,
  'grotto_pool': PREFAB_DEFINITIONS.grottoPools,
  'mushtree': PREFAB_DEFINITIONS.mushtrees,
  'mushroom_plant': PREFAB_DEFINITIONS.mushroomPlants,
  'marbleshrub': PREFAB_DEFINITIONS.marbleShrubs,
  'archive_props': PREFAB_DEFINITIONS.archiveProps,
  'skeleton': PREFAB_DEFINITIONS.skeletons,
  'houndbone': PREFAB_DEFINITIONS.houndbones,
  'beequeenhivegrown': PREFAB_DEFINITIONS.beeQueenHives,
  'dragonfly': PREFAB_DEFINITIONS.dragonflies,
  'dragonfly_spawner': PREFAB_DEFINITIONS.dragonflySpawners,
  'marblebean_sapling': PREFAB_DEFINITIONS.marbleBeanSaplings,
  'rock_avocado_bush': PREFAB_DEFINITIONS.rockAvocadoBushes,
  'rock_avocado_fruit_sprout_sapling': PREFAB_DEFINITIONS.rockAvocadoSaplings,
  'berrybush': PREFAB_DEFINITIONS.berrybushes,
  'monkeytail': PREFAB_DEFINITIONS.monkeytails,
  'grass': PREFAB_DEFINITIONS.grasses,
  'sapling': PREFAB_DEFINITIONS.saplings,
  'cave_fern': PREFAB_DEFINITIONS.caveFerns,
  'lichen': PREFAB_DEFINITIONS.lichens,
  'cactus': PREFAB_DEFINITIONS.cacti,
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
  'moon_tree': PREFAB_DEFINITIONS.moonTrees,
  'pigking': PREFAB_DEFINITIONS.pigKings,
  'bernie': PREFAB_DEFINITIONS.bernies,
  'statueglommer': PREFAB_DEFINITIONS.glommerStatues,
  'atrium_gate': PREFAB_DEFINITIONS.atriumGates,
  'ruins_statue_mage': PREFAB_DEFINITIONS.ruinsStatueMages,
  'ruins_statue_mage_nogem': PREFAB_DEFINITIONS.ruinsStatueMagesNoGem,
  'ruins_statue_head': PREFAB_DEFINITIONS.ruinsStatueHeads,
  'ruins_statue_head_nogem': PREFAB_DEFINITIONS.ruinsStatueHeadsNoGem,
  'ruinsrelic': PREFAB_DEFINITIONS.ruinsRelics,
  'atrium_statue': PREFAB_DEFINITIONS.atriumStatues,
  'chessjunk': PREFAB_DEFINITIONS.chessJunk,
  'chesspiece_malbatross_marble': PREFAB_DEFINITIONS.chesspieces,
  'archive_centipede_husk': PREFAB_DEFINITIONS.archiveCentipedeHusks,
  'sanityrock': PREFAB_DEFINITIONS.nightmareRocks,
  'rain': PREFAB_DEFINITIONS.rain,
  'snow': PREFAB_DEFINITIONS.snow,
  'ocean_waves': PREFAB_DEFINITIONS.oceanWaves,
  'stafflight': PREFAB_DEFINITIONS.staffLights,
  'staff_castinglight': PREFAB_DEFINITIONS.staffCastingLights,
  'pond': PREFAB_DEFINITIONS.ponds,
  'marsh_plant': PREFAB_DEFINITIONS.marshPlants,
} as const;

// Keep frame callbacks and reverse disposal in their existing order, independently of construction dependencies.
const SCENE_LIFECYCLE_ORDER = [
  PREFAB_DEFINITIONS.farmPlow,
  PREFAB_DEFINITIONS.farmDecor,
  PREFAB_DEFINITIONS.plantedSeeds,
  PREFAB_DEFINITIONS.moonTrees,
  PREFAB_DEFINITIONS.moonTreeSaplings,
  PREFAB_DEFINITIONS.evergreens,
  PREFAB_DEFINITIONS.deciduousTrees,
  PREFAB_DEFINITIONS.pigKings,
  PREFAB_DEFINITIONS.glommerStatues,
  PREFAB_DEFINITIONS.atriumGates,
  PREFAB_DEFINITIONS.ruinsStatueMages,
  PREFAB_DEFINITIONS.ruinsStatueMagesNoGem,
  PREFAB_DEFINITIONS.ruinsStatueHeads,
  PREFAB_DEFINITIONS.ruinsStatueHeadsNoGem,
  PREFAB_DEFINITIONS.atriumStatues,
  PREFAB_DEFINITIONS.buildings,
  PREFAB_DEFINITIONS.lightflierFlowers,
  PREFAB_DEFINITIONS.groundItems,
  PREFAB_DEFINITIONS.flowers,
  PREFAB_DEFINITIONS.staffLights,
  PREFAB_DEFINITIONS.staffCastingLights,
  PREFAB_DEFINITIONS.bulbPlants,
  PREFAB_DEFINITIONS.molehills,
  PREFAB_DEFINITIONS.beefalos,
  PREFAB_DEFINITIONS.stalagmites,
  PREFAB_DEFINITIONS.rocks,
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
  const prefabDisplays = new PrefabDisplayGroup(scene), prefabBaseUrl = `${import.meta.env.BASE_URL}dst/data/anim`;
  const prefabFire = FireFxHost.create(prefabBaseUrl, worldState.componentUpdates);
  // Shared by the ground Bernie item and the bernie_active / bernie_big prefabs, built on first use.
  let bernieWorldInstance: BernieWorld | undefined;
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(prefabDisplays, prefabBaseUrl,
    { tickingarea: worldState.tickingarea, physics: world });
  const registry = new EntityRegistry(SCENE_LIFECYCLE_ORDER, prefabs, () => player.position, prefabDisplays);
  const worldEvents = new EventEmitter<WorldEvents>();
  type SceneManagers = {
    'buildings': ReturnType<typeof registerBuildings>;
    'reskinEffects': ReturnType<typeof registerReskinEffects>;
    'world_fx': ReturnType<typeof registerWorldFx>;
    'staff_projectile': ReturnType<typeof registerStaffProjectiles>;
    'molehill': ReturnType<typeof registerMolehills>;
    'lightflier_flower': ReturnType<typeof registerLightFlierFlowers>;
    'ground_item': ReturnType<typeof registerGroundItems>;
    'bulb_plant': ReturnType<typeof registerBulbPlants>;
    'moonglass_rock': ReturnType<typeof registerMoonglassRocks>;
    'cave_hole': ReturnType<typeof registerCaveHoles>;
    'pillar_ruins': ReturnType<typeof registerPillarRuins>;
    'cave_pillar': typeof prefabs;
    'pillar_atrium': ReturnType<typeof registerAtriumPillars>;
    'archive_pillar': ReturnType<typeof registerArchivePillars>;
    'vault_pillar': ReturnType<typeof registerVaultPillars>;
    'monkeypillar': ReturnType<typeof registerMonkeyPillars>;
    'cave_exit': ReturnType<typeof registerCaveExits>;
    'grotto_pool': ReturnType<typeof registerGrottoPools>;
    'mushroom_plant': ReturnType<typeof registerMushroomPlants>;
    'marbleshrub': ReturnType<typeof registerMarbleShrubs>;
    'archive_props': ReturnType<typeof registerArchiveProps>;
    'marblebean_sapling': ReturnType<typeof registerMarbleBeanSaplings>;
    'rock_avocado_bush': ReturnType<typeof registerRockAvocadoBushes>;
    'rock_avocado_fruit_sprout_sapling': ReturnType<typeof registerRockAvocadoSaplings>;
    'grass': ReturnType<typeof registerGrasses>;
    'sapling': ReturnType<typeof registerSaplings>;
    'cave_fern': ReturnType<typeof registerCaveFerns>;
    'wormhole': ReturnType<typeof registerWormholes>;
    'multiplayer_portal_moonrock': ReturnType<typeof registerPortals>;
    'beefalo': ReturnType<typeof registerBeefalos>;
    'evergreen': ReturnType<typeof registerEvergreens>;
    'deciduoustree': ReturnType<typeof registerDeciduousTrees>;
    'farm_plow': ReturnType<typeof registerFarmPlow>;
    'moon_tree': ReturnType<typeof registerMoonTrees>;
    'statueglommer': ReturnType<typeof registerStatueGlommer>;
    'atrium_gate': typeof prefabs;
    'ruins_statue_mage': typeof prefabs;
    'ruins_statue_mage_nogem': typeof prefabs;
    'ruins_statue_head': typeof prefabs;
    'ruins_statue_head_nogem': typeof prefabs;
    'atrium_statue': ReturnType<typeof registerAtriumStatue>;
    'chessjunk': ReturnType<typeof registerChessJunk>;
    'sanityrock': ReturnType<typeof registerNightmareRocks>;
    'rain': ReturnType<typeof registerRain>;
    'snow': ReturnType<typeof registerSnow>;
    'ocean_waves': ReturnType<typeof registerOceanWaves>;
    'staff_castinglight': ReturnType<typeof registerStaffCastingLights>;
    'pond': ReturnType<typeof registerPonds>;
    'marsh_plant': ReturnType<typeof registerMarshPlants>;
  };
  // Filled in dependency order below; deferred callbacks run after scene setup.
  const Managers = {} as SceneManagers;

  const sceneInventory = inventory ?? createInventoryStore();
  sceneInventory.entities.bindPerishWorld({ perishClock: worldState.perishClock, scheduler: worldState.scheduler });
  sceneInventory.entities.bindTemperatureWorld({
    componentUpdates: worldState.componentUpdates,
    temperature: worldState.temperature, clock: worldState.clock, unitScale: WORLD_SCALE,
    findHeaters: (position, radius, ignoredTags) => FindEntities(position, radius, ['HASHEATER'], ignoredTags) as TemperatureSource[],
  });
  const dynamicMusic = scheduler ? new DynamicMusic(scheduler, path => PlaySound(path)) : undefined;

  Managers['buildings'] = registerBuildings(registry, 'buildings', worldState);
  Managers['reskinEffects'] = registerReskinEffects(registry, 'reskinEffects', worldState);
  registerFlowers(registry, 'flower', worldState);
  Managers['world_fx'] = registerWorldFx(registry, 'world_fx', worldState);
  Managers['staff_projectile'] = registerStaffProjectiles(registry, 'staff_projectile', worldState);
  Managers['molehill'] = registerMolehills(registry, 'molehill', worldState);
  Managers['lightflier_flower'] = registerLightFlierFlowers(registry, 'lightflier_flower', worldState);
  Managers['ground_item'] = registerGroundItems(registry, 'ground_item', worldState);

  registerStaffLights(registry, worldState);
  Managers['staff_castinglight'] = registerStaffCastingLights(registry, worldState);
  Managers['bulb_plant'] = registerBulbPlants(registry, 'bulb_plant', worldState);
  registerStalagmites(registry, worldState);
  registerRocks(registry, worldState);
  Managers['moonglass_rock'] = registerMoonglassRocks(registry, 'moonglass_rock', worldState);
  Managers['cave_hole'] = registerCaveHoles(registry, 'cave_hole', worldState);
  Managers['pillar_ruins'] = registerPillarRuins(registry, 'pillar_ruins');
  // pillarPrefabs above declares these too: they share pillar.lua's one definition.
  registry.registerPrefabs(MANAGER_DEFINITIONS['cave_pillar']);
  Managers['cave_pillar'] = prefabs;
  Managers['pillar_atrium'] = registerAtriumPillars(registry, 'pillar_atrium');
  Managers['archive_pillar'] = registerArchivePillars(registry, 'archive_pillar');
  Managers['vault_pillar'] = registerVaultPillars(registry, 'vault_pillar');
  Managers['monkeypillar'] = registerMonkeyPillars(registry, 'monkeypillar', worldState);
  /** ms_playerdespawnandmigrate: the destination shard is the cluster's other save, loaded by reloading the page. */
  const shardLink: WorldMigratorShard = {
    isWorldAvailable: shard => shard === CAVES_SHARD || shard === MASTER_SHARD,
    isWorldFull: () => false,
    migratePlayer: (_player, _portal, shard) => { window.location.search = shardSaveSearch(window.location.search, shard); },
  };

  registerCaveEntrances(registry, 'cave_entrance');
  Managers['cave_exit'] = registerCaveExits(registry, 'cave_exit', worldState);
  Managers['grotto_pool'] = registerGrottoPools(registry, 'grotto_pool', worldState);
  registerMushtrees(registry, 'mushtree', worldState);
  Managers['mushroom_plant'] = registerMushroomPlants(registry, 'mushroom_plant', worldState);
  Managers['marbleshrub'] = registerMarbleShrubs(registry, 'marbleshrub', worldState);
  Managers['archive_props'] = registerArchiveProps(registry, 'archive_props', worldState);
  registerSkeletons(registry, 'skeleton');
  registerHoundbones(registry, 'houndbone');
  registerBeeQueenHives(registry, 'beequeenhivegrown', worldState);
  registerDragonflies(registry, 'dragonfly', worldState);
  registerDragonflySpawners(registry, 'dragonfly_spawner', worldState);
  Managers['marblebean_sapling'] = registerMarbleBeanSaplings(registry, 'marblebean_sapling', worldState);
  Managers['rock_avocado_bush'] = registerRockAvocadoBushes(registry, 'rock_avocado_bush', worldState);
  Managers['rock_avocado_fruit_sprout_sapling'] = registerRockAvocadoSaplings(registry, 'rock_avocado_fruit_sprout_sapling', worldState);
  registerBerrybushes(registry, 'berrybush', worldState);
  registerMonkeytails(registry, 'monkeytail', worldState);
  Managers['grass'] = registerGrasses(registry, 'grass', worldState);
  Managers['sapling'] = registerSaplings(registry, 'sapling', worldState);
  Managers['cave_fern'] = registerCaveFerns(registry, 'cave_fern', worldState);
  registerLichens(registry, 'lichen', worldState);
  registerCacti(registry, 'cactus', worldState);
  registerLavaPonds(registry, 'lava_pond', worldState);

  const worldWind = worldState.worldwind;
  registerTumbleweeds(registry, 'tumbleweed', worldState);
  registerHotsprings(registry, 'hotspring', worldState);
  Managers['wormhole'] = registerWormholes(registry, 'wormhole', worldState);
  Managers['multiplayer_portal_moonrock'] = registerPortals(registry, 'multiplayer_portal_moonrock', worldState);
  registerNightmareGrowths(registry, 'nightmaregrowth', worldState);
  Managers['beefalo'] = registerBeefalos(registry, 'beefalo', worldState);
  Managers['evergreen'] = registerEvergreens(registry, 'evergreen', worldState);
  Managers['deciduoustree'] = registerDeciduousTrees(registry, 'deciduoustree', worldState);
  Managers['farm_plow'] = registerFarmPlow(registry, 'farm_plow', worldState);
  Managers['moon_tree'] = registerMoonTrees(registry, 'moon_tree', worldState);
  registerPigKings(registry, 'pigking', worldState);
  registerBernies(registry, 'bernie', worldState);
  Managers['statueglommer'] = registerStatueGlommer(registry, 'statueglommer', worldState);
  Managers['atrium_gate'] = registerAtriumGate(registry, 'atrium_gate', worldState);
  // statueruins.lua returns the four prefabs together.
  prefabs.register(ruinsStatuePrefabs({ scheduler: worldState.scheduler }));
  Managers['ruins_statue_mage'] = registerRuinsStatue(registry, 'ruins_statue_mage');
  Managers['ruins_statue_mage_nogem'] = registerRuinsStatue(registry, 'ruins_statue_mage_nogem');
  Managers['ruins_statue_head'] = registerRuinsStatue(registry, 'ruins_statue_head');
  Managers['ruins_statue_head_nogem'] = registerRuinsStatue(registry, 'ruins_statue_head_nogem');
  registerRuinsRelics(registry, worldState);
  Managers['atrium_statue'] = registerAtriumStatue(registry, 'atrium_statue', worldState);
  Managers['chessjunk'] = registerChessJunk(registry, 'chessjunk', worldState);
  registerChesspieces(registry, 'chesspiece_malbatross_marble', worldState);
  registerArchiveCentipedeHusks(registry, 'archive_centipede_husk', worldState);
  Managers['marsh_plant'] = registerMarshPlants(registry, worldState);
  Managers['pond'] = registerPonds(registry, 'pond', worldState);
  Managers['sanityrock'] = registerNightmareRocks(registry, 'sanityrock', worldState);
  Managers['rain'] = registerRain(registry, 'rain', worldState);
  Managers['snow'] = registerSnow(registry, 'snow', worldState);
  Managers['ocean_waves'] = registerOceanWaves(registry, 'ocean_waves', worldState);

  registry.assertDefinitions(Object.values(PREFAB_DEFINITIONS));

  const stopDugTurf = turfMap.onDig((point, tileId) => {
    const itemId = turfItemForTile(tileId);
    if (!itemId) return;
    const spec = GROUND_ITEM_DISPLAY_SPECS[itemId];
    Managers['ground_item'].flingLoot([{ itemId, count: 1, name: spec.name, icon: spec.icon, atlas: spec.atlas }],
      new THREE.Vector3(point.x, 0, point.z));
  });

  const dispose = () => {
    stopDugTurf();
    try { registry.dispose(); }
    finally { Managers['molehill'].disposeBaits(); prefabDisplays.dispose(); prefabFire.dispose(); dynamicMusic?.dispose(); if (!inventory) sceneInventory.dispose(); }
  };

  return {
    Managers, registry, prefabs, worldEvents, dispose, worldWind,
    buildingPlacement: Managers['buildings'],
    groundItems: Managers['ground_item'],
    beefalos: Managers['beefalo'],
    mushroomPlants: Managers['mushroom_plant'],
    rockAvocadoBushes: Managers['rock_avocado_bush'],
    grasses: Managers['grass'],
    saplings: Managers['sapling'],
    ponds: Managers['pond'],
    wormholes: Managers['wormhole'],
    reskinEffects: Managers['reskinEffects'],
    worldFx: Managers['world_fx'],
    staffProjectiles: Managers['staff_projectile'],
    farmPlow: Managers['farm_plow'],
  };

  function registerBuildings(registry: EntityRegistry, prefabId: 'buildings', worldState: SceneWorldState) {
    const buildingPlacement = new PlaceableBuildingPlacement(
      { ...view, physics: world, pathfinder, scheduler: scheduler ?? worldState.scheduler, fire: prefabFire, weather: worldState.weather, dynamicMusic, handEquipment: sceneInventory.handEquipment,
        getLocalTemperature: (x, z) => GetTemperatureAtXZ(() => worldState.temperature.peek(), x, z), itemEntities: sceneInventory.entities,
        cycle: worldState.cycle, getWatchWorldContent: worldState.getWatchWorldContent, tickingarea: worldState.tickingarea, isNight: worldState.isNight, perishClock: worldState.perishClock,
        secondsUntilNextDay: now => TUNING.TOTAL_DAY_TIME - now % TUNING.TOTAL_DAY_TIME,
        // world_fx registers after the buildings; the manager is read when an fx is played.
        fx: { spawn: (prefab, position) => { Managers['world_fx'].spawn(prefab, position); },
          collapse: (size, position, material) => Managers['world_fx'].collapse(size, position, material) },
        spawnItem: state => { const entity = sceneInventory.entities.create(state); sceneInventory.configureItem(entity); return entity; },
        dropItem: (entity, position) => { sceneInventory.DropItem(entity, position); },
        registerContainer: (id, container) => sceneInventory.registerContainer(id, container),
        unregisterContainer: (id, container) => sceneInventory.unregisterContainer(id, container), dropLoot: (items, position, launch) => {
        Managers['ground_item'].flingLoot(items.map((item) => ({ ...SAVE_CATALOG.items[item.itemId], ...item })), position, launch);
      } },
      consumeBufferedBuild,
      onBuildingInteraction,
      prefabs,
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

  function registerFlowers(registry: EntityRegistry, prefabId: 'flower', worldState: SceneWorldState) {
    prefabs.register(flowerPrefabs({ scheduler: scheduler ?? worldState.scheduler, fire: prefabFire, worldEvents,
      spawnGroundItem: (definition, position, options) => Managers['ground_item'].spawnGroundItem(definition, position, options) }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerWorldFx(registry: EntityRegistry, prefabId: 'world_fx', worldState: SceneWorldState) {
    prefabs.register(worldFxPrefabs({ scheduler: scheduler ?? worldState.scheduler }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return worldFxSpawner(prefabs);
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
        && !getRegisteredPhysicsBodies(world).some(body => body.type === CANNON.Body.STATIC && body.collisionResponse &&
          body.shapes.some(shape => shape instanceof CANNON.Box || shape instanceof CANNON.Sphere || shape instanceof CANNON.Trimesh) && (() => {
            body.updateAABB(); const b = body.aabb;
            return point.x >= b.lowerBound.x - radius && point.x <= b.upperBound.x + radius && point.z >= b.lowerBound.z - radius && point.z <= b.upperBound.z + radius;
          })());
    };
    const habitat = createMoleHabitat({
      handEquipment: sceneInventory.handEquipment,
      itemSpecs: SAVE_CATALOG.items, getWatchWorldContent: worldState.getWatchWorldContent, cameraHeading: view.cameraHeading,
      isWalkable: moleWalkable,
      pathfinder,
      spawnItem: state => { const entity = sceneInventory.entities.create(state); sceneInventory.configureItem(entity); return entity; },
      dropItem: (entity, position) => sceneInventory.DropItem(entity, position),
      showMole: (entity, position) => { Managers['ground_item'].spawnFromSave(entity.id, {
        ...SAVE_CATALOG.items.mole, ...entity.snapshot(), entity,
      }, position); },
      dropLoot: (itemId, position) => { Managers['ground_item'].flingLoot([{ ...SAVE_CATALOG.items[itemId], itemId, count: 1 }], position); },
      getEntities: () => {
        for (const entity of sceneInventory.entities.values()) if (entity.components.bait && !moleBaits.has(entity.id))
          moleBaits.set(entity.id, new MoleBait(entity, moleScheduler, moleWalkable));
        for (const [id, bait] of moleBaits) if (bait.entity.isRemoved) { bait.dispose(); moleBaits.delete(id); }
        return [...moleBaits.values(), ...habitat.getMoles(),
          { prefab: 'wilson', components: {}, isValid: () => true, hasTag: (tag: string) => tag === 'scarytoprey',
            getPosition: () => player.position, getPhysicsRadius: () => .5 * WORLD_SCALE }];
      },
      spawnPrefab: (prefab, position) => prefabs.spawn(prefab, position) as MolehillInstance,
      fx: Managers['world_fx'],
    });
    prefabs.register(molehillPrefabs(habitat));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return { habitat, disposeBaits: () => { for (const bait of moleBaits.values()) bait.dispose(); moleBaits.clear(); } };
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
        // butterflybrain.lua GetClosestInstWithTag({"flower"}): the flower-tagged entities in the ticking area.
        getFlowers: () => activePrefabs.filter(inst => inst.hasTag('flower')).map(inst => ({ id: String(prefabInstance(inst.model)?.entityId), position: inst.getPosition() })),
        constrainPosition: (position) => {
          const edge = initialSave.world.map.generator.options.size / 2 - 0.5;
          position.x = THREE.MathUtils.clamp(position.x, -edge, edge);
          position.z = THREE.MathUtils.clamp(position.z, -edge, edge);
        },
      },
      {
        getWatchWorldContent: worldState.getWatchWorldContent,
        tickingarea: worldState.tickingarea,
      },
      bernieWorld(worldState),
      itemEntities ?? sceneInventory.entities,
      scheduler,
      Managers['world_fx'],
      Managers['molehill'].habitat,
      worldEvents,
      view.mouseActions,
      Managers['lightflier_flower'].habitat,
      worldState.tickingarea,
      world,
    );
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => {
        const item = record.components.stack!;
        const spec = SAVE_CATALOG.items[item.itemId] ?? GROUND_ART_DEFINITIONS[item.itemId];
        const skin = item.skinId ? SAVE_CATALOG.skins[item.skinId] : undefined;
        return groundItems.spawnFromSave(record.id, {
          ...item, name: skin?.name ?? spec.name, icon: skin?.icon ?? spec.icon ?? '', atlas: skin?.atlas ?? spec.atlas,
          ...(record.components.phonograph ? { playbackRemaining: record.components.phonograph.remainingSeconds } : {}),
          ...(record.components.torch ? { torchLit: true } : {}),
          ...(record.components.lantern ? { lanternOn: record.components.lantern.ison } : {}),
        }, new THREE.Vector3(...record.transform.position));
      },
      debugSpawn: (id) => groundItems.spawnFromSave(newEntityId(), {
        ...GROUND_ART_DEFINITIONS[id], ...SAVE_CATALOG.items[id], icon: SAVE_CATALOG.items[id]?.icon ?? GROUND_ART_DEFINITIONS[id]?.icon ?? '', itemId: id, count: 1,
      }, player.position.clone().setY(0)),
      exportRecords: () => groundItems.exportRecords().map((record) => ({ prefabId: 'ground_item', record })),
      update: (dt, quaternion) => groundItems.update(dt, quaternion),
      renderEntities: () => groundItems.renderEntities,
      dispose: () => groundItems.dispose(),
    });
    return groundItems;
  }

  function registerLightFlierFlowers(registry: EntityRegistry, prefabId: 'lightflier_flower', worldState: SceneWorldState) {
    const lightFlierPlayer = { position: player.position, isValid: () => !playerStats.health.IsDead(),
      hasLightFlier: () => sceneInventory.Has('lightflier'),
      getFacing: () => playerInstance.worldHeading, getWalkSpeed: () => 4 * WORLD_SCALE,
      wantsToMove: () => playerInstance.wantsToMoveForward };
    const flowers = new LightFlierFlowerManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
      maxMovementStep: MAX_PHYSICS_FRAME_TIME,
      scheduler: scheduler ?? worldState.scheduler, getWatchWorldContent: worldState.getWatchWorldContent, tickingarea: worldState.tickingarea, cameraHeading: view.cameraHeading,
      getPlayers: () => [lightFlierPlayer],
      spawnItem: state => { const entity = sceneInventory.entities.create(state); sceneInventory.configureItem(entity); return entity; },
      showItem: (entity, position) => Managers['ground_item'].spawnEntity(entity, position),
      dropLoot: (itemId, count, position) => { Managers['ground_item'].flingLoot([{ ...SAVE_CATALOG.items[itemId], itemId, count }], position); },
    }, model => dstLighting.sampleLightLevel(model.position, model));
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => flowers.spawn(new THREE.Vector3(...record.transform.position), record as LightFlierFlowerRecord),
      debugSpawn: () => flowers.spawn(player.position.clone()),
      exportRecords: () => flowers.exportRecords().map(record => ({ prefabId, record })),
      update: (dt, quaternion) => flowers.update(dt, quaternion), renderEntities: () => flowers.renderEntities,
      dispose: () => flowers.dispose(),
    });
    return flowers;
  }

  function registerBulbPlants(registry: EntityRegistry, prefabId: 'bulb_plant', worldState: SceneWorldState) {
    prefabs.register(bulbPlantPrefabs({
      scheduler: scheduler ?? worldState.scheduler,
      getLightLevel: model => dstLighting.sampleLightLevel(model.position, model),
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerStalagmites(registry: EntityRegistry, worldState: SceneWorldState) {
    prefabs.register(stalagmitePrefabs({ scheduler: worldState.scheduler,
      spawnLoot: (id, position) => {
        const definition = GROUND_ART_DEFINITIONS[id];
        return definition ? Managers['ground_item'].spawnGroundItem({ ...definition, icon: definition.icon ?? '',
          itemId: id, count: 1 }, position, { fling: true }) : undefined;
      } }));
    registry.registerPrefabs(PREFAB_DEFINITIONS.stalagmites);
  }

  function registerRocks(registry: EntityRegistry, worldState: SceneWorldState) {
    const spawnGroundItem: SpawnGroundItem = (definition, position, options) => Managers['ground_item'].spawnGroundItem(definition, position, options);
    prefabs.register(rockPrefabs({ handEquipment: sceneInventory.handEquipment, scheduler: scheduler ?? worldState.scheduler,
      getWatchWorldContent: worldState.getWatchWorldContent, spawnGroundItem, spawnPrefab: (id, position) => prefabs.spawn(id, position) }));
    prefabs.register(caveinBoulderPrefabs({ handEquipment: sceneInventory.handEquipment, spawnGroundItem }));
    prefabs.register(moonrockseedPrefabs());
    registry.registerPrefabs(PREFAB_DEFINITIONS.rocks);
  }

  function registerMoonglassRocks(registry: EntityRegistry, prefabId: 'moonglass_rock', worldState: SceneWorldState) {
    prefabs.register(moonglassRockPrefabs({
      handEquipment: sceneInventory.handEquipment,
      scheduler: scheduler ?? worldState.scheduler, getWatchWorldContent: worldState.getWatchWorldContent,
      spawnGroundItem: (definition, position, options) => Managers['ground_item'].spawnGroundItem(definition, position, options),
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerCaveHoles(registry: EntityRegistry, prefabId: 'cave_hole', worldState: SceneWorldState) {
    prefabs.register(caveHolePrefabs({
      getWatchWorldContent: worldState.getWatchWorldContent,
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerPillarRuins(registry: EntityRegistry, prefabId: 'pillar_ruins') {
    prefabs.register(pillarPrefabs());
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerAtriumPillars(registry: EntityRegistry, prefabId: 'pillar_atrium') {
    prefabs.register(atriumPillarPrefabs());
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerArchivePillars(registry: EntityRegistry, prefabId: 'archive_pillar') {
    prefabs.register(archivePillarPrefabs());
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerVaultPillars(registry: EntityRegistry, prefabId: 'vault_pillar') {
    prefabs.register(vaultPillarPrefabs({ spawnPrefab: (id, position) => prefabs.spawn(id, position) }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerMonkeyPillars(registry: EntityRegistry, prefabId: 'monkeypillar', worldState: SceneWorldState) {
    prefabs.register(monkeyPillarPrefabs({ scheduler: worldState.scheduler, getWatchWorldContent: worldState.getWatchWorldContent }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerCaveEntrances(registry: EntityRegistry, prefabId: 'cave_entrance') {
    prefabs.register(caveEntrancePrefabs({
      handEquipment: sceneInventory.handEquipment,
      spawnGroundItem: (definition, position, options) => Managers['ground_item'].spawnGroundItem(definition, position, options),
      spawnPrefab: (prefab, position) => prefabs.spawn(prefab, position),
      shard: shardLink,
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerMushroomPlants(registry: EntityRegistry, prefabId: 'mushroom_plant', worldState: SceneWorldState) {
    prefabs.register(mushroomPlantPrefabs({
      scheduler: scheduler ?? worldState.scheduler, fire: prefabFire, getWatchWorldContent: worldState.getWatchWorldContent,
      spawnGroundItem: (definition, position, options) => Managers['ground_item'].spawnGroundItem(definition, position, options),
      rain: worldState.weather.preciptype,
      tickingarea: worldState.tickingarea,
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerMushtrees(registry: EntityRegistry, prefabId: 'mushtree', worldState: SceneWorldState) {
    prefabs.register(mushtreePrefabs({
      handEquipment: sceneInventory.handEquipment,
      scheduler: scheduler ?? worldState.scheduler, fire: prefabFire,
      getWatchWorldContent: worldState.getWatchWorldContent, tickingarea: worldState.tickingarea, worldEvents,
      dropLoot: (items, position) => {
        Managers['ground_item'].flingLoot(items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })), position);
      },
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }


  function registerGrottoPools(registry: EntityRegistry, prefabId: 'grotto_pool', worldState: SceneWorldState) {
    prefabs.register(grottoPoolPrefabs({
      handEquipment: sceneInventory.handEquipment,
      scheduler: scheduler ?? worldState.scheduler,
      registerWaterfallPool: (position, radius, large) => worldState.soundPresentation.registerWaterfallPool(position, radius, large),
      getWatchWorldContent: worldState.getWatchWorldContent,
      fx: { spawn: (prefab, position) => Managers['world_fx'].spawn(prefab, position) },
      spawnGroundItem: (definition, position, options) => Managers['ground_item'].spawnGroundItem(definition, position, options),
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
      getEntity: entityId => prefabs.get(entityId),
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerCaveExits(registry: EntityRegistry, prefabId: 'cave_exit', _worldState: SceneWorldState) {
    prefabs.register(caveExitPrefabs({ shard: shardLink }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerMarbleShrubs(registry: EntityRegistry, prefabId: 'marbleshrub', worldState: SceneWorldState) {
    prefabs.register(marbleShrubPrefabs({
      handEquipment: sceneInventory.handEquipment,
      scheduler: scheduler ?? worldState.scheduler, getWatchWorldContent: worldState.getWatchWorldContent,
      spawnGroundItem: (definition, position, options) => Managers['ground_item'].spawnGroundItem(definition, position, options),
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerArchiveProps(registry: EntityRegistry, prefabId: 'archive_props', worldState: SceneWorldState) {
    prefabs.register(archivePropsPrefabs({
      handEquipment: sceneInventory.handEquipment, scheduler: worldState.scheduler, cameraFacing: view.cameraFacing,
      spawnGroundItem: (definition, position, options) => Managers['ground_item'].spawnGroundItem(definition, position, options),
      fx: Managers['world_fx'],
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerHoundbones(registry: EntityRegistry, prefabId: 'houndbone') {
    prefabs.register(houndbonePrefabs({
      fx: Managers['world_fx'],
      handEquipment: sceneInventory.handEquipment,
      spawnGroundItem: (definition, position, options) => Managers['ground_item'].spawnGroundItem(definition, position, options),
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }


  function registerBeeQueenHives(registry: EntityRegistry, prefabId: 'beequeenhivegrown', worldState: SceneWorldState) {
    prefabs.register(beeQueenHivePrefabs({ handEquipment: sceneInventory.handEquipment, scheduler: worldState.scheduler }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerDragonflies(registry: EntityRegistry, prefabId: 'dragonfly', worldState: SceneWorldState) {
    prefabs.register(dragonflyPrefabs({ scheduler: worldState.scheduler, getWatchWorldContent: worldState.getWatchWorldContent }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }


  function registerDragonflySpawners(registry: EntityRegistry, prefabId: 'dragonfly_spawner', worldState: SceneWorldState) {
    prefabs.register(dragonflySpawnerPrefabs({
      scheduler: worldState.scheduler,
      spawnDragonfly: position => prefabs.spawn(DRAGONFLY_ID, position).transform.model,
      resolveDragonfly: id => prefabs.get(id)?.transform.model,
      isPassable: position => turfMap.isPassableAtPoint(position),
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerSkeletons(registry: EntityRegistry, prefabId: 'skeleton') {
    prefabs.register(skeletonPrefabs({
      fx: { collapse: (size, position, material) => Managers['world_fx'].collapse(size, position, material) },
      handEquipment: sceneInventory.handEquipment,
      spawnGroundItem: (definition, position, options) => Managers['ground_item'].spawnGroundItem(definition, position, options),
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }


  function registerMarbleBeanSaplings(registry: EntityRegistry, prefabId: 'marblebean_sapling', worldState: SceneWorldState) {
    prefabs.register(marbleBeanSaplingPrefabs({
      handEquipment: sceneInventory.handEquipment,
      scheduler: scheduler ?? worldState.scheduler,
      spawnPrefab: (id, position) => prefabs.spawn(id, position) as MarbleShrubInstance,
      spawnGroundItem: (definition, position, options) => Managers['ground_item'].spawnGroundItem(definition, position, options),
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerRockAvocadoBushes(registry: EntityRegistry, prefabId: 'rock_avocado_bush', worldState: SceneWorldState) {
    prefabs.register(rockAvocadoBushPrefabs({
      scheduler: scheduler ?? worldState.scheduler, fire: prefabFire, getWatchWorldContent: worldState.getWatchWorldContent,
      tickingarea: worldState.tickingarea,
      rain: worldState.weather.preciptype,
      physics: world, getLocalTemperature: position => GetTemperatureAtXZ(() => worldState.temperature.peek(), position.x, position.z),
      spawnGroundItem: (definition, position, options) => Managers['ground_item'].spawnGroundItem(definition, position, options),
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerRockAvocadoSaplings(registry: EntityRegistry, prefabId: 'rock_avocado_fruit_sprout_sapling', worldState: SceneWorldState) {
    prefabs.register(rockAvocadoSaplingPrefabs({
      handEquipment: sceneInventory.handEquipment,
      scheduler: scheduler ?? worldState.scheduler, fire: prefabFire,
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
      spawnGroundItem: (definition, position, options) => Managers['ground_item'].spawnGroundItem(definition, position, options),
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerBerrybushes(registry: EntityRegistry, prefabId: 'berrybush', worldState: SceneWorldState) {
    prefabs.register(berrybushPrefabs({
      scheduler: scheduler ?? worldState.scheduler, fire: prefabFire, getWatchWorldContent: worldState.getWatchWorldContent,
      tickingarea: worldState.tickingarea,
      rain: worldState.weather.preciptype,
      physics: world, getLocalTemperature: position => GetTemperatureAtXZ(() => worldState.temperature.peek(), position.x, position.z),
      spawnGroundItem: (definition, position, options) => Managers['ground_item'].spawnGroundItem(definition, position, options),
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerMonkeytails(registry: EntityRegistry, prefabId: 'monkeytail', worldState: SceneWorldState) {
    prefabs.register(monkeytailPrefabs({
      scheduler: scheduler ?? worldState.scheduler, fire: prefabFire, getWatchWorldContent: worldState.getWatchWorldContent,
      tickingarea: worldState.tickingarea,
      rain: worldState.weather.preciptype,
      getLocalTemperature: position => GetTemperatureAtXZ(() => worldState.temperature.peek(), position.x, position.z),
      spawnGroundItem: (definition, position, options) => Managers['ground_item'].spawnGroundItem(definition, position, options),
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerGrasses(registry: EntityRegistry, prefabId: 'grass', worldState: SceneWorldState) {
    prefabs.register(grassPrefabs({
      scheduler: scheduler ?? worldState.scheduler, fire: prefabFire, getWatchWorldContent: worldState.getWatchWorldContent,
      tickingarea: worldState.tickingarea,
      spawnGroundItem: (definition, position, options) => Managers['ground_item'].spawnGroundItem(definition, position, options),
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerSaplings(registry: EntityRegistry, prefabId: 'sapling', worldState: SceneWorldState) {
    prefabs.register(saplingPrefabs({
      scheduler: scheduler ?? worldState.scheduler, fire: prefabFire, getWatchWorldContent: worldState.getWatchWorldContent,
      tickingarea: worldState.tickingarea,
      spawnGroundItem: (definition, position, options) => Managers['ground_item'].spawnGroundItem(definition, position, options),
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerCaveFerns(registry: EntityRegistry, prefabId: 'cave_fern', worldState: SceneWorldState) {
    prefabs.register(caveFernPrefabs({
      scheduler: scheduler ?? worldState.scheduler, fire: prefabFire, getWatchWorldContent: worldState.getWatchWorldContent,
      tickingarea: worldState.tickingarea,
      spawnGroundItem: (definition, position, options) => Managers['ground_item'].spawnGroundItem(definition, position, options),
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerLichens(registry: EntityRegistry, prefabId: 'lichen', worldState: SceneWorldState) {
    prefabs.register(lichenPrefabs({
      scheduler: scheduler ?? worldState.scheduler, fire: prefabFire, getWatchWorldContent: worldState.getWatchWorldContent,
      tickingarea: worldState.tickingarea,
      spawnGroundItem: (definition, position, options) => Managers['ground_item'].spawnGroundItem(definition, position, options),
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerCacti(registry: EntityRegistry, prefabId: 'cactus', worldState: SceneWorldState) {
    prefabs.register(cactusPrefabs({
      scheduler: scheduler ?? worldState.scheduler, fire: prefabFire, getWatchWorldContent: worldState.getWatchWorldContent,
      tickingarea: worldState.tickingarea,
      physics: world,
      spawnGroundItem: (definition, position, options) => Managers['ground_item'].spawnGroundItem(definition, position, options),
      spawnItem: state => { const entity = sceneInventory.entities.create(state); sceneInventory.configureItem(entity); return entity; },
      dropItem: (entity, position) => { sceneInventory.DropItem(entity, position); },
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerLavaPonds(registry: EntityRegistry, prefabId: 'lava_pond', worldState: SceneWorldState) {
    prefabs.register(lavaPondPrefabs({
      scheduler: scheduler ?? worldState.scheduler,
      spawnPrefab: (prefab, position) => prefabs.spawn(prefab, position),
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    registry.registerPrefabs(PREFAB_DEFINITIONS.lavaPondRocks);
  }

  function registerTumbleweeds(registry: EntityRegistry, prefabId: 'tumbleweed', worldState: SceneWorldState) {
    prefabs.register(tumbleweedPrefabs({
      scheduler: worldState.scheduler, wind: worldWind, getWatchWorldContent: worldState.getWatchWorldContent,
      componentUpdates: worldState.componentUpdates, spawnPrefab: (prefab, position) => prefabs.spawn(prefab, position),
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
        Managers['ground_item'].flingLoot([...counts].map(([itemId, count]) => ({ ...SAVE_CATALOG.items[itemId], itemId, count })), position);
      },
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerHotsprings(registry: EntityRegistry, prefabId: 'hotspring', worldState: SceneWorldState) {
    prefabs.register(hotspringPrefabs({
      scheduler: scheduler ?? worldState.scheduler,
      fx: { spawn: (prefab, position) => Managers['world_fx'].spawn(prefab, position) },
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
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
    prefabs.register(portalPrefabs({
      scheduler: worldState.scheduler, portalRez: worldState.portalRez,
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerNightmareGrowths(registry: EntityRegistry, prefabId: 'nightmaregrowth', worldState: SceneWorldState) {
    prefabs.register(nightmareGrowthPrefabs({
      scheduler: scheduler ?? worldState.scheduler,
      spawnPrefab: (prefab, position) => prefabs.spawn(prefab, position) as NightmareGrowthCrackInstance,
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerBeefalos(registry: EntityRegistry, prefabId: 'beefalo', worldState: SceneWorldState) {
    // Colliders only change between brain updates, so one update's wander and path queries share an obstacle grid.
    let planning = false;
    let planningObstacles: ((point: THREE.Vector3) => boolean) | undefined;
    const beefalos = new BeefaloManager(scene, world, `${import.meta.env.BASE_URL}dst/data/anim`, {
      scheduler,
      // The scheduler runs on world seconds (src/scene.ts), so the next boundary is the next multiple of the day length.
      secondsUntilNextDay: now => TUNING.TOTAL_DAY_TIME - now % TUNING.TOTAL_DAY_TIME,
      clock: worldState.clock,
      getWatchWorldContent: worldState.getWatchWorldContent,
      season: worldState.season,
      getPlayerPositions: () => [player.position],
      pathfinder,
      isWalkable(point) {
        const radius = BEEFALO_BEHAVIOR.radius;
        const edge = initialSave.world.map.generator.options.size / 2 - radius;
        const blocked = planningObstacles ?? staticObstacleTest(getRegisteredPhysicsBodies(world), radius);
        if (planning) planningObstacles = blocked;
        return Math.abs(point.x) <= edge && Math.abs(point.z) <= edge && turfMap.isPassableAtPoint(point) && !blocked(point);
      },
      constrainPosition(position) {
        const edge = initialSave.world.map.generator.options.size / 2 - BEEFALO_BEHAVIOR.radius;
        position.x = THREE.MathUtils.clamp(position.x, -edge, edge);
        position.z = THREE.MathUtils.clamp(position.z, -edge, edge);
      },
      spawnPrize(prefab, count, position) {
        Managers['ground_item'].flingLoot([{ ...SAVE_CATALOG.items[prefab], itemId: prefab, count }], position);
      },
      getPoopPositions() {
        return Managers['ground_item'].iteratePrefabPositions('poop');
      },
      spawnPoop(position) {
        Managers['ground_item'].spawnFromSave(newEntityId(), {
          ...SAVE_CATALOG.items.poop, itemId: 'poop', count: 1,
        }, position);
      },
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => beefalos.spawn(new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: { beefalo: record.components.beefalo! },
      }),
      debugSpawn: () => beefalos.spawnNear(player.position),
      exportRecords: () => beefalos.exportRecords().map((record) => ({ prefabId: 'beefalo', record })),
      beforePhysics: (dt) => {
        planning = true;
        try { beefalos.update(dt); } finally { planning = false; planningObstacles = undefined; }
      },
      update: (dt, quaternion) => beefalos.sync(dt, quaternion),
      renderEntities: () => beefalos.renderEntities,
      dispose: () => beefalos.dispose(),
    });
    return beefalos;
  }

  function registerEvergreens(registry: EntityRegistry, prefabId: 'evergreen', worldState: SceneWorldState) {
    prefabs.register(evergreenPrefabs({
      handEquipment: sceneInventory.handEquipment, camera, worldEvents,
      scheduler: scheduler ?? worldState.scheduler, fire: prefabFire,
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
      growthDuration: seconds => seconds * (worldState.season.peek().season === 'spring' ? .75 : 1),
      dropLoot: (items, position) => {
        Managers['ground_item'].flingLoot(items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })), position);
      },
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerDeciduousTrees(registry: EntityRegistry, prefabId: 'deciduoustree', worldState: SceneWorldState) {
    prefabs.register(deciduousPrefabs({
      handEquipment: sceneInventory.handEquipment, camera, worldEvents,
      scheduler: scheduler ?? worldState.scheduler, fire: prefabFire,
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
      growthDuration: seconds => seconds * (worldState.season.peek().season === 'spring' ? .75 : 1),
      dropLoot: (items, position) => {
        Managers['ground_item'].flingLoot(items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })), position);
      },
      season: worldState.season, getWatchWorldContent: worldState.getWatchWorldContent,
      secondsUntilNextDay: now => TUNING.TOTAL_DAY_TIME - now % TUNING.TOTAL_DAY_TIME,
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerFarmPlow(registry: EntityRegistry, prefabId: 'farm_plow', _worldState: SceneWorldState) {
    const farmPlow = new FarmPlowPlacement({ ...view, fx: Managers['world_fx'], physics: world, handEquipment: sceneInventory.handEquipment }, turfMap,
      (position, item) => { Managers['ground_item'].spawnFromSave(item.entityId ?? newEntityId(), {
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
        id === 'farm_soil' ? record.components.farmSoil : record.components.farmDebris, record.id),
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

  function registerMoonTrees(registry: EntityRegistry, prefabId: 'moon_tree', worldState: SceneWorldState) {
    prefabs.register(moonTreePrefabs({
      handEquipment: sceneInventory.handEquipment, camera, worldEvents,
      scheduler: scheduler ?? worldState.scheduler, fire: prefabFire,
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
      growthDuration: seconds => seconds * (worldState.season.peek().season === 'spring' ? .75 : 1),
      dropLoot: (items, position) => {
        Managers['ground_item'].flingLoot(items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })), position);
      },
      getWatchWorldContent: worldState.getWatchWorldContent,
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    registry.registerPrefabs(PREFAB_DEFINITIONS.moonTreeSaplings);
    return prefabs;
  }

  /** AllPlayers and SpawnPrefab for bernie_inactive.lua's tryreanimate and the reanimated Bernies. */
  function bernieWorld(worldState: SceneWorldState): BernieWorld {
    return bernieWorldInstance ??= {
      scheduler: worldState.scheduler,
      getPlayers: () => [playerInstance],
      spawnPrefab: (prefab, position, skinId) => prefabs.spawn(prefab, new THREE.Vector3(position.x, 0, position.z), undefined, skinId),
      spawnInactive: (position, skinId) => Managers['ground_item'].spawnGroundItem({ ...SAVE_CATALOG.items[BERNIE_ITEM_ID],
        itemId: BERNIE_ITEM_ID, count: 1, ...skinId === undefined ? {} : { skinId } }, position),
    };
  }

  function registerBernies(registry: EntityRegistry, prefabId: 'bernie', worldState: SceneWorldState) {
    prefabs.register(berniePrefabs(bernieWorld(worldState)));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerPigKings(registry: EntityRegistry, prefabId: 'pigking', worldState: SceneWorldState) {
    // default_pigking.lua BG_TILES are world generation: commit the saved kings' layouts before rebuilding the terrain once.
    turfMap.setOriginalTiles((initialSave.world.entities.pigking ?? []).flatMap(record =>
      placeStaticLayout('default_pigking', new THREE.Vector3(...record.transform.position), 'pigking').tiles.map(({ tile, position }) =>
        ({ position, tileId: WORLD_TILES[tile] }))));
    prefabs.register(pigKingPrefabs({
      camera, scheduler: worldState.scheduler, getWatchWorldContent: worldState.getWatchWorldContent,
      dropLoot: (items, position, launch) => {
        Managers['ground_item'].flingLoot(items.map((item) => ({ ...SAVE_CATALOG.items[item.itemId], ...item })), position, launch);
      },
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerStatueGlommer(registry: EntityRegistry, prefabId: 'statueglommer', worldState: SceneWorldState) {
    const statues = new StatueGlommerManager(scene, { tickingarea: worldState.tickingarea, scheduler: worldState.scheduler, physics: world });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (_, record) => statues.spawn(new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: {
          statueglommer: record.components.statueglommer,
          pickable: record.components.pickable,
          workable: record.components.workable as { maxwork: -1; workleft: number } | undefined,
        },
      }),
      debugSpawn: () => statues.spawn(new THREE.Vector3(player.position.x, 0, player.position.z)),
      exportRecords: () => statues.exportRecords(),
      update: dt => statues.update(dt),
      renderEntities: () => statues.renderEntities,
      dispose: () => statues.dispose(),
    });
    return statues;
  }

  function registerAtriumGate(registry: EntityRegistry, prefabId: 'atrium_gate', worldState: SceneWorldState) {
    prefabs.register(atriumGatePrefabs({ scheduler: worldState.scheduler, pathfinder, spawnPrefab: (id, position) => prefabs.spawn(id, position) }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerRuinsStatue(registry: EntityRegistry, prefabId: RuinsStatueId) {
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerRuinsRelics(registry: EntityRegistry, worldState: SceneWorldState) {
    prefabs.register(ruinsRelicPrefabs({ fx: Managers['world_fx'],
      dropLoot: (items, position) => Managers['ground_item'].flingLoot(items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })), position),
      scheduler: worldState.scheduler }));
    registry.registerPrefabs(PREFAB_DEFINITIONS.ruinsRelics);
  }

  function registerAtriumStatue(registry: EntityRegistry, prefabId: 'atrium_statue', worldState: SceneWorldState) {
    const statues = new AtriumStatueManager(scene, { tickingarea: worldState.tickingarea, physics: world,
      trackDisplay: display => registry.trackDisplay(display) });
    registry.registerDisplayManager(MANAGER_DEFINITIONS[prefabId], statues, {
      restore: (_, record) => statues.spawn(new THREE.Vector3(...record.transform.position),
        { id: record.id, transform: record.transform, components: {} }),
      debugSpawn: () => statues.spawn(new THREE.Vector3(player.position.x, 0, player.position.z)),
    });
    return statues;
  }

  function registerChessJunk(registry: EntityRegistry, prefabId: 'chessjunk', worldState: SceneWorldState) {
    const piles = new ChessJunkManager(scene, { tickingarea: worldState.tickingarea, scheduler: worldState.scheduler, physics: world,
      trackDisplay: display => registry.trackDisplay(display) });
    registry.registerDisplayManager(MANAGER_DEFINITIONS[prefabId], piles, {
      restore: (id, record) => piles.spawn(id, new THREE.Vector3(...record.transform.position), {
        id: record.id, transform: record.transform, components: { chessJunk: record.components.chessJunk },
      }),
      debugSpawn: id => piles.spawn(id, new THREE.Vector3(player.position.x, 0, player.position.z)),
    });
    return piles;
  }

  function registerChesspieces(registry: EntityRegistry, prefabId: 'chesspiece_malbatross_marble', worldState: SceneWorldState) {
    prefabs.register(chesspiecePrefabs({
      fx: Managers['world_fx'], handEquipment: sceneInventory.handEquipment, scheduler: worldState.scheduler,
      spawnGroundItem: (definition, position, options) => Managers['ground_item'].spawnGroundItem(definition, position, options),
    }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerArchiveCentipedeHusks(registry: EntityRegistry, prefabId: 'archive_centipede_husk', worldState: SceneWorldState) {
    prefabs.register(archiveCentipedeHuskPrefabs({ scheduler: worldState.scheduler }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerNightmareRocks(registry: EntityRegistry, prefabId: 'sanityrock', worldState: SceneWorldState) {
    const nightmareRocks = new NightmareRockManager(scene, `${import.meta.env.BASE_URL}dst/data/anim`, {
      scheduler, physics: world, fx: Managers['world_fx'], tickingarea: worldState.tickingarea,
      // AllPlayers: the local player, once its sanity component is attached.
      getPlayers: () => playerInstance.components.sanity
        ? [{ position: player.position, sanity: playerInstance.components.sanity }] : [],
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
      groundOverlay: groundDisplay,
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      exportRecords: () => [],
      update: (dt, quaternion) => snow.update(dt, quaternion),
      dispose: () => snow.dispose(),
    });
    return snow;
  }

  function registerOceanWaves(registry: EntityRegistry, prefabId: 'ocean_waves', worldState: SceneWorldState) {
    // The only ocean tile is OCEAN_COASTAL; INVALID (outside the map) is neither land nor water.
    const waveMap: WaveMap = {
      tileSize: TILE_SIZE,
      tileAt: (x, z) => turfMap.getTileAtWorld({ x, z }),
      isLandTile,
      isOceanTile: tile => tile === WORLD_TILES.OCEAN_COASTAL,
    };
    const oceanWaves = new OceanWaves(scene, waveMap, WORLD_SCALE, worldState.tickingarea);
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

  function registerStaffLights(registry: EntityRegistry, worldState: SceneWorldState) {
    prefabs.register(staffLightPrefabs({ scheduler: scheduler ?? worldState.scheduler, tickingarea: worldState.tickingarea, getWatchWorldContent: worldState.getWatchWorldContent }));
    registry.registerPrefabs(MANAGER_DEFINITIONS['stafflight']);
  }

  /** No renderEntities: these prefabs have nothing to draw, only a light their displays list. */
  function registerStaffCastingLights(registry: EntityRegistry, worldState: SceneWorldState) {
    prefabs.register(staffCastingLightPrefabs({ scheduler: scheduler ?? worldState.scheduler, tickingarea: worldState.tickingarea }));
    registry.registerPrefabs(MANAGER_DEFINITIONS['staff_castinglight']);
    return prefabs;
  }

  function registerMarshPlants(registry: EntityRegistry, worldState: SceneWorldState) {
    prefabs.register(marshPlantPrefabs({ scheduler: scheduler ?? worldState.scheduler, tickingarea: worldState.tickingarea, fire: prefabFire,
      spawnGroundItem: (definition, position, options) => Managers['ground_item'].spawnGroundItem(definition, position, options) }));
    registry.registerPrefabs(MANAGER_DEFINITIONS['marsh_plant']);
    return prefabs;
  }

  function registerPonds(registry: EntityRegistry, prefabId: 'pond', worldState: SceneWorldState) {
    prefabs.register(pondPrefabs({ scheduler: scheduler ?? worldState.scheduler, tickingarea: worldState.tickingarea, getWatchWorldContent: worldState.getWatchWorldContent, physics: world,
        spawnPrefab: (prefab, position) => registry.SpawnPrefab(prefab, position) }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }
}
