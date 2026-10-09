import { type InventoryState } from '@dontstarve-web/inventory';
import { deserializeSave, type SaveCatalog } from './deserialize';
import { STORAGE_BUILDING_IDS, buildingContainerId, buildingContainerDefinition } from '@dontstarve-web/prefab/containers';
import type { SaveDocument, SavedContainer, SavedEntity, SavedPlayer, SavedTransform } from './types';
import type { TurfTileSave } from '@dontstarve-web/prefab/turfMap';

export interface RuntimeSaveState {
  entities: Record<string, SavedEntity[]>;
  playerTransform: SavedTransform;
  inventory: InventoryState;
  elapsedSeconds: number;
  playerStats?: SavedPlayer['stats'];
  tiles?: TurfTileSave[];
  worldtemperature?: SaveDocument['world']['systems']['worldtemperature'];
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
  const containers = new Map<string, SavedContainer>();
  containers.set('player:inventory', { slotCount: 15, slots: [] });
  containers.set('player:equipment', { slotCount: 3, slots: [] });
  containers.set('player:cursor', { slotCount: 1, slots: [] });
  const entities = structuredClone(state.entities);
  for (const prefab of STORAGE_BUILDING_IDS) {
    for (const chest of entities[prefab] ?? []) {
      // Open storage is a session interaction; reload saved storage closed.
      if (prefab !== 'cookpot' && chest.components.building) chest.components.building.state = 'closed';
      const container = { slotCount: buildingContainerDefinition(prefab).slotCount, slots: [] } satisfies SavedContainer;
      chest.components.container = container;
      containers.set(buildingContainerId(prefab, chest.id), container);
    }
  }
  for (const { address, item } of state.inventory.slots) {
    const container = containers.get(address.containerId);
    if (!container) throw new Error(`无法保存未关联实体的容器：${address.containerId}`);
    if (item) container.slots.push({ slotKey: address.slotKey, item: { ...item } });
  }
  const document: SaveDocument = {
    ...structuredClone(template),
    snapshot: { id: String(nextId).padStart(10, '0'), parentId, savedAt, reason: 'manual' },
    world: {
      ...structuredClone(template.world), elapsedSeconds: state.elapsedSeconds, entities,
      systems: {
        ...structuredClone(template.world.systems),
        ...(state.worldtemperature === undefined ? {} : { worldtemperature: { ...state.worldtemperature } }),
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
        inventory: {
          containers: {
            'player:inventory': containers.get('player:inventory')!,
            'player:equipment': containers.get('player:equipment')!,
            'player:cursor': containers.get('player:cursor')!,
          },
          bufferedBuilds: state.inventory.bufferedBuilds.map((build) => ({ ...build })),
        },
      },
    },
  };
  // Ensure every download can be read by the same startup deserializer.
  const validated = deserializeSave(JSON.stringify(document), catalog);
  return `${JSON.stringify(validated, null, 2)}\n`;
}
