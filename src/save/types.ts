import type { InventoryStack } from '@dontstarve-web/inventory';
import type { FlowerAnimation } from '@dontstarve-web/prefab/flower';
import type { BulbPlantSaveState } from '@dontstarve-web/prefab/bulb_plant';
import type { GrassRecord } from '@dontstarve-web/prefab/grass';
import type { LegacyBeefaloSave } from '@dontstarve-web/prefab/beefalo';
import type { TurfTileSave } from '@dontstarve-web/prefab/turfMap';
import type { NightmareGrowthSaveState } from '@dontstarve-web/prefab/nightmaregrowth';
import type { WormholeSaveState } from '@dontstarve-web/prefab/wormhole';
import type { MoonTreeSaveState } from '@dontstarve-web/prefab/moontree';
import type { WallSaveState } from '@dontstarve-web/prefab/wallSkins';
import type { FarmPlowSaveState, FarmSoilSaveState, FarmDebrisSaveState } from '@dontstarve-web/prefab/farm_plow';
import type { WorldTemperatureSaveData } from '../../packages/componets/src/worldtemperature';
import type { WeatherSaveData } from '../../packages/componets/src/weather';
import type { NightmareClockSaveData } from '../../packages/componets/src/nightmareclock';

export interface SavedTransform {
  position: [number, number, number];
  rotationY: number;
}

export interface SavedContainer {
  slotCount: number;
  slots: { slotKey: string; item: InventoryStack }[];
}

export interface SavedEntity {
  id: string;
  transform: SavedTransform;
  components: {
    ruinsRelic?: import('@dontstarve-web/prefab/ruinsrelic').RuinsRelicSaveState;
    inventoryitemmoisture?: import('@dontstarve-web/prefab/ruinsrelic').RelicMoistureSave;
    building?: { skinId?: string; burnt?: true };
    container?: SavedContainer;
    stewer?: import('../../packages/componets/src/stewer').StewerSaveData;
    stack?: InventoryStack;
    phonograph?: { remainingSeconds: number };
    torch?: { lit: true };
    lantern?: { ison: boolean };
    health?: { current: number; maximum: number };
    timer?: import('../../packages/componets/src/timer').NamedTimerSave;
    flower?: { animation: FlowerAnimation; planted?: true };
    bulbPlant?: BulbPlantSaveState;
    witherable?: import('../../packages/componets/src/witherable').WitherableSave;
    burning?: true;
    plant?: { skinId?: string };
    pickable?: GrassRecord['components']['pickable'];
    lightflierFlower?: import('../../packages/prefab/src/lightflier_flower').LightFlierFlowerSave;
    /** watertree_pillar.lua OnSave, with its childspawner and timer records. */
    watertreePillar?: import('@dontstarve-web/prefab/watertree_pillar').WatertreePillarSaveState;
    /** oceantree.lua onsave. */
    oceantree?: import('@dontstarve-web/prefab/oceantree').OceanTreeSaveState;
    /** atrium_overgrowth.lua rune_onsave. */
    atriumOvergrowth?: import('@dontstarve-web/prefab/atrium_overgrowth').AtriumOvergrowthSaveState;
    /** oceantree_pillar.lua OnSave. */
    oceantreePillar?: import('@dontstarve-web/prefab/oceantree_pillar').OceanTreePillarSaveState;
    /** oceanvine_deco.lua onsave: data.animnum, the idle_N clip. */
    animnum?: import('@dontstarve-web/prefab/oceanvine_deco').OceanVineDecoAnimNum;
    molehill?: import('../../packages/prefab/src/molehill').MolehillSave;
    /** A beefalo save from before its components saved themselves; it loads and is not written. */
    beefalo?: LegacyBeefaloSave;
    knownlocations?: { locations: { name: string; x: number; y: number; z: number }[] };
    periodicspawner?: { time: number };
    beard?: import('../../packages/componets/src/beard').BeardSave;
    nightmareGrowth?: NightmareGrowthSaveState;
    fishable?: import('../../packages/componets/src/fishable').FishableSave;
    plants?: { offset: [number, number, number] }[];
    lavaPond?: import('@dontstarve-web/prefab/lava_pond').LavaPondSaveState;
    hotspring?: import('@dontstarve-web/prefab/hotspring').HotspringSaveState;
    wormhole?: WormholeSaveState;
    wall?: WallSaveState;
    fence?: import('@dontstarve-web/prefab/fenceSkins').FenceSaveState;
    moonTree?: MoonTreeSaveState;
    mushtree?: import('@dontstarve-web/prefab/mushtree').MushtreeSaveState;
    mushroom?: { rain: number };
    /** cave_fern.lua OnSave: data.anim. */
    variant?: { anim: string };
    caveinBoulder?: import('@dontstarve-web/prefab/cavein_boulder').CaveinBoulderSave;
    /** cave_hole.lua OnSave: data.allowspawn. */
    allowspawn?: boolean;
    /** archive_pillar.lua OnSave: data.broken (a boolean); vault_pillar.lua OnSave: data.broken (1). */
    broken?: boolean | 1;
    /** vault_pillar.lua OnSave: data.capped. */
    capped?: 1 | 2;
    /** vault_pillar.lua OnLoad: world generation's data.random, never saved back. */
    random?: true;
    /** monkeypillar.lua OnSave: data.pillar_id, a number from a world save or the string math.random made. */
    pillar_id?: import('@dontstarve-web/prefab/monkeypillar').MonkeyPillarId;
    /** rocks.lua on_save_moonglass: data.rock_type. */
    rock_type?: import('@dontstarve-web/prefab/rocks').MoonglassRockType;
    grottoPool?: import('@dontstarve-web/prefab/grotto_pool').GrottoPoolSaveState;
    grottoGlass?: import('@dontstarve-web/prefab/grotto_pool').GrottoGlassSaveState;
    evergreen?: { stump?: true; burnt?: true; burntcone?: true };
    deciduoustree?: import('../../packages/prefab/src/deciduousTreeLeaves').DeciduousTreeSave;
    marbleShrub?: import('../../packages/prefab/src/marbleshrub').MarbleShrubSaveState;
    archiveProp?: import('../../packages/prefab/src/archive_props').ArchivePropSaveState;
    houndbone?: import('../../packages/prefab/src/houndbone').HoundboneSaveState;
    beeQueenHiveTimer?: import('../../packages/componets/src/timer').NamedTimerSave;
    dragonfly?: import('@dontstarve-web/prefab/dragonfly').DragonflySaveState;
    dragonflySpawner?: import('@dontstarve-web/prefab/dragonfly_spawner').DragonflySpawnerSaveState;
    statueglommer?: { worked?: true; spawned?: true };
    atriumGate?: import('@dontstarve-web/prefab/atrium_gate').AtriumGateRecord['components']['atriumGate'];
    ruinsStatueMage?: import('@dontstarve-web/prefab/ruins_statue_mage').RuinsStatueSaveState;
    chessJunk?: import('@dontstarve-web/prefab/chessjunk').ChessJunkSaveState;
    chesspiece?: import('@dontstarve-web/prefab/chesspieces').ChesspieceSaveState;
    submersible?: import('@dontstarve-web/prefab/chesspieces').SubmersibleSaveState;
    charliecutscene?: import('@dontstarve-web/prefab/atrium_gate').AtriumGateRecord['components']['charliecutscene'];
    worldsettingstimer?: import('@dontstarve-web/prefab/atrium_gate').AtriumGateRecord['components']['worldsettingstimer'];
    entitytracker?: import('@dontstarve-web/prefab/atrium_gate').AtriumGateRecord['components']['entitytracker'];
    skeleton?: import('../../packages/prefab/src/skeleton').SkeletonSaveState;
    growable?: import('../../packages/componets/src/growable').GrowableSave;
    deciduousTimer?: import('../../packages/componets/src/timer').NamedTimerSave;
    moonTreeTimer?: import('../../packages/componets/src/timer').NamedTimerSave;
    evergreenTimer?: import('../../packages/componets/src/timer').NamedTimerSave;
    saplingTimer?: import('../../packages/componets/src/timer').NamedTimerSave;
    sculptingtable?: { itemname: string };
    birdcage?: import('@dontstarve-web/prefab/birdcage').BirdcageSaveStateData;
    workable?: { workleft: number; maxwork: number };
    finiteuses?: { uses: number };
    moonbase?: import('@dontstarve-web/prefab/moonbase').MoonbaseSaveState;
    lightningrod?: import('@dontstarve-web/prefab/lightning_rod').LightningRodSaveState;
    firepit?: import('@dontstarve-web/prefab/firepit').FirePitSaveState;
    farmPlow?: FarmPlowSaveState;
    farmSoil?: FarmSoilSaveState;
    farmDebris?: FarmDebrisSaveState;
  };
}

