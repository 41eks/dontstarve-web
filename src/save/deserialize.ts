import type {
  InventoryItemSpec, InventoryRecipeDefinition, InventorySkinSpec, InventoryStack,
} from '@three-roaming/inventory';
import type { SaveDocument, SavedContainer, SavedEntity, SavedTransform } from './types';
import type { BuildingContainerDefinition } from '@three-roaming/prefab/containers';

export interface SaveCatalog {
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

function fail(path: string, message: string): never {
  throw new Error(`Invalid save at ${path}: ${message}`);
}

function object(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object');
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(`${path}.${key}`, 'unsupported field');
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string, max = MAX_ENTITIES): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(path, `expected an array of at most ${max} entries`);
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.length || value.length > 256) fail(path, 'expected a nonempty string');
  return value;
}

function number(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(path, `expected a finite number between ${min} and ${max}`);
  }
  return value;
}

function integer(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const result = number(value, path, min, max);
  if (!Number.isSafeInteger(result)) fail(path, 'expected a safe integer');
  return result;
}

function choice<const T extends readonly string[]>(value: unknown, path: string, choices: T): T[number] {
  const result = string(value, path);
  if (!choices.includes(result)) fail(path, `expected ${choices.join(', ')}`);
  return result as T[number];
}

function timestamp(value: unknown, path: string): string {
  const result = string(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result)
    || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) {
    fail(path, 'expected a UTC ISO timestamp');
  }
  return result;
}

