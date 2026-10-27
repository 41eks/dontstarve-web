import type { InventoryStack } from '@dontstarve-web/inventory';
import type { FlowerAnimation } from '@dontstarve-web/prefab/flower';
import type { BulbPlantSaveState } from '@dontstarve-web/prefab/bulb_plant';
import type { GrassRecord } from '@dontstarve-web/prefab/grass';
import type { BeefaloSaveState } from '@dontstarve-web/prefab/beefalo';
import type { TurfTileSave } from '@dontstarve-web/prefab/turfMap';
import type { NightmareGrowthSaveState } from '@dontstarve-web/prefab/nightmaregrowth';
import type { WormholeSaveState } from '@dontstarve-web/prefab/wormhole';
import type { MoonTreeSaveState } from '@dontstarve-web/prefab/moontree';
import type { WallSaveState } from '@dontstarve-web/prefab/wallSkins';
import type { FarmPlowSaveState, FarmSoilSaveState, FarmDebrisSaveState } from '@dontstarve-web/prefab/farm_plow';
import type { WorldTemperatureSaveData } from '../../packages/componets/src/worldtemperature';
import type { WeatherSaveData } from '../../packages/componets/src/weather';

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
    building?: { state: 'idle' | 'closed' | 'open'; skinId?: string; burnt?: true };
    container?: SavedContainer;
    stewer?: import('@dontstarve-web/prefab/cook_pot').CookPotSaveState;
    stack?: InventoryStack;
    phonograph?: { remainingSeconds: number };
    torch?: { lit: true };
    lantern?: { ison: boolean };
    health?: { current: number; maximum: number };
    timer?: { remainingSeconds: number };
    flower?: { animation: FlowerAnimation; planted?: true };
    bulbPlant?: BulbPlantSaveState;
    witherable?: import('../../packages/componets/src/witherable').WitherableSave;
    burning?: true;
    plant?: { skinId?: string };
    pickable?: GrassRecord['components']['pickable'];
    lightflierFlower?: import('../../packages/prefab/src/lightflier_flower').LightFlierFlowerSave;
    molehill?: import('../../packages/prefab/src/molehill').MolehillSave;
    beefalo?: BeefaloSaveState;
    nightmareGrowth?: NightmareGrowthSaveState;
    fishable?: import('../../packages/componets/src/fishable').FishableSave;
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
    caveinBoulder?: import('@dontstarve-web/prefab/rocks').CaveinBoulderSave;
    grottoPool?: import('@dontstarve-web/prefab/grotto_pool').GrottoPoolSaveState;
    grottoGlass?: import('@dontstarve-web/prefab/grotto_pool').GrottoGlassSaveState;
    evergreen?: { stump?: true; burnt?: true; burntcone?: true };
    deciduoustree?: import('../../packages/prefab/src/deciduousTreeLeaves').DeciduousTreeSave;
    marbleShrub?: import('../../packages/prefab/src/marbleshrub').MarbleShrubSaveState;
    archiveProp?: import('../../packages/prefab/src/archive_props').ArchivePropSaveState;
    houndbone?: import('../../packages/prefab/src/houndbone').HoundboneSaveState;
    beeQueenHiveTimer?: import('../../packages/componets/src/timer').NamedTimerSave;
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
  stats?: { health: number; hunger: number; sanity: number; penalty?: number };
  /** player_common.lua OnSave `is_ghost`: the player resumes as a ghost on load. */
  ghost?: true;
  /** wortox.lua OnSave counters; the transient finishportalhoptask is not saved. */
  wortox?: import('../../packages/prefab/src/wortox').WortoxSave;
}

export interface SaveDocument {
  format: 'three-roaming-save';
  schemaVersion: 1;
  gameVersion: string;
  session: { id: string; createdAt: string };
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
