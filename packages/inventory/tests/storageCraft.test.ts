import { describe, expect, it, vi } from 'vitest';
import {
  InventorySlot,
  InventoryStore,
  StorageSlot,
  craft,
  inventorySlotAddress,
  type InventoryItemSpec,
  type InventoryRecipeDefinition,
  type InventoryStack,
} from '../src';

const specs: Readonly<Record<string, InventoryItemSpec>> = Object.fromEntries(
  ['log', 'rocks', 'goldnugget', 'gears', 'cutstone', 'axe'].map((itemId) => [
    itemId, { name: itemId, icon: `${itemId}.tex`, maxStack: itemId === 'log' ? 20 : 40 },
  ]),
);
const firepit: InventoryRecipeDefinition = {
  recipeId: 'firepit', productId: 'firepit', productCount: 1,
  ingredients: { log: 2, rocks: 12 }, buffered: true,
};

function storageSlot(containerId: string, index: number, stack: InventoryStack | null) {
  return { address: { containerId, slotKey: String(index) }, slot: new StorageSlot(stack) };
}

describe('crafting with accessible storage', () => {

  it('combines the backpack and open containers, preserving remaining stacks and their skins', () => {
    const backpack = { address: inventorySlotAddress(0), slot: new InventorySlot({ itemId: 'log', count: 1 }) };
    const log = storageSlot('chest:1', 0, { itemId: 'log', count: 3, skinId: 'log_skin' });
    const rocks = storageSlot('icebox:1', 0, { itemId: 'rocks', count: 13 });
    const closed = storageSlot('chest:closed', 0, { itemId: 'log', count: 20 });
    const store = new InventoryStore([closed, log, backpack, rocks], specs);
    store.setStorageAccessible('chest:1', true);
    store.setStorageAccessible('icebox:1', true);
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.craft(firepit)).toBe(true);
    expect(backpack.slot.get()).toBeNull();
    expect(log.slot.get()).toEqual({ itemId: 'log', count: 2, skinId: 'log_skin' });
    expect(rocks.slot.get()).toEqual({ itemId: 'rocks', count: 1 });
    expect(closed.slot.get()).toEqual({ itemId: 'log', count: 20 });
    expect(store.materialSummary()).toMatchObject({ log: 2, rocks: 1 });
    expect(listener).toHaveBeenCalledExactlyOnceWith([backpack.address, log.address, rocks.address]);
  });

  it('rejects ingredients in a chest closed before crafting, without changing state', () => {
    const store = new InventoryStore([
      storageSlot('chest:1', 0, { itemId: 'log', count: 2 }),
      storageSlot('chest:1', 1, { itemId: 'rocks', count: 12 }),
    ], specs);
    store.setStorageAccessible('chest:1', true);
    expect(store.materialSummary()).toMatchObject(firepit.ingredients);
    store.setStorageAccessible('chest:1', false);
    const before = store.exportState();
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.materialSummary()).toMatchObject({ log: 0, rocks: 0 });
    expect(store.craft(firepit)).toBe(false);
    expect(store.exportState()).toEqual(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('puts crafted items in the backpack and fails atomically when only storage has room', () => {
    const backpack = { address: inventorySlotAddress(0), slot: new InventorySlot({ itemId: 'rocks', count: 40 }) };
    const chest = storageSlot('chest:1', 0, { itemId: 'log', count: 2 });
    const store = new InventoryStore([backpack, chest], specs);
    store.setStorageAccessible('chest:1', true);
    const recipe: InventoryRecipeDefinition = {
      recipeId: 'axe', productId: 'axe', productCount: 1, ingredients: { log: 2 }, buffered: false,
    };
    const before = store.exportState();
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.craft(recipe)).toBe(false);
    expect(store.exportState()).toEqual(before);
    expect(listener).not.toHaveBeenCalled();
    const empty = { address: inventorySlotAddress(1), slot: new InventorySlot() };
    store.registerSlots([empty]);
    expect(store.craft(recipe)).toBe(true);
    expect(empty.slot.get()).toEqual({ itemId: 'axe', count: 1 });
    expect(chest.slot.get()).toBeNull();
    expect(listener).toHaveBeenCalledExactlyOnceWith([empty.address, chest.address]);
  });
});
