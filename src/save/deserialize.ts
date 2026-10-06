import type {
  InventoryItemSpec, InventoryRecipeDefinition, InventorySkinSpec, InventoryStack,
} from '@dontstarve-web/inventory';
import type { SaveDocument, SavedContainer, SavedEntity, SavedTransform } from './types';
import type { BuildingContainerDefinition } from '@dontstarve-web/prefab/containers';
import { DWARF_STAR_DURATION, POLAR_LIGHT_DURATION } from '@dontstarve-web/prefab/stafflight';
import { FLOWER_ANIMATIONS } from '@dontstarve-web/prefab/flower';
import { BEEFALO_BEHAVIOR } from '@dontstarve-web/prefab/beefalo';
import { BULB_PLANT_PREFABS, BULB_PLANT_LIGHT_STATES, BULB_PLANT_MAX_ON_TIME,
  BULB_PLANT_MAX_RECHARGE_TIME, isBulbPlantPrefab, bulbPlantRegrowTime } from '@dontstarve-web/prefab/bulb_plant';
import { ROCK_PREFABS } from '@dontstarve-web/prefab/rocks';
import { GRASS_ID } from '@dontstarve-web/prefab/grass';
import { SAPLING_PREFABS } from '@dontstarve-web/prefab/sapling';
import { POND_ID } from '@dontstarve-web/prefab/pond';
import { WORMHOLE_ID, WORMHOLE_SKINS } from '@dontstarve-web/prefab/wormhole';
import { WALL_SKIN_ARCHIVES } from '@dontstarve-web/prefab/wallSkins';
import { NIGHTMAREGROWTH_ID } from '@dontstarve-web/prefab/nightmaregrowth';
import { WORLD_TILES } from '@dontstarve-web/prefab/turfMap';
import { FARM_PLOW_ID, FARM_PLOW_DRILLING_DURATION, FARM_DECOR_IDS, FARM_PLOW_USES } from '@dontstarve-web/prefab/farm_plow';
import { TILE_SIZE } from '@dontstarve-web/prefab/tile';

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

