import { describe, expect, it, vi } from 'vitest';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import definitions from '../../prefab/src/definitions.json' with { type: 'json' };
import { INVENTORY_ITEM_DISPLAY_SPECS } from '../../ui/src/inventory-items';
import { INVENTORY_RECIPES, INVENTORY_RECIPE_SKINS, INVENTORY_SKIN_SPECS } from '../../ui/src/categories/shared';
import { inventoryItemEquipmentKind, inventoryItemMaxStack } from '../../inventory/src';
import { deserializeSave, type SaveCatalog } from '../../../src/save/deserialize';
import { chestContainerId, cookPotContainerId, inventoryStateFromSave } from '../../../src/save/inventoryState';
import { serializeSave, type RuntimeSaveState } from '../../../src/save/serialize';
import { executeDebugCommand } from '../../../src/debugCommands';
import type { InventoryStore } from '../../../src/inventory';

const catalog: SaveCatalog = {
  items: Object.fromEntries(Object.entries(INVENTORY_ITEM_DISPLAY_SPECS).map(([id, spec]) => [id, {
    ...spec, maxStack: inventoryItemMaxStack(id), equippable: inventoryItemEquipmentKind(id),
  }])),
  skins: INVENTORY_SKIN_SPECS, recipes: INVENTORY_RECIPES, recipeSkins: INVENTORY_RECIPE_SKINS,
  buildings: definitions.animatedBuildings, walls: Object.keys(definitions.walls),
};

function fixture() {
  const template = deserializeSave(JSON.stringify(initialWorld), catalog);
  template.snapshot.id = '0000000001';
  template.snapshot.parentId = null;
  for (const chest of template.world.entities.treasurechest ?? []) {
    chest.components.container = { slotCount: 9, slots: [] };
  }
  const state: RuntimeSaveState = {
    entities: structuredClone(template.world.entities),
    playerTransform: { position: [30, 0, 42], rotationY: 0 },
    inventory: inventoryStateFromSave(template), elapsedSeconds: 123.5,
  };
  return { template, state };
}

