import {
  BodySlot, HandSlot, HeadSlot, InventorySlot, InventoryStore, ItemEntityRegistry, PreparedFoodSlot, StorageSlot, newItemEntity,
  type InventoryStack, type ItemEntity, type ItemSlot, type SpawnedItemRecord,
} from '../src';
import type { PerishWorld } from '../../componets/src/perishable';

/**
 * Test-only construction. A registry is built on its world's SpawnPrefab and slots hold insts something else spawned;
 * these tests of the inventory's own rules have no world, so each inst here is constructed by itself.
 */
export function testItem(state: InventoryStack, perishWorld?: PerishWorld): ItemEntity {
  return newItemEntity(state, perishWorld, (prefab, saved) => testSavedItem(prefab, saved, perishWorld));
}

/** SpawnSaveRecord of a test inst: the record's skin, then SetPersistData. */
export function testSavedItem(prefab: string, saved: SpawnedItemRecord, perishWorld?: PerishWorld): ItemEntity {
  const inst = testItem({ itemId: prefab, count: 1, entityId: saved.id }, perishWorld);
  if (saved.skinname !== undefined) inst.skinId = saved.skinname;
  inst.SetPersistData(saved.components);
  return inst;
}

/** A registry whose SpawnPrefab is its own construction. */
export function testItemRegistry(): ItemEntityRegistry {
  const entities: ItemEntityRegistry = new ItemEntityRegistry((prefab, saved) => entities.constructSaved(prefab, saved));
  return entities;
}

export function testInventoryStore(...[registrations, itemSpecs, skinSpecs = {}, entities = testItemRegistry(), equipment]:
  [ConstructorParameters<typeof InventoryStore>[0], ConstructorParameters<typeof InventoryStore>[1], ConstructorParameters<typeof InventoryStore>[2]?,
    ItemEntityRegistry?, ConstructorParameters<typeof InventoryStore>[4]?]): InventoryStore {
  return new InventoryStore(registrations, itemSpecs, skinSpecs, entities, equipment);
}

function holding<Slot extends ItemSlot>(slot: Slot, stack: InventoryStack | null | undefined): Slot {
  if (stack) slot.setEntity(testItem(stack));
  return slot;
}
/** Each slot class, already holding a test inst of `stack`. */
export const inventorySlot = (stack?: InventoryStack | null, ...rest: ConstructorParameters<typeof InventorySlot>) => holding(new InventorySlot(...rest), stack);
export const storageSlot = (stack?: InventoryStack | null, ...rest: ConstructorParameters<typeof StorageSlot>) => holding(new StorageSlot(...rest), stack);
export const preparedFoodSlot = (stack?: InventoryStack | null, ...rest: ConstructorParameters<typeof PreparedFoodSlot>) => holding(new PreparedFoodSlot(...rest), stack);
export const handSlot = (stack?: InventoryStack | null) => holding(new HandSlot(), stack);
export const bodySlot = (stack?: InventoryStack | null) => holding(new BodySlot(), stack);
export const headSlot = (stack?: InventoryStack | null) => holding(new HeadSlot(), stack);