function choice<const T extends readonly (string | number)[]>(value: unknown, path: string, choices: T): T[number] {
  const result = typeof value === 'number' ? number(value, path) : string(value, path);
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
  const stack = (value: unknown, path: string): InventoryStack => {
    const o = object(value, path, ['itemId', 'skinId', 'count', 'remainingUses']);
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
    return { itemId, count: integer(o.count, `${path}.count`, 1, spec.maxStack), ...(skinId === undefined ? {} : { skinId }),
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
  const allowedPrefabs = ['moon_tree', 'pigking', 'ground_item', 'stafflight', 'staffcoldlight', 'flower', 'beefalo', GRASS_ID, POND_ID, WORMHOLE_ID, NIGHTMAREGROWTH_ID, FARM_PLOW_ID, ...FARM_DECOR_IDS, ...SAPLING_PREFABS, ...BULB_PLANT_PREFABS, ...ROCK_PREFABS, ...Object.keys(catalog.buildings), ...catalog.walls];
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
        : prefab === 'ground_item' ? ['stack'] : prefab === 'stafflight' || prefab === 'staffcoldlight' ? ['timer'] : prefab === 'flower' ? ['flower']
        : prefab === 'beefalo' ? ['beefalo'] : prefab === NIGHTMAREGROWTH_ID ? ['nightmareGrowth']
        : prefab === WORMHOLE_ID ? ['wormhole']
        : prefab === FARM_PLOW_ID ? ['farmPlow'] : prefab === 'farm_soil' ? ['farmSoil'] : prefab === 'farm_soil_debris' ? ['farmDebris']
        : isBulbPlantPrefab(prefab) ? ['bulbPlant'] : catalog.walls.includes(prefab) ? ['health', 'wall'] : [];
      const c = object(o.components, `${recordPath}.components`, allowedComponents);
      const components: SavedEntity['components'] = {};
      if (prefab === FARM_PLOW_ID) {
        const path = `${recordPath}.components.farmPlow`;
        const plow = object(c.farmPlow, path, ['phase', 'remainingSeconds', 'returnUses']);
        const phase = choice(plow.phase, `${path}.phase`, ['drill_pre', 'drill_loop', 'collapse']);
        const remainingSeconds = number(plow.remainingSeconds, `${path}.remainingSeconds`, 0, FARM_PLOW_DRILLING_DURATION);
        const returnUses = integer(plow.returnUses, `${path}.returnUses`, 0, FARM_PLOW_USES - 1);
        if (phase === 'collapse' && (remainingSeconds !== 0 || returnUses === 0)) fail(path, 'invalid fold-up state');
        components.farmPlow = { phase, remainingSeconds, returnUses };
      }
      if (prefab === 'farm_soil') {
        const path = `${recordPath}.components.farmSoil`;
        const soil = object(c.farmSoil, path, ['broken', 'plowId']);
        if (typeof soil.broken !== 'boolean') fail(`${path}.broken`, 'expected a boolean');
        const plowId = soil.plowId === undefined ? undefined : string(soil.plowId, `${path}.plowId`);
        components.farmSoil = { broken: soil.broken, ...(plowId === undefined ? {} : { plowId }) };
      }
      if (prefab === 'farm_soil_debris') {
        const path = `${recordPath}.components.farmDebris`;
        const debris = object(c.farmDebris, path, ['animation']);
        components.farmDebris = { animation: choice(debris.animation, `${path}.animation`, ['f1', 'f2', 'f3', 'f4']) };
      }
      if (catalog.walls.includes(prefab) && c.wall !== undefined) {
        const path = `${recordPath}.components.wall`;
        const wall = object(c.wall, path, ['skinId']);
        const skinId = wall.skinId === undefined ? undefined : string(wall.skinId, `${path}.skinId`);
        if (skinId !== undefined && !Object.hasOwn(WALL_SKIN_ARCHIVES[prefab] ?? {}, skinId)) {
          fail(`${path}.skinId`, 'unsupported wall skin');
        }
        components.wall = skinId === undefined ? {} : { skinId };
      }
      if (prefab === WORMHOLE_ID && c.wormhole !== undefined) {
        const path = `${recordPath}.components.wormhole`;
        const wormhole = object(c.wormhole, path, ['skinId']);
        components.wormhole = wormhole.skinId === undefined ? {} : {
          skinId: choice(wormhole.skinId, `${path}.skinId`, WORMHOLE_SKINS),
        };
      }
      if (prefab === NIGHTMAREGROWTH_ID) {
        const path = `${recordPath}.components.nightmareGrowth`;
        const growth = object(c.nightmareGrowth, path, ['crackRotation']);
        components.nightmareGrowth = { crackRotation: number(growth.crackRotation, `${path}.crackRotation`, 0, 360) };
      }
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
      if (prefab === 'beefalo') {
        const path = `${recordPath}.components.beefalo`;
        const beefalo = object(c.beefalo, path, ['home', 'heading', 'poopRemainingSeconds']);
        const home = transform({ position: beefalo.home, rotationY: 0 }, `${path}.home`, true).position;
        components.beefalo = { home, heading: number(beefalo.heading, `${path}.heading`, 0, 360),
          poopRemainingSeconds: number(beefalo.poopRemainingSeconds, `${path}.poopRemainingSeconds`,
            Number.MIN_VALUE, BEEFALO_BEHAVIOR.poopMaxSeconds) };
      }
      if (isBulbPlantPrefab(prefab)) {
        const path = `${recordPath}.components.bulbPlant`;
        const plant = object(c.bulbPlant, path, ['variant', 'lightState', 'remainingSeconds', 'picked', 'regrowSeconds']);
        const variant = choice(plant.variant, `${path}.variant`, prefab === 'flower_cave' ? ['single', 'springy'] as const
          : prefab === 'flower_cave_double' ? ['double'] as const : ['triple'] as const);
        const lightState = choice(plant.lightState, `${path}.lightState`, BULB_PLANT_LIGHT_STATES);
        if (plant.picked !== undefined && typeof plant.picked !== 'boolean') fail(`${path}.picked`, 'expected boolean');
        const picked = plant.picked === true;
        if (picked && lightState === 'ON') fail(`${path}.lightState`, 'picked plant cannot emit light');
        if ((picked || lightState === 'CHARGED') && plant.remainingSeconds !== undefined) fail(`${path}.remainingSeconds`, 'plant has no active light timer');
        if (!picked && plant.regrowSeconds !== undefined) fail(`${path}.regrowSeconds`, 'mature plant has no regrowth timer');
        components.bulbPlant = { variant, lightState, ...(picked || lightState === 'CHARGED' ? {} : {
          remainingSeconds: number(plant.remainingSeconds, `${path}.remainingSeconds`, Number.MIN_VALUE,
            lightState === 'ON' ? BULB_PLANT_MAX_ON_TIME : BULB_PLANT_MAX_RECHARGE_TIME),
        }), ...(plant.picked === undefined ? {} : { picked: plant.picked }), ...(picked ? {
          regrowSeconds: number(plant.regrowSeconds, `${path}.regrowSeconds`, Number.MIN_VALUE, bulbPlantRegrowTime(variant)),
        } : {}) };
      }
      if (prefab === 'flower') {
        const path = `${recordPath}.components.flower`;
        const flower = object(c.flower, path, ['animation', 'planted']);
        if (flower.planted !== true) fail(`${path}.planted`, 'expected true');
        components.flower = { animation: choice(flower.animation, `${path}.animation`, FLOWER_ANIMATIONS), planted: true };
      }
      if (prefab === 'stafflight' || prefab === 'staffcoldlight') {
        const t = object(c.timer, `${recordPath}.components.timer`, ['remainingSeconds']);
        components.timer = { remainingSeconds: number(t.remainingSeconds,
          `${recordPath}.components.timer.remainingSeconds`, Number.MIN_VALUE,
          prefab === 'staffcoldlight' ? POLAR_LIGHT_DURATION : DWARF_STAR_DURATION) };
      }
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
  const containers = object(inventory.containers, 'players.local.inventory.containers', ['player:inventory', 'player:equipment', 'player:backpack']);
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
            'player:inventory': container(containers['player:inventory'], 'players.local.inventory.containers.player:inventory', numericKeys(15)),
            'player:equipment': container(containers['player:equipment'], 'players.local.inventory.containers.player:equipment', ['hand', 'body', 'head']),
            ...(containers['player:backpack'] === undefined ? {} : {
              'player:backpack': container(containers['player:backpack'], 'players.local.inventory.containers.player:backpack', numericKeys(8)),
            }),
          }, bufferedBuilds,
        },
      },
    },
  };
}
