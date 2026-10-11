import { describe, expect, it, vi } from 'vitest';
import type { InventoryStore } from '../../inventory/src';
import { executeDebugCommand } from '../../../src/debugCommands';

describe('c_save command', () => {
  const inventory = {} as InventoryStore;

  it('rejects arguments and reports capture/download errors without claiming success', async () => {
    const save = vi.fn(() => { throw new Error('invalid state'); });
    expect((await executeDebugCommand('c_save("path")', inventory, undefined, save)).ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(await executeDebugCommand('c_save()', inventory, undefined, save)).toEqual({ ok: false, message: '保存失败：invalid state' });
    expect((await executeDebugCommand('c_save()', inventory)).ok).toBe(false);
  });
});
