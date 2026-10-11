import { HAT_ITEM_SPECS } from '@dontstarve-web/prefab/hats';
import { TURF_ITEM_SPECS } from '@dontstarve-web/prefab/groundItems';
import { configureLightbulbEntity, LIGHTBULB_ID } from '@dontstarve-web/prefab/lightbulb';
import { RECORD_ITEM_SPECS } from '@dontstarve-web/prefab/records';
import { BOOK_ITEM_SPECS } from '@dontstarve-web/prefab/books';
import { BURNABLE_ITEM_DEFINITIONS, configureBurnableItemEntity } from '@dontstarve-web/prefab/burnableItems';
import { TORCH_FUEL } from '@dontstarve-web/prefab/torch';
import { LIGHT_STAFF_USES, isLightStaff } from '@dontstarve-web/prefab/yellowstaff';
import { configureMoonrockNugget } from '../packages/prefab/src/moonrocknugget';
import { configureHeatRockEntity, HEATROCK_FUEL, HEATROCK_ID } from '@dontstarve-web/prefab/heatrock';
import { configureRazorEntity, RAZOR_ID } from '@dontstarve-web/prefab/razor';
import { configureHandEquipmentEntity, getHandEquipmentDefinition } from '@dontstarve-web/prefab/handEquipment';
import { configureBirdEntity, isBirdId } from '@dontstarve-web/prefab/birds';
import { PERISHABLE_FOODS } from '@dontstarve-web/prefab/food';
import { INVENTORY_ITEM_DISPLAY_SPECS } from '../packages/ui/src/inventory-items';
import { INVENTORY_SKIN_SPECS } from '../packages/ui/src/categories/shared';
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
      configureEntity: isBirdId(itemId) ? configureBirdEntity
        : itemId === LIGHTBULB_ID ? configureLightbulbEntity
        : itemId === HEATROCK_ID ? configureHeatRockEntity
        : itemId === RAZOR_ID ? configureRazorEntity
        : itemId === 'moonrocknugget' ? configureMoonrockNugget
        : Object.hasOwn(BURNABLE_ITEM_DEFINITIONS, itemId) ? configureBurnableItemEntity
        : getHandEquipmentDefinition(itemId) ? configureHandEquipmentEntity : undefined,
      ...(getHandEquipmentDefinition(itemId)?.definition.maxUses === undefined ? {}
        : { maxUses: getHandEquipmentDefinition(itemId)!.definition.maxUses }),
      ...(getHandEquipmentDefinition(itemId)?.definition.useStep === undefined ? {}
        : { useStep: getHandEquipmentDefinition(itemId)!.definition.useStep }),
      ...(itemId === 'backpack' ? { canGoInContainer: false } : {}),
      ...(itemId === 'farm_plow_item' ? { maxUses: 4 } : {}),
      ...(isLightStaff(itemId) ? { maxUses: LIGHT_STAFF_USES[itemId] } : {}),
      ...(itemId === 'torch' ? { maxFuel: TORCH_FUEL } : {}),
      ...(itemId === HEATROCK_ID ? { maxFuel: HEATROCK_FUEL } : {}),
      ...(getHandEquipmentDefinition(itemId)?.definition.maxFuel === undefined ? {}
        : { maxFuel: getHandEquipmentDefinition(itemId)!.definition.maxFuel }),
      ...(Object.hasOwn(PERISHABLE_FOODS, itemId)
        ? { perishTime: PERISHABLE_FOODS[itemId].perishTime, perishReplacement: PERISHABLE_FOODS[itemId].replacement } : {}),
      ...(equippable === undefined ? {} : { equippable }),
    }];
  })), ...HAT_ITEM_SPECS, ...RECORD_ITEM_SPECS, ...BOOK_ITEM_SPECS, ...TURF_ITEM_SPECS };

export { INVENTORY_SKIN_SPECS };
