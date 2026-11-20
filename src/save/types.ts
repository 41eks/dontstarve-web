import type { EntitySaveRecord, SavedTransform } from '@dontstarve-web/prefab/saveRecord';
import type { TurfTileSave } from '@dontstarve-web/prefab/turfMap';
import type { WorldTemperatureSaveData } from '../../packages/componets/src/worldtemperature';
import type { WeatherSaveData } from '../../packages/componets/src/weather';
import type { NightmareClockSaveData } from '../../packages/componets/src/nightmareclock';

/** One TheWorld.topology.nodes entry: node.x / node.y are the centre's world X and Z. */
export interface WorldTopologyNode {
  x: number;
  z: number;
  type: number;
}

export interface SavedPlayer {
  prefab: 'wilson';
  shardId: string;
  transform: SavedTransform;
  /** inventory.lua OnSave of the player. */
  inventory: import('@dontstarve-web/prefab/saveRecord').PlayerInventorySave;
  /** builder.lua's buffered builds. */
  builder: { bufferedBuilds: { recipeId: string; skinId?: string }[] };
  stats?: {
    health: number;
    hunger: number;
    sanity: number;
    penalty?: number;
    sanitySane?: boolean;
    sanityMode?: 0 | 1;
  };
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
      /** TheWorld.topology: each node's centre on the ground and its worldgen NODE_TYPE. */
      topology?: { nodes: WorldTopologyNode[] };
    };
    entities: Record<string, EntitySaveRecord[]>;
  };
  players: { local: SavedPlayer };
}
