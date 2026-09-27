import { describe, expect, it, vi } from 'vitest';
import {
  EquipmentSlot,
  InventorySlot,
  InventoryStore,
  equipmentSlotAddress,
  inventorySlotAddress,
  type InventoryItemSpec,
} from '../src';

const specs: Readonly<Record<string, InventoryItemSpec>> = {
  twigs: { name: '树枝', maxStack: 40, icon: 'twigs.tex' },
  axe: { name: '斧头', maxStack: 40, icon: 'axe.tex', equippable: 'hand' },
};

describe('specialized slots', () => {
  it('owns stable addresses and equipment acceptance rules', () => {
    const inventory = new InventorySlot(3);
    const hand = new EquipmentSlot('hand');
    const body = new EquipmentSlot('body');

    expect(inventory.address).toEqual(inventorySlotAddress(3));
    expect(hand.address).toEqual(equipmentSlotAddress('hand'));
    expect(inventory.accepts(specs.twigs)).toBe(true);
    expect(hand.accepts(specs.axe)).toBe(true);
    expect(body.accepts(specs.axe)).toBe(false);
  });
});

describe('InventoryStore', () => {
  it('keeps crafted skins in a separate stack and resolves their display spec', () => {
    const slots = [
      new InventorySlot(0, { itemId: 'twigs', count: 2 }),
      new InventorySlot(1, { itemId: 'axe', count: 1 }),
      new InventorySlot(2),
      new EquipmentSlot('hand'),
      new EquipmentSlot('body'),
      new EquipmentSlot('head'),
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
      new InventorySlot(0, { itemId: 'axe', skinId: 'axe_feathered', count: 1 }),
      new InventorySlot(1),
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

  it('rejects an item that does not match an equipment slot', () => {
    const store = new InventoryStore([
      new InventorySlot(0, { itemId: 'twigs', count: 1 }),
      new EquipmentSlot('hand'),
    ], specs);

    expect(store.applySlotChanges([
      { slot: inventorySlotAddress(0), itemId: 'twigs', delta: -1 },
      { slot: equipmentSlotAddress('hand'), itemId: 'twigs', delta: 1 },
    ])).toBe(false);
    expect(store.get(inventorySlotAddress(0))).toEqual({ itemId: 'twigs', count: 1 });
    expect(store.get(equipmentSlotAddress('hand'))).toBeNull();
  });
});
