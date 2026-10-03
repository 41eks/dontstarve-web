import { describe, expect, it, vi } from 'vitest';
import { executeDebugCommand } from '../../../src/debugCommands';
import {
  HeadSlot, InventorySlot, InventoryStore, equipmentSlotAddress, inventorySlotAddress,
} from '../../inventory/src';
import { HAT_ITEM_SPECS } from '../../prefab/src/hats';

function createInventory() {
  return new InventoryStore([
    { address: inventorySlotAddress(0), slot: new InventorySlot() },
    { address: equipmentSlotAddress('head'), slot: new HeadSlot() },
  ], HAT_ITEM_SPECS);
}

describe('debug command punctuation', () => {
  it.each([
    'c_give("alterguardianhat")',
    'c_give("alterguardianhat"）',
    'c_give（"alterguardianhat")',
    " c_give （ 'alterguardianhat'， 1 ） ; ",
  ])('gives and equips the registered Enlightened Crown using %s', async (command) => {
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

  it.each(['c_spawn("icebox"）', 'c_spawn（"icebox")', "c_spawn（'icebox'）"])(
    'spawns once using %s', async (command) => {
      const spawn = vi.fn(() => true);
      expect(await executeDebugCommand(command, createInventory(), spawn)).toEqual({
        ok: true, message: '已生成 icebox',
      });
      expect(spawn).toHaveBeenCalledExactlyOnceWith('icebox');
    },
  );

  it.each(['c_save(）', 'c_save（)', ' c_save （ ） ; '])('saves once using %s', async (command) => {
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

  it.each([
    'c_give("alterguardianhat"', 'c_give("alterguardianhat"）; c_save()',
    'c_give（"alterguardianhat"，0）', 'c_give（"alterguardianhat"，1.5）', 'c_save（"path"）',
  ])('rejects malformed input without mutating state: %s', async (command) => {
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
