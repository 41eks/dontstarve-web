import { stalagmitePrefabs } from '@dontstarve-web/prefab/stalagmite';
import { ruinsRelicPrefabs } from '@dontstarve-web/prefab/ruinsrelic';
import { lightflierFlowerPrefabs } from '../packages/prefab/src/lightflier_flower';
import { LightFlierHabitat } from '../packages/prefab/src/lightflier';
import { MAX_PHYSICS_FRAME_TIME } from './physicsTiming';
import { createMoleHabitat, molehillPrefabs, MolehillInstance } from '../packages/prefab/src/molehill';
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
import { moonTreePrefabs } from '@dontstarve-web/prefab/moontree';
import { WORLD_TILES, isLandTile } from '@dontstarve-web/prefab/turfMap';
import { camera, followCamera } from './camera';
import { flingLoot, itemPrefabs, spawnGroundStack } from '@dontstarve-web/prefab/itemPrefabs';
import { turfItemForTile } from '@dontstarve-web/prefab/turfs';
import {
  GROUND_ART_DEFINITIONS,
  GROUND_ITEM_DISPLAY_SPECS,
  GroundItemAssets,
} from '@dontstarve-web/prefab/groundItems';
import { farmPrefabs } from '@dontstarve-web/prefab/farm_plow';
import { createFarmMap } from '@dontstarve-web/prefab/farmMap';
import { placementEntities } from '@dontstarve-web/prefab/placementEntities';
import { playerStats } from './playerStats';
import { SpriteResources } from '@dontstarve-web/display';
import { staffCastingLightPrefabs } from '@dontstarve-web/prefab/staff_castinglight';
import { staffLightPrefabs } from '@dontstarve-web/prefab/stafflight';
import { bulbPlantPrefabs } from '@dontstarve-web/prefab/bulb_plant';
import { moonglassRockPrefabs, rockPrefabs } from '@dontstarve-web/prefab/rocks';
import { caveinBoulderPrefabs } from '@dontstarve-web/prefab/cavein_boulder';
import { moonrockseedPrefabs } from '@dontstarve-web/prefab/moonrockseed';
import type {
  GroundItemDefinition,
  GroundSpawnOptions,
  ItemPrefabWorld,
  SpawnGroundItem,
} from '@dontstarve-web/prefab/groundPrefab';
import { caveHolePrefabs } from '@dontstarve-web/prefab/cave_hole';
import { pillarPrefabs } from '@dontstarve-web/prefab/pillar';
import { atriumPillarPrefabs } from '@dontstarve-web/prefab/atrium_pillar';
import { moonFissurePrefabs } from '@dontstarve-web/prefab/moon_fissure';
import { watertreePillarPrefabs } from '@dontstarve-web/prefab/watertree_pillar';
import { oceanTreePrefabs } from '@dontstarve-web/prefab/oceantree';
import { oceanTreePillarPrefabs } from '@dontstarve-web/prefab/oceantree_pillar';
import { oceanVinePrefabs } from '@dontstarve-web/prefab/oceanvine';
import { reedsPrefabs } from '@dontstarve-web/prefab/reeds';
import { ROPE_BRIDGE_FX_ID, RopeBridgeFxInstance, ropeBridgePrefabs } from '@dontstarve-web/prefab/rope_bridge';
import { mastMalbatrossPrefabs } from '@dontstarve-web/prefab/mast_malbatross';
import { supportPillarPrefabs } from '@dontstarve-web/prefab/support_pillar';
import { oasislakePrefabs } from '@dontstarve-web/prefab/oasislake';
import { beehivePrefabs } from '@dontstarve-web/prefab/beehive';
import { shadowForgePrefabs } from '@dontstarve-web/prefab/shadow_forge';
import { spiderdenPrefabs } from '@dontstarve-web/prefab/spiderden';
import { wasphivePrefabs } from '@dontstarve-web/prefab/wasphive';
import { oceanVineDecoPrefabs } from '@dontstarve-web/prefab/oceanvine_deco';
import { archivePillarPrefabs } from '@dontstarve-web/prefab/archive_pillar';
import { vaultPillarPrefabs } from '@dontstarve-web/prefab/vault_pillar';
import { monkeyPillarPrefabs } from '@dontstarve-web/prefab/monkeypillar';
import { staffProjectilePrefabs } from '@dontstarve-web/prefab/staff_projectile';
import { caveEntrancePrefabs, CAVES_SHARD } from '@dontstarve-web/prefab/cave_entrance';
import { caveExitPrefabs, MASTER_SHARD } from '@dontstarve-web/prefab/cave_exit';
import type { WorldMigratorShard } from '../packages/componets/src/worldmigrator';
import { grottoPoolPrefabs } from '@dontstarve-web/prefab/grotto_pool';
import { mushroomPlantPrefabs } from '@dontstarve-web/prefab/mushroom_plant';
import { mushtreePrefabs } from '@dontstarve-web/prefab/mushtree';
import { marbleShrubPrefabs, MarbleShrubInstance } from '@dontstarve-web/prefab/marbleshrub';
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
import { wormholePrefabs } from '@dontstarve-web/prefab/wormhole';
import { portalPrefabs } from '@dontstarve-web/prefab/portal';
import { nightmareGrowthPrefabs, NightmareGrowthCrackInstance } from '@dontstarve-web/prefab/nightmaregrowth';
import { nightmareRockPrefabs } from '@dontstarve-web/prefab/nightmarerock';
import { pigKingPrefabs } from '@dontstarve-web/prefab/pigking';
import { BERNIE_ITEM_ID, berniePrefabs, type BernieWorld } from '@dontstarve-web/prefab/bernie';
import { statueGlommerPrefabs } from '@dontstarve-web/prefab/statueglommer';
import { atriumGatePrefabs } from '@dontstarve-web/prefab/atrium_gate';
import { ruinsStatuePrefabs, type RuinsStatueId } from '@dontstarve-web/prefab/ruins_statue_mage';
import { atriumStatuePrefabs } from '@dontstarve-web/prefab/atrium_statue';
import { atriumOvergrowthPrefabs } from '@dontstarve-web/prefab/atrium_overgrowth';
import { chessJunkPrefabs } from '@dontstarve-web/prefab/chessjunk';
import { chesspiecePrefabs } from '@dontstarve-web/prefab/chesspieces';
import { archiveCentipedeHuskPrefabs } from '@dontstarve-web/prefab/archive_centipede';
import {
  BEEFALO_BEHAVIOR,
  beefaloPrefabs,
  findBeefaloSpawnPoint,
  type BeefaloWorld,
} from '@dontstarve-web/prefab/beefalo';
import {
  LIGHTNING_GOAT_RADIUS,
  lightningGoatPrefabs,
  type LightningGoatWorld,
} from '@dontstarve-web/prefab/lightninggoat';
import type { LootLaunch } from '../packages/componets/src/inventoryphysics';

