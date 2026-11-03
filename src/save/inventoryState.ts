import {
  inventorySlotAddress, equipmentSlotAddress,
  cursorSlotAddress,
  type EquipmentKind, type InventoryState,
} from '@dontstarve-web/inventory';
import type { SaveDocument } from './types';

export function inventoryStateFromSave(save: SaveDocument): InventoryState {
  const slots: InventoryState['slots'][number][] = [];
  for (const [id, container] of Object.entries(save.players.local.inventory.containers)) {
    for (const { slotKey, item } of container.slots) {
      const address = id === 'player:inventory'
        ? inventorySlotAddress(Number(slotKey))
        : id === 'player:cursor' ? cursorSlotAddress() : equipmentSlotAddress(slotKey as EquipmentKind);
      slots.push({ address, item: { ...item } });
    }
  }
  return { slots, bufferedBuilds: save.players.local.inventory.bufferedBuilds.map((build) => ({ ...build })) };
}
