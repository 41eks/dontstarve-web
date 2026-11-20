import {
  INVENTORY_SLOT_COUNT,
  BodySlot,
  HandSlot,
  HeadSlot,
  InventorySlot,
  InventoryStore,
  ItemEntityRegistry,
  equipmentSlotAddress,
  inventorySlotAddress,
  cursorSlotAddress,
  type InventoryStack,
  type ItemSpawner,
} from '@dontstarve-web/inventory';
import {
  INVENTORY_ITEM_SPECS,
  INVENTORY_SKIN_SPECS,
  type InventoryItemDefinition,
} from './inventoryItems';

export { InventoryStore } from '@dontstarve-web/inventory';
export type {
  EquipmentKind,
  InventoryItemSpec,
  InventoryMaterialSummary,
  InventorySlotDelta,
  InventoryStack,
} from '@dontstarve-web/inventory';

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

/** The world the inventory's items are spawned into. */
export interface ItemWorld {
  /** Whether `prefab` is an item prefab of this world. */
  isItemPrefab(prefab: string): boolean;
  /** SpawnPrefab of an item prefab, then SetPersistData of its record. */
  readonly SpawnPrefab: ItemSpawner;
}

/**
 * The item registry of a world: every item is SpawnPrefab'd into it. The one exception is a building or relic held
 * under its own prefab ID until it is placed: that ID names the structure's prefab, not an item's, so the held stack is
 * constructed by the registry alone.
 */
export function createItemRegistry(world: ItemWorld): ItemEntityRegistry {
  const entities: ItemEntityRegistry = new ItemEntityRegistry((prefab, saved) =>
    world.isItemPrefab(prefab) ? world.SpawnPrefab(prefab, saved) : entities.constructSaved(prefab, saved));
  return entities;
}

export function createInventoryStore(
  world: ItemWorld,
  definitions: readonly InventoryItemDefinition[] = [],
): InventoryStore {
  const stacks = initialStacks(definitions);
  const entities = createItemRegistry(world);
  const inventorySlots = Array.from(
    { length: INVENTORY_SLOT_COUNT },
    (_, index) => {
      const slot = new InventorySlot(INVENTORY_ITEM_SPECS), stack = stacks.get(index);
      if (stack) { slot.setEntity(entities.create(stack)); }
      return { address: inventorySlotAddress(index), slot };
    },
  );
  const equipmentSlots = [
    { address: equipmentSlotAddress('hand'), slot: new HandSlot() },
    { address: equipmentSlotAddress('body'), slot: new BodySlot() },
    { address: equipmentSlotAddress('head'), slot: new HeadSlot() },
  ];
  return new InventoryStore(
    [...inventorySlots, ...equipmentSlots, { address: cursorSlotAddress(), slot: new InventorySlot(INVENTORY_ITEM_SPECS) }],
    INVENTORY_ITEM_SPECS,
    INVENTORY_SKIN_SPECS,
    entities,
  );
}
