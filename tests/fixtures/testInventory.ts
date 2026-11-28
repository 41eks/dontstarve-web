import {
  InventoryStore,
  ItemEntityRegistry,
  newItemEntity,
  type InventoryStack,
  type ItemEntity,
  type ItemSlot,
  type SpawnedItemRecord,
} from '../../packages/inventory/src';
import type { PerishWorld } from '../../packages/componets/src/perishable';
import {
  createInventoryStore as createWorldInventoryStore,
  createItemRegistry,
  type ItemWorld,
} from '../../src/inventory';
import type { InventoryItemDefinition } from '../../src/inventoryItems';

/**
 * Test-only item worlds. The application's registry is built on its world's SpawnPrefab and has no other way to make
 * an inst. A test of inventory rules alone has no world, so these helpers give its registry one that constructs each
 * inst by itself, and `bindTestItemWorld` (as ItemWorldFixture calls it) puts the registry in a test scene's world.
 */
const handles = new WeakMap<ItemEntityRegistry, { world?: ItemWorld }>();

function handleWorld(handle: { world?: ItemWorld }): ItemWorld {
  return {
    isItemPrefab: prefab => handle.world?.isItemPrefab(prefab) ?? false,
    SpawnPrefab: (prefab, saved) => {
      if (!handle.world) {
        throw new Error(`No test item world spawns ${prefab}`);
      }
      return handle.world.SpawnPrefab(prefab, saved);
    },
  };
}

/** An item registry for a test: outside a world until a fixture binds one. */
export function testItemRegistry(): ItemEntityRegistry {
  const handle: { world?: ItemWorld } = {};
  const entities = createItemRegistry(handleWorld(handle));
  handles.set(entities, handle);
  return entities;
}

/** The application's player inventory on a test item registry. */
export function createInventoryStore(definitions: readonly InventoryItemDefinition[] = []): InventoryStore {
  const handle: { world?: ItemWorld } = {};
  const store = createWorldInventoryStore(handleWorld(handle), definitions);
  handles.set(store.entities, handle);
  return store;
}

/** Puts a test registry in a test scene's world, or takes it out again with `undefined`. */
export function bindTestItemWorld(entities: ItemEntityRegistry, world: ItemWorld | undefined): void {
  const handle = handles.get(entities);
  if (!handle) {
    throw new Error('This item registry was not made by testInventory');
  }
  handle.world = world;
}

/** An item inst outside any world and registry, for tests of the inst alone; a backpack loads its contents the same way. */
export function testItem(state: InventoryStack, perishWorld?: PerishWorld): ItemEntity {
  const restore = (prefab: string, saved: SpawnedItemRecord) => testSavedItem(prefab, saved, perishWorld);
  const inst = newItemEntity(state, perishWorld, restore);
  // What the inst itself loads (a phonograph's record) is spawned the same way.
  inst.BindWorld({
    ...inst.worldServices,
    spawnItem: child => testItem(child, perishWorld),
    restoreItem: record => restore(record.prefab, record),
  });
  return inst;
}

/** SpawnSaveRecord of a test inst outside any world: the record's skin, then SetPersistData. */
export function testSavedItem(prefab: string, saved: SpawnedItemRecord, perishWorld?: PerishWorld): ItemEntity {
  const inst = testItem({ itemId: prefab, count: 1, entityId: saved.id }, perishWorld);
  if (saved.skinname !== undefined) {
    inst.skinId = saved.skinname;
  }
  inst.SetPersistData(saved.components);
  return inst;
}

/** SpawnSaveRecord of a held record in a test world without an item registry. */
export function testRestoreItem(record: { prefab: string } & SpawnedItemRecord): ItemEntity {
  return testSavedItem(record.prefab, record);
}

/** `slot` holding a new test inst of `state`. */
export function slotWith<Slot extends ItemSlot>(slot: Slot, state: InventoryStack, perishWorld?: PerishWorld): Slot {
  slot.setEntity(testItem(state, perishWorld));
  return slot;
}

/** An InventoryStore over the given slots on a test item registry. */
export function testInventoryStore(
  ...[registrations, itemSpecs, skinSpecs = {}]: [
    ConstructorParameters<typeof InventoryStore>[0],
    ConstructorParameters<typeof InventoryStore>[1],
    ConstructorParameters<typeof InventoryStore>[2]?,
  ]
): InventoryStore {
  return new InventoryStore(registrations, itemSpecs, skinSpecs, testItemRegistry());
}
