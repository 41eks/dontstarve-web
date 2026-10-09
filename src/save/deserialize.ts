import type {
  InventoryItemSpec, InventoryRecipeDefinition, InventorySkinSpec, InventoryStack,
} from '@dontstarve-web/inventory';
import type { SaveDocument, SavedContainer, SavedEntity, SavedTransform } from './types';
import type { BuildingContainerDefinition } from '@dontstarve-web/prefab/containers';
import { WORLD_TILES } from '@dontstarve-web/prefab/turfMap';
import { TILE_SIZE } from '@dontstarve-web/prefab/tile';
import { PREFAB_DEFINITIONS, prefabSaveParsers, type PrefabDefinition } from '../prefabDefinitions';
import { array, choice, fail, integer, number, object, snapshotId, string, timestamp } from './validation';

export interface SaveCatalog {
  /** Defaults to the application's shared definitions; custom runtimes supply their own. */
  prefabs?: readonly PrefabDefinition[];
  items: Readonly<Record<string, InventoryItemSpec>>;
  skins: Readonly<Record<string, InventorySkinSpec>>;
  recipes: Readonly<Record<string, InventoryRecipeDefinition>>;
  recipeSkins: Readonly<Record<string, readonly string[]>>;
  buildings: Readonly<Record<string, {
    archive: string;
    skinArchives?: Readonly<Record<string, string>>;
    container?: BuildingContainerDefinition;
  }>>;
  walls: readonly string[];
}

export const MAX_SAVE_BYTES = 8 * 1024 * 1024;
const MAX_ENTITIES = 10_000;