export interface SavedInventory {
  containers: Record<string, SavedContainer>;
  bufferedBuilds: { recipeId: string; skinId?: string }[];
}

export interface SavedPlayer {
  prefab: 'wilson';
  shardId: string;
  transform: SavedTransform;
  inventory: SavedInventory;
  stats?: { health: number; hunger: number; sanity: number; penalty?: number; sanitySane?: boolean; sanityMode?: 0 | 1 };
  /** player_common.lua OnSave `is_ghost`: the player resumes as a ghost on load. */
  ghost?: true;
  /** wortox.lua OnSave counters; the transient finishportalhoptask is not saved. */
  wortox?: import('../../packages/prefab/src/wortox').WortoxSave;
}

/** The project's JSON counterpart of a DST per-shard Session player file. */
export interface SavedPlayerSessionFile {
  player: SavedPlayer;
  migration?: { worldid: string; portalid: number; sessionid: string } | null;
}

export interface SaveDocument {
  format: 'three-roaming-save';
  schemaVersion: 1;
  gameVersion: string;
  session: { id: string; createdAt: string; playerFile?: string };
  snapshot: { id: string; parentId: string | null; savedAt: string; reason: string };
  world: {
    shardId: string;
    prefab: 'forest' | 'cave';
    seed?: string;
    elapsedSeconds: number;
    systems: {
      clock?: { day: number; phase: 'day' | 'dusk' | 'night' | 'full_moon'; phaseProgress: number };
      season?: { name: 'autumn' | 'winter' | 'spring' | 'summer'; daysRemaining: number };
      worldtemperature?: WorldTemperatureSaveData;
      weather?: WeatherSaveData;
      nightmareclock?: NightmareClockSaveData;
      /** clock.lua OnSave mooomphasecycle: one-based index into the 20-step moon cycle. */
      moon?: { mooomphasecycle: number };
      random?: { algorithm: 'xoshiro128ss'; state: number[] };
    };
    map: {
      kind: 'generated';
      /** Missing cells use this tile; omitted in legacy forest saves. */
      defaultTileId?: number;
      tiles?: TurfTileSave[];
      generator: {
        id: string;
        seed?: string;
        options: { size: number; moonTreeCount: number; moonTreeExclusionRadiusSquared: number };
      };
    };
    entities: Record<string, SavedEntity[]>;
  };
  players: { local: SavedPlayer };
}
