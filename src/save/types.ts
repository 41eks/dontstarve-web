import type { InventoryStack } from '@dontstarve-web/inventory';
import type { FlowerAnimation } from '@dontstarve-web/prefab/flower';
import type { BulbPlantSaveState } from '@dontstarve-web/prefab/bulb_plant';
import type { BeefaloSaveState } from '@dontstarve-web/prefab/beefalo';
import type { TurfTileSave } from '@dontstarve-web/prefab/turfMap';
import type { NightmareGrowthSaveState } from '@dontstarve-web/prefab/nightmaregrowth';
import type { WormholeSaveState } from '@dontstarve-web/prefab/wormhole';
import type { WallSaveState } from '@dontstarve-web/prefab/wallSkins';
import type { FarmPlowSaveState, FarmSoilSaveState, FarmDebrisSaveState } from '@dontstarve-web/prefab/farm_plow';
import type { WorldTemperatureSaveData } from '../../packages/componets/src/worldtemperature';

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
    building?: { state: 'idle' | 'closed' | 'open'; skinId?: string };
    container?: SavedContainer;
    stewer?: import('@dontstarve-web/prefab/cook_pot').CookPotSaveState;
    stack?: InventoryStack;
    phonograph?: { remainingSeconds: number };
    torch?: { lit: true };
    health?: { current: number; maximum: number };
    timer?: { remainingSeconds: number };
    flower?: { animation: FlowerAnimation; planted: true };
    bulbPlant?: BulbPlantSaveState;
    beefalo?: BeefaloSaveState;
    nightmareGrowth?: NightmareGrowthSaveState;
    wormhole?: WormholeSaveState;
    wall?: WallSaveState;
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
  stats?: { health: number; hunger: number; sanity: number };
}

export interface SaveDocument {
  format: 'three-roaming-save';
  schemaVersion: 1;
  gameVersion: string;
  session: { id: string; createdAt: string };
  snapshot: { id: string; parentId: string | null; savedAt: string; reason: string };
  world: {
    shardId: string;
    prefab: 'forest';
    seed?: string;
    elapsedSeconds: number;
    systems: {
      clock?: { day: number; phase: 'day' | 'dusk' | 'night' | 'full_moon'; phaseProgress: number };
      season?: { name: 'autumn' | 'winter' | 'spring' | 'summer'; daysRemaining: number };
      worldtemperature?: WorldTemperatureSaveData;
      random?: { algorithm: 'xoshiro128ss'; state: number[] };
    };
    map: {
      kind: 'generated';
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