describe('manual JSON save', () => {
  it('round trips cook pot slots and rejects stacked ingredients while reading old idle saves', () => {
    const { template, state } = fixture();
    state.entities.cookpot = [{
      id: 'e_pot', transform: { position: [10, 0, 10], rotationY: 0 },
      components: { building: { state: 'open' } },
    }];
    state.inventory.slots.push({
      address: { containerId: cookPotContainerId('e_pot'), slotKey: '3' },
      item: { itemId: 'berries', count: 1 },
    });
    const saved = deserializeSave(serializeSave(template, state, catalog), catalog);
    expect(saved.world.entities.cookpot[0].components).toEqual({
      building: { state: 'open' },
      container: { slotCount: 4, slots: [{ slotKey: '3', item: { itemId: 'berries', count: 1 } }] },
    });
    expect(inventoryStateFromSave(saved).slots).toContainEqual(state.inventory.slots.at(-1));
    saved.world.entities.cookpot[0].components.container!.slots[0].item.count = 2;
    expect(() => deserializeSave(JSON.stringify(saved), catalog)).toThrow('expected at most 1');
    state.inventory.slots.at(-1)!.item!.count = 2;
    expect(() => serializeSave(template, state, catalog)).toThrow('expected at most 1');
    state.inventory.slots.at(-1)!.item!.count = 1;
    state.entities.cookpot[0].components.building!.state = 'idle';
    expect(deserializeSave(serializeSave(template, state, catalog), catalog)
      .world.entities.cookpot[0].components.building?.state).toBe('closed');
  });

  it('saves all chests closed while preserving skins, contents and live interaction states', () => {
    const { template, state } = fixture();
    state.entities.treasurechest[0].components.building = { state: 'open', skinId: 'treasurechest_ancient' };
    state.entities.treasurechest.push({
      id: 'e_new_chest', transform: { position: [40, 0, 40], rotationY: 0 },
      components: { building: { state: 'open' } },
    });
    state.entities.ground_item = [{
      id: 'e_dropped_log', transform: { position: [30, 0, 42], rotationY: 0 },
      components: { stack: { itemId: 'log', count: 1 } },
    }];
    state.inventory.slots[0].item = { itemId: 'cutgrass', count: 12 };
    state.inventory.slots.push(
      { address: { containerId: 'player:equipment', slotKey: 'hand' }, item: { itemId: 'torch', count: 1 } },
      { address: { containerId: chestContainerId('e_treasurechest_000001'), slotKey: '8' }, item: { itemId: 'log', count: 3 } },
    );
    state.inventory.bufferedBuilds = [{ recipeId: 'treasurechest', skinId: 'treasurechest_ancient' }];
    const beforeTemplate = structuredClone(template);
    const beforeState = structuredClone(state);
    const saved = deserializeSave(serializeSave(template, state, catalog, template.snapshot.id,
      '2026-09-30T14:00:00.000Z'), catalog);
    expect(saved.snapshot).toEqual({ id: '0000000002', parentId: '0000000001', reason: 'manual', savedAt: '2026-09-30T14:00:00.000Z' });
    expect(saved.world.elapsedSeconds).toBe(123.5);
    expect(saved.players.local.transform.position).toEqual([30, 0, 42]);
    expect(saved.world.entities.moon_tree).toHaveLength(500);
    expect(saved.world.entities.ground_item).toEqual(state.entities.ground_item);
    expect(saved.world.entities.treasurechest[0].components).toEqual({
      building: { state: 'closed', skinId: 'treasurechest_ancient' },
      container: { slotCount: 9, slots: [{ slotKey: '8', item: { itemId: 'log', count: 3 } }] },
    });
    expect(saved.world.entities.treasurechest[1].components.container).toEqual({ slotCount: 9, slots: [] });
    expect(saved.world.entities.treasurechest.every((chest) => chest.components.building?.state === 'closed')).toBe(true);
    const inventory = inventoryStateFromSave(saved);
    expect(inventory.slots).toEqual(state.inventory.slots);
    expect(inventory.bufferedBuilds).toEqual(state.inventory.bufferedBuilds);
    expect(template).toEqual(beforeTemplate);
    expect(state).toEqual(beforeState);
  });

  it('uses current collections without reviving deleted entities or picked-up items', () => {
    const { template, state } = fixture();
    state.entities.moon_tree = state.entities.moon_tree.slice(1);
    state.entities.pigking = [];
    state.entities.ground_item = [];
    const saved = deserializeSave(serializeSave(template, state, catalog, '0000000002'), catalog);
    expect(saved.snapshot.id).toBe('0000000003');
    expect(saved.snapshot.parentId).toBe('0000000002');
    expect(saved.world.entities.moon_tree).toHaveLength(499);
    expect(saved.world.entities.pigking).toEqual([]);
    expect(saved.world.entities.ground_item).toEqual([]);
  });

  it('fails before downloading an invalid state or losing orphaned storage', () => {
    const { template, state } = fixture();
    state.inventory.slots[0].item!.count = 999;
    expect(() => serializeSave(template, state, catalog)).toThrow('count');
    state.inventory.slots[0].item!.count = 1;
    state.inventory.slots.push({ address: { containerId: 'unknown', slotKey: '0' }, item: { itemId: 'log', count: 1 } });
    expect(() => serializeSave(template, state, catalog)).toThrow('未关联实体');
    expect(() => serializeSave(template, state, catalog, '9999999999')).toThrow('编号已用尽');
  });
});

describe('c_save command', () => {
  const inventory = {} as InventoryStore;
  it.each(['c_save()', ' c_save ( ) ; '])('downloads once for %s', async (command) => {
    const save = vi.fn();
    const spawn = vi.fn();
    expect(await executeDebugCommand(command, inventory, spawn, save)).toEqual({ ok: true, message: '已下载存档 initial-world.json' });
    expect(save).toHaveBeenCalledTimes(1);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('rejects arguments and reports capture/download errors without claiming success', async () => {
    const save = vi.fn(() => { throw new Error('invalid state'); });
    expect((await executeDebugCommand('c_save("path")', inventory, undefined, save)).ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(await executeDebugCommand('c_save()', inventory, undefined, save)).toEqual({ ok: false, message: '保存失败：invalid state' });
    expect((await executeDebugCommand('c_save()', inventory)).ok).toBe(false);
  });
});
