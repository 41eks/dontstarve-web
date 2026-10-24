import { describe, expect, it } from 'vitest';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import definitions from '../../prefab/src/definitions.json' with { type: 'json' };
import { INVENTORY_ITEM_DISPLAY_SPECS } from '../../ui/src/inventory-items';
import { INVENTORY_RECIPES, INVENTORY_RECIPE_SKINS, INVENTORY_SKIN_SPECS } from '../../ui/src/categories/shared';
import { inventoryItemEquipmentKind, inventoryItemMaxStack } from '../../inventory/src';
import { deserializeSave, type SaveCatalog } from '../../../src/save/deserialize';
import { TORCH_FUEL } from '../../prefab/src/torch';
import { serializeSave } from '../../../src/save/serialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { TurfMap } from '../../prefab/src/turfMap';

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
  it('loads and exports more than 10000 entities in one prefab group while validating the last record', () => {
    const data = structuredClone(initialWorld);
    data.world.entities.ground_item = Array.from({ length: 10_001 }, (_, i) => ({
      id: `large-save-fireflies-${i}`,
      transform: { position: [i % 100 - 50, 0, Math.floor(i / 100) - 50], rotationY: 0 },
      components: { stack: { itemId: 'fireflies', count: 1 } },
    }));
    data.world.map.generator.options.moonTreeCount = 10_001;
    const template = deserializeSave(JSON.stringify(data), SAVE_CATALOG);
    const restored = deserializeSave(serializeSave(template, {
      entities: template.world.entities, playerTransform: template.players.local.transform,
      inventory: inventoryStateFromSave(template), elapsedSeconds: template.world.elapsedSeconds,
    }, SAVE_CATALOG), SAVE_CATALOG);
    expect(restored.world.entities).toEqual(template.world.entities);
    expect(restored.world.map.generator.options.moonTreeCount).toBe(10_001);
    data.world.entities.ground_item[10_000].id = data.world.entities.ground_item[0].id;
    expect(() => deserializeSave(JSON.stringify(data), SAVE_CATALOG)).toThrow('duplicate entity ID');
  });

  it('exports and reloads the initial island terrain with retained entity identity and state', () => {
    const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
    const map = new TurfMap(template.world.map.generator.options.size, template.world.map.tiles);
    const state = { entities: template.world.entities, tiles: map.exportTiles(),
      playerTransform: template.players.local.transform, inventory: inventoryStateFromSave(template),
      elapsedSeconds: template.world.elapsedSeconds };
    const restored = deserializeSave(serializeSave(template, state, SAVE_CATALOG), SAVE_CATALOG);
    expect(restored.world.map.tiles).toEqual(template.world.map.tiles);
    expect(restored.world.entities).toEqual(template.world.entities);
    expect(restored.players.local).toEqual(template.players.local);
  });
  it('exports and reloads beefalo named locations, an imminent zero-second spawn and legacy saves', () => {
    const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
    const beefalo = {
      id: 'beefalo-save-regression', transform: { position: [12, 0, 24] as [number, number, number], rotationY: 0 },
      components: { beefalo: {
        home: [12, 0, 24] as [number, number, number], heading: 45, poopRemainingSeconds: 0,
        beard: { growth: 1, growthaccumulator: 0, bits: 0 },
        knownlocations: { locations: [{ name: 'herd', x: 30, y: 0, z: 40 }] },
      } },
    };
    const json = serializeSave(template, {
      entities: { ...template.world.entities, beefalo: [beefalo] },
      playerTransform: template.players.local.transform,
      inventory: inventoryStateFromSave(template), elapsedSeconds: template.world.elapsedSeconds,
    }, SAVE_CATALOG);
    const restored = deserializeSave(json, SAVE_CATALOG);
    expect(restored.world.entities.beefalo).toEqual([beefalo]);
    beefalo.components.beefalo!.knownlocations.locations = [];
    expect(deserializeSave(JSON.stringify(restored), SAVE_CATALOG).world.entities.beefalo[0].components.beefalo!.knownlocations)
      .toEqual({ locations: [{ name: 'herd', x: 30, y: 0, z: 40 }] });
    delete restored.world.entities.beefalo[0].components.beefalo!.knownlocations;
    restored.world.entities.beefalo[0].components.beefalo!.poopRemainingSeconds = 99;
    expect(deserializeSave(JSON.stringify(restored), SAVE_CATALOG).world.entities.beefalo[0].components.beefalo!.poopRemainingSeconds).toBe(99);
  });

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
