import {
  inventorySlotAddress, equipmentSlotAddress,
  type EquipmentKind, type InventoryState,
} from '@three-roaming/inventory';
import type { SaveDocument } from './types';

export function chestContainerId(entityId: string): string {
  return `world:treasurechest:${entityId}`;
}

export function inventoryStateFromSave(save: SaveDocument): InventoryState {
  const slots: InventoryState['slots'][number][] = [];
  for (const [id, container] of Object.entries(save.players.local.inventory.containers)) {
    for (const { slotKey, item } of container.slots) {
      const address = id === 'player:inventory'
        ? inventorySlotAddress(Number(slotKey))
        : equipmentSlotAddress(slotKey as EquipmentKind);
      slots.push({ address, item: { ...item } });
    }
  }
  for (const record of save.world.entities.treasurechest ?? []) {
    for (const { slotKey, item } of record.components.container?.slots ?? []) {
      slots.push({ address: { containerId: chestContainerId(record.id), slotKey }, item: { ...item } });
    }
  }
  return { slots, bufferedBuilds: save.players.local.inventory.bufferedBuilds.map((build) => ({ ...build })) };
}
