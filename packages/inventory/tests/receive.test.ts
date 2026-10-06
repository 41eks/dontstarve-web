import { expect, it, vi } from 'vitest';
import { InventorySlot, InventoryStore, inventorySlotAddress, type InventoryStack } from '../src';

const specs = { cutgrass: { name: '草', icon: 'cutgrass.tex', maxStack: 40 },
  rope: { name: '绳', icon: 'rope.tex', maxStack: 20 } };
function store(stacks: readonly (InventoryStack | null)[]) {
  return new InventoryStore(stacks.map((item, index) => ({
    address: inventorySlotAddress(index), slot: new InventorySlot(item, specs),
  })), specs);
}

it('reports each actual destination after committing a gain split between an existing stack and an empty slot', () => {
  const inventory = store([{ itemId: 'cutgrass', count: 39 }, null]);
  const receive = vi.fn((allocations) => {
    expect(inventory.count('cutgrass')).toBe(42);
    expect(allocations).toEqual([
      { slot: inventorySlotAddress(0), itemId: 'cutgrass', delta: 1 },
      { slot: inventorySlotAddress(1), itemId: 'cutgrass', delta: 2 },
    ]);
  });
  expect(inventory.add('cutgrass', 3, undefined, receive)).toBe(true);
  expect(receive).toHaveBeenCalledOnce();
  expect(inventory.add('cutgrass', 100, undefined, receive)).toBe(false);
  expect(receive).toHaveBeenCalledOnce();
  expect(inventory.count('cutgrass')).toBe(42);
});

it('reports crafted products in freed ingredient slots and preserves the selected skin', () => {
  const inventory = store([{ itemId: 'cutgrass', count: 3 }]);
  const receive = vi.fn();
  expect(inventory.craft({ recipeId: 'rope', productId: 'rope', productCount: 1,
    ingredients: { cutgrass: 3 }, buffered: false }, 'rope_skin', receive)).toBe(true);
  expect(receive).toHaveBeenCalledExactlyOnceWith([
    { slot: inventorySlotAddress(0), itemId: 'rope', skinId: 'rope_skin', delta: 1 },
  ]);
  expect(inventory.get(inventorySlotAddress(0))).toEqual({ itemId: 'rope', skinId: 'rope_skin', count: 1 });
});

it('emits no receipts for buffered builds, failed recipes or ordinary slot transfers', () => {
  const inventory = store([{ itemId: 'cutgrass', count: 3 }, null]);
  const receive = vi.fn();
  const recipe = { recipeId: 'rope', productId: 'rope', productCount: 1,
    ingredients: { cutgrass: 3 }, buffered: true };
  expect(inventory.craft(recipe, undefined, receive)).toBe(true);
  expect(inventory.craft(recipe, undefined, receive)).toBe(false);
  expect(inventory.craft({ ...recipe, buffered: false }, undefined, receive)).toBe(false);
  expect(receive).not.toHaveBeenCalled();
});
