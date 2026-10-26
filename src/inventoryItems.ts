import { configureVeggieEntity } from '../packages/prefab/src/veggies';
import { configureLightFlierEntity, LIGHTFLIER_PERISH_TIME } from '../packages/prefab/src/lightflier';
import { configureMoleEntity, MOLE_PERISH_TIME } from '../packages/prefab/src/mole';
import { configureMoleBaitEntity } from '../packages/prefab/src/molebait';
import { configureRockAvocadoFruitEntity } from '../packages/prefab/src/rock_avocado_fruit';
import { configureButterflyEntity, configureMoonButterflyEntity } from '../packages/prefab/src/butterfly';
import { configurePlantableEntity } from '@dontstarve-web/prefab/plantables';
import { BATHBOMB_ID, configureBathbombEntity } from '../packages/prefab/src/bathbomb';
import { configureFertilizerEntity, FERTILIZER_CYCLES } from '../packages/prefab/src/fertilizers';
import { HAT_ITEM_SPECS } from '@dontstarve-web/prefab/hats';
import { TURF_ITEM_SPECS } from '@dontstarve-web/prefab/groundItems';
import { configureLightbulbEntity, LIGHTBULB_ID } from '@dontstarve-web/prefab/lightbulb';
import { RECORD_ITEM_SPECS } from '@dontstarve-web/prefab/records';
import { BOOK_ITEM_SPECS } from '@dontstarve-web/prefab/books';
import { BURNABLE_ITEM_DEFINITIONS, configureBurnableItemEntity } from '@dontstarve-web/prefab/burnableItems';
import { TORCH_FUEL } from '@dontstarve-web/prefab/torch';
import { LIGHT_STAFF_USES, isLightStaff } from '@dontstarve-web/prefab/yellowstaff';
import { configureTradableEntity, hasTradableGoldValue } from '@dontstarve-web/prefab/tradable';
import { configureMoonrockNugget } from '../packages/prefab/src/moonrocknugget';
import { configureHeatRockEntity, HEATROCK_FUEL, HEATROCK_ID } from '@dontstarve-web/prefab/heatrock';
import { configureRazorEntity, RAZOR_ID } from '@dontstarve-web/prefab/razor';
import { configurePanfluteEntity, PANFLUTE_ID, PANFLUTE_USES } from '@dontstarve-web/prefab/panflute';
import { configureEquipmentEntity, getHandEquipmentDefinition } from '@dontstarve-web/prefab/handEquipment';
import { configureBirdEntity, isBirdId } from '@dontstarve-web/prefab/birds';
import { configureBackpackEntity } from '@dontstarve-web/prefab/backpack';
import { ARMORSNURTLESHELL, ARMORSNURTLESHELL_ID, configureArmorSnurtleshellEntity } from '@dontstarve-web/prefab/armorsnurtleshell';
import { AMULET_ID, REDAMULET_USES, configureAmuletEntity } from '@dontstarve-web/prefab/amulet';
import { configureIceEntity, ICE_ID } from '@dontstarve-web/prefab/ice';
import { PERISHABLE_FOODS } from '@dontstarve-web/prefab/food';
import { INVENTORY_ITEM_DISPLAY_SPECS } from '../packages/ui/src/inventory-items';
import { INVENTORY_SKIN_SPECS } from '../packages/ui/src/categories/shared';
import {
  type ItemEntity,
  inventoryItemEquipmentKind,
  inventoryItemMaxStack,
  type InventoryItemSpec,
} from '@dontstarve-web/inventory';

export interface InventoryItemDefinition {
  slot_index: number;
  id: string;
  num: number;
}

function withTradable(itemId: string, configure: ((entity: ItemEntity) => void) | undefined): ((entity: ItemEntity) => void) | undefined {
  return entity => {
    configure?.(entity); configureVeggieEntity(entity); configureMoleBaitEntity(entity); configurePlantableEntity(entity); configureRockAvocadoFruitEntity(entity);
    if (Object.hasOwn(FERTILIZER_CYCLES, itemId)) configureFertilizerEntity(entity);
    if (itemId === BATHBOMB_ID) configureBathbombEntity(entity);
    if (hasTradableGoldValue(itemId)) configureTradableEntity(entity);
  };
}

export const INVENTORY_ITEM_SPECS: Readonly<Record<string, InventoryItemSpec>> =
  { ...Object.fromEntries(Object.entries(INVENTORY_ITEM_DISPLAY_SPECS).map(([itemId, display]) => {
    const equippable = inventoryItemEquipmentKind(itemId);
    return [itemId, {
      ...display,
      maxStack: inventoryItemMaxStack(itemId),
      configureEntity: withTradable(itemId, isBirdId(itemId) ? configureBirdEntity
        : itemId === 'butterfly' ? configureButterflyEntity
        : itemId === 'moonbutterfly' ? configureMoonButterflyEntity
        : itemId === 'mole' ? configureMoleEntity
        : itemId === 'lightflier' ? configureLightFlierEntity
        : itemId === 'backpack' ? configureBackpackEntity
        : itemId === ARMORSNURTLESHELL_ID ? configureArmorSnurtleshellEntity
        : itemId === AMULET_ID ? configureAmuletEntity
        : itemId === LIGHTBULB_ID ? configureLightbulbEntity
        : itemId === HEATROCK_ID ? configureHeatRockEntity
        : itemId === RAZOR_ID ? configureRazorEntity
        : itemId === PANFLUTE_ID ? configurePanfluteEntity
        : itemId === 'moonrocknugget' ? configureMoonrockNugget
        : itemId === ICE_ID ? configureIceEntity
        : Object.hasOwn(BURNABLE_ITEM_DEFINITIONS, itemId) ? configureBurnableItemEntity
        : getHandEquipmentDefinition(itemId) ? configureEquipmentEntity : undefined),
      ...(getHandEquipmentDefinition(itemId)?.definition.maxUses === undefined ? {}
        : { maxUses: getHandEquipmentDefinition(itemId)!.definition.maxUses }),
      ...(getHandEquipmentDefinition(itemId)?.definition.useStep === undefined ? {}
        : { useStep: getHandEquipmentDefinition(itemId)!.definition.useStep }),
      ...(itemId === 'backpack' ? { canGoInContainer: false } : {}),
      ...(itemId === ARMORSNURTLESHELL_ID ? { maxArmor: ARMORSNURTLESHELL } : {}),
      ...(itemId === 'mole' ? { perishTime: MOLE_PERISH_TIME } : {}),
      ...(itemId === 'lightflier' ? { perishTime: LIGHTFLIER_PERISH_TIME } : {}),
      ...(itemId === 'farm_plow_item' ? { maxUses: 4 } : {}),
      ...(itemId === AMULET_ID ? { maxUses: REDAMULET_USES } : {}),
      ...(itemId === PANFLUTE_ID ? { maxUses: PANFLUTE_USES } : {}),
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
