import {
  INVENTORY_SLOT_COUNT,
  BodySlot,
  HandSlot,
  HeadSlot,
  InventorySlot,
  InventoryStore,
  equipmentSlotAddress,
  inventorySlotAddress,
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
    (_, index) => ({
      address: inventorySlotAddress(index),
      slot: new InventorySlot(stacks.get(index) ?? null),
    }),
  );
  const equipmentSlots = [
    { address: equipmentSlotAddress('hand'), slot: new HandSlot() },
    { address: equipmentSlotAddress('body'), slot: new BodySlot() },
    { address: equipmentSlotAddress('head'), slot: new HeadSlot() },
  ];
  return new InventoryStore(
    [...inventorySlots, ...equipmentSlots],
    INVENTORY_ITEM_SPECS,
    INVENTORY_SKIN_SPECS,
  );
}