/** Parses and validates all data before any resources or runtime entities are created. */
export function deserializeSave(text: string, catalog: SaveCatalog): SaveDocument {
  if (text.length > MAX_SAVE_BYTES || new TextEncoder().encode(text).byteLength > MAX_SAVE_BYTES) {
    fail('$', 'file is too large');
  }
  let data: unknown;
  try { data = JSON.parse(text); } catch { fail('$', 'invalid JSON'); }
  let nodes = 0;
  const visit = (value: unknown, depth: number) => {
    if (++nodes > 200_000 || depth > 32) fail('$', 'data exceeds nesting or size limits');
    if (typeof value === 'number' && !Number.isFinite(value)) fail('$', 'nonfinite number');
    if (typeof value === 'string' && value.length > 256) fail('$', 'string is too long');
    if (value && typeof value === 'object') Object.values(value).forEach((child) => visit(child, depth + 1));
  };
  visit(data, 0);
  const root = object(data, '$', ['format', 'schemaVersion', 'gameVersion', 'session', 'snapshot', 'world', 'players']);
  if (root.format !== 'three-roaming-save') fail('format', 'unrecognized format');
  if (root.schemaVersion !== 1) fail('schemaVersion', 'only version 1 is supported');
  const session = object(root.session, 'session', ['id', 'createdAt']);
  const snapshot = object(root.snapshot, 'snapshot', ['id', 'parentId', 'savedAt', 'reason']);
  const id = snapshotId(snapshot.id, 'snapshot.id');
  const parentId = snapshot.parentId === null ? null : snapshotId(snapshot.parentId, 'snapshot.parentId');
  if (parentId !== null && parentId >= id) fail('snapshot.parentId', 'must refer to an earlier snapshot');
  const world = object(root.world, 'world', ['shardId', 'prefab', 'seed', 'elapsedSeconds', 'systems', 'map', 'entities']);
  const shardId = string(world.shardId, 'world.shardId');
  const map = object(world.map, 'world.map', ['kind', 'generator', 'tiles']);
  const generator = object(map.generator, 'world.map.generator', ['id', 'seed', 'options']);
  const options = object(generator.options, 'world.map.generator.options', ['size', 'moonTreeCount', 'moonTreeExclusionRadiusSquared']);
  const size = number(options.size, 'world.map.generator.options.size', 1, 10_000);
  const tileKeys = new Set<string>();
  const tiles = map.tiles === undefined ? undefined : array(map.tiles, 'world.map.tiles',
    (Math.ceil(size / TILE_SIZE) + 1) ** 2).map((value, i) => {
    const path = `world.map.tiles[${i}]`;
    const tile = object(value, path, ['col', 'row', 'tileId', 'underTileId']);
    const min = Math.floor(-size / 2 / TILE_SIZE), max = Math.ceil(size / 2 / TILE_SIZE) - 1;
    const col = integer(tile.col, `${path}.col`, min, max);
    const row = integer(tile.row, `${path}.row`, min, max);
    const tileId = choice(tile.tileId, `${path}.tileId`, [WORLD_TILES.DIRT, WORLD_TILES.FARMING_SOIL]);
    const underTileId = tile.underTileId === undefined ? undefined
      : choice(tile.underTileId, `${path}.underTileId`, [WORLD_TILES.DIRT, WORLD_TILES.DECIDUOUS]);
    if (underTileId !== undefined && tileId !== WORLD_TILES.FARMING_SOIL) fail(`${path}.underTileId`, 'only farming soil has an underlying tile');
    const key = `${col},${row}`;
    if (tileKeys.has(key)) fail(path, 'duplicate terrain tile');
    tileKeys.add(key);
    return { col, row, tileId, ...(underTileId === undefined ? {} : { underTileId }) };
  });

  const transform = (value: unknown, path: string, grounded: boolean): SavedTransform => {
    const o = object(value, path, ['position', 'rotationY']);
    const p = array(o.position, `${path}.position`, 3);
    if (p.length !== 3) fail(`${path}.position`, 'expected three coordinates');
    const position: [number, number, number] = [
      number(p[0], `${path}.position[0]`, -size / 2, size / 2),
      number(p[1], `${path}.position[1]`, 0, grounded ? 0 : 1000),
      number(p[2], `${path}.position[2]`, -size / 2, size / 2),
    ];
    // Current prefabs use camera-facing art and have no persistent world yaw.
    return { position, rotationY: number(o.rotationY, `${path}.rotationY`, 0, 0) };
  };
  const ids = new Set<string>();
  const stack = (value: unknown, path: string): InventoryStack => {
    const o = object(value, path, ['entityId', 'itemId', 'skinId', 'count', 'remainingUses', 'remainingFuel', 'phonographRecord', 'container']);
    const entityId = o.entityId === undefined ? undefined : string(o.entityId, `${path}.entityId`);
    if (entityId !== undefined) {
      if (!/^[a-zA-Z0-9_:.-]+$/.test(entityId)) fail(`${path}.entityId`, 'invalid item entity ID');
      if (!path.endsWith('.components.stack')) {
        if (ids.has(entityId)) fail(`${path}.entityId`, 'duplicate item entity ID');
        ids.add(entityId);
      }
    }
    const itemId = string(o.itemId, `${path}.itemId`);
    const spec = Object.hasOwn(catalog.items, itemId) ? catalog.items[itemId] : undefined;
    if (!spec) fail(`${path}.itemId`, `unknown item ${itemId}`);
    const skinId = o.skinId === undefined ? undefined : string(o.skinId, `${path}.skinId`);
    if (skinId !== undefined) {
      const skin = Object.hasOwn(catalog.skins, skinId) ? catalog.skins[skinId] : undefined;
      if (!skin || (skin.itemId !== undefined && skin.itemId !== itemId)) fail(`${path}.skinId`, `invalid skin for ${itemId}`);
    }
    const remainingUses = o.remainingUses === undefined ? undefined
      : integer(o.remainingUses, `${path}.remainingUses`, 1, spec.maxUses ?? 0);
    const remainingFuel = o.remainingFuel === undefined ? undefined
      : number(o.remainingFuel, `${path}.remainingFuel`, Number.MIN_VALUE, spec.maxFuel ?? 0);
    const phonographRecord = o.phonographRecord === undefined ? undefined : string(o.phonographRecord, `${path}.phonographRecord`);
    if (phonographRecord !== undefined && (itemId !== 'phonograph'
      || (phonographRecord !== 'record' && catalog.skins[phonographRecord]?.itemId !== 'record'))) {
      fail(`${path}.phonographRecord`, 'invalid loaded record');
    }
    const itemContainer = o.container === undefined ? undefined : (() => {
      if (itemId !== 'backpack') fail(`${path}.container`, 'item has no container');
      return container(o.container, `${path}.container`, numericKeys(8));
    })();
    return { ...(itemContainer === undefined ? {} : { container: itemContainer }), ...(entityId === undefined ? {} : { entityId }), itemId, count: integer(o.count, `${path}.count`, 1, spec.maxStack), ...(skinId === undefined ? {} : { skinId }),
      ...(phonographRecord === undefined ? {} : { phonographRecord }),
      ...(remainingFuel === undefined ? {} : { remainingFuel }),
      ...(remainingUses === undefined ? {} : { remainingUses }) };
  };
  const container = (value: unknown, path: string, keys: readonly string[], maxStack = Infinity): SavedContainer => {
    const o = object(value, path, ['slotCount', 'slots']);
    if (o.slotCount !== keys.length) fail(`${path}.slotCount`, `expected ${keys.length}`);
    const seen = new Set<string>();
    const slots = array(o.slots, `${path}.slots`, keys.length).map((value, i) => {
      const slotPath = `${path}.slots[${i}]`;
      const slot = object(value, slotPath, ['slotKey', 'item']);
      const slotKey = string(slot.slotKey, `${slotPath}.slotKey`);
      if (!keys.includes(slotKey) || seen.has(slotKey)) fail(`${slotPath}.slotKey`, 'invalid or duplicate slot');
      seen.add(slotKey);
      const item = stack(slot.item, `${slotPath}.item`);
      if (!keys.includes('hand') && (item.itemId === 'backpack' || catalog.items[item.itemId].canGoInContainer === false)
        && path !== 'players.local.inventory.containers.player:inventory'
        && path !== 'players.local.inventory.containers.player:cursor') fail(`${slotPath}.item`, 'item cannot go in a container');
      if (item.count > maxStack) fail(`${slotPath}.item.count`, `expected at most ${maxStack}`);
      if (keys.includes('hand') && catalog.items[item.itemId].equippable !== slotKey) {
        fail(`${slotPath}.item`, `item cannot be equipped in ${slotKey}`);
      }
      return { slotKey, item };
    });
    return { slotCount: keys.length, slots };
  };
  const numericKeys = (count: number) => Array.from({ length: count }, (_, i) => String(i));
  let entityCount = 0;
  const parsers = prefabSaveParsers(catalog.prefabs ?? Object.values(PREFAB_DEFINITIONS));
  const groups = object(world.entities, 'world.entities', [...parsers.keys()]);
  const entities = Object.fromEntries(Object.entries(groups).map(([prefab, values]) => {
    const path = `world.entities.${prefab}`;
    const records = array(values, path).map((value, i): SavedEntity => {
      if (++entityCount > MAX_ENTITIES) fail(path, 'too many entities');
      const recordPath = `${path}[${i}]`;
      const o = object(value, recordPath, ['id', 'transform', 'components']);
      const id = string(o.id, `${recordPath}.id`);
      if (!/^[a-zA-Z0-9_:.-]+$/.test(id) || ids.has(id)) fail(`${recordPath}.id`, 'invalid or duplicate entity ID');
      ids.add(id);
      const components = parsers.get(prefab)!(o.components, `${recordPath}.components`, {
        prefab, catalog, stack, container, transform,
      });
      if (components.stack?.entityId !== undefined && components.stack.entityId !== id) {
        fail(`${recordPath}.components.stack.entityId`, 'ground item ID must match entity record');
      }
      return { id, transform: transform(o.transform, `${recordPath}.transform`, true), components };
    });
    return [prefab, records];
  }));

  const players = object(root.players, 'players', ['local']);
  const player = object(players.local, 'players.local', ['prefab', 'shardId', 'transform', 'stats', 'inventory']);
  if (player.shardId !== shardId) fail('players.local.shardId', 'player must belong to this shard');
  const inventory = object(player.inventory, 'players.local.inventory', ['containers', 'bufferedBuilds']);
  const containers = object(inventory.containers, 'players.local.inventory.containers', ['player:inventory', 'player:equipment', 'player:cursor', 'player:backpack']);
  const playerInventory = container(containers['player:inventory'], 'players.local.inventory.containers.player:inventory', numericKeys(15));
  const playerEquipment = container(containers['player:equipment'], 'players.local.inventory.containers.player:equipment', ['hand', 'body', 'head']);
  const playerCursor = containers['player:cursor'] === undefined ? { slotCount: 1, slots: [] }
    : container(containers['player:cursor'], 'players.local.inventory.containers.player:cursor', ['0']);
  // Migrate the old shared container only when its owner can be identified safely.
  if (containers['player:backpack'] !== undefined) {
    const legacy = container(containers['player:backpack'], 'players.local.inventory.containers.player:backpack', numericKeys(8));
    const bags = [
      ...[...playerInventory.slots, ...playerEquipment.slots, ...playerCursor.slots].map(({ item }) => item),
      ...(entities.ground_item ?? []).flatMap(record => record.components.stack ? [record.components.stack] : []),
    ].filter(item => item.itemId === 'backpack');
    const owner = playerEquipment.slots.find(({ slotKey, item }) => slotKey === 'body' && item.itemId === 'backpack')?.item
      ?? (bags.length === 1 ? bags[0] : undefined);
    if (legacy.slots.length) {
      if (!owner || owner.container !== undefined) fail('players.local.inventory.containers.player:backpack', 'ambiguous legacy backpack owner');
      owner.container = legacy;
    }
  }
  const bufferedIds = new Set<string>();
  const bufferedBuilds = array(inventory.bufferedBuilds, 'players.local.inventory.bufferedBuilds', 1000).map((value, i) => {
    const path = `players.local.inventory.bufferedBuilds[${i}]`;
    const o = object(value, path, ['recipeId', 'skinId']);
    const recipeId = string(o.recipeId, `${path}.recipeId`);
    if (!Object.hasOwn(catalog.recipes, recipeId) || !catalog.recipes[recipeId].buffered || bufferedIds.has(recipeId)) {
      fail(`${path}.recipeId`, 'unknown, unbuffered or duplicate recipe');
    }
    bufferedIds.add(recipeId);
    const skinId = o.skinId === undefined ? undefined : string(o.skinId, `${path}.skinId`);
    if (skinId !== undefined && !catalog.recipeSkins[recipeId]?.includes(skinId)) fail(`${path}.skinId`, 'invalid recipe skin');
    return { recipeId, ...(skinId === undefined ? {} : { skinId }) };
  });
  let stats: SaveDocument['players']['local']['stats'];
  if (player.stats !== undefined) {
    const o = object(player.stats, 'players.local.stats', ['health', 'hunger', 'sanity']);
    stats = { health: number(o.health, 'players.local.stats.health'), hunger: number(o.hunger, 'players.local.stats.hunger'), sanity: number(o.sanity, 'players.local.stats.sanity') };
  }
  const systemsData = object(world.systems, 'world.systems', ['clock', 'season', 'worldtemperature', 'random']);
  const systems: SaveDocument['world']['systems'] = {};
  if (systemsData.clock !== undefined) {
    const o = object(systemsData.clock, 'world.systems.clock', ['day', 'phase', 'phaseProgress']);
    systems.clock = { day: integer(o.day, 'world.systems.clock.day', 1), phase: choice(o.phase, 'world.systems.clock.phase', ['day', 'dusk', 'night', 'full_moon']), phaseProgress: number(o.phaseProgress, 'world.systems.clock.phaseProgress', 0, 1) };
  }
  if (systemsData.season !== undefined) {
    const o = object(systemsData.season, 'world.systems.season', ['name', 'daysRemaining']);
    systems.season = { name: choice(o.name, 'world.systems.season.name', ['autumn', 'winter', 'spring', 'summer']), daysRemaining: number(o.daysRemaining, 'world.systems.season.daysRemaining') };
  }
  if (systemsData.worldtemperature !== undefined) {
    const path = 'world.systems.worldtemperature';
    const o = object(systemsData.worldtemperature, path,
      ['daylight', 'season', 'seasontemperature', 'phasetemperature', 'noisetime']);
    if (o.daylight !== undefined && typeof o.daylight !== 'boolean') fail(`${path}.daylight`, 'expected a boolean');
    systems.worldtemperature = {
      ...(o.daylight === undefined ? {} : { daylight: o.daylight as boolean }),
      season: choice(o.season, `${path}.season`, ['autumn', 'winter', 'spring', 'summer']),
      seasontemperature: number(o.seasontemperature, `${path}.seasontemperature`, -Number.MAX_SAFE_INTEGER),
      phasetemperature: number(o.phasetemperature, `${path}.phasetemperature`, -Number.MAX_SAFE_INTEGER),
      noisetime: number(o.noisetime, `${path}.noisetime`),
    };
  }
  if (systemsData.random !== undefined) {
    const o = object(systemsData.random, 'world.systems.random', ['algorithm', 'state']);
    const state = array(o.state, 'world.systems.random.state', 4).map((value, i) => integer(value, `world.systems.random.state[${i}]`, 0, 0xffffffff));
    if (state.length !== 4 || state.every((value) => value === 0)) fail('world.systems.random.state', 'expected four nonzero-state uint32 words');
    systems.random = { algorithm: choice(o.algorithm, 'world.systems.random.algorithm', ['xoshiro128ss']), state };
  }
  return {
    format: 'three-roaming-save', schemaVersion: 1,
    gameVersion: string(root.gameVersion, 'gameVersion'),
    session: { id: string(session.id, 'session.id'), createdAt: timestamp(session.createdAt, 'session.createdAt') },
    snapshot: { id, parentId, savedAt: timestamp(snapshot.savedAt, 'snapshot.savedAt'), reason: choice(snapshot.reason, 'snapshot.reason', ['initial', 'manual', 'autosave']) },
    world: {
      shardId, prefab: choice(world.prefab, 'world.prefab', ['forest']),
      ...(world.seed === undefined ? {} : { seed: string(world.seed, 'world.seed') }),
      elapsedSeconds: number(world.elapsedSeconds, 'world.elapsedSeconds'), systems,
      map: {
        kind: choice(map.kind, 'world.map.kind', ['generated']),
        ...(tiles === undefined ? {} : { tiles }),
        generator: {
          id: string(generator.id, 'world.map.generator.id'),
          ...(generator.seed === undefined ? {} : { seed: string(generator.seed, 'world.map.generator.seed') }),
          options: {
            size, moonTreeCount: integer(options.moonTreeCount, 'world.map.generator.options.moonTreeCount', 0, MAX_ENTITIES),
            moonTreeExclusionRadiusSquared: number(options.moonTreeExclusionRadiusSquared, 'world.map.generator.options.moonTreeExclusionRadiusSquared', 0, size * size / 2),
          },
        },
      }, entities,
    },
    players: {
      local: {
        prefab: choice(player.prefab, 'players.local.prefab', ['wilson']), shardId,
        transform: transform(player.transform, 'players.local.transform', false),
        ...(stats === undefined ? {} : { stats }),
        inventory: {
          containers: {
            'player:inventory': playerInventory,
            'player:equipment': playerEquipment,
            'player:cursor': playerCursor,
          }, bufferedBuilds,
        },
      },
    },
  };
}
