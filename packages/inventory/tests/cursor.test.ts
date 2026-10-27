import { expect, it } from 'vitest';
import { InventorySlot, InventoryStore, HandSlot, cursorSlotAddress, equipmentSlotAddress, inventorySlotAddress } from '../src';
import { addFueled } from './fueled';

const first = inventorySlotAddress(0), second = inventorySlotAddress(1), cursor = cursorSlotAddress();
const specs = {
  log: { name: '木头', icon: 'log.tex', maxStack: 20 },
  torch: { name: '火把', icon: 'torch.tex', maxStack: 1, equippable: 'hand' as const, maxFuel: 75, configureEntity: addFueled(75) },
};
function createStore() {
  return new InventoryStore([
    ...[first, second, cursor].map(address => ({ address, slot: new InventorySlot(null, specs) })),
    { address: equipmentSlotAddress('hand'), slot: new HandSlot() },
  ], specs, { torch_barber: { itemId: 'torch', name: '理发师火把', icon: 'torch_barber.tex', atlas: 'images/inventoryimages.xml' } });
}

it('moves real entities through the cursor, swaps and reloads held skin and component state', () => {
  const store = createStore();
  store.add('torch', 1, 'torch_barber', undefined, undefined, undefined, 23.125);
  store.add('log', 8);
  const torch = store.getEntity(first)!, logs = store.getEntity(second)!;
  expect(store.transfer(first, cursor, 1, torch.snapshot())).toBe(true);
  expect(store.get(first)).toBeNull();
  expect(store.getEntity(cursor)).toBe(torch);
  expect(store.swap(cursor, second)).toBe(true);
  expect(store.getEntity(cursor)).toBe(logs);
  expect(store.getEntity(second)).toBe(torch);
  expect(store.returnCursor(first)).toBe(true);
  expect(store.getEntity(first)).toBe(logs);
  expect(store.transfer(second, cursor, 1)).toBe(true);
  const saved = store.exportState(), restored = createStore();
  restored.replaceState(saved, {});
  expect(restored.exportState()).toEqual(saved);
  expect(restored.getEntity(cursor)?.snapshot()).toMatchObject({ entityId: torch.id, skinId: 'torch_barber', remainingFuel: 23.125 });
  store.dispose(); restored.dispose();
});

it('keeps held items when return or placement fails and rejects a replaced source identity', () => {
  const store = createStore();
  store.add('log', 20);
  const log = store.getEntity(first)!;
  expect(store.transfer(first, cursor, 20)).toBe(true);
  store.add('torch', 2);
  const before = store.exportState();
  expect(store.returnCursor(first)).toBe(false);
  expect(store.transfer(cursor, equipmentSlotAddress('hand'), 20)).toBe(false);
  expect(store.exportState()).toEqual(before);
  expect(store.getEntity(cursor)).toBe(log);
  const torch = store.getEntity(first)!;
  expect(store.transfer(first, cursor, 1, { ...torch.snapshot(), entityId: 'old_entity' })).toBe(false);
  expect(store.getEntity(first)).toBe(torch);
  store.dispose();
});

it('excludes the cursor from automatic allocations and crafting while permitting ordinary inventory operations', () => {
  const store = createStore();
  store.add('torch', 2);
  expect(store.add('log', 1)).toBe(false);
  expect(store.get(cursor)).toBeNull();
  expect(store.transfer(first, cursor, 1)).toBe(true);
  expect(store.add('log', 20)).toBe(true);
  expect(store.materialSummary()).toEqual({ log: 20, torch: 1 });
  expect(store.craft({ recipeId: 'burn_torch', productId: 'log', productCount: 1,
    ingredients: { torch: 2 }, buffered: false })).toBe(false);
  expect(store.get(cursor)?.itemId).toBe('torch');
  expect(store.returnCursor()).toBe(false);
  store.dispose();
});

it('DropEverything drops the cursor, slot and equipped whole stacks at the owner position, keeping identity and state', () => {
  const store = createStore();
  const dropped: string[] = [], launches: ({ speed: { min: number }; ySpeed: { min: number }; height: number } | undefined)[] = [];
  store.subscribeDropped((entity, launch) => { dropped.push(entity.id); launches.push(launch); });
  store.add('torch', 1, 'torch_barber', undefined, undefined, undefined, 23.125);
  store.add('log', 8);
  const torch = store.getEntity(first)!, logs = store.getEntity(second)!;
  expect(store.EquipFromInventory(torch)).toBe(true);
  expect(store.transfer(second, cursor, 8)).toBe(true);
  store.add('log', 3);
  const rest = store.getEntity(first)!;
  store.DropEverything();
  expect(dropped).toEqual([logs.id, rest.id, torch.id]);
  // DropItem(item, true, true): OnDropped(randomdir) throws each item from y = 1 at speed 2..3 with vertical speed 3 × speed.
  for (const launch of launches) {
    expect(launch!.height).toBe(1);
    expect(launch!.speed.min).toBeGreaterThanOrEqual(2); expect(launch!.speed.min).toBeLessThan(3);
    expect(launch!.ySpeed.min).toBeCloseTo(launch!.speed.min * 3);
  }
  expect(store.addresses().every(address => store.get(address) === null)).toBe(true);
  expect(torch.snapshot()).toMatchObject({ skinId: 'torch_barber', remainingFuel: 23.125, count: 1 });
  expect(rest.snapshot().count).toBe(3);
  expect(logs.snapshot().count).toBe(8);
  store.dispose();
});
