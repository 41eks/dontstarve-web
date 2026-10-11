import { describe, expect, it } from 'vitest';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import definitions from '../../prefab/src/definitions.json' with { type: 'json' };
import { INVENTORY_ITEM_DISPLAY_SPECS } from '../../ui/src/inventory-items';
import { INVENTORY_RECIPES, INVENTORY_RECIPE_SKINS, INVENTORY_SKIN_SPECS } from '../../ui/src/categories/shared';
import { inventoryItemEquipmentKind, inventoryItemMaxStack } from '../../inventory/src';
import { deserializeSave, type SaveCatalog } from '../../../src/save/deserialize';
import { TORCH_FUEL } from '../../prefab/src/torch';

const catalog: SaveCatalog = {
  items: Object.fromEntries(Object.entries(INVENTORY_ITEM_DISPLAY_SPECS).map(([id, spec]) => [id, {
    ...spec, maxStack: inventoryItemMaxStack(id), equippable: inventoryItemEquipmentKind(id),
    ...(id === 'farm_plow_item' ? { maxUses: 4 } : {}),
    ...(id === 'torch' ? { maxFuel: TORCH_FUEL } : {}),
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
  it.each([
    ['unknown version', (data: any) => { data.schemaVersion = 2; }, 'schemaVersion'],
    ['duplicate ID across prefabs', (data: any) => { data.world.entities.pigking[0].id = data.world.entities.moon_tree[0].id; }, 'duplicate entity ID'],
    ['unknown prefab', (data: any) => { data.world.entities.unknown = []; }, 'unsupported field'],
    ['out-of-bounds position', (data: any) => { data.world.entities.moon_tree[0].transform.position[0] = 501; }, 'position[0]'],
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
