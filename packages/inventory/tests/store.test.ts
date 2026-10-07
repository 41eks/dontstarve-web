import { afterEach, describe, expect, it, vi } from 'vitest';
import { handEquipmentState } from '@dontstarve-web/signals';
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

const signalSubscriptions: (() => void)[] = [];
afterEach(() => {
  signalSubscriptions.splice(0).forEach((stop) => stop());
  handEquipmentState.set(null);
});

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

describe('inventory state restoration', () => {
  it('publishes hand equipment only after commits, preserves its identity during fuel updates and distinguishes replacement torches', () => {
    const itemSpecs = { torch: { name: '火把', icon: 'torch.tex', maxStack: 1, equippable: 'hand' as const, maxFuel: 75 } };
    const store = new InventoryStore([inventorySlot(0), equipmentSlot('hand')], itemSpecs);
    const from = inventorySlotAddress(0), hand = equipmentSlotAddress('hand');
    const transitions: unknown[] = [];
    signalSubscriptions.push(store.handEquipment.subscribe((equipment) => transitions.push({ equipment, hand: store.get(hand), from: store.get(from) })));
    expect(store.handEquipment.get()).toBeNull();
    expect(store.add('torch', 1)).toBe(true);
    expect(store.applySlotChanges([{ slot: from, itemId: 'torch', delta: -1 },
      { slot: hand, itemId: 'torch', delta: 1 }])).toBe(true);
    const first = store.handEquipment.get();
    expect(first).toEqual({ itemId: 'torch', EQUIPSLOTS: 'HANDS' });
    expect(transitions).toEqual([{ equipment: first, hand: { itemId: 'torch', count: 1 }, from: null }]);
    store.setRemainingFuel(hand, 40);
    expect(store.handEquipment.get()).toBe(first);
    expect(store.applySlotChanges([{ slot: hand, itemId: 'torch', delta: 1 }])).toBe(false);
    expect(store.handEquipment.get()).toBe(first);
    expect(transitions).toHaveLength(1);
    expect(store.applySlotChanges([{ slot: hand, itemId: 'torch', delta: -1 },
      { slot: from, itemId: 'torch', delta: 1, remainingFuel: 40 }])).toBe(true);
    expect(store.handEquipment.get()).toBeNull();
    expect(store.applySlotChanges([{ slot: hand, itemId: 'torch', delta: 1 }])).toBe(true);
    const second = store.handEquipment.get();
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    // An atomic same-prefab replacement still starts a new equip lifetime.
    expect(store.applySlotChanges([{ slot: hand, itemId: 'torch', delta: -1 },
      { slot: hand, itemId: 'torch', delta: 1, remainingFuel: 25 }])).toBe(true);
    expect(store.handEquipment.get()).not.toBe(second);
    const saved = store.exportState();
    const last = store.handEquipment.get();
    store.replaceState(saved, {});
    expect(store.handEquipment.get()).toEqual(last);
    expect(store.handEquipment.get()).not.toBe(last);
    expect(() => store.replaceState({ ...saved, slots: [{ address: hand, item: { itemId: 'torch', count: 2 } }] }, {})).toThrow();
    expect(transitions).toHaveLength(5);
    handEquipmentState.set(null);
    store.setRemainingFuel(hand, 24);
    store.applySlotChanges([{ slot: from, itemId: 'torch', delta: -1 }]);
    store.setStorageAccessible('chest:test', true);
    expect(handEquipmentState.peek()).toBeNull();
    expect(transitions).toHaveLength(6);
  });

  it('persists fractional prefab fuel through transfers and reload', () => {
    const itemSpecs = { torch: { name: '火把', icon: 'torch.tex', maxStack: 1, equippable: 'hand' as const, maxFuel: 75 } };
    const store = new InventoryStore([inventorySlot(0), inventorySlot(1), equipmentSlot('hand')], itemSpecs);
    const from = inventorySlotAddress(0), spare = inventorySlotAddress(1), hand = equipmentSlotAddress('hand');
    expect(store.add('torch', 2)).toBe(true);
    expect(store.applySlotChanges([{ slot: from, itemId: 'torch', delta: -1 },
      { slot: hand, itemId: 'torch', delta: 1 }])).toBe(true);
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.setRemainingFuel(hand, 37.875)).toBe(true);
    expect(store.get(hand)).toEqual({ itemId: 'torch', count: 1, remainingFuel: 37.875 });
    expect(listener).toHaveBeenLastCalledWith([hand]);
    expect(store.get(spare)).toEqual({ itemId: 'torch', count: 1 });
    // Failed transfers leave the burning item's state intact.
    expect(store.applySlotChanges([{ slot: hand, itemId: 'torch', delta: -1 },
      { slot: spare, itemId: 'torch', delta: 1, remainingFuel: 37.875 }])).toBe(false);
    expect(store.get(hand)?.remainingFuel).toBe(37.875);
    expect(store.applySlotChanges([{ slot: hand, itemId: 'torch', delta: -1 },
      { slot: from, itemId: 'torch', delta: 1, remainingFuel: 37.875 }])).toBe(true);
    const restored = new InventoryStore([inventorySlot(0), inventorySlot(1), equipmentSlot('hand')], itemSpecs);
    restored.replaceState(store.exportState(), {});
    expect(restored.get(from)).toEqual(store.get(from));
    expect(restored.get(spare)).toEqual(store.get(spare));
  });

  it('rejects invalid fuel without changing inventory or notifying listeners', () => {
    const store = new InventoryStore([inventorySlot(0)], {
      ...specs, torch: { name: '火把', icon: 'torch.tex', maxStack: 1, maxFuel: 75 },
    });
    const listener = vi.fn();
    store.subscribe(listener);
    for (const fuel of [0, -1, 76, NaN, Infinity]) {
      expect(store.add('torch', 1, undefined, undefined, undefined, undefined, fuel)).toBe(false);
      expect(() => store.replaceState({ slots: [{ address: inventorySlotAddress(0),
        item: { itemId: 'torch', count: 1, remainingFuel: fuel } }], bufferedBuilds: [] }, {})).toThrow();
    }
    expect(store.add('twigs', 1, undefined, undefined, undefined, undefined, 10)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(store.add('torch', 1)).toBe(true);
    listener.mockClear();
    for (const seconds of [0, -1, 76, NaN, Infinity]) expect(store.setRemainingFuel(inventorySlotAddress(0), seconds)).toBe(false);
    expect(store.get(inventorySlotAddress(0))).toEqual({ itemId: 'torch', count: 1 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('preserves a farm plow usage count through pickup, transfers and save/load', () => {
    const itemSpecs = { farm_plow_item: { name: '耕地机', icon: 'farm_plow_item.tex', maxStack: 1, maxUses: 4 } };
    const store = new InventoryStore([inventorySlot(0), inventorySlot(1)], itemSpecs);
    const from = inventorySlotAddress(0), to = inventorySlotAddress(1);
    expect(store.add('farm_plow_item', 1, undefined, undefined, 3)).toBe(true);
    expect(store.get(from)).toEqual({ itemId: 'farm_plow_item', count: 1, remainingUses: 3 });
    expect(store.applySlotChanges([{ slot: from, itemId: 'farm_plow_item', delta: -1 },
      { slot: to, itemId: 'farm_plow_item', delta: 1, remainingUses: 3 }])).toBe(true);
    const saved = store.exportState();
    const restored = new InventoryStore([inventorySlot(0), inventorySlot(1)], itemSpecs);
    restored.replaceState(saved, {});
    expect(restored.get(to)?.remainingUses).toBe(3);
    expect(store.add('farm_plow_item', 1, undefined, undefined, 0)).toBe(false);
    expect(store.add('farm_plow_item', 1, undefined, undefined, 5)).toBe(false);
    expect(store.get(to)?.remainingUses).toBe(3);
  });

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
});
