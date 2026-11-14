import {
  inventorySlotAddress, equipmentSlotAddress,
  cursorSlotAddress, EQUIPMENT_KINDS,
  type EquipmentKind, type InventoryState,
} from '@dontstarve-web/inventory';
import type { SaveDocument } from './types';

/** A validated save's equipment slot key. */
function equipmentKind(slotKey: string): EquipmentKind {
  const kind = EQUIPMENT_KINDS.find(known => known === slotKey);
  if (!kind) throw new Error(`Unknown equipment slot: ${slotKey}`);
  return kind;
}

export function inventoryStateFromSave(save: SaveDocument): InventoryState {
  const slots: InventoryState['slots'][number][] = [];
  for (const [id, container] of Object.entries(save.players.local.inventory.containers)) {
    for (const { slotKey, item } of container.slots) {
      const address = id === 'player:inventory'
        ? inventorySlotAddress(Number(slotKey))
        : id === 'player:cursor' ? cursorSlotAddress() : equipmentSlotAddress(equipmentKind(slotKey));
      slots.push({ address, item: { ...item } });
    }
  }
  return { slots, bufferedBuilds: save.players.local.inventory.bufferedBuilds.map((build) => ({ ...build })) };
}
