import { InventorySlot, HandSlot, HeadSlot, BodySlot, InventoryStore, inventorySlotAddress, equipmentSlotAddress } from '../../inventory/src';
import { INVENTORY_ITEM_SPECS, INVENTORY_SKIN_SPECS } from '../../../src/inventoryItems';

export function createPickupInventory() {
  return new InventoryStore([
    ...Array.from({ length: 15 }, (_, index) => ({ address: inventorySlotAddress(index), slot: new InventorySlot() })),
    { address: equipmentSlotAddress('hand'), slot: new HandSlot() },
    { address: equipmentSlotAddress('head'), slot: new HeadSlot() },
    { address: equipmentSlotAddress('body'), slot: new BodySlot() },
  ], INVENTORY_ITEM_SPECS, INVENTORY_SKIN_SPECS);
}
