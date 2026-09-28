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

export const INVENTORY_ITEM_DEFINITIONS: readonly InventoryItemDefinition[] = [
  { slot_index: 0, id: 'cutgrass', num: 3 },
  { slot_index: 1, id: 'twigs', num: 17 },
  { slot_index: 2, id: 'torch', num: 1 },
  { slot_index: 3, id: 'goldnugget', num: 1 },
  { slot_index: 4, id: 'log', num: 20 },
  { slot_index: 5, id: 'rocks', num: 14 },
  { slot_index: 6, id: 'wall_stone_item', num: 14 },
];

export const INVENTORY_ITEM_SPECS: Readonly<Record<string, InventoryItemSpec>> =
  Object.fromEntries(Object.entries(INVENTORY_ITEM_DISPLAY_SPECS).map(([itemId, display]) => {
    const equippable = inventoryItemEquipmentKind(itemId);
    return [itemId, {
      ...display,
      maxStack: inventoryItemMaxStack(itemId),
      ...(equippable === undefined ? {} : { equippable }),
    }];
  }));

export { INVENTORY_SKIN_SPECS };
