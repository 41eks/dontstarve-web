import type { EquipmentKind, SlotAddress } from './types';

export const INVENTORY_SLOT_COUNT = 15;
export const PLAYER_INVENTORY_CONTAINER_ID = 'player:inventory';
export const PLAYER_EQUIPMENT_CONTAINER_ID = 'player:equipment';
export const PLAYER_BACKPACK_CONTAINER_ID = 'player:backpack';
export const BACKPACK_SLOT_COUNT = 8;
export const EQUIPMENT_KINDS: readonly EquipmentKind[] = ['hand', 'body', 'head'];

export function inventorySlotAddress(index: number): SlotAddress {
  if (!Number.isInteger(index) || index < 0 || index >= INVENTORY_SLOT_COUNT) {
    throw new RangeError(`Invalid inventory slot index: ${index}`);
  }
  return { containerId: PLAYER_INVENTORY_CONTAINER_ID, slotKey: String(index) };
}

export function equipmentSlotAddress(kind: EquipmentKind): SlotAddress {
  if (!EQUIPMENT_KINDS.includes(kind)) {
    throw new RangeError(`Invalid equipment slot kind: ${kind}`);
  }
  return { containerId: PLAYER_EQUIPMENT_CONTAINER_ID, slotKey: kind };
}

export function backpackSlotAddress(index: number): SlotAddress {
  if (!Number.isInteger(index) || index < 0 || index >= BACKPACK_SLOT_COUNT) {
    throw new RangeError(`Invalid backpack slot index: ${index}`);
  }
  return { containerId: PLAYER_BACKPACK_CONTAINER_ID, slotKey: String(index) };
}
