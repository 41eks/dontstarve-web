import { describe, expect, it, vi } from 'vitest';
import {
  BodySlot,
  HandSlot,
  HeadSlot,
  InventorySlot,
  InventoryStore,
  StorageSlot,
  PreparedFoodSlot,
  craft,
  equipmentSlotAddress,
  inventorySlotAddress,
  type InventoryItemSpec,
  type InventoryStack,
} from '../src';

const specs: Readonly<Record<string, InventoryItemSpec>> = {
  twigs: { name: '树枝', maxStack: 40, icon: 'twigs.tex' },
  axe: { name: '斧头', maxStack: 40, icon: 'axe.tex', equippable: 'hand' },
};

function inventorySlot(index: number, stack: InventoryStack | null = null) {
  return {
    address: inventorySlotAddress(index),
    slot: new InventorySlot(stack),
  };
}

function equipmentSlot(kind: 'hand' | 'body' | 'head') {
  const slot = kind === 'hand'
    ? new HandSlot()
    : kind === 'body'
      ? new BodySlot()
      : new HeadSlot();
  return {
    address: equipmentSlotAddress(kind),
    slot,
  };
}

describe('specialized slots', () => {
  it('stores stacks and applies equipment acceptance rules without owning addresses', () => {
    const inventory = new InventorySlot({ itemId: 'twigs', count: 1 });
    const hand = new HandSlot();
    const body = new BodySlot();

    expect(inventory.get()).toEqual({ itemId: 'twigs', count: 1 });
    expect('address' in inventory).toBe(false);
    expect('address' in hand).toBe(false);
    expect(inventory.maxStack('torch')).toBe(1);
    expect(inventory.maxStack('log')).toBe(20);
    expect(inventory.maxStack('twigs')).toBe(40);
    expect(inventory.accepts(specs.twigs)).toBe(true);
    expect(hand.accepts(specs.axe)).toBe(true);
    expect(body.accepts(specs.axe)).toBe(false);
  });
});