function snapshotId(value: unknown, path: string): string {
  const result = string(value, path);
  if (!/^\d{10}$/.test(result)) fail(path, 'expected a ten-digit snapshot ID');
  return result;
}

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
  const map = object(world.map, 'world.map', ['kind', 'generator']);
  const generator = object(map.generator, 'world.map.generator', ['id', 'seed', 'options']);
  const options = object(generator.options, 'world.map.generator.options', ['size', 'moonTreeCount', 'moonTreeExclusionRadiusSquared']);
  const size = number(options.size, 'world.map.generator.options.size', 1, 10_000);

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
  const stack = (value: unknown, path: string): InventoryStack => {
    const o = object(value, path, ['itemId', 'skinId', 'count']);
    const itemId = string(o.itemId, `${path}.itemId`);
    const spec = Object.hasOwn(catalog.items, itemId) ? catalog.items[itemId] : undefined;
    if (!spec) fail(`${path}.itemId`, `unknown item ${itemId}`);
    const skinId = o.skinId === undefined ? undefined : string(o.skinId, `${path}.skinId`);
    if (skinId !== undefined) {
      const skin = Object.hasOwn(catalog.skins, skinId) ? catalog.skins[skinId] : undefined;
      if (!skin || (skin.itemId !== undefined && skin.itemId !== itemId)) fail(`${path}.skinId`, `invalid skin for ${itemId}`);
    }
    return { itemId, count: integer(o.count, `${path}.count`, 1, spec.maxStack), ...(skinId === undefined ? {} : { skinId }) };
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
      if (item.count > maxStack) fail(`${slotPath}.item.count`, `expected at most ${maxStack}`);
      if (keys.includes('hand') && catalog.items[item.itemId].equippable !== slotKey) {
        fail(`${slotPath}.item`, `item cannot be equipped in ${slotKey}`);
      }
      return { slotKey, item };
    });
    return { slotCount: keys.length, slots };
  };
  const numericKeys = (count: number) => Array.from({ length: count }, (_, i) => String(i));
  const ids = new Set<string>();
  let entityCount = 0;
  const allowedPrefabs = ['moon_tree', 'pigking', 'ground_item', ...Object.keys(catalog.buildings), ...catalog.walls];
  const groups = object(world.entities, 'world.entities', allowedPrefabs);
  const entities = Object.fromEntries(Object.entries(groups).map(([prefab, values]) => {
    const path = `world.entities.${prefab}`;
    const records = array(values, path).map((value, i): SavedEntity => {
      if (++entityCount > MAX_ENTITIES) fail(path, 'too many entities');
      const recordPath = `${path}[${i}]`;
      const o = object(value, recordPath, ['id', 'transform', 'components']);
      const id = string(o.id, `${recordPath}.id`);
      if (!/^[a-zA-Z0-9_:.-]+$/.test(id) || ids.has(id)) fail(`${recordPath}.id`, 'invalid or duplicate entity ID');
      ids.add(id);
      const building = Object.hasOwn(catalog.buildings, prefab) ? catalog.buildings[prefab] : undefined;
      const containerDefinition = building?.container;
      const isContainer = containerDefinition !== undefined;
      const allowedComponents = building ? ['building', ...(isContainer ? ['container'] : [])]
        : prefab === 'ground_item' ? ['stack'] : catalog.walls.includes(prefab) ? ['health'] : [];
      const c = object(o.components, `${recordPath}.components`, allowedComponents);
      const components: SavedEntity['components'] = {};
      if (building) {
        const b = object(c.building, `${recordPath}.components.building`, ['state', 'skinId']);
        // Older cook pot saves only stored idle; migrate that to the closed state.
        const state = choice(prefab === 'cookpot' && b.state === 'idle' ? 'closed' : b.state,
          `${recordPath}.components.building.state`, isContainer ? ['closed', 'open'] : ['idle']);
        const skinId = b.skinId === undefined ? undefined : string(b.skinId, `${recordPath}.components.building.skinId`);
        if (skinId !== undefined && !Object.hasOwn(building.skinArchives ?? {}, skinId)) fail(`${recordPath}.components.building.skinId`, 'unsupported building skin');
        components.building = { state, ...(skinId === undefined ? {} : { skinId }) };
        if (isContainer) {
          const slotCount = containerDefinition!.slotCount;
          components.container = c.container === undefined ? { slotCount, slots: [] }
            : container(c.container, `${recordPath}.components.container`, numericKeys(slotCount),
              containerDefinition!.singleItems ? 1 : Infinity);
        }
      }
      if (prefab === 'ground_item') components.stack = stack(c.stack, `${recordPath}.components.stack`);
      if (c.health !== undefined) {
        const h = object(c.health, `${recordPath}.components.health`, ['current', 'maximum']);
        const maximum = number(h.maximum, `${recordPath}.components.health.maximum`, 1);
        components.health = { current: number(h.current, `${recordPath}.components.health.current`, 0, maximum), maximum };
      }
      return { id, transform: transform(o.transform, `${recordPath}.transform`, true), components };
    });
    return [prefab, records];
  }));

  const players = object(root.players, 'players', ['local']);
  const player = object(players.local, 'players.local', ['prefab', 'shardId', 'transform', 'stats', 'inventory']);
  if (player.shardId !== shardId) fail('players.local.shardId', 'player must belong to this shard');
  const inventory = object(player.inventory, 'players.local.inventory', ['containers', 'bufferedBuilds']);
  const containers = object(inventory.containers, 'players.local.inventory.containers', ['player:inventory', 'player:equipment']);
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
  const systemsData = object(world.systems, 'world.systems', ['clock', 'season', 'random']);
  const systems: SaveDocument['world']['systems'] = {};
  if (systemsData.clock !== undefined) {
    const o = object(systemsData.clock, 'world.systems.clock', ['day', 'phase', 'phaseProgress']);
    systems.clock = { day: integer(o.day, 'world.systems.clock.day', 1), phase: choice(o.phase, 'world.systems.clock.phase', ['day', 'dusk', 'night', 'full_moon']), phaseProgress: number(o.phaseProgress, 'world.systems.clock.phaseProgress', 0, 1) };
  }
  if (systemsData.season !== undefined) {
    const o = object(systemsData.season, 'world.systems.season', ['name', 'daysRemaining']);
    systems.season = { name: choice(o.name, 'world.systems.season.name', ['autumn', 'winter', 'spring', 'summer']), daysRemaining: number(o.daysRemaining, 'world.systems.season.daysRemaining') };
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
            'player:inventory': container(containers['player:inventory'], 'players.local.inventory.containers.player:inventory', numericKeys(15)),
            'player:equipment': container(containers['player:equipment'], 'players.local.inventory.containers.player:equipment', ['hand', 'body', 'head']),
          }, bufferedBuilds,
        },
      },
    },
  };
}
