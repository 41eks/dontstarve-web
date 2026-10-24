import { describe, expect, it } from 'vitest';
import { Container } from '../../componets/src/container';
import { ItemEntity, InventoryStore, InventorySlot, BodySlot, StorageSlot, backpackSlotAddress, equipmentSlotAddress, inventorySlotAddress } from '../src';

const specs = {
  backpack: { name: '背包', icon: 'backpack.tex', maxStack: 1, equippable: 'body' as const, canGoInContainer: false },
  log: { name: '木头', icon: 'log.tex', maxStack: 20 },
  torch: { name: '火把', icon: 'torch.tex', maxStack: 1, maxFuel: 75 },
};
const body = equipmentSlotAddress('body'), a = inventorySlotAddress(0), b = inventorySlotAddress(1), item = inventorySlotAddress(2);
function store() {
  return new InventoryStore([
    { address: a, slot: new InventorySlot(null, specs) },
    { address: b, slot: new InventorySlot(null, specs) },
    { address: item, slot: new InventorySlot(null, specs) },
    { address: body, slot: new BodySlot() },
    { address: { containerId: 'chest:1', slotKey: '0' }, slot: new StorageSlot() },
  ], specs, { backpack_babybeef: { itemId: 'backpack', name: '小牛背包', icon: 'backpack_babybeef.tex', atlas: 'images/inventoryimages.xml' } });
}