describe('inventory state restoration', () => {
  it('exports closed storage, equipment and buffered builds as detached data without notifying', () => {
    const storage = { address: { containerId: 'chest:1', slotKey: '0' }, slot: new StorageSlot() };
    const store = new InventoryStore([inventorySlot(0), equipmentSlot('hand'), storage], specs);
    const recipe = { recipeId: 'house', productId: 'twigs', productCount: 1, ingredients: {}, buffered: true };
    store.replaceState({ slots: [
      { address: equipmentSlotAddress('hand'), item: { itemId: 'axe', count: 1 } },
      { address: storage.address, item: { itemId: 'twigs', count: 5 } },
    ], bufferedBuilds: [{ recipeId: 'house' }] }, { house: recipe });
    const listener = vi.fn();
    store.subscribe(listener);
    const saved = store.exportState();
    expect(saved.bufferedBuilds).toEqual([{ recipeId: 'house' }]);
    expect(saved.slots[2].item).toEqual({ itemId: 'twigs', count: 5 });
    saved.slots[2].item!.count = 40;
    saved.slots[2].address.containerId = 'changed';
    saved.bufferedBuilds[0].recipeId = 'changed';
    expect(store.get(storage.address)?.count).toBe(5);
    expect(store.isBuffered('house')).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });
  it('replaces items and buffered recipes without crafting, and notifies once', () => {
    const store = new InventoryStore([
      inventorySlot(0, { itemId: 'twigs', count: 8 }), inventorySlot(1), equipmentSlot('hand'),
    ], specs);
    const listener = vi.fn();
    store.subscribe(listener);
    const recipes = { house: { recipeId: 'house', productId: 'twigs', productCount: 1, ingredients: { twigs: 8 }, buffered: true } };
    store.replaceState({
      slots: [{ address: equipmentSlotAddress('hand'), item: { itemId: 'axe', count: 1 } }],
      bufferedBuilds: [{ recipeId: 'house' }],
    }, recipes);
    expect(store.get(inventorySlotAddress(0))).toBeNull();
    expect(store.get(equipmentSlotAddress('hand'))).toEqual({ itemId: 'axe', count: 1 });
    expect(store.isBuffered('house')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('leaves the entire old inventory untouched when any saved slot is invalid', () => {
    const store = new InventoryStore([inventorySlot(0, { itemId: 'twigs', count: 8 }), equipmentSlot('hand')], specs);
    const listener = vi.fn();
    store.subscribe(listener);
    expect(() => store.replaceState({
      slots: [
        { address: inventorySlotAddress(0), item: { itemId: 'twigs', count: 2 } },
        { address: equipmentSlotAddress('hand'), item: { itemId: 'twigs', count: 1 } },
      ], bufferedBuilds: [],
    }, {})).toThrow('Invalid saved item');
    expect(store.get(inventorySlotAddress(0))).toEqual({ itemId: 'twigs', count: 8 });
    expect(store.get(equipmentSlotAddress('hand'))).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('craft', () => {
  it('returns new inventory items without mutating its input', () => {
    const slots = [
      new InventorySlot({ itemId: 'twigs', count: 2 }),
      new InventorySlot({ itemId: 'axe', count: 1 }),
      new InventorySlot(),
    ];

    const next = craft({
      recipeId: 'axe',
      productId: 'axe',
      productCount: 1,
      productSkinId: 'axe_feathered',
      ingredients: { twigs: 1 },
      buffered: false,
    }, slots);

    expect(next).toEqual([
      { itemId: 'twigs', count: 1 },
      { itemId: 'axe', count: 1 },
      { itemId: 'axe', skinId: 'axe_feathered', count: 1 },
    ]);
    expect(slots.map((slot) => slot.get())).toEqual([
      { itemId: 'twigs', count: 2 },
      { itemId: 'axe', count: 1 },
      null,
    ]);
  });

  it('returns null when ingredients are insufficient', () => {
    expect(craft({
      recipeId: 'axe',
      productId: 'axe',
      productCount: 1,
      ingredients: { twigs: 2 },
      buffered: false,
    }, [new InventorySlot({ itemId: 'twigs', count: 1 })])).toBeNull();
  });

  it('uses slot max-stack definitions when placing products', () => {
    const next = craft({
      recipeId: 'axe',
      productId: 'axe',
      productCount: 2,
      ingredients: {},
      buffered: false,
    }, [
      new InventorySlot({ itemId: 'axe', count: 40 }),
      new InventorySlot(),
    ]);

    expect(next).toEqual([
      { itemId: 'axe', count: 40 },
      { itemId: 'axe', count: 2 },
    ]);
  });
});

describe('InventoryStore', () => {
  it('keeps the selected skin with a buffered build until it is consumed', () => {
    const store = new InventoryStore([
      inventorySlot(0, { itemId: 'twigs', count: 2 }),
    ], specs);

    expect(store.craft({
      recipeId: 'treasurechest',
      productId: 'axe',
      productCount: 1,
      ingredients: { twigs: 1 },
      buffered: true,
    }, 'treasurechest_ancient')).toBe(true);

    expect(store.buffered()).toEqual(['treasurechest']);
    expect(store.bufferedSkin('treasurechest')).toBe('treasurechest_ancient');
    expect(store.takeBuffered('treasurechest')).toBe(true);
    expect(store.bufferedSkin('treasurechest')).toBeUndefined();
  });

  it('keeps crafted skins in a separate stack and resolves their display spec', () => {
    const slots = [
      inventorySlot(0, { itemId: 'twigs', count: 2 }),
      inventorySlot(1, { itemId: 'axe', count: 1 }),
      inventorySlot(2),
      equipmentSlot('hand'),
      equipmentSlot('body'),
      equipmentSlot('head'),
    ];
    const store = new InventoryStore(slots, specs, {
      axe_feathered: {
        name: '猎人斧',
        icon: 'axe_feathered.tex',
        atlas: 'images/inventoryimages.xml',
      },
    });

    expect(store.craft({
      recipeId: 'axe',
      productId: 'axe',
      productCount: 1,
      ingredients: { twigs: 1 },
      buffered: false,
    }, 'axe_feathered')).toBe(true);

    expect(store.get(inventorySlotAddress(0))).toEqual({ itemId: 'twigs', count: 1 });
    expect(store.get(inventorySlotAddress(1))).toEqual({ itemId: 'axe', count: 1 });
    expect(store.get(inventorySlotAddress(2))).toEqual({
      itemId: 'axe',
      skinId: 'axe_feathered',
      count: 1,
    });
    expect(store.getStackSpec(store.get(inventorySlotAddress(2))!)).toMatchObject({
      name: '猎人斧',
      icon: 'axe_feathered.tex',
    });
  });

  it('moves a skinned stack atomically and notifies both slots', () => {
    const store = new InventoryStore([
      inventorySlot(0, { itemId: 'axe', skinId: 'axe_feathered', count: 1 }),
      inventorySlot(1),
    ], specs);
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.applySlotChanges([
      {
        slot: inventorySlotAddress(0),
        itemId: 'axe',
        skinId: 'axe_feathered',
        delta: -1,
      },
      {
        slot: inventorySlotAddress(1),
        itemId: 'axe',
        skinId: 'axe_feathered',
        delta: 1,
      },
    ])).toBe(true);

    expect(store.get(inventorySlotAddress(0))).toBeNull();
    expect(store.get(inventorySlotAddress(1))).toEqual({
      itemId: 'axe',
      skinId: 'axe_feathered',
      count: 1,
    });
    expect(listener).toHaveBeenCalledWith([
      inventorySlotAddress(0),
      inventorySlotAddress(1),
    ]);
  });

  it('registers storage slots and moves a stack into storage atomically', () => {
    const store = new InventoryStore([
      inventorySlot(0, { itemId: 'twigs', count: 4 }),
    ], specs);
    const storageAddress = { containerId: 'world:treasurechest:0', slotKey: '0' };
    store.registerSlots([{
      address: storageAddress,
      slot: new StorageSlot(),
    }]);

    expect(store.applySlotChanges([
      { slot: inventorySlotAddress(0), itemId: 'twigs', delta: -4 },
      { slot: storageAddress, itemId: 'twigs', delta: 4 },
    ])).toBe(true);
    expect(store.get(inventorySlotAddress(0))).toBeNull();
    expect(store.get(storageAddress)).toEqual({ itemId: 'twigs', count: 4 });
    expect(store.count('twigs')).toBe(0);
    expect(store.materialSummary()).toEqual({ twigs: 0, axe: 0 });

    const listener = vi.fn();
    store.subscribe(listener);
    store.setStorageAccessible(storageAddress.containerId, true);
    expect(store.materialSummary()).toEqual({ twigs: 4, axe: 0 });
    expect(listener).toHaveBeenLastCalledWith([]);
    store.setStorageAccessible(storageAddress.containerId, false);
    expect(store.materialSummary()).toEqual({ twigs: 0, axe: 0 });

    expect(store.add('twigs', 1)).toBe(true);
    expect(store.get(inventorySlotAddress(0))).toEqual({ itemId: 'twigs', count: 1 });
    expect(store.get(storageAddress)).toEqual({ itemId: 'twigs', count: 4 });
    expect(store.count('twigs')).toBe(1);
    expect(store.materialSummary()).toEqual({ twigs: 1, axe: 0 });
  });

  it('limits prepared food slots to one item and rolls back oversized transfers and saves', () => {
    const address = { containerId: 'world:cookpot:pot', slotKey: '0' };
    const slot = new PreparedFoodSlot();
    const store = new InventoryStore([
      inventorySlot(0, { itemId: 'twigs', count: 4 }), { address, slot },
    ], specs);
    const transfer = (count: number) => store.applySlotChanges([
      { slot: inventorySlotAddress(0), itemId: 'twigs', delta: -count },
      { slot: address, itemId: 'twigs', delta: count },
    ]);
    expect(transfer(4)).toBe(false);
    expect(store.get(inventorySlotAddress(0))?.count).toBe(4);
    expect(slot.get()).toBeNull();
    expect(transfer(1)).toBe(true);
    expect(transfer(1)).toBe(false);
    expect(slot.get()).toEqual({ itemId: 'twigs', count: 1 });
    expect(store.count('twigs')).toBe(3);
    expect(store.materialSummary().twigs).toBe(3);
    store.setStorageAccessible(address.containerId, true);
    expect(store.materialSummary().twigs).toBe(4);
    const before = store.exportState();
    expect(() => store.replaceState({
      slots: [{ address, item: { itemId: 'twigs', count: 2 } }], bufferedBuilds: [],
    }, {})).toThrow('Invalid saved item');
    expect(store.exportState()).toEqual(before);
    expect(() => new PreparedFoodSlot({ itemId: 'twigs', count: 2 })).toThrow('one item');
    expect(store.applySlotChanges([
      { slot: address, itemId: 'twigs', delta: -1 },
      { slot: inventorySlotAddress(0), itemId: 'twigs', delta: 1 },
    ])).toBe(true);
    expect(store.get(inventorySlotAddress(0))?.count).toBe(4);
  });

  it('rejects an item that does not match an equipment slot', () => {
    const store = new InventoryStore([
      inventorySlot(0, { itemId: 'twigs', count: 1 }),
      equipmentSlot('hand'),
    ], specs);

    expect(store.applySlotChanges([
      { slot: inventorySlotAddress(0), itemId: 'twigs', delta: -1 },
      { slot: equipmentSlotAddress('hand'), itemId: 'twigs', delta: 1 },
    ])).toBe(false);
    expect(store.get(inventorySlotAddress(0))).toEqual({ itemId: 'twigs', count: 1 });
    expect(store.get(equipmentSlotAddress('hand'))).toBeNull();
  });
});
