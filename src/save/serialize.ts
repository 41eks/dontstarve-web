import type { InventoryState } from '@three-roaming/inventory';
import { deserializeSave, type SaveCatalog } from './deserialize';
import { chestContainerId, cookPotContainerId } from './inventoryState';
import type { SaveDocument, SavedContainer, SavedEntity, SavedTransform } from './types';

export interface RuntimeSaveState {
  entities: Record<string, SavedEntity[]>;
  playerTransform: SavedTransform;
  inventory: InventoryState;
  elapsedSeconds: number;
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
  const entities = structuredClone(state.entities);
  for (const chest of entities.treasurechest ?? []) {
    // An open chest is a session interaction; reload every saved chest closed.
    if (chest.components.building) chest.components.building.state = 'closed';
    const container = { slotCount: 9, slots: [] } satisfies SavedContainer;
    chest.components.container = container;
    containers.set(chestContainerId(chest.id), container);
  }
  for (const pot of entities.cookpot ?? []) {
    const container = { slotCount: 4, slots: [] } satisfies SavedContainer;
    pot.components.container = container;
    containers.set(cookPotContainerId(pot.id), container);
  }
  for (const { address, item } of state.inventory.slots) {
    const container = containers.get(address.containerId);
    if (!container) throw new Error(`无法保存未关联实体的容器：${address.containerId}`);
    if (item) container.slots.push({ slotKey: address.slotKey, item: { ...item } });
  }
  const document: SaveDocument = {
    ...structuredClone(template),
    snapshot: { id: String(nextId).padStart(10, '0'), parentId, savedAt, reason: 'manual' },
    world: { ...structuredClone(template.world), elapsedSeconds: state.elapsedSeconds, entities },
    players: {
      local: {
        ...structuredClone(template.players.local),
        transform: structuredClone(state.playerTransform),
        inventory: {
          containers: {
            'player:inventory': containers.get('player:inventory')!,
            'player:equipment': containers.get('player:equipment')!,
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
