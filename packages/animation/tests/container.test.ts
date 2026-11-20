import { describe, expect, it, vi } from 'vitest';
import { testPlayer } from './testPlayer';
import { Container } from '../../componets/src/container';
import { StorageSlot, type InventoryStack } from '../../inventory/src';
import { Vector3 } from 'three';
import { createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { bindTestWorld } from './worldContentFixture';
import { createEmptyEntity } from '../../prefab/src/prefabInstance';
import { createBuildingContainer, type StorageBuildingId } from '../../prefab/src/containers';
import { testItem, testSavedItem } from './testInventory';
import type { HeldEntityRecord } from '../../prefab/src/saveRecord';

/** A chest's container whose SpawnSaveRecord is `restoreItem`. */
function createContainer(restoreItem = (record: HeldEntityRecord) => testSavedItem(record.prefab, record)) {
  return new Container(createEmptyEntity('treasurechest').instance, () => new StorageSlot(), (record: InventoryStack) => testItem(record), restoreItem);
}

describe('Lua container component', () => {
  it('closes the open container of the same type when a doer opens another, and only an opener closes one', () => {
    // The player inst opens them: its inventory keeps its opencontainers.
    const doer = testPlayer();
    const entities: ReturnType<typeof createEmptyEntity>[] = [];
    const open = (prefab: StorageBuildingId) => {
      const entity = createEmptyEntity(prefab);
      entities.push(entity);
      const container = createBuildingContainer(prefab, entity.instance);
      container.Open(doer);
      return container;
    };
    const chest = open('treasurechest'), pot = open('cookpot');
    expect(chest.IsOpenedBy(doer) && pot.IsOpenedBy(doer)).toBe(true);
    // containers.lua: the icebox is a "chest" too; the cookpot is a "cooker".
    const icebox = open('icebox');
    expect(chest.IsOpen()).toBe(false);
    expect(pot.IsOpenedBy(doer)).toBe(true);
    expect(doer.components.inventory.opencontainers.size).toBe(2);

    const closed = vi.fn();
    icebox.onclosefn = closed;
    icebox.Close(testPlayer());
    expect(closed).not.toHaveBeenCalled();
    expect(icebox.IsOpenedBy(doer)).toBe(true);
    icebox.Close(doer);
    expect(closed).toHaveBeenCalledOnce();
    expect(doer.components.inventory.opencontainers.size).toBe(1);
    for (const { instance, display } of entities) { instance.remove(); display.dispose(); }
  });

  it('checks actual openers on position changes and releases subscriptions when the last opener leaves', async () => {
    const scheduler = new GameTimeScheduler(), world = bindTestWorld(scheduler);
    const container = createContainer();
    container.SetAutoClose(world.getWatchWorldContent, 9);
    const first = { position: new Vector3(), removal: createSignal(false) };
    const second = { position: new Vector3(1, 0, 0), removal: createSignal(false) };
    const closed = container.onclosefn = vi.fn();
    const check = vi.spyOn(container, 'CheckOpeners');
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    try {
      container.Open(first); container.Open(second);
      check.mockClear(); scheduler.advance(30); await settle();
      expect(check).not.toHaveBeenCalled();
      first.position.x = 9.01;
      world.playerpositions.set([first.position.clone(), second.position.clone()]); await settle();
      expect(container.GetOpeners()).toEqual([second]);
      expect(closed).not.toHaveBeenCalled();
      // Opener removal closes without waiting for another position snapshot.
      second.removal.set(true); await settle();
      expect(closed).toHaveBeenCalledOnce();
      check.mockClear();
      world.playerpositions.set([new Vector3(100, 0, 0)]); await settle();
      expect(check).not.toHaveBeenCalled();
    } finally { container.dispose(); world.unbind(); scheduler.dispose(); }
  });
  it('publishes each slot\'s inst as a read-only signal, through loads and clearing', () => {
    const container = createContainer();
    container.SetNumSlots(2);
    const slots = container.slots;
    expect('set' in slots[0].entity).toBe(false);
    expect(slots.map(slot => slot.entity.peek())).toEqual([null, null]);
    const observed = vi.fn();
    const stops = slots.map(slot => slot.entity.subscribe(observed));
    // container.lua OnLoad: each record by its one-based slot.
    container.OnLoad({ items: {
      1: { id: 'slot_log', prefab: 'log', components: { stackable: { stack: 3 } } },
      2: { id: 'slot_torch', prefab: 'torch', components: { fueled: { fuel: 12.5 } } },
    } });
    expect(observed).toHaveBeenCalledTimes(2);
    // The slots hold the insts themselves, not copies of their records.
    expect(slots[0].entity.peek()).toBe(container.GetItemInSlot(1));
    expect(slots.map(slot => slot.entity.peek()?.id)).toEqual(['slot_log', 'slot_torch']);
    expect(() => container.OnLoad({ items: { 3: { id: 'outside', prefab: 'log', components: {} } } })).toThrow();
    expect(observed).toHaveBeenCalledTimes(2);
    container.dispose();
    expect(observed).toHaveBeenCalledTimes(4);
    expect(slots.map(slot => slot.entity.peek())).toEqual([null, null]);
    stops.forEach(stop => stop());
  });

  it('uses one-based slots and independent openers, preserving contents when closed', () => {
    const container = createContainer();
    expect(container.GetNumSlots()).toBe(0);
    container.SetNumSlots(2);
    const log = testItem({ itemId: 'log', count: 3 });
    container.slots[1].setEntity(log);
    expect(container.GetItemInSlot(2)).toBe(log);
    expect(container.GetItemSlot(log)).toBe(2);
    expect(container.GetItemInSlot(0)).toBeNull();
    expect(container.NumItems()).toBe(1);
    expect(container.IsFull()).toBe(false);
    expect(() => container.SetNumSlots(1)).toThrow(RangeError);
    const first = {}, second = {};
    container.openlimit = 2;
    container.Open(first); container.Open(first); container.Open(second);
    expect(container.opencount).toBe(2);
    expect(container.CanOpen()).toBe(false);
    expect(container.IsOpenedByOthers(first)).toBe(true);
    container.Close(first);
    expect(container.IsOpenedBy(first)).toBe(false);
    expect(container.IsOpenedBy(second)).toBe(true);
    expect(container.CanOpen()).toBe(true);
    container.Close();
    expect(container.IsOpen()).toBe(false);
    expect(container.GetAllItems()).toEqual([log]);
    container.dispose();
    expect(log.isRemoved).toBe(true);
    expect(container.IsEmpty()).toBe(true);
  });

  it('saves occupied Lua slots and restores fresh entities without persisting openers', () => {
    const container = createContainer();
    container.SetNumSlots(8);
    const torch = testItem({ entityId: 'saved_torch', itemId: 'torch', count: 1, remainingFuel: 12.5 });
    container.slots[7].setEntity(torch);
    container.Open({});
    const flush = vi.spyOn(torch, 'flush');
    const saved = container.OnSave();
    expect(flush).toHaveBeenCalledOnce();
    // container.lua OnSave: the item's GetSaveRecord under its one-based slot.
    expect(saved).toEqual({ items: { 8: torch.GetSaveRecord() } });
    const restored = createContainer();
    restored.SetNumSlots(8);
    restored.OnLoad(JSON.parse(JSON.stringify(saved)));
    expect(restored.GetItemInSlot(8)).not.toBe(torch);
    expect(restored.OnSave()).toEqual(saved);
    expect(restored.GetOpeners()).toEqual([]);
    saved.items[8].components.fueled = { fuel: 1 };
    expect(container.GetItemInSlot(8)!.snapshot().remainingFuel).toBe(12.5);
    container.dispose(); restored.dispose();
  });

  it('validates loads before changing slots and disposes prepared items if restoration fails', () => {
    const prepared = testItem({ itemId: 'log', count: 1 });
    const restoreItem = vi.fn((record: HeldEntityRecord) => {
      if (record.prefab === 'missing') { throw new Error('Missing prefab'); }
      return prepared;
    });
    const container = createContainer(restoreItem);
    container.SetNumSlots(2);
    expect(() => container.OnLoad({ items: { 3: { id: 'outside', prefab: 'log', components: {} } } })).toThrow(RangeError);
    expect(restoreItem).not.toHaveBeenCalled();
    expect(() => container.OnLoad({ items: {
      1: { id: 'first', prefab: 'log', components: {} }, 2: { id: 'second', prefab: 'missing', components: {} },
    } })).toThrow('Missing prefab');
    expect(container.IsEmpty()).toBe(true);
    expect(prepared.isRemoved).toBe(true);
    container.dispose();
  });
});
