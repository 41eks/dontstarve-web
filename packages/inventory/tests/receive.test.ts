import { expect, it, vi } from 'vitest';
import { InventorySlot, InventoryStore, inventorySlotAddress, type InventoryStack } from '../src';

const specs = { cutgrass: { name: '草', icon: 'cutgrass.tex', maxStack: 40 },
  rope: { name: '绳', icon: 'rope.tex', maxStack: 20 } };
function store(stacks: readonly (InventoryStack | null)[]) {
  return new InventoryStore(stacks.map((item, index) => ({
    address: inventorySlotAddress(index), slot: new InventorySlot(item, specs),
  })), specs);
}

it('handles GiveItem when partially or completely full, notifying only received quantities', () => {
  const inventory = store([{ itemId: 'cutgrass', count: 39 }, { itemId: 'rope', count: 20 }]);
  const receive = vi.fn(), drop = vi.fn();
  const source = { x: 8, y: 0, z: 9 }, position = { x: 4, y: 0, z: 5 };
  inventory.bindActor({ hasTag: tag => tag === 'player', GetPosition: () => position, PushEvent() {} });
  inventory.subscribeReceived(receive);
  inventory.subscribeDropped(drop);
  try {
    const partial = inventory.entities.create({ itemId: 'cutgrass', count: 3, wet: true });
    expect(inventory.GiveItem(partial, source)).toBe(true);
    expect(inventory.count('cutgrass')).toBe(40);
    expect(receive).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ slot: inventorySlotAddress(0), itemId: 'cutgrass', delta: 1 }),
    ], source);
    expect(drop).toHaveBeenNthCalledWith(1, partial);
    expect(partial.snapshot()).toMatchObject({ count: 2, wet: true });
    expect(partial.components.inventoryitem.owner).toBeNull();
    expect(partial.transform.position.toArray()).toEqual([4, 0, 5]);

    const full = inventory.entities.create({ itemId: 'cutgrass', count: 3 });
    expect(inventory.GiveItem(full, source)).toBe(true);
    expect(inventory.count('cutgrass')).toBe(40);
    expect(receive).toHaveBeenCalledOnce();
    expect(drop).toHaveBeenNthCalledWith(2, full);
    expect(full.isRemoved).toBe(false);
    expect(full.snapshot().count).toBe(3);
    expect(full.transform.position.toArray()).toEqual([4, 0, 5]);
  } finally { inventory.dispose(); }
});

it('accepts the available part of a product stack and reports only its committed allocation', () => {
  const inventory = store([{ itemId: 'cutgrass', count: 39 }, { itemId: 'rope', count: 20 }]);
  const entity = inventory.getEntity(inventorySlotAddress(0)), receive = vi.fn();
  expect(inventory.addAvailable('cutgrass', 3, undefined, receive)).toBe(1);
  expect(inventory.count('cutgrass')).toBe(40);
  expect(inventory.getEntity(inventorySlotAddress(0))).toBe(entity);
  expect(receive).toHaveBeenCalledExactlyOnceWith([
    { slot: inventorySlotAddress(0), itemId: 'cutgrass', delta: 1 },
  ]);
  const saved = inventory.exportState();
  expect(inventory.addAvailable('cutgrass', 2, undefined, receive)).toBe(0);
  expect(inventory.exportState()).toEqual(saved);
  expect(receive).toHaveBeenCalledOnce();
});

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
