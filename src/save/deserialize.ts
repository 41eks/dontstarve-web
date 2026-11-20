import type {
  InventoryItemSpec, InventoryRecipeDefinition, InventorySkinSpec,
} from '@dontstarve-web/inventory';
import type { SaveDocument } from './types';
import type { BuildingContainerDefinition } from '@dontstarve-web/prefab/containers';
import { WORLD_TILES, isOceanTile } from '@dontstarve-web/prefab/turfMap';
import { GROUND_TILE_DEFINITIONS } from '@dontstarve-web/prefab/groundTiles';
import { GROUND_ART_DEFINITIONS, GROUND_ART_VARIANTS } from '@dontstarve-web/prefab/groundItems';
import { TILE_SIZE } from '@dontstarve-web/prefab/tile';
import { ITEM_PREFAB_IDS, PREFAB_DEFINITIONS, prefabSaveParsers, type PrefabDefinition } from '../prefabDefinitions';
import type { EntitySaveContext } from './prefabComponents';
import { PHONOGRAPH_PLAY_TIME } from '@dontstarve-web/prefab/phonograph';
import { ROPEBRIDGE_HEALTH, type RopeBridgeTileSave } from '../../packages/componets/src/ropebridgemanager';
import { array, choice, fail, integer, number, object, snapshotId, string, timestamp } from './validation';
import type { EntityPersistData, EntitySaveRecord, HeldEntityRecord, PlayerInventorySave, SavedTransform, SlotItemsSave } from '@dontstarve-web/prefab/saveRecord';

/** The item component records an item's GetPersistData may hold; its spec says which it has. */
const ITEM_RECORDS = ['stackable', 'finiteuses', 'fueled', 'perishable', 'armor', 'temperature', 'highTemp', 'lowTemp',
  'inventoryitemmoisture', 'container', 'inventory', 'health', 'knownlocations', 'needs_home_time', 'groundVariant'] as const;
/** inventory.lua's EQUIPSLOTS names, by the equip kind of the item each takes. */
const EQUIP_SLOTS: Readonly<Record<string, string>> = { hands: 'hand', body: 'body', head: 'head' };

/** TILE_SCALE: a rope bridge's direction is one tile's offset in DST units. */
const ROPE_BRIDGE_DIRECTION_LIMIT = 4;

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
    /** The parts of the container definition the save parser reads. */
    container?: Pick<BuildingContainerDefinition, 'slotCount' | 'singleItems'>;
  }>>;
  walls: readonly string[];
}

export const MAX_SAVE_BYTES = 32 * 1024 * 1024;

function ghostFlag(value: unknown): true {
  if (value !== true) { fail('players.local.ghost', 'expected true'); }
  return true;
}

