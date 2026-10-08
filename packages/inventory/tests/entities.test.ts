import { afterEach, describe, expect, it, vi } from 'vitest';
import { handEquipmentState } from '@dontstarve-web/signals';
import { HandSlot, InventorySlot, InventoryStore, equipmentSlotAddress, inventorySlotAddress } from '../src';

const a = inventorySlotAddress(0), b = inventorySlotAddress(1), hand = equipmentSlotAddress('hand');
const specs = {
  farm_plow_item: { name: 'farm plow', icon: 'farm_plow_item.tex', maxStack: 1, maxUses: 4 },
  torch: { name: 'torch', icon: 'torch.tex', maxStack: 1, maxFuel: 75, equippable: 'hand' as const },
  log: { name: 'log', icon: 'log.tex', maxStack: 20 },
};
function setup() {
  return new InventoryStore([
    { address: a, slot: new InventorySlot() }, { address: b, slot: new InventorySlot() },
    { address: hand, slot: new HandSlot() },
  ], specs);
}
afterEach(() => handEquipmentState.set(null));

describe('DST item identity and ownership', () => {
  it('lets finiteuses consume durability, notify its owner and remove exhausted inventory items', () => {
    const store = setup();
    store.add('farm_plow_item', 1);
    const entity = store.getEntity(a)!;
    const changes = vi.fn();
    store.subscribe(changes);
    expect(entity.components.finiteuses.use()).toBe(true);
    expect(store.get(a)?.remainingUses).toBe(3);
    expect(changes).toHaveBeenCalledExactlyOnceWith([a]);
    expect(entity.components.finiteuses.use(-1)).toBe(false);
    expect(store.get(a)?.remainingUses).toBe(3);
    const saved = store.exportState();
    const restored = setup();
    restored.replaceState(saved, {});
    expect(restored.getEntity(a)!.components.finiteuses.use(3)).toBe(true);
    expect(restored.get(a)).toBeNull();
    expect(entity.components.finiteuses.use(3)).toBe(true);
    expect(store.get(a)).toBeNull();
    store.add('farm_plow_item', 1);
    const replacement = store.getEntity(a);
    expect(entity.components.finiteuses.use()).toBe(false);
    expect(store.getEntity(a)).toBe(replacement);
    expect(store.get(a)?.remainingUses).toBeUndefined();
  });

  it('moves the same inst, preserves it on failed transactions and recreates it only when loading', () => {
    const store = setup();
    store.add('torch', 1);
    const entity = store.getEntity(a)!;
    const runtime = { flush: vi.fn(), dispose: vi.fn() };
    entity.component('test', () => runtime);
    expect(store.applySlotChanges([{ slot: a, itemId: 'torch', delta: -1 },
      { slot: hand, itemId: 'torch', delta: 1 }])).toBe(true);
    expect(store.getEntity(hand)).toBe(entity);
    expect(entity.components.inventoryitem.owner?.address).toEqual(hand);
    entity.setRemainingFuel(32.125);
    expect(store.get(hand)?.remainingFuel).toBe(32.125);
    store.add('log', 20);
    const owner = entity.components.inventoryitem.owner;
    expect(store.applySlotChanges([{ slot: hand, itemId: 'torch', delta: -1 },
      { slot: a, itemId: 'torch', delta: 1 }])).toBe(false);
    expect(store.getEntity(hand)).toBe(entity);
    expect(entity.components.inventoryitem.owner).toBe(owner);
    expect(runtime.dispose).not.toHaveBeenCalled();
    const saved = store.exportState();
    expect(saved.slots.find(slot => slot.address.slotKey === 'hand')?.item?.entityId).toBe(entity.id);
    const restored = setup();
    restored.replaceState(saved, {});
    expect(restored.getEntity(hand)).not.toBe(entity);
    expect(restored.getEntity(hand)?.snapshot()).toEqual(entity.snapshot());
    expect(store.extract(hand, 1, entity)).toBe(entity);
    expect(entity.components.inventoryitem.owner).toBeNull();
    expect(entity.component('test', () => { throw new Error('recreated component'); })).toBe(runtime);
    store.applySlotChanges([{ slot: a, itemId: 'log', delta: -20 }]);
    expect(store.receive(entity)).toBe(true);
    expect(store.getEntity(a)).toBe(entity);
    entity.remove();
    expect(store.get(a)).toBeNull();
    expect(entity.isRemoved).toBe(true);
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it('creates an inst for a split, keeps the receiving stack and removes the merged inst', () => {
    const store = setup();
    store.add('log', 8);
    const original = store.getEntity(a)!;
    const split = store.extract(a, 3)!;
    expect(split).not.toBe(original);
    expect(split.id).not.toBe(original.id);
    expect(store.getEntity(a)).toBe(original);
    expect(original.components.stackable.count).toBe(5);
    expect(split.components.stackable.count).toBe(3);
    expect(store.receive(split)).toBe(true);
    expect(store.getEntity(a)).toBe(original);
    expect(store.get(a)?.count).toBe(8);
    expect(split.isRemoved).toBe(true);
    expect(store.entities.get(split.id)).toBeUndefined();
    expect(store.extract(a, 8)).toBe(original);
    expect(store.receive(original)).toBe(true);
    expect(store.getEntity(a)).toBe(original);
    expect(store.transfer(a, b, 3)).toBe(true);
    const transferred = store.getEntity(b)!;
    expect(transferred).not.toBe(original);
    const before = store.exportState();
    expect(store.transfer(a, b, -1)).toBe(false);
    expect(store.exportState()).toEqual(before);
    expect(store.transfer(b, a, 3)).toBe(true);
    expect(transferred.isRemoved).toBe(true);
    expect(store.getEntity(a)).toBe(original);
    expect(store.get(a)?.count).toBe(8);
  });

  it('rejects duplicate saved identities and failed pickup without changing entities or owners', () => {
    const store = setup();
    store.add('torch', 2);
    const original = store.getEntity(a)!;
    const incoming = store.entities.create({ itemId: 'torch', count: 1, remainingFuel: 14.5 });
    expect(store.receive(incoming)).toBe(false);
    expect(incoming.snapshot().remainingFuel).toBe(14.5);
    expect(incoming.isRemoved).toBe(false);
    expect(incoming.components.inventoryitem.owner).toBeNull();
    const saved = store.exportState();
    saved.slots[1].item!.entityId = original.id;
    expect(() => store.replaceState(saved, {})).toThrow('Duplicate saved item entity');
    expect(store.getEntity(a)).toBe(original);
    expect(original.isRemoved).toBe(false);
    expect(store.extract(a, 1, incoming)).toBeNull();
  });
});
