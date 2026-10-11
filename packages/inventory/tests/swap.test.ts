import { describe, expect, it, vi } from 'vitest';
import { HandSlot, InventorySlot, InventoryStore, PreparedFoodSlot, StorageSlot,
  equipmentSlotAddress, inventorySlotAddress } from '../src';

const specs = {
  log: { name: '木头', icon: 'log.tex', maxStack: 20 },
  torch: { name: '火把', icon: 'torch.tex', maxStack: 1, equippable: 'hand' as const, maxFuel: 75 },
  reskin_tool: { name: '清洁扫把', icon: 'reskin_tool.tex', maxStack: 1, equippable: 'hand' as const },
};
const first = inventorySlotAddress(0), second = inventorySlotAddress(1), hand = equipmentSlotAddress('hand');
const chest = { containerId: 'chest:swap', slotKey: '0' }, food = { containerId: 'cookpot:swap', slotKey: '0' };
function createStore() {
  return new InventoryStore([
    { address: first, slot: new InventorySlot(null, specs) },
    { address: second, slot: new InventorySlot(null, specs) },
    { address: hand, slot: new HandSlot() },
    { address: chest, slot: new StorageSlot() },
    { address: food, slot: new PreparedFoodSlot() },
  ], specs, { torch_barber: { itemId: 'torch', name: '理发师火把', icon: 'torch_barber.tex', atlas: 'images/inventoryimages.xml' } });
}

describe('atomic slot swaps', () => {
  it('exchanges whole stacks across containers, preserving identity, skin and fuel through reload', () => {
    const store = createStore();
    store.add('torch', 1, 'torch_barber', undefined, undefined, undefined, 23.125);
    store.add('log', 8);
    store.transfer(second, chest, 8);
    const torch = store.getEntity(first)!, logs = store.getEntity(chest)!;
    const changes = vi.fn(() => {
      expect(store.getEntity(first)).toBe(logs);
      expect(store.getEntity(chest)).toBe(torch);
    });
    store.subscribe(changes);
    expect(store.swap(first, chest)).toBe(true);
    expect(changes).toHaveBeenCalledExactlyOnceWith([first, chest]);
    expect(store.get(first)!.count).toBe(8);
    expect(store.get(chest)).toMatchObject({ itemId: 'torch', skinId: 'torch_barber', remainingFuel: 23.125 });
    const saved = store.exportState(), restored = createStore();
    restored.replaceState(saved, {});
    expect(restored.exportState()).toEqual(saved);
    expect(torch.isRemoved).toBe(false);
    expect(logs.isRemoved).toBe(false);
    store.dispose(); restored.dispose();
  });

  it('swaps identical equipment entities without merging and settles their runtime state first', () => {
    const store = createStore();
    store.add('torch', 2);
    store.transfer(first, hand, 1);
    store.setRemainingFuel(hand, 23);
    store.setRemainingFuel(second, 60);
    const worn = store.getEntity(hand)!, replacement = store.getEntity(second)!;
    let pending = 0.125;
    const dispose = vi.fn();
    worn.component('pending-fuel', () => ({
      flush() { if (pending) { const fuel = worn.components.fueled.remaining! - pending; pending = 0; worn.setRemainingFuel(fuel); } },
      dispose,
    }));
    const equipped = vi.fn(() => {
      expect(store.getEntity(hand)).toBe(replacement);
      expect(store.getEntity(second)).toBe(worn);
    });
    store.handEquipment.subscribe(equipped);
    expect(store.swap(hand, second)).toBe(true);
    expect(equipped).toHaveBeenCalledOnce();
    expect(store.get(hand)!.remainingFuel).toBe(60);
    expect(store.get(second)!.remainingFuel).toBe(22.875);
    expect(dispose).not.toHaveBeenCalled();
    expect(worn.components.inventoryitem.owner!.address).toEqual(second);
    store.dispose();
  });

  it('rejects incompatible reverse slots, capacity limits and stale selections without moving entities', () => {
    const store = createStore();
    store.add('log', 8);
    store.add('torch', 1);
    store.transfer(second, hand, 1);
    store.add('reskin_tool', 1);
    store.transfer(second, food, 1);
    const before = store.exportState(), logs = store.getEntity(first)!, torch = store.getEntity(hand)!;
    const changes = vi.fn(); store.subscribe(changes);
    expect(store.swap(first, hand)).toBe(false);
    expect(store.swap(first, food)).toBe(false);
    expect(store.swap(first, first)).toBe(false);
    expect(store.swap(first, second)).toBe(false);
    expect(store.swap(first, food, { from: logs.snapshot(), to: { ...store.getEntity(food)!.snapshot(), entityId: 'replaced' } })).toBe(false);
    expect(store.exportState()).toEqual(before);
    expect(store.getEntity(first)).toBe(logs);
    expect(store.getEntity(hand)).toBe(torch);
    expect(changes).not.toHaveBeenCalled();
    store.dispose();
  });
});
