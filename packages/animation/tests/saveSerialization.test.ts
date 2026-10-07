import { describe, expect, it, vi } from 'vitest';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import definitions from '../../prefab/src/definitions.json' with { type: 'json' };
import { INVENTORY_ITEM_DISPLAY_SPECS } from '../../ui/src/inventory-items';
import { HAT_ITEM_SPECS } from '../../prefab/src/hats';
import { inventoryItemEquipmentKind, inventoryItemMaxStack } from '../../inventory/src';
import { INVENTORY_RECIPES, INVENTORY_RECIPE_SKINS, INVENTORY_SKIN_SPECS } from '../../ui/src/categories/shared';
import { deserializeSave, type SaveCatalog } from '../../../src/save/deserialize';
import { chestContainerId, cookPotContainerId, inventoryStateFromSave } from '../../../src/save/inventoryState';
import { serializeSave, type RuntimeSaveState } from '../../../src/save/serialize';
import { executeDebugCommand } from '../../../src/debugCommands';
import type { InventoryStore } from '../../../src/inventory';
import { WORLD_TILES } from '../../prefab/src/turfMap';
import { PORTAL_ID } from '../../prefab/src/portal';

const catalog: SaveCatalog = {
  items: { ...Object.fromEntries(Object.entries(INVENTORY_ITEM_DISPLAY_SPECS).map(([id, spec]) => [id, {
    ...spec, maxStack: inventoryItemMaxStack(id), equippable: inventoryItemEquipmentKind(id),
  }])), ...HAT_ITEM_SPECS },
  skins: INVENTORY_SKIN_SPECS, recipes: INVENTORY_RECIPES, recipeSkins: INVENTORY_RECIPE_SKINS,
  buildings: definitions.animatedBuildings, walls: Object.keys(definitions.walls),
};

function fixture() {
  const template = deserializeSave(JSON.stringify(initialWorld), catalog);
  template.snapshot.id = '0000000001';
  template.snapshot.parentId = null;
  // Tests add their own equipment; local gameplay saves may already equip an item.
  template.players.local.inventory.containers['player:equipment'].slots = [];
  for (const chest of template.world.entities.treasurechest ?? []) {
    chest.components.container = { slotCount: 9, slots: [] };
  }
  const inventory = inventoryStateFromSave(template);
  const state = {
    entities: structuredClone(template.world.entities),
    playerTransform: { position: [30, 0, 42], rotationY: 0 },
    inventory: { ...inventory, slots: [...inventory.slots] }, elapsedSeconds: 123.5,
  } satisfies RuntimeSaveState;
  return { template, state };
}

