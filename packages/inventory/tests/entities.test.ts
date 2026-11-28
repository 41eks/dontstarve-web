import { onSignalChange } from '../../signals/tests/signalChanges';
import { describe, expect, it, vi } from 'vitest';
import { InventorySlot, InventoryStore, ItemEntityRegistry, equipmentSlotAddress, inventorySlotAddress } from '../src';
import { addFueled } from './fueled';
import { handSlot, inventorySlot, testInventoryStore, testItemRegistry } from './testItems';

const a = inventorySlotAddress(0),
  b = inventorySlotAddress(1),
  hand = equipmentSlotAddress('hand');
const specs = {
  farm_plow_item: { name: 'farm plow', icon: 'farm_plow_item.tex', maxStack: 1, maxUses: 4 },
  torch: {
    name: 'torch',
    icon: 'torch.tex',
    maxStack: 1,
    maxFuel: 75,
    equippable: 'hand' as const,
    configureEntity: addFueled(75),
  },
  log: { name: 'log', icon: 'log.tex', maxStack: 20 },
};
function setup() {
  return testInventoryStore(
    [
      { address: a, slot: inventorySlot() },
      { address: b, slot: inventorySlot() },
      { address: hand, slot: handSlot() },
    ],
    specs,
  );
}

describe('DST item identity and ownership', () => {
  it('indexes late-created map icons without scanning iconless items and releases removed icons from every registry', () => {
    const entities = testItemRegistry(),
      adopted = testItemRegistry();
    const insect = entities.create({ itemId: 'fireflies', count: 1 });
    const backpack = entities.create({ itemId: 'backpack', count: 1 });
    const icon = backpack.AddMiniMapEntity();
    icon.SetIcon('backpack.png');
    adopted.adopt(backpack);
    adopted.adopt(backpack);
    const readInsectIcon = vi.spyOn(insect, 'MiniMapEntity', 'get');
    const readItems = vi.spyOn(entities, 'values');
    try {
      expect(entities.miniMapEntities).toEqual([icon]);
      expect(adopted.miniMapEntities).toEqual([icon]);
      icon.SetEnabled(false);
      expect(entities.miniMapEntities).toEqual([]);
      icon.SetEnabled(true);
      backpack.transform.setPosition(24, 0, -36);
      expect(entities.miniMapEntities[0].position).toBe(backpack.transform.position);
      expect(readItems).not.toHaveBeenCalled();
      expect(readInsectIcon).not.toHaveBeenCalled();
      backpack.destroy();
      expect(entities.miniMapEntities).toEqual([]);
      expect(adopted.miniMapEntities).toEqual([]);
      expect(entities.get(backpack.id)).toBeUndefined();
      expect(insect.isRemoved).toBe(false);
    } finally {
      readItems.mockRestore();
      readInsectIcon.mockRestore();
      entities.dispose();
      adopted.dispose();
    }
  });

  it('derives one item tile and preserves its state through transfers, extraction and load', () => {
    const store = setup();
    store.add('log', 8);
    const entity = store.getEntity(a)!;
    const tile = entity.tile;
    expect('set' in tile).toBe(false);
    expect(tile.value).toMatchObject({ name: store.getItemSpec('log').name, count: 8, wet: false });
    expect(tile.value.image?.icon).toBe(store.getItemSpec('log').icon);
    const changes: string[] = [];
    const stops = [
      onSignalChange(tile, (next, previous) => {
        for (const key of ['count', 'durabilityPercent', 'freshnessPercent', 'wet'] as const) {
          if (next[key] !== previous[key]) {
            changes.push(key);
          }
        }
      }),
    ];
    entity.setFreshnessPercent(0.75);
    entity.setWet(true);
    expect(changes).toEqual(['freshnessPercent', 'wet']);
    changes.length = 0;
    onSignalChange(entity.components.stackable.size, () => {
      // Raw field subscriptions also see the complete committed split.
      expect(store.get(a)?.count).toBe(5);
      expect(store.get(b)?.count).toBe(3);
    });
    expect(store.transfer(a, b, 3)).toBe(true);
    expect(changes).toEqual(['count']);
    const split = store.getEntity(b)!;
    expect(split.tile.value.freshnessPercent).toBe(0.75);
    expect(split.tile.value.wet).toBe(true);
    expect(store.transfer(a, b, 100)).toBe(false);
    expect(changes).toEqual(['count']);
    expect(store.extract(b, 3)).toBe(split);
    store.entities.destroy(split);
    expect(store.extract(a, 5)).toBe(entity);
    expect(store.getEntity(a)).toBeNull();
    expect(store.receive(entity)).toBe(true);
    expect(store.getEntity(a)?.tile).toBe(tile);
    const saved = store.exportState();
    const restored = setup();
    restored.replaceState(saved, {});
    expect(restored.getEntity(a)?.snapshot()).toEqual(entity.snapshot());
    expect(restored.getEntity(a)?.tile.value).toMatchObject({ freshnessPercent: 0.75, wet: true });
    stops.forEach(stop => stop());
    store.dispose();
    restored.dispose();
  });

  it('publishes fuel and finite uses directly without changing the item or quantity signal', () => {
    const store = setup();
    store.add('torch', 1);
    store.add('farm_plow_item', 1);
    const torch = store.getEntity(a)!,
      plow = store.getEntity(b)!;
    const count = vi.fn(),
      durability = vi.fn();
    onSignalChange(torch.components.stackable.size, count);
    onSignalChange(torch.tile, (next, previous) => {
      if (next.durabilityPercent !== previous.durabilityPercent) {
        durability(next.durabilityPercent, previous.durabilityPercent);
      }
    });
    expect(torch.tile.value.durabilityPercent).toBe(1);
    expect(store.setRemainingFuel(a, 37.5)).toBe(true);
    expect(durability).toHaveBeenCalledExactlyOnceWith(0.5, 1);
    expect(count).not.toHaveBeenCalled();
    expect(plow.components.finiteuses.use()).toBe(true);
    expect(plow.tile.value.durabilityPercent).toBe(0.75);
    expect(plow.components.finiteuses.uses.value).toBe(3);
    expect(torch.setFreshnessPercent(NaN)).toBe(false);
    expect(torch.tile.value.freshnessPercent).toBeUndefined();
    store.dispose();
  });

  it('lets finiteuses consume durability on the item tile without a store notification and remove exhausted items', () => {
    const store = setup();
    store.add('farm_plow_item', 1);
    const entity = store.getEntity(a)!;
    const changes = vi.fn();
    store.subscribe(changes);
    expect(entity.components.finiteuses.use()).toBe(true);
    expect(store.get(a)?.remainingUses).toBe(3);
    // The slot keeps the same inst; itemtile follows the inst's tile, so the store has nothing to publish.
    expect(entity.tile.value.durabilityPercent).toBe(0.75);
    expect(changes).not.toHaveBeenCalled();
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
    expect(
      store.applySlotChanges([
        { slot: a, itemId: 'torch', delta: -1 },
        { slot: hand, itemId: 'torch', delta: 1 },
      ]),
    ).toBe(true);
    expect(store.getEntity(hand)).toBe(entity);
    expect(entity.components.inventoryitem.slot?.address).toEqual(hand);
    entity.setRemainingFuel(32.125);
    expect(store.get(hand)?.remainingFuel).toBe(32.125);
    store.add('log', 20);
    const owner = entity.components.inventoryitem.owner;
    expect(
      store.applySlotChanges([
        { slot: hand, itemId: 'torch', delta: -1 },
        { slot: a, itemId: 'torch', delta: 1 },
      ]),
    ).toBe(false);
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
    expect(
      entity.component('test', () => {
        throw new Error('recreated component');
      }),
    ).toBe(runtime);
    store.applySlotChanges([{ slot: a, itemId: 'log', delta: -20 }]);
    expect(store.receive(entity)).toBe(true);
    expect(store.getEntity(a)).toBe(entity);
    entity.remove();
    expect(store.get(a)).toBeNull();
    expect(entity.isRemoved).toBe(true);
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it("makes every inst through the world's SpawnPrefab: created, restored, split and loaded into a backpack", () => {
    const spawned: string[] = [];
    const entities: ItemEntityRegistry = new ItemEntityRegistry((prefab, saved) => {
      spawned.push(prefab);
      return entities.constructSaved(prefab, saved);
    });
    const store = new InventoryStore(
      [
        { address: a, slot: new InventorySlot() },
        { address: b, slot: new InventorySlot() },
      ],
      { ...specs, backpack: { name: 'backpack', icon: 'backpack.tex', maxStack: 1 } },
      {},
      entities,
    );
    entities.create({ itemId: 'torch', count: 1 });
    store.replaceState({ bufferedBuilds: [], slots: [{ address: a, item: { itemId: 'log', count: 4 } }] }, {});
    expect(store.getEntity(a)).not.toBeNull();
    entities.create({
      itemId: 'backpack',
      count: 1,
      container: { slotCount: 8, slots: [{ slotKey: '0', item: { itemId: 'log', count: 1 } }] },
    });
    expect(spawned).toEqual(['torch', 'log', 'backpack', 'log']);
    store.dispose();
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
