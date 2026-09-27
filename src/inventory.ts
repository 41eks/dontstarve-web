import {
  EQUIPMENT_KINDS,
  INVENTORY_SLOT_COUNT,
  EquipmentSlot,
  InventorySlot,
  InventoryStore,
  type InventoryStack,
} from '@three-roaming/inventory';
import {
  INVENTORY_ITEM_DEFINITIONS,
  INVENTORY_ITEM_SPECS,
  INVENTORY_SKIN_SPECS,
  type InventoryItemDefinition,
} from './inventoryItems';

export { InventoryStore } from '@three-roaming/inventory';
export type {
  EquipmentKind,
  InventoryItemSpec,
  InventorySlotDelta,
  InventoryStack,
} from '@three-roaming/inventory';

function initialStacks(
  definitions: readonly InventoryItemDefinition[],
): ReadonlyMap<number, InventoryStack> {
  const stacks = new Map<number, InventoryStack>();
  for (const definition of definitions) {
    if (!Number.isInteger(definition.slot_index)
      || definition.slot_index < 0
      || definition.slot_index >= INVENTORY_SLOT_COUNT) {
      throw new RangeError(`Invalid inventory slot index: ${definition.slot_index}`);
    }
    if (stacks.has(definition.slot_index)) {
      throw new RangeError(`Duplicate inventory slot index: ${definition.slot_index}`);
    }
    stacks.set(definition.slot_index, {
      itemId: definition.id,
      count: definition.num,
    });
  }
  return stacks;
}

export function createInventoryStore(
  definitions: readonly InventoryItemDefinition[] = INVENTORY_ITEM_DEFINITIONS,
): InventoryStore {
  const stacks = initialStacks(definitions);
  const inventorySlots = Array.from(
    { length: INVENTORY_SLOT_COUNT },
    (_, index) => new InventorySlot(index, stacks.get(index) ?? null),
  );
  const equipmentSlots = EQUIPMENT_KINDS.map((kind) => new EquipmentSlot(kind));
  return new InventoryStore(
    [...inventorySlots, ...equipmentSlots],
    INVENTORY_ITEM_SPECS,
    INVENTORY_SKIN_SPECS,
  );
}