describe('manual JSON save', () => {
  it('round trips empty portal groups and spawned portals without accepting unsupported prefabs or components', () => {
    const { template, state } = fixture();
    // EntityRegistry exports every registered group, even before any spawn.
    state.entities[PORTAL_ID] = [];
    expect(deserializeSave(serializeSave(template, state, catalog), catalog).world.entities[PORTAL_ID]).toEqual([]);
    state.entities[PORTAL_ID].push({ id: 'portal:test', transform: { position: [24, 0, -36], rotationY: 0 }, components: {} });
    const before = structuredClone(state);
    const saved = deserializeSave(serializeSave(template, state, catalog), catalog);
    expect(saved.world.entities[PORTAL_ID]).toEqual(state.entities[PORTAL_ID]);
    expect(state).toEqual(before);
    saved.world.entities[PORTAL_ID][0].components.building = { state: 'idle' };
    expect(() => deserializeSave(JSON.stringify(saved), catalog)).toThrow('unsupported field');
    state.entities.unregistered_prefab = [];
    expect(() => serializeSave(template, state, catalog)).toThrow('world.entities.unregistered_prefab');
  });

  it('saves current sanity rather than the loaded value, preserving it through reload', () => {
    const { template, state } = fixture();
    template.players.local.stats = { health: 150, hunger: 105, sanity: 200 };
    const playerStats = { health: 150, hunger: 105, sanity: 35 };
    const saved = deserializeSave(serializeSave(template, { ...state, playerStats }, catalog), catalog);
    expect(saved.players.local.stats).toEqual(playerStats);
    expect(template.players.local.stats.sanity).toBe(200);
    const resaved = deserializeSave(serializeSave(saved, state, catalog), catalog);
    expect(resaved.players.local.stats).toEqual(playerStats);
  });
  it('round trips equipped backpack contents, including the eighth slot', () => {
    const { template, state } = fixture();
    state.inventory.slots.push(
      { address: { containerId: 'player:equipment', slotKey: 'body' }, item: { itemId: 'backpack', count: 1 } },
      { address: { containerId: 'player:backpack', slotKey: '7' }, item: { itemId: 'cutgrass', count: 3 } },
    );
    const saved = deserializeSave(serializeSave(template, state, catalog), catalog);
    expect(saved.players.local.inventory.containers['player:backpack']).toEqual({
      slotCount: 8, slots: [{ slotKey: '7', item: { itemId: 'cutgrass', count: 3 } }],
    });
    expect(inventoryStateFromSave(saved).slots).toContainEqual(state.inventory.slots.at(-1));
    saved.players.local.inventory.containers['player:backpack'].slots[0].slotKey = '8';
    expect(() => deserializeSave(JSON.stringify(saved), catalog)).toThrow('invalid or duplicate slot');
  });
  it('round trips dug terrain and rejects duplicate, invalid and out-of-bounds tiles', () => {
    const { template, state } = fixture();
    const tiles = [{ col: -1, row: 2, tileId: WORLD_TILES.DIRT }];
    const saved = deserializeSave(serializeSave(template, { ...state, tiles }, catalog), catalog);
    expect(saved.world.map.tiles).toEqual(tiles);
    const resaved = deserializeSave(serializeSave(saved, state, catalog), catalog);
    expect(resaved.world.map.tiles).toEqual(tiles);
    for (const tiles of [
      [{ col: 0, row: 0, tileId: WORLD_TILES.DECIDUOUS }],
      [{ col: 0.5, row: 0, tileId: WORLD_TILES.DIRT }],
      [{ col: 100, row: 0, tileId: WORLD_TILES.DIRT }],
      [{ col: -100, row: 0, tileId: WORLD_TILES.DIRT }],
      [saved.world.map.tiles![0], saved.world.map.tiles![0]],
    ]) {
      const bad = structuredClone(saved);
      Object.assign(bad.world.map, { tiles });
      expect(() => deserializeSave(JSON.stringify(bad), catalog)).toThrow();
    }
  });
  it('round trips beefalo positions, home, facing and manure timers and rejects invalid AI data', () => {
    const { template, state } = fixture();
    state.entities.beefalo = [{ id: 'e_beefalo', transform: { position: [10, 0, 2], rotationY: 0 },
      components: { beefalo: { home: [3, 0, 4], heading: 135, poopRemainingSeconds: 12.5 } } }];
    const saved = deserializeSave(serializeSave(template, state, catalog), catalog);
    expect(saved.world.entities.beefalo).toEqual(state.entities.beefalo);
    for (const patch of [{ home: [0, 1, 0] }, { home: [501, 0, 0] }, { heading: -1 },
      { heading: 361 }, { poopRemainingSeconds: 0 }, { poopRemainingSeconds: 61 }]) {
      const bad = structuredClone(saved);
      Object.assign(bad.world.entities.beefalo[0].components.beefalo!, patch);
      expect(() => deserializeSave(JSON.stringify(bad), catalog)).toThrow();
    }
  });
  it('preserves bulb plant harvesting timers and rejects inconsistent harvested states', () => {
    const { template, state } = fixture();
    state.entities.flower_cave = [{ id: 'e_picked', transform: { position: [1, 0, 2], rotationY: 0 },
      components: { bulbPlant: { variant: 'single', lightState: 'RECHARGING', picked: true, regrowSeconds: 123.5 } } }];
    const saved = deserializeSave(serializeSave(template, state, catalog), catalog);
    expect(saved.world.entities.flower_cave).toEqual(state.entities.flower_cave);
    for (const patch of [
      { picked: 'yes' }, { picked: false }, { lightState: 'ON' }, { remainingSeconds: 1 },
      { regrowSeconds: 0 }, { regrowSeconds: -1 }, { regrowSeconds: 1441 }, { regrowSeconds: undefined },
    ]) {
      const bad = structuredClone(saved);
      Object.assign(bad.world.entities.flower_cave[0].components.bulbPlant!, patch);
      expect(() => deserializeSave(JSON.stringify(bad), catalog)).toThrow();
    }
  });
  it.each([['staffcoldlight', 960]] as const)('round trips %s lifetimes and rejects invalid timers', (prefab, duration) => {
    const { template, state } = fixture();
    state.entities[prefab] = [{
      id: 'e_star', transform: { position: [20, 0, 30], rotationY: 0 },
      components: { timer: { remainingSeconds: 120.5 } },
    }];
    const saved = deserializeSave(serializeSave(template, state, catalog), catalog);
    expect(saved.world.entities[prefab]).toEqual(state.entities[prefab]);
    for (const remainingSeconds of [0, -1, duration + 1]) {
      saved.world.entities[prefab][0].components.timer!.remainingSeconds = remainingSeconds;
      expect(() => deserializeSave(JSON.stringify(saved), catalog)).toThrow('remainingSeconds');
    }
    delete saved.world.entities[prefab][0].components.timer;
    expect(() => deserializeSave(JSON.stringify(saved), catalog)).toThrow('timer');
  });

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

  it('rejects arguments and reports capture/download errors without claiming success', async () => {
    const save = vi.fn(() => { throw new Error('invalid state'); });
    expect((await executeDebugCommand('c_save("path")', inventory, undefined, save)).ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(await executeDebugCommand('c_save()', inventory, undefined, save)).toEqual({ ok: false, message: '保存失败：invalid state' });
    expect((await executeDebugCommand('c_save()', inventory)).ok).toBe(false);
  });
});
