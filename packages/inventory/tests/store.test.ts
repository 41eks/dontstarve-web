import { describe, expect, it, vi } from 'vitest';
import {
  BodySlot,
  HandSlot,
  HeadSlot,
  InventorySlot,
  InventoryStore,
  StorageSlot,
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

    expect(store.add('twigs', 1)).toBe(true);
    expect(store.get(inventorySlotAddress(0))).toEqual({ itemId: 'twigs', count: 1 });
    expect(store.get(storageAddress)).toEqual({ itemId: 'twigs', count: 4 });
    expect(store.count('twigs')).toBe(1);
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