/** Parses and validates all data before any resources or runtime entities are created. */
export function deserializeSave(text: string, catalog: SaveCatalog, sessionPlayer?: unknown): SaveDocument {
  if (text.length > MAX_SAVE_BYTES || new TextEncoder().encode(text).byteLength > MAX_SAVE_BYTES) {
    fail('$', 'file is too large');
  }
  let data: unknown;
  try { data = JSON.parse(text); } catch { fail('$', 'invalid JSON'); }
  if (sessionPlayer !== undefined) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) { fail('$', 'expected a save object'); }
    data = { ...data, players: { local: sessionPlayer } };
  }
  let nodes = 0;
  const visit = (value: unknown, depth: number) => {
    // Full forest snapshots include over 168,000 land/ocean tiles plus their entities.
    if (++nodes > 2_000_000 || depth > 32) { fail('$', 'data exceeds nesting or size limits'); }
    if (typeof value === 'number' && !Number.isFinite(value)) { fail('$', 'nonfinite number'); }
    if (typeof value === 'string' && value.length > 256) { fail('$', 'string is too long'); }
    if (value && typeof value === 'object') { Object.values(value).forEach((child) => visit(child, depth + 1)); }
  };
  visit(data, 0);
  const root = object(data, '$', ['format', 'schemaVersion', 'gameVersion', 'session', 'snapshot', 'world', 'players']);
  if (root.format !== 'three-roaming-save') { fail('format', 'unrecognized format'); }
  if (root.schemaVersion !== 1) { fail('schemaVersion', 'only version 1 is supported'); }
  const session = object(root.session, 'session', ['id', 'createdAt', 'playerFile']);
  const playerFile = session.playerFile === undefined ? undefined : string(session.playerFile, 'session.playerFile');
  if (playerFile !== undefined && !/^(?:Master|Caves)\/save\/session\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[0-9]{10}\.json$/.test(playerFile)) {
    fail('session.playerFile', 'invalid Session player path');
  }
  const snapshot = object(root.snapshot, 'snapshot', ['id', 'parentId', 'savedAt', 'reason']);
  const id = snapshotId(snapshot.id, 'snapshot.id');
  const parentId = snapshot.parentId === null ? null : snapshotId(snapshot.parentId, 'snapshot.parentId');
  if (parentId !== null && parentId >= id) { fail('snapshot.parentId', 'must refer to an earlier snapshot'); }
  const world = object(root.world, 'world', ['shardId', 'prefab', 'seed', 'elapsedSeconds', 'systems', 'map', 'entities']);
  const shardId = string(world.shardId, 'world.shardId');
  const map = object(world.map, 'world.map', ['kind', 'generator', 'tiles', 'defaultTileId', 'topology']);
  const generator = object(map.generator, 'world.map.generator', ['id', 'seed', 'options']);
  const options = object(generator.options, 'world.map.generator.options', ['size', 'moonTreeCount', 'moonTreeExclusionRadiusSquared']);
  const size = number(options.size, 'world.map.generator.options.size', 1, 10_000);
  const tileKeys = new Set<string>();
  const groundTiles = Object.values(GROUND_TILE_DEFINITIONS).map(definition => definition.tileId);
  const supportedTiles = [...groundTiles, WORLD_TILES.IMPASSABLE, WORLD_TILES.FAKE_GROUND];
  const defaultTileId = map.defaultTileId === undefined ? undefined
    : choice(map.defaultTileId, 'world.map.defaultTileId', [WORLD_TILES.DECIDUOUS, WORLD_TILES.IMPASSABLE]);
  if (world.prefab === 'cave' && defaultTileId !== WORLD_TILES.IMPASSABLE) {
    fail('world.map.defaultTileId', 'cave maps require an impassable background');
  }
  const topology = map.topology === undefined ? undefined : {
    nodes: array(object(map.topology, 'world.map.topology', ['nodes']).nodes, 'world.map.topology.nodes', 100_000).map((value, i) => {
      const path = `world.map.topology.nodes[${i}]`;
      const node = object(value, path, ['x', 'z', 'type']);
      return { x: number(node.x, `${path}.x`, -size, size), z: number(node.z, `${path}.z`, -size, size), type: integer(node.type, `${path}.type`, 0, 7) };
    }),
  };
  const tiles = map.tiles === undefined ? undefined : array(map.tiles, 'world.map.tiles',
    (Math.ceil(size / TILE_SIZE) + 1) ** 2).map((value, i) => {
    const path = `world.map.tiles[${i}]`;
    const tile = object(value, path, ['col', 'row', 'tileId', 'underTileId', 'ropeBridge']);
    const min = Math.floor(-size / 2 / TILE_SIZE), max = Math.ceil(size / 2 / TILE_SIZE) - 1;
    const col = integer(tile.col, `${path}.col`, min, max);
    const row = integer(tile.row, `${path}.row`, min, max);
    const tileId = choice(tile.tileId, `${path}.tileId`, supportedTiles);
    const underTileId = tile.underTileId === undefined ? undefined
      : choice(tile.underTileId, `${path}.underTileId`, groundTiles.filter(id => id !== WORLD_TILES.FARMING_SOIL && id !== WORLD_TILES.MONKEY_DOCK));
    if (underTileId !== undefined && tileId !== WORLD_TILES.FARMING_SOIL && tileId !== WORLD_TILES.MONKEY_DOCK && tileId !== WORLD_TILES.OCEAN_ICE
      && tileId !== WORLD_TILES.RIFT_MOON) {
      fail(`${path}.underTileId`, 'only farming soil, docks, ice floes and lunar rift ground have an underlying tile');
    }
    if (tileId === WORLD_TILES.MONKEY_DOCK && (underTileId === undefined || !isOceanTile(underTileId))) { fail(`${path}.underTileId`, 'a dock covers an ocean tile'); }
    if (tileId === WORLD_TILES.FARMING_SOIL && (underTileId !== undefined && isOceanTile(underTileId))) { fail(`${path}.underTileId`, 'farming soil cannot cover ocean'); }
    // rift_terraformer.lua only turns land into RIFT_MOON, recording the replaced tile with undertile.
    if (tileId === WORLD_TILES.RIFT_MOON && (underTileId !== undefined && isOceanTile(underTileId))) { fail(`${path}.underTileId`, 'lunar rift ground cannot cover ocean'); }
    let ropeBridge: RopeBridgeTileSave | undefined;
    if (tile.ropeBridge !== undefined) {
      const at = `${path}.ropeBridge`;
      if (tileId !== WORLD_TILES.ROPE_BRIDGE) { fail(at, 'only rope bridge tiles carry bridge data'); }
      const bridge = object(tile.ropeBridge, at, ['health', 'direction', 'iconOffset']);
      const direction = object(bridge.direction, `${at}.direction`, ['x', 'z']);
      const limit = ROPE_BRIDGE_DIRECTION_LIMIT;
      ropeBridge = {
        health: number(bridge.health, `${at}.health`, 0, ROPEBRIDGE_HEALTH),
        direction: { x: number(direction.x, `${at}.direction.x`, -limit, limit), z: number(direction.z, `${at}.direction.z`, -limit, limit) },
        ...(bridge.iconOffset === undefined ? {} : { iconOffset: integer(bridge.iconOffset, `${at}.iconOffset`, 0, 255) }),
      };
    }
    const key = `${col},${row}`;
    if (tileKeys.has(key)) { fail(path, 'duplicate terrain tile'); }
    tileKeys.add(key);
    return { col, row, tileId, ...(underTileId === undefined ? {} : { underTileId }), ...(ropeBridge ? { ropeBridge } : {}) };
  });

  const transform = (value: unknown, path: string, grounded: boolean): SavedTransform => {
    const o = object(value, path, ['position', 'rotationY']);
    const p = array(o.position, `${path}.position`, 3);
    if (p.length !== 3) { fail(`${path}.position`, 'expected three coordinates'); }
    const position: [number, number, number] = [
      number(p[0], `${path}.position[0]`, -size / 2, size / 2),
      number(p[1], `${path}.position[1]`, 0, grounded ? 0 : 1000),
      number(p[2], `${path}.position[2]`, -size / 2, size / 2),
    ];
    return { position, rotationY: number(o.rotationY, `${path}.rotationY`, -Number.MAX_VALUE) };
  };
  const parsers = prefabSaveParsers(catalog.prefabs ?? Object.values(PREFAB_DEFINITIONS));
  const itemRecords = new Set<string>(ITEM_PREFAB_IDS);
  const ids = new Set<string>();
  /** A record's ID, unique among the save's entities and the items they hold. */
  const entityId = (value: unknown, path: string): string => {
    const id = string(value, path);
    if (!/^[a-zA-Z0-9_:.-]+$/.test(id) || ids.has(id)) { fail(path, 'invalid or duplicate entity ID'); }
    ids.add(id);
    return id;
  };
  /** An item's record.skinname: one of its own skins, or of its ground art for an item lying in the world. */
  const itemSkin = (value: unknown, path: string, prefab: string, ground: boolean): string => {
    const skinId = string(value, path);
    const skin = Object.hasOwn(catalog.skins, skinId) ? catalog.skins[skinId] : undefined;
    const art = Object.hasOwn(GROUND_ART_DEFINITIONS, prefab) ? GROUND_ART_DEFINITIONS[prefab] : undefined;
    if ((!skin || (skin.itemId !== undefined && skin.itemId !== prefab)) && !(ground && art && Object.hasOwn(art.skinArchives, skinId))) {
      fail(path, `invalid skin for ${prefab}`);
    }
    return skinId;
  };
  /** GetSaveRecord of an item a container or inventory holds; `refuse` names why its holder cannot hold that prefab. */
  const held = (value: unknown, path: string, refuse?: (prefab: string) => string | undefined): HeldEntityRecord => {
    const o = object(value, path, ['id', 'prefab', 'skinname', 'components']);
    const id = entityId(o.id, `${path}.id`);
    const prefab = string(o.prefab, `${path}.prefab`);
    if (!Object.hasOwn(catalog.items, prefab) || !parsers.has(prefab)) { fail(`${path}.prefab`, `unknown item ${prefab}`); }
    const reason = refuse?.(prefab);
    if (reason) { fail(`${path}.prefab`, reason); }
    const skinname = o.skinname === undefined ? undefined : itemSkin(o.skinname, `${path}.skinname`, prefab, false);
    const components = parsers.get(prefab)!(o.components, `${path}.components`, context(prefab));
    return { id, prefab, ...(skinname === undefined ? {} : { skinname }), components };
  };
  /** container.lua / inventory.lua OnSave's items: held records under one-based slots, each stack within `maxStack`. */
  const slotItems = (value: unknown, path: string, slotCount: number, refuse?: (prefab: string) => string | undefined,
    maxStack = Infinity): SlotItemsSave => {
    const o = object(value, path, ['items']);
    const saved = object(o.items, `${path}.items`, Array.from({ length: slotCount }, (_, i) => String(i + 1)));
    return { items: Object.fromEntries(Object.entries(saved).map(([slot, record]) => {
      const item = held(record, `${path}.items.${slot}`, refuse);
      if ((item.components.stackable?.stack ?? 1) > maxStack) { fail(`${path}.items.${slot}.components.stackable.stack`, `expected at most ${maxStack}`); }
      return [slot, item];
    })) };
  };
  const inContainer = (prefab: string) => catalog.items[prefab].canGoInContainer === false ? 'item cannot go in a container' : undefined;
  /** An item's GetPersistData: its components' records, bounded by what its spec says the item has. */
  const item = (value: unknown, path: string, prefab: string, extra: readonly (keyof EntityPersistData)[] = []): EntityPersistData => {
    const ground = path.startsWith('world.entities.');
    const art = Object.hasOwn(GROUND_ART_DEFINITIONS, prefab) ? GROUND_ART_DEFINITIONS[prefab] : undefined;
    // An item record in the world may be ground art alone, which no inventory holds.
    const spec: InventoryItemSpec | undefined = Object.hasOwn(catalog.items, prefab) ? catalog.items[prefab]
      : ground && art ? { name: art.name, icon: art.icon ?? '', maxStack: Number.MAX_SAFE_INTEGER } : undefined;
    if (!spec) { fail(path, `unknown item ${prefab}`); }
    const o = object(value, path, [...ITEM_RECORDS, ...extra]);
    const has = (key: string, available: unknown): boolean => {
      if (o[key] === undefined) { return false; }
      if (!available) { fail(`${path}.${key}`, `${prefab} has no ${key}`); }
      return true;
    };
    const data: EntityPersistData = {};
    if (o.stackable !== undefined) {
      const saved = object(o.stackable, `${path}.stackable`, ['stack']);
      data.stackable = { stack: integer(saved.stack, `${path}.stackable.stack`, 2, spec.maxStack) };
    }
    if (has('finiteuses', spec.maxUses !== undefined)) {
      const step = spec.useStep ?? 1;
      const uses = number(object(o.finiteuses, `${path}.finiteuses`, ['uses']).uses, `${path}.finiteuses.uses`, step, spec.maxUses!);
      if (!Number.isSafeInteger(uses / step)) { fail(`${path}.finiteuses.uses`, 'invalid durability increment'); }
      data.finiteuses = { uses };
    }
    if (has('fueled', spec.maxFuel !== undefined)) {
      data.fueled = { fuel: number(object(o.fueled, `${path}.fueled`, ['fuel']).fuel, `${path}.fueled.fuel`, 0, spec.maxFuel!) };
    }
    if (has('perishable', spec.perishTime !== undefined)) {
      const saved = object(o.perishable, `${path}.perishable`, ['time', 'paused']);
      if (saved.paused !== undefined && saved.paused !== true) { fail(`${path}.perishable.paused`, 'expected true'); }
      data.perishable = { time: number(saved.time, `${path}.perishable.time`, 0, spec.perishTime!), ...saved.paused ? { paused: true as const } : {} };
    }
    if (has('armor', spec.maxArmor !== undefined)) {
      // armor.lua OnSave omits a full condition; a broken armor is removed rather than saved.
      data.armor = { condition: number(object(o.armor, `${path}.armor`, ['condition']).condition, `${path}.armor.condition`, Number.MIN_VALUE, spec.maxArmor!) };
    }
    if (has('temperature', spec.savesTemperature)) {
      data.temperature = { current: number(object(o.temperature, `${path}.temperature`, ['current']).current, `${path}.temperature.current`, -20, 90) };
    }
    if (has('highTemp', spec.savesTemperature)) { data.highTemp = integer(o.highTemp, `${path}.highTemp`, -20, 90); }
    if (has('lowTemp', spec.savesTemperature)) { data.lowTemp = integer(o.lowTemp, `${path}.lowTemp`, -20, 90); }
    if (data.highTemp !== undefined && data.lowTemp !== undefined) { fail(path, 'a heat rock saves one temperature extreme'); }
    if (o.inventoryitemmoisture !== undefined) {
      const saved = object(o.inventoryitemmoisture, `${path}.inventoryitemmoisture`, ['moisture', 'wet']);
      if (saved.wet !== undefined && saved.wet !== true) { fail(`${path}.inventoryitemmoisture.wet`, 'expected true'); }
      data.inventoryitemmoisture = { ...saved.moisture === undefined ? {} : { moisture: number(saved.moisture, `${path}.inventoryitemmoisture.moisture`, 0, 100) },
        ...saved.wet ? { wet: true as const } : {} };
    }
    if (has('container', spec.containerSlots !== undefined)) {
      data.container = slotItems(o.container, `${path}.container`, spec.containerSlots!,
        child => catalog.items[child].containerSlots !== undefined ? 'a container cannot hold another' : inContainer(child));
    }
    if (has('inventory', spec.holds ?? spec.creatureState === 'mole')) {
      const holds = spec.holds;
      data.inventory = holds ? slotItems(o.inventory, `${path}.inventory`, holds.slots, child => child === holds.itemId ? undefined : `expected ${holds.itemId}`, 1)
        : slotItems(o.inventory, `${path}.inventory`, 3);
    }
    if (has('health', spec.creatureState)) {
      const saved = object(o.health, `${path}.health`, ['health', 'maxhealth', 'penalty']);
      // health.lua OnSave; this port's Health always writes its maximum.
      const maxhealth = number(saved.maxhealth, `${path}.health.maxhealth`, Number.MIN_VALUE);
      data.health = { health: number(saved.health, `${path}.health.health`, 0, maxhealth), maxhealth,
        ...saved.penalty === undefined ? {} : { penalty: number(saved.penalty, `${path}.health.penalty`, 0, 1) } };
    }
    if (has('knownlocations', spec.creatureState)) {
      const saved = object(o.knownlocations, `${path}.knownlocations`, ['locations']);
      data.knownlocations = { locations: array(saved.locations, `${path}.knownlocations.locations`, 16).map((entry, i) => {
        const p = `${path}.knownlocations.locations[${i}]`, location = object(entry, p, ['name', 'x', 'y', 'z']);
        return { name: string(location.name, `${p}.name`), x: number(location.x, `${p}.x`, -Number.MAX_SAFE_INTEGER),
          y: number(location.y, `${p}.y`, -Number.MAX_SAFE_INTEGER), z: number(location.z, `${p}.z`, -Number.MAX_SAFE_INTEGER) };
      }) };
    }
    if (has('needs_home_time', spec.creatureState === 'mole')) { data.needs_home_time = number(o.needs_home_time, `${path}.needs_home_time`, 0); }
    if (o.groundVariant !== undefined) { data.groundVariant = choice(o.groundVariant, `${path}.groundVariant`, Object.keys(GROUND_ART_VARIANTS[prefab] ?? {})); }
    if (o.torch !== undefined) {
      if (object(o.torch, `${path}.torch`, ['lit']).lit !== true) { fail(`${path}.torch.lit`, 'expected true'); }
      data.torch = { lit: true };
    }
    if (o.machine !== undefined) {
      const machine = object(o.machine, `${path}.machine`, ['ison']);
      if (typeof machine.ison !== 'boolean') { fail(`${path}.machine.ison`, 'expected boolean'); }
      data.machine = { ison: machine.ison };
    }
    if (o.phonograph !== undefined) {
      if (!Object.keys(data.inventory?.items ?? {}).length) { fail(`${path}.phonograph`, 'playing machine requires a record'); }
      data.phonograph = { remainingSeconds: number(object(o.phonograph, `${path}.phonograph`, ['remainingSeconds']).remainingSeconds,
        `${path}.phonograph.remainingSeconds`, Number.MIN_VALUE, PHONOGRAPH_PLAY_TIME) };
    }
    return data;
  };
  const context = (prefab: string): EntitySaveContext => ({ prefab, catalog, held, slotItems, item, transform });
  const groups = object(world.entities, 'world.entities', [...parsers.keys()]);
  const entities = Object.fromEntries(Object.entries(groups).map(([prefab, values]) => {
    const path = `world.entities.${prefab}`;
    const records = array(values, path, Number.MAX_SAFE_INTEGER).map((value, i): EntitySaveRecord => {
      const recordPath = `${path}[${i}]`;
      const o = object(value, recordPath, ['id', 'transform', 'components', 'skinname']);
      const id = entityId(o.id, `${recordPath}.id`);
      // GetSaveRecord's skinname belongs to an item; structures save their skin in their own data.
      const isItem = itemRecords.has(prefab);
      if (o.skinname !== undefined && !isItem) { fail(`${recordPath}.skinname`, 'only an item saves its skin on the record'); }
      const skinname = o.skinname === undefined ? undefined : itemSkin(o.skinname, `${recordPath}.skinname`, prefab, true);
      const components = parsers.get(prefab)!(o.components, `${recordPath}.components`, context(prefab));
      // An item is saved where it lies; others stand on the ground.
      return { id, transform: transform(o.transform, `${recordPath}.transform`, !isItem), components,
        ...(skinname === undefined ? {} : { skinname }) };
    });
    return [prefab, records];
  }));

  const players = object(root.players, 'players', ['local']);
  const player = object(players.local, 'players.local', ['prefab', 'shardId', 'transform', 'stats', 'ghost', 'wortox', 'inventory', 'builder']);
  if (player.shardId !== shardId) { fail('players.local.shardId', 'player must belong to this shard'); }
  // inventory.lua OnSave of the player: items by slot, equip by EQUIPSLOTS name, and the cursor's activeitem.
  const savedInventory = object(player.inventory, 'players.local.inventory', ['items', 'equip', 'activeitem']);
  const equipped = object(savedInventory.equip ?? {}, 'players.local.inventory.equip', Object.keys(EQUIP_SLOTS));
  const inventory: PlayerInventorySave = {
    items: slotItems({ items: savedInventory.items ?? {} }, 'players.local.inventory', 15).items,
    equip: Object.fromEntries(Object.entries(equipped).map(([equipslot, record]) => [equipslot,
      held(record, `players.local.inventory.equip.${equipslot}`, prefab => catalog.items[prefab].equippable === EQUIP_SLOTS[equipslot]
        ? undefined : `item cannot be equipped in ${equipslot}`)])),
    ...(savedInventory.activeitem === undefined ? {} : { activeitem: held(savedInventory.activeitem, 'players.local.inventory.activeitem') }),
  };
  const builder = object(player.builder ?? { bufferedBuilds: [] }, 'players.local.builder', ['bufferedBuilds']);
  const bufferedIds = new Set<string>();
  const bufferedBuilds = array(builder.bufferedBuilds, 'players.local.builder.bufferedBuilds', 1000).map((value, i) => {
    const path = `players.local.builder.bufferedBuilds[${i}]`;
    const o = object(value, path, ['recipeId', 'skinId']);
    const recipeId = string(o.recipeId, `${path}.recipeId`);
    if (!Object.hasOwn(catalog.recipes, recipeId) || !catalog.recipes[recipeId].buffered || bufferedIds.has(recipeId)) {
      fail(`${path}.recipeId`, 'unknown, unbuffered or duplicate recipe');
    }
    bufferedIds.add(recipeId);
    const skinId = o.skinId === undefined ? undefined : string(o.skinId, `${path}.skinId`);
    if (skinId !== undefined && !catalog.recipeSkins[recipeId]?.includes(skinId)) { fail(`${path}.skinId`, 'invalid recipe skin'); }
    return { recipeId, ...(skinId === undefined ? {} : { skinId }) };
  });
  let stats: SaveDocument['players']['local']['stats'];
  if (player.stats !== undefined) {
    const o = object(player.stats, 'players.local.stats', ['health', 'hunger', 'sanity', 'penalty', 'sanitySane', 'sanityMode']);
    if (o.sanitySane !== undefined && typeof o.sanitySane !== 'boolean') { fail('players.local.stats.sanitySane', 'expected boolean'); }
    stats = { health: number(o.health, 'players.local.stats.health'), hunger: number(o.hunger, 'players.local.stats.hunger'), sanity: number(o.sanity, 'players.local.stats.sanity'),
      ...o.penalty === undefined ? {} : { penalty: number(o.penalty, 'players.local.stats.penalty') },
      ...o.sanitySane === undefined ? {} : { sanitySane: o.sanitySane },
      ...o.sanityMode === undefined ? {} : { sanityMode: choice(o.sanityMode, 'players.local.stats.sanityMode', [0, 1]) } };
  }
  const systemsData = object(world.systems, 'world.systems', ['clock', 'season', 'worldtemperature', 'weather', 'nightmareclock', 'moon', 'random']);
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
    if (o.daylight !== undefined && typeof o.daylight !== 'boolean') { fail(`${path}.daylight`, 'expected a boolean'); }
    systems.worldtemperature = {
      ...(o.daylight === undefined ? {} : { daylight: o.daylight }),
      season: choice(o.season, `${path}.season`, ['autumn', 'winter', 'spring', 'summer']),
      seasontemperature: number(o.seasontemperature, `${path}.seasontemperature`, -Number.MAX_SAFE_INTEGER),
      phasetemperature: number(o.phasetemperature, `${path}.phasetemperature`, -Number.MAX_SAFE_INTEGER),
      noisetime: number(o.noisetime, `${path}.noisetime`),
    };
  }
  if (systemsData.weather !== undefined) {
    const path = 'world.systems.weather';
    const o = object(systemsData.weather, path, ['moisture', 'moisturefloor', 'moistureceil', 'preciptype', 'peakprecipitationrate', 'snowlevel']);
    systems.weather = {
      moisture: number(o.moisture, `${path}.moisture`), moisturefloor: number(o.moisturefloor, `${path}.moisturefloor`),
      moistureceil: number(o.moistureceil, `${path}.moistureceil`),
      preciptype: choice(o.preciptype, `${path}.preciptype`, ['none', 'rain', 'snow']),
      peakprecipitationrate: number(o.peakprecipitationrate, `${path}.peakprecipitationrate`, 0, 1),
      ...(o.snowlevel === undefined ? {} : { snowlevel: number(o.snowlevel, `${path}.snowlevel`, 0, 1) }),
    };
  }
  if (systemsData.nightmareclock !== undefined) {
    const path = 'world.systems.nightmareclock';
    const phases = ['calm', 'warn', 'wild', 'dawn'] as const;
    const o = object(systemsData.nightmareclock, path, ['lengths', 'phase', 'totaltimeinphase', 'remainingtimeinphase', 'lockedphase']);
    const lengths = object(o.lengths, `${path}.lengths`, phases);
    systems.nightmareclock = {
      // net_smallbyte, in segs.
      lengths: {
        calm: integer(lengths.calm, `${path}.lengths.calm`, 0, 63), warn: integer(lengths.warn, `${path}.lengths.warn`, 0, 63),
        wild: integer(lengths.wild, `${path}.lengths.wild`, 0, 63), dawn: integer(lengths.dawn, `${path}.lengths.dawn`, 0, 63),
      },
      phase: choice(o.phase, `${path}.phase`, phases),
      totaltimeinphase: number(o.totaltimeinphase, `${path}.totaltimeinphase`),
      remainingtimeinphase: number(o.remainingtimeinphase, `${path}.remainingtimeinphase`),
      ...(o.lockedphase === undefined ? {} : { lockedphase: choice(o.lockedphase, `${path}.lockedphase`, phases) }),
    };
  }
  if (systemsData.moon !== undefined) {
    const o = object(systemsData.moon, 'world.systems.moon', ['mooomphasecycle']);
    systems.moon = { mooomphasecycle: integer(o.mooomphasecycle, 'world.systems.moon.mooomphasecycle', 1, 20) };
  }
  if (systemsData.random !== undefined) {
    const o = object(systemsData.random, 'world.systems.random', ['algorithm', 'state']);
    const state = array(o.state, 'world.systems.random.state', 4).map((value, i) => integer(value, `world.systems.random.state[${i}]`, 0, 0xffffffff));
    if (state.length !== 4 || state.every((value) => value === 0)) { fail('world.systems.random.state', 'expected four nonzero-state uint32 words'); }
    systems.random = { algorithm: choice(o.algorithm, 'world.systems.random.algorithm', ['xoshiro128ss']), state };
  }
  return {
    format: 'three-roaming-save', schemaVersion: 1,
    gameVersion: string(root.gameVersion, 'gameVersion'),
    session: { id: string(session.id, 'session.id'), createdAt: timestamp(session.createdAt, 'session.createdAt'),
      ...(playerFile === undefined ? {} : { playerFile }) },
    snapshot: { id, parentId, savedAt: timestamp(snapshot.savedAt, 'snapshot.savedAt'), reason: choice(snapshot.reason, 'snapshot.reason', ['initial', 'manual', 'autosave']) },
    world: {
      shardId, prefab: choice(world.prefab, 'world.prefab', ['forest', 'cave']),
      ...(world.seed === undefined ? {} : { seed: string(world.seed, 'world.seed') }),
      elapsedSeconds: number(world.elapsedSeconds, 'world.elapsedSeconds'), systems,
      map: {
        kind: choice(map.kind, 'world.map.kind', ['generated']),
        ...(defaultTileId === undefined ? {} : { defaultTileId }),
        ...(tiles === undefined ? {} : { tiles }),
        ...(topology === undefined ? {} : { topology }),
        generator: {
          id: string(generator.id, 'world.map.generator.id'),
          ...(generator.seed === undefined ? {} : { seed: string(generator.seed, 'world.map.generator.seed') }),
          options: {
            size, moonTreeCount: integer(options.moonTreeCount, 'world.map.generator.options.moonTreeCount'),
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
        ...(player.ghost === undefined ? {} : { ghost: ghostFlag(player.ghost) }),
        ...(player.wortox === undefined ? {} : { wortox: (() => {
          const saved = object(player.wortox, 'players.local.wortox', ['freehops', 'soulhopcost']);
          return { freehops: integer(saved.freehops, 'players.local.wortox.freehops', 0, 7),
            soulhopcost: number(saved.soulhopcost, 'players.local.wortox.soulhopcost', 0) };
        })() }),
        inventory,
        builder: { bufferedBuilds },
      },
    },
  };
}