/** Where SpawnPrefab makes an inst before it is set down or given to its holder. */
import { player, playerInstance } from './player';
import {
  PlaceableBuildingPlacement,
  type PlaceableBuildingInteractionChange,
  type PlaceableBuildingId,
} from './placeableBuilding';
import { dstLighting, scene } from './universal';
import { PREFAB_BASE_URL, prefabDisplays, prefabs } from './prefabWorld';
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

const MANAGER_DEFINITIONS = {
  buildings: PREFAB_DEFINITIONS.buildings,
  reskinEffects: PREFAB_DEFINITIONS.reskinEffects,
  flower: PREFAB_DEFINITIONS.flowers,
  world_fx: PREFAB_DEFINITIONS.worldFx,
  staff_projectile: PREFAB_DEFINITIONS.staffProjectiles,
  molehill: PREFAB_DEFINITIONS.molehills,
  lightflier_flower: PREFAB_DEFINITIONS.lightflierFlowers,
  items: PREFAB_DEFINITIONS.groundItems,
  bulb_plant: PREFAB_DEFINITIONS.bulbPlants,
  stalagmite: PREFAB_DEFINITIONS.stalagmites,
  rocks: PREFAB_DEFINITIONS.rocks,
  moonglass_rock: PREFAB_DEFINITIONS.moonglassRocks,
  cave_hole: PREFAB_DEFINITIONS.caveHoles,
  pillar_ruins: PREFAB_DEFINITIONS.pillarRuins,
  cave_pillar: PREFAB_DEFINITIONS.cavePillars,
  pillar_atrium: PREFAB_DEFINITIONS.atriumPillars,
  archive_pillar: PREFAB_DEFINITIONS.archivePillars,
  vault_pillar: PREFAB_DEFINITIONS.vaultPillars,
  monkeypillar: PREFAB_DEFINITIONS.monkeyPillars,
  cave_entrance: PREFAB_DEFINITIONS.caveEntrances,
  cave_exit: PREFAB_DEFINITIONS.caveExits,
  grotto_pool: PREFAB_DEFINITIONS.grottoPools,
  mushtree: PREFAB_DEFINITIONS.mushtrees,
  mushroom_plant: PREFAB_DEFINITIONS.mushroomPlants,
  marbleshrub: PREFAB_DEFINITIONS.marbleShrubs,
  archive_props: PREFAB_DEFINITIONS.archiveProps,
  skeleton: PREFAB_DEFINITIONS.skeletons,
  houndbone: PREFAB_DEFINITIONS.houndbones,
  beequeenhivegrown: PREFAB_DEFINITIONS.beeQueenHives,
  dragonfly: PREFAB_DEFINITIONS.dragonflies,
  dragonfly_spawner: PREFAB_DEFINITIONS.dragonflySpawners,
  marblebean_sapling: PREFAB_DEFINITIONS.marbleBeanSaplings,
  rock_avocado_bush: PREFAB_DEFINITIONS.rockAvocadoBushes,
  rock_avocado_fruit_sprout_sapling: PREFAB_DEFINITIONS.rockAvocadoSaplings,
  berrybush: PREFAB_DEFINITIONS.berrybushes,
  monkeytail: PREFAB_DEFINITIONS.monkeytails,
  grass: PREFAB_DEFINITIONS.grasses,
  sapling: PREFAB_DEFINITIONS.saplings,
  cave_fern: PREFAB_DEFINITIONS.caveFerns,
  lichen: PREFAB_DEFINITIONS.lichens,
  cactus: PREFAB_DEFINITIONS.cacti,
  lava_pond: PREFAB_DEFINITIONS.lavaPonds,
  tumbleweed: PREFAB_DEFINITIONS.tumbleweeds,
  hotspring: PREFAB_DEFINITIONS.hotsprings,
  wormhole: PREFAB_DEFINITIONS.wormholes,
  multiplayer_portal_moonrock: PREFAB_DEFINITIONS.portals,
  nightmaregrowth: PREFAB_DEFINITIONS.nightmareGrowths,
  beefalo: PREFAB_DEFINITIONS.beefalos,
  lightninggoat: PREFAB_DEFINITIONS.lightningGoats,
  evergreen: PREFAB_DEFINITIONS.evergreens,
  deciduoustree: PREFAB_DEFINITIONS.deciduousTrees,
  farm_plow: PREFAB_DEFINITIONS.farmPlow,
  moon_tree: PREFAB_DEFINITIONS.moonTrees,
  pigking: PREFAB_DEFINITIONS.pigKings,
  bernie: PREFAB_DEFINITIONS.bernies,
  statueglommer: PREFAB_DEFINITIONS.glommerStatues,
  moon_fissure: PREFAB_DEFINITIONS.moonFissures,
  watertree_pillar: PREFAB_DEFINITIONS.watertreePillars,
  oceantree: PREFAB_DEFINITIONS.oceanTrees,
  oceantree_pillar: PREFAB_DEFINITIONS.oceanTreePillars,
  oceanvine: PREFAB_DEFINITIONS.oceanVines,
  reeds: PREFAB_DEFINITIONS.reeds,
  mast_malbatross: PREFAB_DEFINITIONS.mastMalbatross,
  support_pillar: PREFAB_DEFINITIONS.supportPillars,
  oasislake: PREFAB_DEFINITIONS.oasislakes,
  beehive: PREFAB_DEFINITIONS.beehives,
  shadow_forge: PREFAB_DEFINITIONS.shadowForges,
  spiderden: PREFAB_DEFINITIONS.spiderDens,
  wasphive: PREFAB_DEFINITIONS.wasphives,
  oceanvine_deco: PREFAB_DEFINITIONS.oceanVineDecos,
  atrium_gate: PREFAB_DEFINITIONS.atriumGates,
  ruins_statue_mage: PREFAB_DEFINITIONS.ruinsStatueMages,
  ruins_statue_mage_nogem: PREFAB_DEFINITIONS.ruinsStatueMagesNoGem,
  ruins_statue_head: PREFAB_DEFINITIONS.ruinsStatueHeads,
  ruins_statue_head_nogem: PREFAB_DEFINITIONS.ruinsStatueHeadsNoGem,
  ruinsrelic: PREFAB_DEFINITIONS.ruinsRelics,
  atrium_statue: PREFAB_DEFINITIONS.atriumStatues,
  atrium_overgrowth: PREFAB_DEFINITIONS.atriumOvergrowths,
  chessjunk: PREFAB_DEFINITIONS.chessJunk,
  chesspiece_malbatross_marble: PREFAB_DEFINITIONS.chesspieces,
  archive_centipede_husk: PREFAB_DEFINITIONS.archiveCentipedeHusks,
  sanityrock: PREFAB_DEFINITIONS.nightmareRocks,
  rain: PREFAB_DEFINITIONS.rain,
  snow: PREFAB_DEFINITIONS.snow,
  ocean_waves: PREFAB_DEFINITIONS.oceanWaves,
  stafflight: PREFAB_DEFINITIONS.staffLights,
  staff_castinglight: PREFAB_DEFINITIONS.staffCastingLights,
  pond: PREFAB_DEFINITIONS.ponds,
  marsh_plant: PREFAB_DEFINITIONS.marshPlants,
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
  consumeBufferedBuild: (buildingId: PlaceableBuildingId, skinId?: string) => boolean,
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

  Managers['buildings'] = registerBuildings(registry, 'buildings', worldState);
  Managers['reskinEffects'] = registerReskinEffects(registry, 'reskinEffects', worldState);
  registerFlowers(registry, 'flower', worldState);
  Managers['world_fx'] = registerWorldFx(registry, 'world_fx', worldState);
  registerStaffProjectiles(registry, worldState);
  Managers['molehill'] = registerMolehills(registry, 'molehill', worldState);
  Managers['lightflier_flower'] = registerLightFlierFlowers(registry, 'lightflier_flower', worldState);
  registerItems(registry, 'items', worldState);

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
    migratePlayer: (_player, _portal, shard) => {
      window.location.search = shardSaveSearch(window.location.search, shard);
    },
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
  Managers['rock_avocado_fruit_sprout_sapling'] = registerRockAvocadoSaplings(
    registry,
    'rock_avocado_fruit_sprout_sapling',
    worldState,
  );
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
  registerWormholes(registry, 'wormhole', worldState);
  Managers['multiplayer_portal_moonrock'] = registerPortals(registry, 'multiplayer_portal_moonrock', worldState);
  registerNightmareGrowths(registry, 'nightmaregrowth', worldState);
  registerBeefalos(registry, 'beefalo', worldState);
  registerLightningGoats(registry, 'lightninggoat', worldState);
  Managers['evergreen'] = registerEvergreens(registry, 'evergreen', worldState);
  Managers['deciduoustree'] = registerDeciduousTrees(registry, 'deciduoustree', worldState);
  const farmMap = registerFarm(registry, worldState);
  Managers['moon_tree'] = registerMoonTrees(registry, 'moon_tree', worldState);
  registerPigKings(registry, 'pigking', worldState);
  registerBernies(registry, 'bernie', worldState);
  registerStatueGlommer(registry, worldState);
  registerMoonFissures(registry, worldState);
  registerWatertreePillars(registry, worldState);
  registerOceanTrees(registry, worldState);
  registerOceanTreePillars(registry, worldState);
  registerOceanVines(registry, worldState);
  registerReeds(registry, worldState);
  registerMastMalbatross(registry, worldState);
  prefabs.register(supportPillarPrefabs());
  registry.registerPrefabs(PREFAB_DEFINITIONS.supportPillars);
  prefabs.register(oasislakePrefabs({ scheduler: worldState.scheduler }));
  registry.registerPrefabs(PREFAB_DEFINITIONS.oasislakes);
  prefabs.register(
    beehivePrefabs({
      scheduler: worldState.scheduler,
      getWatchWorldContent: worldState.getWatchWorldContent,
      fx: Managers['world_fx'],
    }),
  );
  registry.registerPrefabs(PREFAB_DEFINITIONS.beehives);
  prefabs.register(
    shadowForgePrefabs({ scheduler: worldState.scheduler, getWatchWorldContent: worldState.getWatchWorldContent }),
  );
  registry.registerPrefabs(PREFAB_DEFINITIONS.shadowForges);
  prefabs.register(
    spiderdenPrefabs({ scheduler: worldState.scheduler, getWatchWorldContent: worldState.getWatchWorldContent }),
  );
  registry.registerPrefabs(PREFAB_DEFINITIONS.spiderDens);
  prefabs.register(
    wasphivePrefabs({ scheduler: worldState.scheduler, getWatchWorldContent: worldState.getWatchWorldContent }),
  );
  registry.registerPrefabs(PREFAB_DEFINITIONS.wasphives);
  prefabs.register(oceanVineDecoPrefabs());
  registry.registerPrefabs(PREFAB_DEFINITIONS.oceanVineDecos);
  Managers['atrium_gate'] = registerAtriumGate(registry, 'atrium_gate', worldState);
  // statueruins.lua returns the four prefabs together.
  prefabs.register(ruinsStatuePrefabs({ scheduler: worldState.scheduler }));
  Managers['ruins_statue_mage'] = registerRuinsStatue(registry, 'ruins_statue_mage');
  Managers['ruins_statue_mage_nogem'] = registerRuinsStatue(registry, 'ruins_statue_mage_nogem');
  Managers['ruins_statue_head'] = registerRuinsStatue(registry, 'ruins_statue_head');
  Managers['ruins_statue_head_nogem'] = registerRuinsStatue(registry, 'ruins_statue_head_nogem');
  registerRuinsRelics(registry, worldState);
  registerAtriumStatue(registry);
  prefabs.register(atriumOvergrowthPrefabs());
  registry.registerPrefabs(PREFAB_DEFINITIONS.atriumOvergrowths);
  registerChessJunk(registry, worldState);
  registerChesspieces(registry, 'chesspiece_malbatross_marble', worldState);
  registerArchiveCentipedeHusks(registry, 'archive_centipede_husk', worldState);
  Managers['marsh_plant'] = registerMarshPlants(registry, worldState);
  Managers['pond'] = registerPonds(registry, 'pond', worldState);
  registerNightmareRocks(registry, 'sanityrock', worldState);
  Managers['rain'] = registerRain(registry, 'rain', worldState);
  Managers['snow'] = registerSnow(registry, 'snow', worldState);
  Managers['ocean_waves'] = registerOceanWaves(registry, 'ocean_waves', worldState);

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

  function registerBuildings(registry: EntityRegistry, prefabId: 'buildings', worldState: SceneWorldState) {
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
      consumeBufferedBuild,
      onBuildingInteraction,
      prefabs,
    );
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (id, record) => buildingPlacement.spawnFromSave(id, record),
      debugSpawn: id => buildingPlacement.spawn(id),
      exportRecords: () => buildingPlacement.exportRecords(),
      update: dt => buildingPlacement.update(dt),
      renderEntities: () => buildingPlacement.renderEntities,
      dispose: () => buildingPlacement.dispose(),
    });
    return buildingPlacement;
  }

  function registerReskinEffects(registry: EntityRegistry, prefabId: 'reskinEffects', _worldState: SceneWorldState) {
    const reskinEffects = new ReskinEffects(scene);
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      exportRecords: () => [],
      update: dt => reskinEffects.update(dt),
      renderEntities: () => reskinEffects.renderEntities,
      dispose: () => reskinEffects.dispose(),
    });
    return reskinEffects;
  }

  function registerFlowers(registry: EntityRegistry, prefabId: 'flower', worldState: SceneWorldState) {
    prefabs.register(
      flowerPrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        fire: prefabFire,
        worldEvents,
        spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerWorldFx(registry: EntityRegistry, prefabId: 'world_fx', worldState: SceneWorldState) {
    prefabs.register(worldFxPrefabs({ scheduler: scheduler ?? worldState.scheduler }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return worldFxSpawner(prefabs);
  }

  function registerStaffProjectiles(registry: EntityRegistry, worldState: SceneWorldState) {
    prefabs.register(
      staffProjectilePrefabs({ fx: Managers['world_fx'], componentUpdates: worldState.componentUpdates }),
    );
    registry.registerPrefabs(PREFAB_DEFINITIONS.staffProjectiles);
  }

  function registerMolehills(registry: EntityRegistry, prefabId: 'molehill', worldState: SceneWorldState) {
    const moleWalkable = (point: THREE.Vector3) => {
      const radius = 0.5 * WORLD_SCALE;
      const edge = initialSave.world.map.generator.options.size / 2 - radius;
      return (
        turfMap.isPassableAtPoint(point) &&
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
    prefabs.register(molehillPrefabs(habitat));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return { habitat };
  }

  /**
   * The item prefabs on the shared manager, which the inventory's item registry spawns through (prefabWorld.ts): every
   * item inst is SpawnPrefab'd into this world, saved by the world while it lies in the scene and by its holder while held.
   */
  function registerItems(registry: EntityRegistry, prefabId: 'items', worldState: SceneWorldState) {
    const icons = Object.fromEntries(
      Object.entries(SAVE_CATALOG.items)
        .filter(([id]) => !Object.hasOwn(GROUND_ART_DEFINITIONS, id))
        .map(([id, spec]) => [id, { atlas: spec.atlas ?? 'images/inventoryimages.xml', image: spec.icon }]),
    );
    const definitions = itemPrefabs(itemWorld(worldState), icons);
    const ids = new Set(MANAGER_DEFINITIONS[prefabId].prefabIds);
    prefabs.register(Object.fromEntries(Object.entries(definitions).filter(([id]) => ids.has(id))));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  /** TheWorld as the item prefabs reach it. */
  function itemWorld(worldState: SceneWorldState): ItemPrefabWorld {
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
        isPassableAtPoint: (point, allowWater) =>
          turfMap.isPassableAtPoint(point) || (allowWater && turfMap.isOceanAtWorld(point)),
      },
      physics: world,
      fx: Managers['world_fx'],
      moleWorld: Managers['molehill'].habitat,
      lightflierWorld: Managers['lightflier_flower'].habitat,
      handEquipment: sceneInventory.handEquipment,
      bernieWorld: bernieWorld(worldState),
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
  function registerLightFlierFlowers(
    registry: EntityRegistry,
    prefabId: 'lightflier_flower',
    worldState: SceneWorldState,
  ) {
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
        prefabs.instances(prefabId) as Iterable<
          import('../packages/prefab/src/lightflier_flower').LightFlierFlowerInstance
        >,
    });
    // The formation leaders move every frame after physics.
    const stopFormations = worldState.componentUpdates.register({ OnUpdate: dt => habitat.update(dt) });
    prefabs.register(
      lightflierFlowerPrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        habitat,
        dropLoot,
        getWatchWorldContent: worldState.getWatchWorldContent,
        getLightLevel: model => dstLighting.sampleLightLevel(model.position, model),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return {
      habitat,
      dispose: () => {
        stopFormations();
        habitat.dispose();
      },
    };
  }

  function registerBulbPlants(registry: EntityRegistry, prefabId: 'bulb_plant', worldState: SceneWorldState) {
    prefabs.register(
      bulbPlantPrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        getLightLevel: model => dstLighting.sampleLightLevel(model.position, model),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerStalagmites(registry: EntityRegistry, worldState: SceneWorldState) {
    prefabs.register(
      stalagmitePrefabs({
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
      }),
    );
    registry.registerPrefabs(PREFAB_DEFINITIONS.stalagmites);
  }

  function registerRocks(registry: EntityRegistry, worldState: SceneWorldState) {
    const spawnGroundItem: SpawnGroundItem = (definition, position, options) =>
      groundItems.spawnGroundItem(definition, position, options);
    prefabs.register(
      rockPrefabs({
        handEquipment: sceneInventory.handEquipment,
        scheduler: scheduler ?? worldState.scheduler,
        getWatchWorldContent: worldState.getWatchWorldContent,
        spawnGroundItem,
        spawnPrefab: (id, position) => prefabs.spawn(id, position),
      }),
    );
    prefabs.register(caveinBoulderPrefabs({ handEquipment: sceneInventory.handEquipment, spawnGroundItem }));
    prefabs.register(moonrockseedPrefabs());
    registry.registerPrefabs(PREFAB_DEFINITIONS.rocks);
  }

  function registerMoonglassRocks(registry: EntityRegistry, prefabId: 'moonglass_rock', worldState: SceneWorldState) {
    prefabs.register(
      moonglassRockPrefabs({
        handEquipment: sceneInventory.handEquipment,
        scheduler: scheduler ?? worldState.scheduler,
        getWatchWorldContent: worldState.getWatchWorldContent,
        spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerCaveHoles(registry: EntityRegistry, prefabId: 'cave_hole', worldState: SceneWorldState) {
    prefabs.register(
      caveHolePrefabs({
        getWatchWorldContent: worldState.getWatchWorldContent,
        cameraFacing: view.cameraFacing,
        spawnPrefab: (id, position) => prefabs.spawn(id, position),
      }),
    );
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
    prefabs.register(
      monkeyPillarPrefabs({ scheduler: worldState.scheduler, getWatchWorldContent: worldState.getWatchWorldContent }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerCaveEntrances(registry: EntityRegistry, prefabId: 'cave_entrance') {
    prefabs.register(
      caveEntrancePrefabs({
        handEquipment: sceneInventory.handEquipment,
        spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
        spawnPrefab: (prefab, position) => prefabs.spawn(prefab, position),
        shard: shardLink,
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerMushroomPlants(registry: EntityRegistry, prefabId: 'mushroom_plant', worldState: SceneWorldState) {
    prefabs.register(
      mushroomPlantPrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        fire: prefabFire,
        getWatchWorldContent: worldState.getWatchWorldContent,
        spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
        rain: worldState.weather.preciptype,
        tickingarea: worldState.tickingarea,
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerMushtrees(registry: EntityRegistry, prefabId: 'mushtree', worldState: SceneWorldState) {
    prefabs.register(
      mushtreePrefabs({
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
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerGrottoPools(registry: EntityRegistry, prefabId: 'grotto_pool', worldState: SceneWorldState) {
    prefabs.register(
      grottoPoolPrefabs({
        handEquipment: sceneInventory.handEquipment,
        scheduler: scheduler ?? worldState.scheduler,
        registerWaterfallPool: (position, radius, large) =>
          worldState.soundPresentation.registerWaterfallPool(position, radius, large),
        getWatchWorldContent: worldState.getWatchWorldContent,
        fx: { spawn: (prefab, position) => Managers['world_fx'].spawn(prefab, position) },
        spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
        spawnPrefab: (id, position) => prefabs.spawn(id, position),
        getEntity: entityId => prefabs.get(entityId),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerCaveExits(registry: EntityRegistry, prefabId: 'cave_exit', _worldState: SceneWorldState) {
    prefabs.register(caveExitPrefabs({ shard: shardLink }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerMarbleShrubs(registry: EntityRegistry, prefabId: 'marbleshrub', worldState: SceneWorldState) {
    prefabs.register(
      marbleShrubPrefabs({
        handEquipment: sceneInventory.handEquipment,
        scheduler: scheduler ?? worldState.scheduler,
        getWatchWorldContent: worldState.getWatchWorldContent,
        spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerArchiveProps(registry: EntityRegistry, prefabId: 'archive_props', worldState: SceneWorldState) {
    prefabs.register(
      archivePropsPrefabs({
        handEquipment: sceneInventory.handEquipment,
        scheduler: worldState.scheduler,
        cameraFacing: view.cameraFacing,
        spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
        fx: Managers['world_fx'],
        spawnPrefab: (id, position) => prefabs.spawn(id, position),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerHoundbones(registry: EntityRegistry, prefabId: 'houndbone') {
    prefabs.register(
      houndbonePrefabs({
        fx: Managers['world_fx'],
        handEquipment: sceneInventory.handEquipment,
        spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerBeeQueenHives(registry: EntityRegistry, prefabId: 'beequeenhivegrown', worldState: SceneWorldState) {
    prefabs.register(
      beeQueenHivePrefabs({ handEquipment: sceneInventory.handEquipment, scheduler: worldState.scheduler }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerDragonflies(registry: EntityRegistry, prefabId: 'dragonfly', worldState: SceneWorldState) {
    prefabs.register(
      dragonflyPrefabs({ scheduler: worldState.scheduler, getWatchWorldContent: worldState.getWatchWorldContent }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerDragonflySpawners(
    registry: EntityRegistry,
    prefabId: 'dragonfly_spawner',
    worldState: SceneWorldState,
  ) {
    prefabs.register(
      dragonflySpawnerPrefabs({
        scheduler: worldState.scheduler,
        spawnDragonfly: position => prefabs.spawn(DRAGONFLY_ID, position).transform.model,
        resolveDragonfly: id => prefabs.get(id)?.transform.model,
        isPassable: position => turfMap.isPassableAtPoint(position),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerSkeletons(registry: EntityRegistry, prefabId: 'skeleton') {
    prefabs.register(
      skeletonPrefabs({
        fx: { collapse: (size, position, material) => Managers['world_fx'].collapse(size, position, material) },
        handEquipment: sceneInventory.handEquipment,
        spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerMarbleBeanSaplings(
    registry: EntityRegistry,
    prefabId: 'marblebean_sapling',
    worldState: SceneWorldState,
  ) {
    prefabs.register(
      marbleBeanSaplingPrefabs({
        handEquipment: sceneInventory.handEquipment,
        scheduler: scheduler ?? worldState.scheduler,
        spawnPrefab: (id, position) => prefabs.spawnAs(MarbleShrubInstance, id, position),
        spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerRockAvocadoBushes(
    registry: EntityRegistry,
    prefabId: 'rock_avocado_bush',
    worldState: SceneWorldState,
  ) {
    prefabs.register(
      rockAvocadoBushPrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        fire: prefabFire,
        getWatchWorldContent: worldState.getWatchWorldContent,
        tickingarea: worldState.tickingarea,
        rain: worldState.weather.preciptype,
        physics: world,
        getLocalTemperature: position =>
          GetTemperatureAtXZ(() => worldState.temperature.peek(), position.x, position.z),
        spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerRockAvocadoSaplings(
    registry: EntityRegistry,
    prefabId: 'rock_avocado_fruit_sprout_sapling',
    worldState: SceneWorldState,
  ) {
    prefabs.register(
      rockAvocadoSaplingPrefabs({
        handEquipment: sceneInventory.handEquipment,
        scheduler: scheduler ?? worldState.scheduler,
        fire: prefabFire,
        spawnPrefab: (id, position) => prefabs.spawn(id, position),
        spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerBerrybushes(registry: EntityRegistry, prefabId: 'berrybush', worldState: SceneWorldState) {
    prefabs.register(
      berrybushPrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        fire: prefabFire,
        getWatchWorldContent: worldState.getWatchWorldContent,
        tickingarea: worldState.tickingarea,
        rain: worldState.weather.preciptype,
        physics: world,
        getLocalTemperature: position =>
          GetTemperatureAtXZ(() => worldState.temperature.peek(), position.x, position.z),
        spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerMonkeytails(registry: EntityRegistry, prefabId: 'monkeytail', worldState: SceneWorldState) {
    prefabs.register(
      monkeytailPrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        fire: prefabFire,
        getWatchWorldContent: worldState.getWatchWorldContent,
        tickingarea: worldState.tickingarea,
        rain: worldState.weather.preciptype,
        getLocalTemperature: position =>
          GetTemperatureAtXZ(() => worldState.temperature.peek(), position.x, position.z),
        spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerGrasses(registry: EntityRegistry, prefabId: 'grass', worldState: SceneWorldState) {
    prefabs.register(
      grassPrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        fire: prefabFire,
        getWatchWorldContent: worldState.getWatchWorldContent,
        tickingarea: worldState.tickingarea,
        spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerSaplings(registry: EntityRegistry, prefabId: 'sapling', worldState: SceneWorldState) {
    prefabs.register(
      saplingPrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        fire: prefabFire,
        getWatchWorldContent: worldState.getWatchWorldContent,
        tickingarea: worldState.tickingarea,
        spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerCaveFerns(registry: EntityRegistry, prefabId: 'cave_fern', worldState: SceneWorldState) {
    prefabs.register(
      caveFernPrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        fire: prefabFire,
        getWatchWorldContent: worldState.getWatchWorldContent,
        tickingarea: worldState.tickingarea,
        spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerLichens(registry: EntityRegistry, prefabId: 'lichen', worldState: SceneWorldState) {
    prefabs.register(
      lichenPrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        fire: prefabFire,
        getWatchWorldContent: worldState.getWatchWorldContent,
        tickingarea: worldState.tickingarea,
        spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerCacti(registry: EntityRegistry, prefabId: 'cactus', worldState: SceneWorldState) {
    prefabs.register(
      cactusPrefabs({
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
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerLavaPonds(registry: EntityRegistry, prefabId: 'lava_pond', worldState: SceneWorldState) {
    prefabs.register(
      lavaPondPrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        spawnPrefab: (prefab, position) => prefabs.spawn(prefab, position),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    registry.registerPrefabs(PREFAB_DEFINITIONS.lavaPondRocks);
  }

  function registerTumbleweeds(registry: EntityRegistry, prefabId: 'tumbleweed', worldState: SceneWorldState) {
    prefabs.register(
      tumbleweedPrefabs({
        scheduler: worldState.scheduler,
        wind: worldWind,
        getWatchWorldContent: worldState.getWatchWorldContent,
        componentUpdates: worldState.componentUpdates,
        spawnPrefab: (prefab, position) => prefabs.spawn(prefab, position),
        isOnValidGround: position => turfMap.isPassableAtPoint(position),
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
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerHotsprings(registry: EntityRegistry, prefabId: 'hotspring', worldState: SceneWorldState) {
    prefabs.register(
      hotspringPrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        fx: { spawn: (prefab, position) => Managers['world_fx'].spawn(prefab, position) },
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerWormholes(registry: EntityRegistry, prefabId: 'wormhole', worldState: SceneWorldState) {
    prefabs.register(
      wormholePrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        getWatchWorldContent: worldState.getWatchWorldContent,
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerPortals(
    registry: EntityRegistry,
    prefabId: 'multiplayer_portal_moonrock',
    worldState: SceneWorldState,
  ) {
    prefabs.register(
      portalPrefabs({
        scheduler: worldState.scheduler,
        portalRez: worldState.portalRez,
        spawnPrefab: (id, position) => prefabs.spawn(id, position),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerNightmareGrowths(
    registry: EntityRegistry,
    prefabId: 'nightmaregrowth',
    worldState: SceneWorldState,
  ) {
    prefabs.register(
      nightmareGrowthPrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        spawnPrefab: (prefab, position) => prefabs.spawnAs(NightmareGrowthCrackInstance, prefab, position),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerBeefalos(registry: EntityRegistry, prefabId: 'beefalo', worldState: SceneWorldState) {
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
          turfMap.isPassableAtPoint(point) &&
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
    prefabs.register(beefaloPrefabs(beefaloWorld));
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (id, record) => prefabs.restore(id, record),
      debugSpawn: id => prefabs.spawn(id, findBeefaloSpawnPoint(world, beefaloWorld, player.position)),
      exportRecords: () => [],
      dispose: () => {},
    });
  }

  function registerLightningGoats(registry: EntityRegistry, prefabId: 'lightninggoat', worldState: SceneWorldState) {
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
          turfMap.isPassableAtPoint(point) &&
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
    prefabs.register(lightningGoatPrefabs(goatWorld));
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      restore: (id, record) => prefabs.restore(id, record),
      // The same clear ring search as c_spawn("beefalo"), for a goat-sized collider.
      debugSpawn: id => prefabs.spawn(id, findBeefaloSpawnPoint(world, goatWorld, player.position)),
      exportRecords: () => [],
      dispose: () => {},
    });
  }

  function registerEvergreens(registry: EntityRegistry, prefabId: 'evergreen', worldState: SceneWorldState) {
    prefabs.register(
      evergreenPrefabs({
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
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerDeciduousTrees(registry: EntityRegistry, prefabId: 'deciduoustree', worldState: SceneWorldState) {
    prefabs.register(
      deciduousPrefabs({
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
        getWatchWorldContent: worldState.getWatchWorldContent,
        secondsUntilNextDay: now => TUNING.TOTAL_DAY_TIME - (now % TUNING.TOTAL_DAY_TIME),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  /** farm_plow, farm_soil, farm_soil_debris and the sown seeds, with TheWorld.Map's soil functions they share. */
  function registerFarm(registry: EntityRegistry, worldState: SceneWorldState) {
    const farmMap = createFarmMap({ turf: turfMap, entities: prefabs, blockers: placementEntities(view.scene) });
    prefabs.register(
      farmPrefabs({
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
      }),
    );
    registry.registerPrefabs(PREFAB_DEFINITIONS.farmPlow);
    registry.registerPrefabs(PREFAB_DEFINITIONS.farmDecor);
    registry.registerPrefabs(PREFAB_DEFINITIONS.plantedSeeds);
    return farmMap;
  }

  function registerMoonTrees(registry: EntityRegistry, prefabId: 'moon_tree', worldState: SceneWorldState) {
    prefabs.register(
      moonTreePrefabs({
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
        getWatchWorldContent: worldState.getWatchWorldContent,
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    registry.registerPrefabs(PREFAB_DEFINITIONS.moonTreeSaplings);
    return prefabs;
  }

  /** AllPlayers and SpawnPrefab for bernie_inactive.lua's tryreanimate and the reanimated Bernies. */
  function bernieWorld(worldState: SceneWorldState): BernieWorld {
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

  function registerBernies(registry: EntityRegistry, prefabId: 'bernie', worldState: SceneWorldState) {
    prefabs.register(berniePrefabs(bernieWorld(worldState)));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerPigKings(registry: EntityRegistry, prefabId: 'pigking', worldState: SceneWorldState) {
    prefabs.register(
      pigKingPrefabs({
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
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerMoonFissures(registry: EntityRegistry, worldState: SceneWorldState) {
    prefabs.register(moonFissurePrefabs({ getWatchWorldContent: worldState.getWatchWorldContent }));
    registry.registerPrefabs(PREFAB_DEFINITIONS.moonFissures);
  }

  function registerWatertreePillars(registry: EntityRegistry, worldState: SceneWorldState) {
    prefabs.register(
      watertreePillarPrefabs({
        scheduler: worldState.scheduler,
        getWatchWorldContent: worldState.getWatchWorldContent,
      }),
    );
    registry.registerPrefabs(PREFAB_DEFINITIONS.watertreePillars);
  }

  function registerOceanTrees(registry: EntityRegistry, worldState: SceneWorldState) {
    prefabs.register(
      oceanTreePrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        getWatchWorldContent: worldState.getWatchWorldContent,
        growthDuration: seconds => seconds * (worldState.season.peek().season === 'spring' ? 0.75 : 1),
        spawnLoot: (prefab, position) => {
          groundItems.flingLoot([{ ...SAVE_CATALOG.items[prefab], itemId: prefab, count: 1 }], position);
          return undefined;
        },
      }),
    );
    registry.registerPrefabs(PREFAB_DEFINITIONS.oceanTrees);
  }

  function registerOceanTreePillars(registry: EntityRegistry, worldState: SceneWorldState) {
    prefabs.register(
      oceanTreePillarPrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        getWatchWorldContent: worldState.getWatchWorldContent,
        spawnLoot: (prefab, position) => {
          groundItems.flingLoot([{ ...SAVE_CATALOG.items[prefab], itemId: prefab, count: 1 }], position);
          return undefined;
        },
        spawnPrefab: (id, position) => prefabs.spawn(id, position),
      }),
    );
    registry.registerPrefabs(PREFAB_DEFINITIONS.oceanTreePillars);
  }

  function registerMastMalbatross(registry: EntityRegistry, worldState: SceneWorldState) {
    prefabs.register(
      mastMalbatrossPrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        getWatchWorldContent: worldState.getWatchWorldContent,
      }),
    );
    registry.registerPrefabs(PREFAB_DEFINITIONS.mastMalbatross);
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

  function registerReeds(registry: EntityRegistry, worldState: SceneWorldState) {
    prefabs.register(
      reedsPrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        getWatchWorldContent: worldState.getWatchWorldContent,
      }),
    );
    registry.registerPrefabs(PREFAB_DEFINITIONS.reeds);
  }

  function registerOceanVines(registry: EntityRegistry, worldState: SceneWorldState) {
    prefabs.register(
      oceanVinePrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        getWatchWorldContent: worldState.getWatchWorldContent,
      }),
    );
    registry.registerPrefabs(PREFAB_DEFINITIONS.oceanVines);
  }

  function registerStatueGlommer(registry: EntityRegistry, worldState: SceneWorldState) {
    prefabs.register(statueGlommerPrefabs({ scheduler: worldState.scheduler }));
    registry.registerPrefabs(PREFAB_DEFINITIONS.glommerStatues);
  }

  function registerAtriumGate(registry: EntityRegistry, prefabId: 'atrium_gate', worldState: SceneWorldState) {
    prefabs.register(
      atriumGatePrefabs({
        scheduler: worldState.scheduler,
        pathfinder,
        spawnPrefab: (id, position) => prefabs.spawn(id, position),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerRuinsStatue(registry: EntityRegistry, prefabId: RuinsStatueId) {
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }

  function registerRuinsRelics(registry: EntityRegistry, worldState: SceneWorldState) {
    prefabs.register(
      ruinsRelicPrefabs({
        fx: Managers['world_fx'],
        dropLoot: (items, position) =>
          groundItems.flingLoot(
            items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })),
            position,
          ),
        scheduler: worldState.scheduler,
      }),
    );
    registry.registerPrefabs(PREFAB_DEFINITIONS.ruinsRelics);
  }

  function registerAtriumStatue(registry: EntityRegistry) {
    prefabs.register(atriumStatuePrefabs());
    registry.registerPrefabs(PREFAB_DEFINITIONS.atriumStatues);
  }

  function registerChessJunk(registry: EntityRegistry, worldState: SceneWorldState) {
    prefabs.register(
      chessJunkPrefabs({
        fx: Managers['world_fx'],
        scheduler: worldState.scheduler,
        dropLoot: (items, position) =>
          groundItems.flingLoot(
            items.map(item => ({ ...SAVE_CATALOG.items[item.itemId], ...item })),
            position,
          ),
      }),
    );
    registry.registerPrefabs(PREFAB_DEFINITIONS.chessJunk);
  }

  function registerChesspieces(
    registry: EntityRegistry,
    prefabId: 'chesspiece_malbatross_marble',
    worldState: SceneWorldState,
  ) {
    prefabs.register(
      chesspiecePrefabs({
        fx: Managers['world_fx'],
        handEquipment: sceneInventory.handEquipment,
        scheduler: worldState.scheduler,
        spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerArchiveCentipedeHusks(
    registry: EntityRegistry,
    prefabId: 'archive_centipede_husk',
    worldState: SceneWorldState,
  ) {
    prefabs.register(archiveCentipedeHuskPrefabs({ scheduler: worldState.scheduler }));
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerNightmareRocks(registry: EntityRegistry, prefabId: 'sanityrock', worldState: SceneWorldState) {
    prefabs.register(
      nightmareRockPrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        spawnPrefab: (prefab, position) => prefabs.spawn(prefab, position),
        // AllPlayers: the local player, once its sanity component is attached.
        getPlayers: () =>
          playerInstance.components.sanity
            ? [{ position: player.position, sanity: playerInstance.components.sanity }]
            : [],
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
  }

  function registerRain(registry: EntityRegistry, prefabId: 'rain', worldState: SceneWorldState) {
    const rain = new RainEffect({
      scene,
      dataBaseUrl: `${import.meta.env.BASE_URL}dst/data`,
      animationBaseUrl: `${import.meta.env.BASE_URL}dst/data/anim`,
      getFocus: () => player.position,
      camera,
      rate: worldState.weather.rainRate,
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
      scene,
      dataBaseUrl: `${import.meta.env.BASE_URL}dst/data`,
      getFocus: () => player.position,
      camera,
      rate: worldState.weather.snowRate,
      cover: worldState.weather.snowCover,
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
      map: waveMap,
      spawner: oceanWaves,
      scale: WORLD_SCALE,
      tiles: new Map([[WORLD_TILES.OCEAN_COASTAL, 'shore']]),
      cameraDistance: () => followCamera.getDistance() / WORLD_SCALE,
      playerPosition: () => player.position,
    });
    registry.register(MANAGER_DEFINITIONS[prefabId], {
      exportRecords: () => [],
      update: (dt, quaternion) => {
        waveManager.OnUpdate(dt);
        oceanWaves.update(dt, quaternion);
      },
      dispose: () => oceanWaves.dispose(),
    });
    return oceanWaves;
  }

  function registerStaffLights(registry: EntityRegistry, worldState: SceneWorldState) {
    prefabs.register(
      staffLightPrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        tickingarea: worldState.tickingarea,
        getWatchWorldContent: worldState.getWatchWorldContent,
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS['stafflight']);
  }

  /** No renderEntities: these prefabs have nothing to draw, only a light their displays list. */
  function registerStaffCastingLights(registry: EntityRegistry, worldState: SceneWorldState) {
    prefabs.register(
      staffCastingLightPrefabs({ scheduler: scheduler ?? worldState.scheduler, tickingarea: worldState.tickingarea }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS['staff_castinglight']);
    return prefabs;
  }

  function registerMarshPlants(registry: EntityRegistry, worldState: SceneWorldState) {
    prefabs.register(
      marshPlantPrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        tickingarea: worldState.tickingarea,
        fire: prefabFire,
        spawnGroundItem: (definition, position, options) => groundItems.spawnGroundItem(definition, position, options),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS['marsh_plant']);
    return prefabs;
  }

  function registerPonds(registry: EntityRegistry, prefabId: 'pond', worldState: SceneWorldState) {
    prefabs.register(
      pondPrefabs({
        scheduler: scheduler ?? worldState.scheduler,
        tickingarea: worldState.tickingarea,
        getWatchWorldContent: worldState.getWatchWorldContent,
        physics: world,
        spawnPrefab: (prefab, position) => registry.SpawnPrefab(prefab, position),
      }),
    );
    registry.registerPrefabs(MANAGER_DEFINITIONS[prefabId]);
    return prefabs;
  }
}