describe('entity-owned backpack containers', () => {
  it('publishes one container DTO after transfers, including in-place stack and fuel changes', () => {
    const inventory = store();
    inventory.add('backpack', 1);
    const bag = inventory.getEntity(a)!;
    inventory.transfer(a, body, 1);
    const container = bag.components.container!, signal = container.toSignal();
    const first = backpackSlotAddress(bag.id, 0), last = backpackSlotAddress(bag.id, 7);
    inventory.add('log', 3);
    expect(inventory.transfer(a, first, 3)).toBe(true);
    const logId = signal.peek().slots[0]!.entityId;
    const observed: unknown[] = [];
    const stop = signal.subscribe(dto => {
      observed.push(dto);
      expect(dto.slots[0]?.count ?? 0).toBe(inventory.get(first)?.count ?? 0);
      expect(dto.slots[7]?.count ?? 0).toBe(inventory.get(last)?.count ?? 0);
    });
    expect(inventory.transfer(first, last, 1)).toBe(true);
    expect(observed).toHaveLength(1);
    expect(signal.peek().slots[0]).toMatchObject({ entityId: logId, count: 2 });
    expect(signal.peek().slots[7]!.count).toBe(1);
    expect(inventory.transfer(first, last, 99)).toBe(false);
    expect(observed).toHaveLength(1);
    expect(inventory.transfer(last, a, 1)).toBe(true);
    expect(signal.peek().slots[7]).toBeNull();
    expect(inventory.add('torch', 1, undefined, undefined, undefined, undefined, 12)).toBe(true);
    expect(inventory.transfer(b, last, 1)).toBe(true);
    const torchId = signal.peek().slots[7]!.entityId;
    const beforeFuel = observed.length;
    expect(inventory.setRemainingFuel(last, 8)).toBe(true);
    expect(observed).toHaveLength(beforeFuel + 1);
    expect(signal.peek().slots[7]).toMatchObject({ entityId: torchId, remainingFuel: 8 });
    const beforeStop = observed.length;
    stop();
    inventory.setRemainingFuel(last, 7);
    expect(observed).toHaveLength(beforeStop);
    expect(signal.peek().slots[7]!.remainingFuel).toBe(7);
    inventory.dispose();
  });

  it('switches independent contents and preserves entities across dropping, pickup, reskinning and restore', () => {
    const inventory = store();
    expect(inventory.add('backpack', 2)).toBe(true);
    const first = inventory.getEntity(a)!, second = inventory.getEntity(b)!;
    const firstSlot = backpackSlotAddress(first.id, 7), secondSlot = backpackSlotAddress(second.id, 0);
    expect(first.components.container).toBeInstanceOf(Container);
    expect(first.components.container!.IsOpen()).toBe(false);
    expect(inventory.transfer(a, body, 1)).toBe(true);
    expect(first.components.container!.IsOpenedBy(inventory)).toBe(true);
    expect(inventory.add('torch', 1, undefined, undefined, undefined, undefined, 12)).toBe(true);
    const torch = inventory.getEntity(a)!;
    expect(inventory.transfer(a, firstSlot, 1)).toBe(true);
    expect(inventory.transfer(body, a, 1)).toBe(true);
    expect(first.components.container!.IsOpen()).toBe(false);
    expect(inventory.transfer(b, body, 1)).toBe(true);
    expect(second.components.container!.IsOpenedBy(inventory)).toBe(true);
    expect(inventory.get(secondSlot)).toBeNull();
    expect(inventory.materialSummary().torch).toBe(0);
    expect(inventory.add('log', 3)).toBe(true);
    expect(inventory.transfer(b, secondSlot, 3)).toBe(true);
    const log = inventory.getEntity(secondSlot)!;
    const dropped = inventory.extract(body, 1, second)!;
    expect(dropped).toBe(second);
    expect(dropped.components.container!.IsOpen()).toBe(false);
    dropped.transform.position = [2, 0, 3];
    dropped.apply({ ...dropped.snapshot(), skinId: 'backpack_babybeef' });
    expect(dropped.components.container!.slots[0].getEntity()).toBe(log);
    expect(inventory.materialSummary().log).toBe(0);
    // A ground save loads a fresh inst with the same nested identity/state.
    const groundState = dropped.snapshot();
    expect(groundState.container!.slots[0].item.entityId).toBe(log.id);
    const groundReload = store();
    const loadedBag = new ItemEntity(groundState);
    loadedBag.transform.position = [2, 0, 3];
    expect(groundReload.receive(loadedBag)).toBe(true);
    expect(groundReload.transfer(a, body, 1)).toBe(true);
    expect(groundReload.getEntity(secondSlot)!.id).toBe(log.id);
    expect(groundReload.get(body)!.skinId).toBe('backpack_babybeef');
    groundReload.dispose();
    expect(inventory.receive(dropped)).toBe(true);
    expect(inventory.transfer(b, body, 1)).toBe(true);
    expect(inventory.getEntity(secondSlot)).toBe(log);
    expect(inventory.materialSummary().log).toBe(3);
    expect(inventory.transfer(body, b, 1)).toBe(true);
    expect(inventory.transfer(a, body, 1)).toBe(true);
    expect(inventory.getEntity(firstSlot)).toBe(torch);
    expect(inventory.get(firstSlot)!.remainingFuel).toBe(12);
    const saved = inventory.exportState();
    expect(saved.slots.some(({ address }) => address.containerId.startsWith('item:backpack:'))).toBe(false);
    const restored = store();
    restored.replaceState(inventory.exportState(), {});
    expect(restored.getEntity(firstSlot)!.id).toBe(torch.id);
    expect(restored.get(firstSlot)!.remainingFuel).toBe(12);
    expect(restored.getEntity(secondSlot)!.id).toBe(log.id);
    expect(restored.transfer(body, a, 1)).toBe(true);
    expect(restored.transfer(b, body, 1)).toBe(true);
    expect(restored.craft({ recipeId: 'test', productId: 'log', productCount: 1, ingredients: { log: 1 }, buffered: false })).toBe(true);
    expect(restored.getEntity(firstSlot)!.id).toBe(torch.id);
    expect(restored.getEntity(secondSlot)!.id).toBe(log.id);
    expect(restored.get(secondSlot)!.count).toBe(2);
    inventory.dispose(); restored.dispose();
  });

  it('rejects inaccessible transfers, nested backpacks and invalid restores without changing contents', () => {
    const inventory = store();
    inventory.add('backpack', 2);
    const first = inventory.getEntity(a)!;
    const slot = backpackSlotAddress(first.id, 0);
    const saved = inventory.exportState();
    expect(inventory.transfer(a, { containerId: 'chest:1', slotKey: '0' }, 1)).toBe(false);
    expect(inventory.transfer(b, slot, 1)).toBe(false);
    inventory.transfer(a, body, 1);
    expect(inventory.transfer(b, slot, 1)).toBe(false);
    expect(inventory.get(slot)).toBeNull();
    const invalid = structuredClone(saved);
    invalid.slots[0].item!.container = { slotCount: 8, slots: [{ slotKey: '8', item: { itemId: 'log', count: 1 } }] };
    const before = inventory.exportState();
    expect(() => inventory.replaceState(invalid, {})).toThrow();
    expect(inventory.exportState()).toEqual(before);
    inventory.dispose();
  });
});
