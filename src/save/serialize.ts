import type { InventoryStore } from '@dontstarve-web/inventory';
import { deserializeSave, type SaveCatalog } from './deserialize';
import type { SaveDocument, SavedPlayer } from './types';
import type { TurfTileSave } from '@dontstarve-web/prefab/turfMap';
import type { EntitySaveRecord, SavedTransform } from '@dontstarve-web/prefab/saveRecord';

export interface RuntimeSaveState {
  entities: Record<string, EntitySaveRecord[]>;
  playerTransform: SavedTransform;
  /** The player's inventory.lua OnSave and buffered builds: InventoryStore.exportSaved(). */
  inventory: ReturnType<InventoryStore['exportSaved']>;
  elapsedSeconds: number;
  playerStats?: SavedPlayer['stats'];
  playerGhost?: boolean;
  playerWortox?: SavedPlayer['wortox'];
  tiles?: TurfTileSave[];
  worldtemperature?: SaveDocument['world']['systems']['worldtemperature'];
  weather?: SaveDocument['world']['systems']['weather'];
  nightmareclock?: SaveDocument['world']['systems']['nightmareclock'];
  moon?: SaveDocument['world']['systems']['moon'];
}

/** Captures current domain state; the loaded document supplies only world/session metadata. */
export function serializeSave(
  template: SaveDocument,
  state: RuntimeSaveState,
  catalog: SaveCatalog,
  parentId = template.snapshot.id,
  savedAt = new Date().toISOString(),
): string {
  const nextId = Number(parentId) + 1;
  if (!Number.isSafeInteger(nextId) || nextId > 9_999_999_999) throw new Error('Snapshot 编号已用尽');
  const entities = structuredClone(state.entities);
  const document: SaveDocument = {
    ...structuredClone(template),
    snapshot: { id: String(nextId).padStart(10, '0'), parentId, savedAt, reason: 'manual' },
    world: {
      ...structuredClone(template.world), elapsedSeconds: state.elapsedSeconds, entities,
      systems: {
        ...structuredClone(template.world.systems),
        ...(state.worldtemperature === undefined ? {} : { worldtemperature: { ...state.worldtemperature } }),
        ...(state.weather === undefined ? {} : { weather: { ...state.weather } }),
        ...(state.nightmareclock === undefined ? {} : { nightmareclock: structuredClone(state.nightmareclock) }),
        ...(state.moon === undefined ? {} : { moon: { ...state.moon } }),
      },
      map: {
        ...structuredClone(template.world.map),
        ...(state.tiles === undefined ? {} : { tiles: structuredClone(state.tiles) }),
      },
    },
    players: {
      local: {
        ...structuredClone(template.players.local),
        transform: structuredClone(state.playerTransform),
        ...(state.playerStats === undefined ? {} : { stats: { ...state.playerStats } }),
        ...(state.playerGhost ? { ghost: true as const } : {}),
        ...(state.playerWortox === undefined ? {} : { wortox: { ...state.playerWortox } }),
        inventory: structuredClone(state.inventory.inventory),
        builder: { bufferedBuilds: state.inventory.bufferedBuilds.map((build) => ({ ...build })) },
      },
    },
  };
  // Ensure every download can be read by the same startup deserializer.
  const validated = deserializeSave(JSON.stringify(document), catalog);
  return `${JSON.stringify(validated, null, 2)}\n`;
}
