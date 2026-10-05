import { HAT_ITEM_SPECS } from '@dontstarve-web/prefab/hats';
import { GROUND_ITEM_DISPLAY_SPECS } from '@dontstarve-web/prefab/groundItems';
import { INVENTORY_PRODUCT_SPECS, type InventoryProductSpec } from './categories/shared';
import { ingredientNames } from './categories/generated';

export type InventoryItemDisplaySpec = InventoryProductSpec;

export const INVENTORY_ITEM_DISPLAY_SPECS: Readonly<Record<string, InventoryItemDisplaySpec>> = {
  ...Object.fromEntries(Object.entries(ingredientNames).map(([itemId, name]) => [itemId, {
    name,
    icon: `${itemId}.tex`,
  }])),
  ...INVENTORY_PRODUCT_SPECS,
  ...GROUND_ITEM_DISPLAY_SPECS,
  ...HAT_ITEM_SPECS,
};
