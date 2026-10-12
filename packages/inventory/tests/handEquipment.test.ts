import { expect, it, vi } from 'vitest';
import { InventoryStore, InventorySlot, HandSlot, inventorySlotAddress, equipmentSlotAddress } from '../src';

const hand = equipmentSlotAddress('hand'), bag = inventorySlotAddress(0);
const specs = { torch: { name: 'torch', icon: 'torch.tex', maxStack: 1, maxFuel: 75, equippable: 'hand' as const } };
function createStore() {
  return new InventoryStore([{ address: bag, slot: new InventorySlot() }, { address: hand, slot: new HandSlot() }], specs, {});
}

it('publishes equipment identity after commits; a transfer keeps the entity and a removal clears the slot', () => {
  const store = createStore();
  const observed: unknown[] = [];
  const stop = store.handEquipment.subscribe(equipment => { if (equipment === null) observed.push(store.getEntity(hand)); });
  try {
    store.add('torch', 1, undefined, undefined, undefined, undefined, 18.5);
    const entity = store.getEntity(bag)!;
    store.transfer(bag, hand, 1);
    expect(store.handEquipment.peek()?.entity).toBe(entity);
    const destroy = vi.spyOn(entity, 'destroy');
    expect(store.transfer(hand, bag, 1)).toBe(true);
    expect(store.getEntity(bag)).toBe(entity);
    expect(entity.components.fueled.remaining).toBe(18.5);
    expect(destroy).not.toHaveBeenCalled();
    expect(observed).toEqual([null]);

    store.transfer(bag, hand, 1);
    const changes = vi.fn();
    store.subscribe(changes);
    // Equipment removes itself (inst:Remove()); the inventory owner clears the slot before observers run.
    expect(entity.remove()).toBe(true);
    expect(store.get(hand)).toBeNull();
    expect(entity.isRemoved).toBe(true);
    expect(changes).toHaveBeenCalledExactlyOnceWith([hand]);
    expect(store.handEquipment.peek()).toBeNull();
    expect(observed).toEqual([null, null]);
    expect(store.exportState().slots.find(slot => slot.address.slotKey === 'hand')?.item).toBeNull();
  } finally { stop(); store.dispose(); }
});

it('publishes the initial equipment when a hand slot is registered later', () => {
  const store = new InventoryStore([{ address: bag, slot: new InventorySlot() }], specs, {});
  try {
    expect(store.handEquipment.peek()).toBeNull();
    store.registerSlots([{ address: hand, slot: new HandSlot({ itemId: 'torch', count: 1, remainingFuel: 18.5 }) }]);
    expect(store.handEquipment.peek()?.entity).toBe(store.getEntity(hand));
  } finally { store.dispose(); }
});
