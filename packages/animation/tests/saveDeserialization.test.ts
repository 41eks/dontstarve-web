import { describe, expect, it } from 'vitest';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import definitions from '../../prefab/src/definitions.json' with { type: 'json' };
import { INVENTORY_ITEM_DISPLAY_SPECS } from '../../ui/src/inventory-items';
import { INVENTORY_RECIPES, INVENTORY_RECIPE_SKINS, INVENTORY_SKIN_SPECS } from '../../ui/src/categories/shared';
import { inventoryItemEquipmentKind, inventoryItemMaxStack } from '../../inventory/src';
import { deserializeSave, type SaveCatalog } from '../../../src/save/deserialize';
import { chestContainerId, inventoryStateFromSave } from '../../../src/save/inventoryState';

const catalog: SaveCatalog = {
  items: Object.fromEntries(Object.entries(INVENTORY_ITEM_DISPLAY_SPECS).map(([id, spec]) => [id, {
    ...spec, maxStack: inventoryItemMaxStack(id), equippable: inventoryItemEquipmentKind(id),
  }])),
  skins: INVENTORY_SKIN_SPECS,
  recipes: INVENTORY_RECIPES,
  recipeSkins: INVENTORY_RECIPE_SKINS,
  buildings: definitions.animatedBuildings,
  walls: Object.keys(definitions.walls),
};

function parse(data: unknown = initialWorld) {
  return deserializeSave(JSON.stringify(data), catalog);
}

describe('save JSON deserialization', () => {
  it('reads the checked-in initial world with all 500 persistent tree records', () => {
    const save = parse();
    const migrated = structuredClone(initialWorld);
    for (const pot of migrated.world.entities.cookpot) {
      Object.assign(pot.components, {
        building: { ...pot.components.building, state: 'closed' },
        container: { slotCount: 4, slots: [] },
      });
    }
    expect(save).toEqual(migrated);
    expect(save.world.entities.treasurechest.every((chest) => chest.components.building?.state === 'closed')).toBe(true);
    expect(save.world.entities.moon_tree).toHaveLength(500);
    expect(new Set(save.world.entities.moon_tree.map(({ id }) => id)).size).toBe(500);
    expect(save.world.entities.pigking[0].transform.position).toEqual([0, 0, 25]);
    expect(save.players.local.inventory.containers['player:inventory'].slots).toHaveLength(7);
  });

  it.each([
    ['unknown version', (data: any) => { data.schemaVersion = 2; }, 'schemaVersion'],
    ['wrong format', (data: any) => { data.format = 'other'; }, 'format'],
    ['duplicate ID across prefabs', (data: any) => { data.world.entities.pigking[0].id = data.world.entities.moon_tree[0].id; }, 'duplicate entity ID'],
    ['unknown prefab', (data: any) => { data.world.entities.unknown = []; }, 'unsupported field'],
    ['unknown component', (data: any) => { data.world.entities.moon_tree[0].components.future = {}; }, 'unsupported field'],
    ['out-of-bounds position', (data: any) => { data.world.entities.moon_tree[0].transform.position[0] = 501; }, 'position[0]'],
    ['incomplete position', (data: any) => { data.world.entities.moon_tree[0].transform.position = [0, 0]; }, 'three coordinates'],
    ['unknown item', (data: any) => { data.players.local.inventory.containers['player:inventory'].slots[0].item.itemId = 'removed_mod_item'; }, 'unknown item'],
    ['invalid stack count', (data: any) => { data.players.local.inventory.containers['player:inventory'].slots[0].item.count = 41; }, 'count'],
    ['duplicate slot', (data: any) => { const c = data.players.local.inventory.containers['player:inventory']; c.slots[1].slotKey = c.slots[0].slotKey; }, 'duplicate slot'],
    ['wrong equipment kind', (data: any) => { data.players.local.inventory.containers['player:equipment'].slots = [{ slotKey: 'body', item: { itemId: 'torch', count: 1 } }]; }, 'cannot be equipped'],
    ['wrong item skin', (data: any) => { data.players.local.inventory.containers['player:inventory'].slots[0].item.skinId = 'treasurechest_ancient'; }, 'invalid skin'],
    ['wrong building skin', (data: any) => { data.world.entities.treasurechest[0].components.building.skinId = 'missing_skin'; }, 'unsupported building skin'],
    ['transition animation state', (data: any) => { data.world.entities.treasurechest[0].components.building.state = 'opening'; }, 'closed, open'],
    ['wrong player shard', (data: any) => { data.players.local.shardId = 'caves'; }, 'this shard'],
    ['unknown buffered recipe', (data: any) => { data.players.local.inventory.bufferedBuilds = [{ recipeId: 'removed_recipe' }]; }, 'recipe'],
    ['future parent snapshot', (data: any) => { data.snapshot.parentId = data.snapshot.id; }, 'earlier snapshot'],
  ])('rejects %s before creating runtime models', (_, mutate, message) => {
    const data = structuredClone(initialWorld);
    mutate(data);
    expect(() => parse(data)).toThrow(message);
  });

  it('rejects malformed JSON and nonfinite numbers rather than coercing them', () => {
    expect(() => deserializeSave('{', catalog)).toThrow('invalid JSON');
    const text = JSON.stringify(initialWorld).replace(/"elapsedSeconds":[^,}]+/, '"elapsedSeconds":1e999');
    expect(() => deserializeSave(text, catalog)).toThrow('nonfinite number');
  });

  it('recovers equipment, buffered builds and separate inventories for each chest', () => {
    const data = structuredClone(initialWorld);
    data.players.local.inventory.containers['player:equipment'].slots.push({ slotKey: 'hand', item: { itemId: 'torch', count: 1 } });
    data.players.local.inventory.bufferedBuilds.push({ recipeId: 'treasurechest', skinId: 'treasurechest_ancient' } as never);
    const second = structuredClone(data.world.entities.treasurechest[0]);
    second.id = 'e_chest_second';
    second.components.container.slots.push({ slotKey: '0', item: { itemId: 'log', count: 8 } } as never);
    data.world.entities.treasurechest.push(second);
    const save = parse(data);
    const state = inventoryStateFromSave(save);
    expect(state.slots).toContainEqual({ address: { containerId: 'player:equipment', slotKey: 'hand' }, item: { itemId: 'torch', count: 1 } });
    expect(state.slots).toContainEqual({ address: { containerId: chestContainerId(second.id), slotKey: '0' }, item: { itemId: 'log', count: 8 } });
    expect(state.bufferedBuilds).toEqual([{ recipeId: 'treasurechest', skinId: 'treasurechest_ancient' }]);
  });
});
