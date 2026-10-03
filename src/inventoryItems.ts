import { HAT_ITEM_SPECS } from '@three-roaming/prefab/hats';
import {
  INVENTORY_ITEM_DISPLAY_SPECS,
  INVENTORY_SKIN_SPECS,
} from '@three-roaming/ui';
import {
  inventoryItemEquipmentKind,
  inventoryItemMaxStack,
  type InventoryItemSpec,
} from '@three-roaming/inventory';

export interface InventoryItemDefinition {
  slot_index: number;
  id: string;
  num: number;
}

export const INVENTORY_ITEM_SPECS: Readonly<Record<string, InventoryItemSpec>> =
  { ...Object.fromEntries(Object.entries(INVENTORY_ITEM_DISPLAY_SPECS).map(([itemId, display]) => {
    const equippable = inventoryItemEquipmentKind(itemId);
    return [itemId, {
      ...display,
      maxStack: inventoryItemMaxStack(itemId),
      ...(equippable === undefined ? {} : { equippable }),
    }];
  })), ...HAT_ITEM_SPECS };

export { INVENTORY_SKIN_SPECS };
