import { expect, it, vi } from 'vitest';
import { createHandEquipmentExistenceState } from '@dontstarve-web/signals';
import { InventoryStore, InventorySlot, HandSlot, inventorySlotAddress, equipmentSlotAddress } from '../src';

const hand = equipmentSlotAddress('hand'), bag = inventorySlotAddress(0);
const specs = { torch: { name: 'torch', icon: 'torch.tex', maxStack: 1, maxFuel: 75, equippable: 'hand' as const } };
function createStore(handEquipmentExistenceState?: ReturnType<typeof createHandEquipmentExistenceState>) {
  return new InventoryStore([{ address: bag, slot: new InventorySlot() }, { address: hand, slot: new HandSlot() }], specs, {}, undefined, handEquipmentExistenceState);
}

it('commits a signal clear before presentation observes it and preserves a transferred entity', () => {
  const store = createStore();
  const observed: unknown[] = [];
  const stop = store.handEquipmentExistenceState.subscribe(equipment => { if (equipment === null) observed.push(store.getEntity(hand)); });
  try {
    store.add('torch', 1, undefined, undefined, undefined, undefined, 18.5);
    const entity = store.getEntity(bag)!;
    store.transfer(bag, hand, 1);
    const destroy = vi.spyOn(entity, 'destroy');
    const changes = vi.fn();
    store.subscribe(changes);
    expect(store.transfer(hand, bag, 1)).toBe(true);
    expect(store.getEntity(bag)).toBe(entity);
    expect(entity.components.fueled.remaining).toBe(18.5);
    expect(destroy).not.toHaveBeenCalled();
    expect(changes).toHaveBeenCalledOnce();
    expect(observed).toEqual([null]);
    store.transfer(bag, hand, 1);
    changes.mockClear();
    store.handEquipmentExistenceState.set(null);
    expect(store.get(hand)).toBeNull();
    expect(entity.isRemoved).toBe(true);
    expect(destroy).toHaveBeenCalledOnce();
    expect(changes).toHaveBeenCalledExactlyOnceWith([hand]);
    expect(observed).toEqual([null, null]);
    expect(store.exportState().slots.find(slot => slot.address.slotKey === 'hand')?.item).toBeNull();
  } finally { stop(); store.dispose(); }
});

it('isolates stores, ignores foreign identities and releases the existence subscription on disposal', () => {
  const handEquipmentExistenceState = createHandEquipmentExistenceState();
  const player = createStore(handEquipmentExistenceState), other = createStore();
  expect(player.handEquipmentExistenceState).toBe(handEquipmentExistenceState);
  try {
    player.add('torch', 1); player.transfer(bag, hand, 1);
    const entity = player.getEntity(hand)!;
    const equipment = player.handEquipment.peek();
    other.add('torch', 1); other.transfer(bag, hand, 1);
    const otherEntity = other.getEntity(hand)!;
    expect(player.handEquipment.peek()).toBe(equipment);
    other.handEquipmentExistenceState.set(null);
    expect(other.getEntity(hand)).toBeNull();
    expect(otherEntity.isRemoved).toBe(true);
    expect(player.handEquipment.peek()).toBe(equipment);
    expect(player.getEntity(hand)).toBe(entity);
    expect(entity.isRemoved).toBe(false);
    // Even an incorrectly injected foreign equip identity cannot remove our item.
    handEquipmentExistenceState.set({ itemId: 'torch', EQUIPSLOTS: 'HANDS', entity: otherEntity });
    handEquipmentExistenceState.set(null);
    expect(player.getEntity(hand)).toBe(entity);
    player.replaceState(player.exportState(), {});
    const current = player.getEntity(hand)!;
    const remove = vi.spyOn(player, 'applySlotChanges');
    player.dispose();
    expect(current.isRemoved).toBe(true);
    handEquipmentExistenceState.set(null);
    expect(remove).not.toHaveBeenCalled();
  } finally { player.dispose(); other.dispose(); }
});

it('binds once when a hand slot is registered later and leaves failed registrations unbound', () => {
  const handEquipmentExistenceState = createHandEquipmentExistenceState();
  const subscribe = vi.spyOn(handEquipmentExistenceState, 'subscribe');
  const store = new InventoryStore([{ address: bag, slot: new InventorySlot() }], specs,
    {}, undefined, handEquipmentExistenceState);
  try {
    expect(subscribe).not.toHaveBeenCalled();
    expect(() => store.registerSlots([
      { address: hand, slot: new HandSlot() }, { address: bag, slot: new InventorySlot() },
    ])).toThrow('Duplicate slot address');
    expect(subscribe).not.toHaveBeenCalled();
    expect(handEquipmentExistenceState.peek()).toBeNull();

    store.registerSlots([{ address: hand, slot: new HandSlot({ itemId: 'torch', count: 1, remainingFuel: 18.5 }) }]);
    const entity = store.getEntity(hand)!;
    expect(subscribe).toHaveBeenCalledOnce();
    expect(store.handEquipment.peek()?.entity).toBe(entity);
    store.registerSlots([{ address: inventorySlotAddress(1), slot: new InventorySlot() }]);
    expect(() => store.registerSlots([{ address: hand, slot: new HandSlot() }])).toThrow('Duplicate slot address');
    expect(subscribe).toHaveBeenCalledOnce();

    handEquipmentExistenceState.set(null);
    expect(store.getEntity(hand)).toBeNull();
    expect(entity.isRemoved).toBe(true);
  } finally { store.dispose(); }
});
