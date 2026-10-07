import { describe, expect, it } from 'vitest';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import definitions from '../../prefab/src/definitions.json' with { type: 'json' };
import { INVENTORY_ITEM_DISPLAY_SPECS } from '../../ui/src/inventory-items';
import { INVENTORY_RECIPES, INVENTORY_RECIPE_SKINS, INVENTORY_SKIN_SPECS } from '../../ui/src/categories/shared';
import { inventoryItemEquipmentKind, inventoryItemMaxStack } from '../../inventory/src';
import { deserializeSave, type SaveCatalog } from '../../../src/save/deserialize';
import { TUNING } from '../../../src/tuning';

const catalog: SaveCatalog = {
  items: Object.fromEntries(Object.entries(INVENTORY_ITEM_DISPLAY_SPECS).map(([id, spec]) => [id, {
    ...spec, maxStack: inventoryItemMaxStack(id), equippable: inventoryItemEquipmentKind(id),
    ...(id === 'farm_plow_item' ? { maxUses: 4 } : {}),
    ...(id === 'torch' ? { maxFuel: TUNING.TORCH_FUEL } : {}),
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
  it('restores fractional torch fuel in inventory and skinned ground items and accepts old full-fuel saves', () => {
    const data = structuredClone(initialWorld) as any;
    data.players.local.inventory.containers['player:equipment'].slots = [];
    data.players.local.inventory.containers['player:inventory'].slots = [{ slotKey: '0',
      item: { itemId: 'torch', count: 1, remainingFuel: 0.125 } }];
    data.world.entities.ground_item = [{ id: 'torch:test', transform: { position: [12, 0, 12], rotationY: 0 },
      components: { stack: { itemId: 'torch', count: 1, skinId: 'torch_barber', remainingFuel: 37.875 } } }];
    const restored = parse(data);
    expect(restored.world.entities.ground_item).toEqual(data.world.entities.ground_item);
    expect(restored.players.local.inventory.containers['player:inventory'].slots).toEqual(data.players.local.inventory.containers['player:inventory'].slots);
    const item = data.world.entities.ground_item[0].components.stack;
    for (const fuel of [0, -1, 76]) {
      item.remainingFuel = fuel;
      expect(() => parse(data)).toThrow('remainingFuel');
    }
    delete item.remainingFuel;
    expect(parse(data).world.entities.ground_item).toEqual(data.world.entities.ground_item);
    item.itemId = 'twigs'; delete item.skinId; item.remainingFuel = 10;
    expect(() => parse(data)).toThrow('remainingFuel');
  });

  it('round-trips farmland, active plows, soil and finite-use inventory items', () => {
    const data = structuredClone(initialWorld) as any;
    data.players.local.inventory.containers['player:equipment'].slots = [];
    data.world.map.tiles = [{ col: 0, row: 0, tileId: 47, underTileId: 30 }];
    data.world.entities.farm_plow = [{ id: 'test_plow', transform: { position: [6, 0, 6], rotationY: 0 },
      components: { farmPlow: { phase: 'drill_loop', remainingSeconds: 7, returnUses: 3 } } }];
    data.world.entities.farm_soil = [{ id: 'test_soil', transform: { position: [3, 0, 3], rotationY: 0 },
      components: { farmSoil: { broken: false, plowId: 'test_plow' } } }];
    data.world.entities.ground_item = [{ id: 'test_item', transform: { position: [12, 0, 12], rotationY: 0 },
      components: { stack: { itemId: 'farm_plow_item', count: 1, remainingUses: 2 } } }];
    const saved = parse(data);
    expect(saved.world.map.tiles).toEqual(data.world.map.tiles);
    expect(saved.world.entities.farm_plow).toEqual(data.world.entities.farm_plow);
    expect(saved.world.entities.farm_soil).toEqual(data.world.entities.farm_soil);
    expect(saved.world.entities.ground_item).toEqual(data.world.entities.ground_item);
    data.world.entities.ground_item[0].components.stack.remainingUses = 0;
    expect(() => parse(data)).toThrow('remainingUses');
    data.world.entities.ground_item[0].components.stack.remainingUses = 5;
    expect(() => parse(data)).toThrow('remainingUses');
  });

  it('restores valid wall skins and health, accepts legacy walls and rejects other-prefab skins', () => {
    const data = structuredClone(initialWorld) as any;
    data.players.local.inventory.containers['player:equipment'].slots = [];
    data.world.entities.wall_stone = [{ id: 'wall:stone', transform: { position: [4, 0, -6], rotationY: 0 },
      components: { health: { current: 90, maximum: 400 }, wall: { skinId: 'wall_stone_gothic' } } }];
    expect(parse(data).world.entities.wall_stone).toEqual(data.world.entities.wall_stone);
    data.world.entities.wall_stone[0].components.wall.skinId = 'wall_hay_corn';
    expect(() => parse(data)).toThrow('unsupported wall skin');
    data.world.entities.wall_stone[0].components.wall.skinId = 'wall_stone_anitem';
    expect(() => parse(data)).toThrow('unsupported wall skin');
    delete data.world.entities.wall_stone[0].components.wall;
    expect(parse(data).world.entities.wall_stone).toEqual(data.world.entities.wall_stone);
  });

  it('accepts visual-only wormholes with their saved identity and position', () => {
    const data = structuredClone(initialWorld) as any;
    // This reduced catalog omits the application's imported hat definitions.
    data.players.local.inventory.containers['player:equipment'].slots = [];
    data.world.entities.wormhole = [{
      id: 'wormhole:test', transform: { position: [4, 0, -6], rotationY: 0 }, components: {},
    }];
    expect(parse(data).world.entities.wormhole).toEqual(data.world.entities.wormhole);
    data.world.entities.wormhole[0].components.wormhole = { skinId: 'wormhole_spider' };
    expect(parse(data).world.entities.wormhole).toEqual(data.world.entities.wormhole);
    data.world.entities.wormhole[0].components.wormhole.skinId = 'missing';
    expect(() => parse(data)).toThrow('skinId');
    delete data.world.entities.wormhole[0].components.wormhole;
    data.world.entities.wormhole[0].components.teleporter = {};
    expect(() => parse(data)).toThrow('unsupported field');
  });

  it.each([
    ['unknown version', (data: any) => { data.schemaVersion = 2; }, 'schemaVersion'],
    ['duplicate ID across prefabs', (data: any) => { data.world.entities.pigking[0].id = data.world.entities.moon_tree[0].id; }, 'duplicate entity ID'],
    ['unknown prefab', (data: any) => { data.world.entities.unknown = []; }, 'unsupported field'],
    ['out-of-bounds position', (data: any) => { data.world.entities.moon_tree[0].transform.position[0] = 501; }, 'position[0]'],
    ['invalid stack count', (data: any) => { data.players.local.inventory.containers['player:inventory'].slots[0].item.count = 41; }, 'count'],
    ['wrong item skin', (data: any) => { data.players.local.inventory.containers['player:inventory'].slots[0].item.skinId = 'treasurechest_ancient'; }, 'invalid skin'],
    ['wrong player shard', (data: any) => { data.players.local.shardId = 'caves'; }, 'this shard'],
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

});
