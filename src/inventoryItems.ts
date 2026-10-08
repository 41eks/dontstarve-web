import { HAT_ITEM_SPECS } from '@dontstarve-web/prefab/hats';
import { TORCH_FUEL } from '@dontstarve-web/prefab/torch';
import {
  INVENTORY_ITEM_DISPLAY_SPECS,
  INVENTORY_SKIN_SPECS,
} from '@dontstarve-web/ui';
import {
  inventoryItemEquipmentKind,
  inventoryItemMaxStack,
  type InventoryItemSpec,
} from '@dontstarve-web/inventory';

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
      ...(itemId === 'backpack' ? { canGoInContainer: false } : {}),
      ...(itemId === 'farm_plow_item' ? { maxUses: 4 } : {}),
      ...(itemId === 'torch' ? { maxFuel: TORCH_FUEL } : {}),
      ...(equippable === undefined ? {} : { equippable }),
    }];
  })), ...HAT_ITEM_SPECS };

export { INVENTORY_SKIN_SPECS };
