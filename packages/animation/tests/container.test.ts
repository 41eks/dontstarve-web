import { describe, expect, it, vi } from 'vitest';
import { Container } from '../../componets/src/container';
import { ItemEntity, StorageSlot, type InventoryStack } from '../../inventory/src';
import { Vector3 } from 'three';
import { createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { bindTestWorld } from './worldContentFixture';

function createContainer(loadItem = (record: InventoryStack) => new ItemEntity(record)) {
  return new Container({}, () => new StorageSlot(), loadItem);
}

describe('Lua container component', () => {
  it('checks actual openers on position changes and releases subscriptions when the last opener leaves', async () => {
    const scheduler = new GameTimeScheduler(), world = bindTestWorld(scheduler);
    const container = new Container({ getPosition: () => new Vector3() }, () => new StorageSlot(), (record: InventoryStack) => new ItemEntity(record));
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
  it('provides a stable read-only DTO signal and publishes complete loads and cleared slots', () => {
    const container = createContainer();
    container.SetNumSlots(2);
    const signal = container.toSignal();
    expect(container.toSignal()).toBe(signal);
    expect('set' in signal).toBe(false);
    expect(signal.peek()).toEqual({ slotCount: 2, slots: [null, null] });
    const observed: unknown[] = [];
    const stop = signal.subscribe(dto => observed.push(dto));
    container.OnLoad({ items: {
      '1': { entityId: 'dto_log', itemId: 'log', count: 3 },
      '2': { entityId: 'dto_torch', itemId: 'torch', count: 1, remainingFuel: 12.5 },
    } });
    expect(observed).toHaveLength(1);
    expect(signal.peek().slots.map(item => item?.entityId)).toEqual(['dto_log', 'dto_torch']);
    expect(Object.isFrozen(signal.peek().slots)).toBe(true);
    expect(signal.peek().slots[0]).not.toBe(container.GetItemInSlot(1));
    const before = signal.peek();
    expect(() => container.OnLoad({ items: { '3': { itemId: 'log', count: 1 } } })).toThrow();
    expect(signal.peek()).toBe(before);
    expect(observed).toHaveLength(1);
    container.SetNumSlots(3);
    expect(signal.peek().slots[2]).toBeNull();
    container.dispose();
    expect(signal.peek()).toEqual({ slotCount: 3, slots: [null, null, null] });
    stop();
    const count = observed.length;
    container.publishDTO();
    expect(observed).toHaveLength(count);
  });

  it('uses one-based slots and independent openers, preserving contents when closed', () => {
    const container = createContainer();
    expect(container.GetNumSlots()).toBe(0);
    container.SetNumSlots(2);
    const log = new ItemEntity({ itemId: 'log', count: 3 });
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
    const torch = new ItemEntity({ entityId: 'saved_torch', itemId: 'torch', count: 1, remainingFuel: 12.5 });
    container.slots[7].setEntity(torch);
    container.Open({});
    const saved = container.OnSave();
    expect(saved).toEqual({ items: { '8': torch.snapshot() } });
    const restored = createContainer();
    restored.SetNumSlots(8);
    restored.OnLoad(JSON.parse(JSON.stringify(saved)));
    expect(restored.GetItemInSlot(8)).not.toBe(torch);
    expect(restored.OnSave()).toEqual(saved);
    expect(restored.GetOpeners()).toEqual([]);
    saved.items['8'].remainingFuel = 1;
    expect(container.GetItemInSlot(8)!.snapshot().remainingFuel).toBe(12.5);
    const flush = vi.spyOn(torch, 'flush');
    container.flush();
    expect(flush).toHaveBeenCalledOnce();
    container.dispose(); restored.dispose();
  });

  it('validates loads before changing slots and disposes prepared items if restoration fails', () => {
    const prepared = new ItemEntity({ itemId: 'log', count: 1 });
    const loadItem = vi.fn((record: InventoryStack) => {
      if (record.itemId === 'missing') throw new Error('Missing prefab');
      return prepared;
    });
    const container = createContainer(loadItem);
    container.SetNumSlots(2);
    expect(() => container.OnLoad({ items: { '3': { itemId: 'log', count: 1 } } })).toThrow(RangeError);
    expect(loadItem).not.toHaveBeenCalled();
    expect(() => container.OnLoad({ items: {
      '1': { itemId: 'log', count: 1 }, '2': { itemId: 'missing', count: 1 },
    } })).toThrow('Missing prefab');
    expect(container.IsEmpty()).toBe(true);
    expect(prepared.isRemoved).toBe(true);
    container.dispose();
  });
});
