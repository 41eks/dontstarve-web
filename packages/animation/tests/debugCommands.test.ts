import { describe, expect, it, vi } from 'vitest';
import { executeDebugCommand } from '../../../src/debugCommands';
import {
  HeadSlot, InventorySlot, InventoryStore, equipmentSlotAddress, inventorySlotAddress,
} from '../../inventory/src';
import { HAT_ITEM_SPECS } from '../../prefab/src/hats';
import { createPickupInventory } from './pickupFixture';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';

function createInventory() {
  return new InventoryStore([
    { address: inventorySlotAddress(0), slot: new InventorySlot() },
    { address: equipmentSlotAddress('head'), slot: new HeadSlot() },
  ], HAT_ITEM_SPECS);
}

describe('debug command punctuation', () => {
  it.each([' c_setsanity （ .5 ) ; '])(
    'sets sanity exactly once using %s', async (command) => {
      const setSanity = vi.fn();
      const result = await executeDebugCommand(command, createInventory(), undefined, undefined, setSanity);
      expect(result.ok).toBe(true);
      expect(setSanity).toHaveBeenCalledTimes(1);
      expect(setSanity.mock.calls[0][0]).toBeGreaterThanOrEqual(0);
      expect(setSanity.mock.calls[0][0]).toBeLessThanOrEqual(1);
    },
  );

  it.each(['c_setsanity(-1)', 'c_setsanity(NaN)'])(
    'rejects invalid sanity without changing it: %s', async (command) => {
      const setSanity = vi.fn();
      expect((await executeDebugCommand(command, createInventory(), undefined, undefined, setSanity)).ok).toBe(false);
      expect(setSanity).not.toHaveBeenCalled();
    },
  );

  it.each([" c_give （ 'alterguardianhat'， 1 ） ; "])('gives and equips the registered Enlightened Crown using %s', async (command) => {
    const inventory = createInventory();
    expect(await executeDebugCommand(command, inventory)).toEqual({
      ok: true, message: '已添加 1 个 alterguardianhat',
    });
    expect(inventory.get(inventorySlotAddress(0))).toEqual({ itemId: 'alterguardianhat', count: 1 });
    expect(inventory.getItemSpec('alterguardianhat')).toMatchObject({
      name: '启迪之冠', atlas: 'images/inventoryimages1.xml', maxStack: 1, equippable: 'head',
    });
    expect(inventory.applySlotChanges([
      { slot: inventorySlotAddress(0), itemId: 'alterguardianhat', delta: -1 },
      { slot: equipmentSlotAddress('head'), itemId: 'alterguardianhat', delta: 1 },
    ])).toBe(true);
    expect(inventory.get(equipmentSlotAddress('head'))).toEqual({ itemId: 'alterguardianhat', count: 1 });
  });

  it.each(['c_spawn（"icebox")'])(
    'spawns once using %s', async (command) => {
      const spawn = vi.fn(() => true);
      expect(await executeDebugCommand(command, createInventory(), spawn)).toEqual({
        ok: true, message: '已生成 icebox',
      });
      expect(spawn).toHaveBeenCalledExactlyOnceWith('icebox');
    },
  );

  it.each([' c_save （ ） ; '])('saves once using %s', async (command) => {
    const save = vi.fn();
    expect((await executeDebugCommand(command, createInventory(), undefined, save)).ok).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('reports a full inventory without adding or automatically equipping the crown', async () => {
    const inventory = createInventory();
    inventory.add('strawhat', 1);
    expect(await executeDebugCommand('c_give("alterguardianhat"）', inventory)).toEqual({
      ok: false, message: '物品栏空间不足',
    });
    expect(inventory.get(inventorySlotAddress(0))?.itemId).toBe('strawhat');
    expect(inventory.get(equipmentSlotAddress('head'))).toBeNull();
  });

  it.each(['c_give("alterguardianhat"); c_save(;', 'c_give（"alterguardianhat"，0）'])('rejects malformed input without mutating state: %s', async (command) => {
    const inventory = createInventory();
    const before = inventory.exportState();
    const spawn = vi.fn();
    const save = vi.fn();
    expect((await executeDebugCommand(command, inventory, spawn, save)).ok).toBe(false);
    expect(inventory.exportState()).toEqual(before);
    expect(spawn).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});

describe('debug command sequences', () => {
  it('gives a phonograph and record from one submission, then saves and reloads their inventory entities', async () => {
    const inventory = createPickupInventory();
    const restored = createPickupInventory();
    try {
      expect(await executeDebugCommand('c_give("phonograph");c_give("record");', inventory)).toEqual({
        ok: true, message: '已添加 1 个 phonograph\n已添加 1 个 record',
      });
      expect(inventory.get(inventorySlotAddress(0))).toMatchObject({ itemId: 'phonograph', count: 1 });
      expect(inventory.get(inventorySlotAddress(1))).toMatchObject({ itemId: 'record', count: 1 });
      expect(inventory.getEntity(inventorySlotAddress(1))!.hasTag('phonograph_record')).toBe(true);
      const before = inventory.exportState();
      let json = '';
      const save = vi.fn(() => {
        json = serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG), {
          entities: {}, inventory: before, elapsedSeconds: 12.5,
          playerTransform: { position: [3, 0, -6], rotationY: 0 },
        }, SAVE_CATALOG);
      });
      expect((await executeDebugCommand('c_save()', inventory, undefined, save)).ok).toBe(true);
      expect(save).toHaveBeenCalledTimes(1);
      const saved = deserializeSave(json, SAVE_CATALOG);
      restored.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
      expect(restored.exportState()).toEqual(before);
      expect(restored.getEntity(inventorySlotAddress(1))!.hasTag('phonograph_record')).toBe(true);
    } finally { inventory.dispose(); restored.dispose(); }
  });

  it('awaits asynchronous spawning before giving items and saving in a mixed sequence', async () => {
    const inventory = createInventory();
    let finishSpawn!: (ok: boolean) => void;
    const spawn = vi.fn(() => new Promise<boolean>((resolve) => { finishSpawn = resolve; }));
    const save = vi.fn(async () => {
      expect(inventory.get(inventorySlotAddress(0))?.itemId).toBe('alterguardianhat');
    });
    const result = executeDebugCommand('c_spawn("icebox");c_give("alterguardianhat");c_save()', inventory, spawn, save);
    expect(spawn).toHaveBeenCalledExactlyOnceWith('icebox');
    expect(inventory.get(inventorySlotAddress(0))).toBeNull();
    expect(save).not.toHaveBeenCalled();
    finishSpawn(true);
    expect(await result).toEqual({
      ok: true, message: '已生成 icebox\n已添加 1 个 alterguardianhat\n已下载存档 initial-world.json',
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('preserves successful commands and stops on failure, keeping semicolons inside quoted arguments', async () => {
    const inventory = createInventory();
    const save = vi.fn();
    expect(await executeDebugCommand('c_give("alterguardianhat");c_give("unknown;item");c_save()', inventory, undefined, save))
      .toEqual({ ok: false, message: '已添加 1 个 alterguardianhat\n未知物品：unknown;item' });
    expect(inventory.get(inventorySlotAddress(0))?.itemId).toBe('alterguardianhat');
    expect(save).not.toHaveBeenCalled();
  });
});
