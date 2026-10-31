import { BERNIE_ITEM_ID } from '@dontstarve-web/prefab/bernie';
import { HEATROCK_ID } from '@dontstarve-web/prefab/heatrock';
import { GROUND_ART_DEFINITIONS, GROUND_ART_VARIANTS, GROUND_ART_SPAWN_IDS, TURF_ITEM_IDS } from '@dontstarve-web/prefab/groundItems';
import { BURNABLE_ITEM_DEFINITIONS } from '@dontstarve-web/prefab/burnableItems';
import { BANANAJUICE_ID, MUSHROOM_ITEM_IDS } from '@dontstarve-web/prefab/food';
import { BIRD_IDS } from '@dontstarve-web/prefab/birds';
import { VEGGIE_ITEM_IDS } from '@dontstarve-web/prefab/veggies';
import { FARM_PLOW_ID, FARM_PLOW_ITEM_ID, FARM_DECOR_IDS, PLANTED_SEED_IDS } from '@dontstarve-web/prefab/farm_plow';
import { DWARF_STAR_DURATION, POLAR_LIGHT_DURATION, POLAR_LIGHT_ID } from '@dontstarve-web/prefab/stafflight';
import { BULB_PLANT_PREFABS, BULB_PLANT_VARIANTS } from '@dontstarve-web/prefab/bulb_plant';
import { ROCK_ENTITY_IDS, rockArchives } from '@dontstarve-web/prefab/rocks';
import { MARBLESHRUB_ID, MARBLESHRUB_SPAWN_IDS, MARBLESHRUB_MAX_GROW_TIME } from '@dontstarve-web/prefab/marbleshrub';
import { ARCHIVE_PROP_IDS, ARCHIVE_PROP_SPAWN_IDS, ARCHIVE_MOON_STATUE_ID, ARCHIVE_RUNE_STATUE_ID } from '@dontstarve-web/prefab/archive_props';
import { HOUNDBONE_ID } from '@dontstarve-web/prefab/houndbone';
import { BEEQUEENHIVEGROWN_ID, BEEQUEEN_HIVE_MAX_WORK } from '@dontstarve-web/prefab/beequeenhivegrown';
import { DRAGONFLY_ID } from '@dontstarve-web/prefab/dragonfly';
import { DRAGONFLY_SPAWNER_ID } from '@dontstarve-web/prefab/dragonfly_spawner';
import { STATUEGLOMMER_ID, STATUEGLOMMER_WORK } from '@dontstarve-web/prefab/statueglommer';
import { ATRIUM_GATE_ID, ATRIUM_GATE_TIMER_NAMES } from '@dontstarve-web/prefab/atrium_gate';
import { RUINS_STATUE_MAGE_ID, RUINS_STATUE_HEAD_NOGEM_ID, RUINS_STATUE_GEMS } from '@dontstarve-web/prefab/ruins_statue_mage';
import { ATRIUM_STATUE_ID } from '@dontstarve-web/prefab/atrium_statue';
import { CHESSJUNK_IDS } from '@dontstarve-web/prefab/chessjunk';
import { parseDragonflyState } from './save/dragonfly';
import { SKELETON_IDS, SKELETON_ANIMS, SKELETON_PLAYER_ID } from '@dontstarve-web/prefab/skeleton';
import { MARBLEBEAN_SAPLING_ID } from '@dontstarve-web/prefab/marblebean_sapling';
import { ROCK_AVOCADO_SAPLING_ID, ROCK_AVOCADO_SPROUT_GROW_TIME } from '@dontstarve-web/prefab/rock_avocado_fruit_sprout_sapling';
import { ROCK_AVOCADO_BUSH_ID, ROCK_AVOCADO_FRUIT_ID } from '@dontstarve-web/prefab/rock_avocado_bush';
import { BERRYBUSH_DEFINITION, BERRYBUSH_ID, BERRYBUSH_MAX_REGROW_TIME, BERRYBUSH_SKINS } from '@dontstarve-web/prefab/berrybush';
import { MONKEYTAIL_ID, MONKEYTAIL_REGROW_TIME } from '@dontstarve-web/prefab/monkeytail';
import { GRASS_CYCLES, GRASS_DEFINITION, GRASS_ID, GRASS_REGROW_TIME } from '@dontstarve-web/prefab/grass';
import { SAPLING_PREFABS, SAPLING_REGROW_TIME } from '@dontstarve-web/prefab/sapling';
import { POND_ID } from '@dontstarve-web/prefab/pond';
import { TRINKET_IDS } from '@dontstarve-web/prefab/trinkets';
import { TUMBLEWEED_ID } from '@dontstarve-web/prefab/tumbleweed';
import { HOTSPRING_ID } from '@dontstarve-web/prefab/hotspring';
import { LAVA_POND_ID, LAVA_POND_ROCK_IDS } from '@dontstarve-web/prefab/lava_pond';
import { WORMHOLE_ID } from '@dontstarve-web/prefab/wormhole';
import { PORTAL_ID } from '@dontstarve-web/prefab/portal';
import { NIGHTMAREGROWTH_ID } from '@dontstarve-web/prefab/nightmaregrowth';
import { NIGHTMAREROCK_IDS } from '@dontstarve-web/prefab/nightmarerock';
import { CAVE_ENTRANCE_IDS } from '@dontstarve-web/prefab/cave_entrance';
import { CAVE_EXIT_IDS } from '@dontstarve-web/prefab/cave_exit';
import { GROTTO_IDS } from '@dontstarve-web/prefab/grotto_pool';
import { CAVE_FERN_ANIMATIONS, CAVE_FERN_DEFINITIONS, CAVE_FERN_IDS } from '@dontstarve-web/prefab/cave_fern';
import { CACTUS_DEFINITIONS, CACTUS_IDS, CACTUS_REGROW_TIME } from '@dontstarve-web/prefab/cactus';
import { MUSHROOM_PLANT_IDS } from '@dontstarve-web/prefab/mushroom_plant';
import { MUSHTREE_IDS, MUSHTREE_SPAWN_IDS, MUSHTREE_GROWTH_STAGES, MUSHTREE_GROWTH_TIME } from '@dontstarve-web/prefab/mushtree';
import { TENT_ID, TENT_USES } from '@dontstarve-web/prefab/tent';
import { PLACEABLE_BUILDING_IDS } from './placeableBuilding';
import { FENCE_ID, FENCE_ITEM_ID } from '@dontstarve-web/prefab/fenceSkins';
import type { AnimationArchiveSpec } from '@dontstarve-web/animation/preloadArchives';
import definitions from '@dontstarve-web/prefab/definitions.json' with { type: 'json' };
import { componentParser, type PrefabComponentParser } from './save/prefabComponents';
import { fail } from './save/validation';
import { array, integer, number, object, string } from './save/validation';

/** Pure definitions are available before loading a save or constructing a scene. */
export interface PrefabDefinition<Id extends string = string> {
  readonly prefabIds: readonly Id[];
  readonly debugSpawnIds: readonly Id[];
  readonly parseComponents: PrefabComponentParser;
  /** Archives a saved instance needs, so a scan of the save can warm the decoders before restore. */
  readonly archives: (prefabId: string, records: readonly unknown[]) => readonly AnimationArchiveSpec[];
}

export function definePrefabs<const Id extends string>(
  prefabIds: readonly Id[], parseComponents: PrefabComponentParser, debugSpawn: readonly Id[] | true = [],
  archives: readonly AnimationArchiveSpec[] | ((prefabId: Id, records: readonly unknown[]) => readonly AnimationArchiveSpec[]) = [],
): PrefabDefinition<Id> {
  const debugSpawnIds = debugSpawn === true ? prefabIds : debugSpawn;
  if (new Set(prefabIds).size !== prefabIds.length || new Set(debugSpawnIds).size !== debugSpawnIds.length) {
    throw new Error('Duplicate prefab ID in definition');
  }
  return Object.freeze({ prefabIds: Object.freeze([...prefabIds]), debugSpawnIds: Object.freeze([...debugSpawnIds]), parseComponents,
    archives: (typeof archives === 'function' ? archives : () => archives) as PrefabDefinition['archives'] });
}

/** Base art only; skins load when applied. definitions.json supplies each archive's bank and build. */
function buildingArchives(prefab: string): readonly AnimationArchiveSpec[] {
  if (prefab === FENCE_ID) return [{ animation: 'fence.zip', build: 'fence.zip' }, { animation: 'fence_thin.zip', build: 'fence.zip' }];
  const spec: { archive: string; buildArchive?: string } | undefined = Object.hasOwn(definitions.animatedBuildings, prefab)
    ? definitions.animatedBuildings[prefab as keyof typeof definitions.animatedBuildings]
    : Object.hasOwn(definitions.walls, prefab) ? definitions.walls[prefab as keyof typeof definitions.walls] : undefined;
  return spec ? [{ animation: spec.archive, build: spec.buildArchive ?? spec.archive }] : [];
}

/** Ground items share one saved prefab; the catalog entry named by each record's stack supplies its art. */
function groundItemArchives(_prefab: string, records: readonly unknown[]): readonly AnimationArchiveSpec[] {
  const specs: AnimationArchiveSpec[] = [];
  for (const record of records as { components?: { stack?: { itemId?: string; skinId?: string; variant?: string } } }[]) {
    const stack = record.components?.stack;
    const item = stack?.itemId !== undefined && Object.hasOwn(GROUND_ART_DEFINITIONS, stack.itemId)
      ? { ...GROUND_ART_DEFINITIONS[stack.itemId], ...GROUND_ART_VARIANTS[stack.itemId]?.[stack.variant ?? ''] } : undefined;
    if (!item) continue;
    for (const build of item.buildArchives) specs.push({ animation: item.animationArchive, build });
    for (const { archive } of Object.values(item.symbolOverrides)) specs.push({ animation: item.animationArchive, build: archive });
    const skin = stack!.skinId !== undefined && Object.hasOwn(item.skinArchives, stack!.skinId)
      ? item.skinArchives[stack!.skinId] : undefined;
    if (skin) specs.push(skin);
  }
  return specs;
}

const empty = componentParser({ keys: [] });
const archiveStatue = componentParser({ keys: ['archiveProp'], archivePropVariants: 4 });
const archiveRune = componentParser({ keys: ['archiveProp'], archivePropVariants: 3, archiveStoryLines: 5 });
const farmSoil = componentParser({ keys: ['farmSoil'] });
const farmDebris = componentParser({ keys: ['farmDebris'] });
const building = componentParser({ keys: ['building'] });
const storage = componentParser({ keys: ['building', 'container'] });
const sculptingTable = componentParser({ keys: ['building', 'sculptingtable'] });
const birdcage = componentParser({ keys: ['building', 'birdcage'] });
const lightningRod = componentParser({ keys: ['building', 'lightningrod'] });
const firepit = componentParser({ keys: ['building', 'firepit'] });
const moonbase = componentParser({ keys: ['building', 'workable', 'moonbase'] });
const tent = componentParser({ keys: ['building', 'finiteuses'], finiteUses: TENT_USES });
const cookPot = componentParser({ keys: ['building', 'container', 'stewer'] });
const wall = componentParser({ keys: ['wall', 'health'] });
const fence = componentParser({ keys: ['fence'] });
const bulbSingle = componentParser({ keys: ['bulbPlant'], bulbVariants: ['single', 'springy'] });
const bulbDouble = componentParser({ keys: ['bulbPlant'], bulbVariants: ['double'] });
const bulbTriple = componentParser({ keys: ['bulbPlant'], bulbVariants: ['triple'] });
const caveinBoulder = componentParser({ keys: ['caveinBoulder'] });
const beeQueenHiveComponents: PrefabComponentParser = (value, path) => {
  const data = object(value, path, ['workable', 'beeQueenHiveTimer']);
  const components: ReturnType<PrefabComponentParser> = {};
  if (data.workable !== undefined) {
    const work = object(data.workable, `${path}.workable`, ['maxwork', 'workleft']);
    const maximum = number(work.maxwork, `${path}.workable.maxwork`, BEEQUEEN_HIVE_MAX_WORK, BEEQUEEN_HIVE_MAX_WORK);
    components.workable = { maxwork: maximum, workleft: number(work.workleft, `${path}.workable.workleft`, 0, maximum) };
  }
  if (data.beeQueenHiveTimer !== undefined) {
    const timer = object(data.beeQueenHiveTimer, `${path}.beeQueenHiveTimer`, ['timers']);
    const timers = object(timer.timers, `${path}.beeQueenHiveTimer.timers`, ['hiveregen']);
    const regen = object(timers.hiveregen, `${path}.beeQueenHiveTimer.timers.hiveregen`, ['timeleft', 'paused', 'initial_time']);
    if (typeof regen.paused !== 'boolean') fail(`${path}.beeQueenHiveTimer.timers.hiveregen.paused`, 'expected boolean');
    const duration = number(regen.initial_time, `${path}.beeQueenHiveTimer.timers.hiveregen.initial_time`, 0, 120);
    components.beeQueenHiveTimer = { timers: { hiveregen: {
      timeleft: number(regen.timeleft, `${path}.beeQueenHiveTimer.timers.hiveregen.timeleft`, 0, duration),
      paused: regen.paused, initial_time: duration,
    } } };
  }
  return components;
};

/** One declaration supplies saved IDs, debug aliases and component schemas to both consumers. */
export const PREFAB_DEFINITIONS = {
  farmPlow: definePrefabs([FARM_PLOW_ID], componentParser({ keys: ['farmPlow'] }), true),
  plantedSeeds: definePrefabs(PLANTED_SEED_IDS, empty, true),
  farmDecor: definePrefabs(FARM_DECOR_IDS, (value, path, context) =>
    (context.prefab === 'farm_soil' ? farmSoil : farmDebris)(value, path, context), true),
  moonTrees: definePrefabs(['moon_tree'], componentParser({ keys: ['moonTree', 'growable', 'moonTreeTimer'] }),
    ['moon_tree', 'moon_tree_short', 'moon_tree_normal', 'moon_tree_tall'],
    [definitions.moonTree.archive, 'tree_petal_fx.zip', 'baby_moon_tree.zip', 'snow.zip']),
  moonTreeSaplings: definePrefabs(['moonbutterfly_sapling'], componentParser({ keys: ['saplingTimer'] }), true,
    ['baby_moon_tree.zip']),
  deciduousTrees: definePrefabs(['deciduoustree'], componentParser({ keys: ['deciduoustree', 'growable', 'deciduousTimer'] }),
    ['deciduoustree', 'deciduoustree_short', 'deciduoustree_normal', 'deciduoustree_tall'], [
      { animation: 'tree_leaf_trunk_build.zip', build: 'tree_leaf_trunk_build.zip' },
      ...['short', 'normal', 'tall'].map(stage => ({ animation: `tree_leaf_${stage}.zip`, build: 'tree_leaf_trunk_build.zip' })),
      ...['green', 'red', 'orange', 'yellow'].flatMap(color => [`tree_leaf_${color}_build.zip`, `tree_leaf_fx_${color}.zip`]),
      'snow.zip',
    ]),
  evergreens: definePrefabs(['evergreen'], componentParser({ keys: ['evergreen', 'growable', 'evergreenTimer'], growthStages: 4 }),
    ['evergreen', 'evergreen_short', 'evergreen_normal', 'evergreen_tall'], [
      { animation: 'evergreen_short_normal.zip', build: 'evergreen_new.zip' },
      { animation: 'evergreen_tall_old.zip', build: 'evergreen_new.zip' }, 'pine_needles.zip',
    ]),
  pigKings: definePrefabs(['pigking'], empty, true, [definitions.pigKing.archive]),
  glommerStatues: definePrefabs([STATUEGLOMMER_ID], (value, path) => {
    const data = object(value, path, ['statueglommer', 'pickable', 'workable']);
    const components: import('./save/types').SavedEntity['components'] = {};
    if (data.statueglommer !== undefined) {
      const state = object(data.statueglommer, `${path}.statueglommer`, ['worked', 'spawned']);
      for (const key of ['worked', 'spawned'] as const) if (state[key] !== undefined && state[key] !== true)
        fail(`${path}.statueglommer.${key}`, 'expected true');
      components.statueglommer = { ...(state.worked ? { worked: true } : {}), ...(state.spawned ? { spawned: true } : {}) };
    }
    if (data.pickable !== undefined) {
      const state = object(data.pickable, `${path}.pickable`, ['picked', 'caninteractwith']);
      if (state.picked !== undefined && state.picked !== true) fail(`${path}.pickable.picked`, 'expected true');
      if (state.caninteractwith !== undefined && state.caninteractwith !== true)
        fail(`${path}.pickable.caninteractwith`, 'expected true');
      components.pickable = { ...(state.picked ? { picked: true } : {}),
        ...(state.caninteractwith ? { caninteractwith: true } : {}) };
    }
    if (data.workable !== undefined) {
      const state = object(data.workable, `${path}.workable`, ['maxwork', 'workleft']);
      if (state.maxwork !== -1) fail(`${path}.workable.maxwork`, 'expected -1');
      components.workable = { maxwork: -1, workleft: number(state.workleft, `${path}.workable.workleft`, 0, STATUEGLOMMER_WORK) };
    }
    return components;
  }, true, ['glommer_statue.zip', 'glommer_swap_flower.zip']),
  atriumGates: definePrefabs([ATRIUM_GATE_ID], (value, path) => {
    const data = object(value, path, ['atriumGate', 'pickable', 'charliecutscene', 'worldsettingstimer', 'entitytracker']);
    const components: import('./save/types').SavedEntity['components'] = {};
    const flags = (value: unknown, field: string, keys: readonly string[]) => {
      const record = object(value, field, keys);
      for (const [key, flag] of Object.entries(record)) if (flag !== true) fail(`${field}.${key}`, 'expected true');
      return record;
    };
    if (data.atriumGate !== undefined) components.atriumGate = flags(data.atriumGate, `${path}.atriumGate`,
      ['vault_key_socketed', 'can_spawn_charlie_hand_keystone', 'launch_key']) as typeof components.atriumGate;
    if (data.pickable !== undefined) components.pickable = flags(data.pickable, `${path}.pickable`,
      ['picked', 'paused', 'caninteractwith']) as typeof components.pickable;
    if (data.charliecutscene !== undefined) components.charliecutscene = flags(data.charliecutscene, `${path}.charliecutscene`,
      ['running', 'gatefixed']) as typeof components.charliecutscene;
    if (data.worldsettingstimer !== undefined) {
      const timer = object(data.worldsettingstimer, `${path}.worldsettingstimer`, ['timers']);
      const entries = object(timer.timers, `${path}.worldsettingstimer.timers`, ATRIUM_GATE_TIMER_NAMES);
      const timers: NonNullable<typeof components.worldsettingstimer>['timers'] = {};
      for (const name of ATRIUM_GATE_TIMER_NAMES) if (entries[name] !== undefined) {
        const field = `${path}.worldsettingstimer.timers.${name}`;
        const item = object(entries[name], field, ['timeleft', 'paused', 'blocklongupdate', 'initial_time']);
        if (typeof item.paused !== 'boolean' || (item.blocklongupdate !== undefined && typeof item.blocklongupdate !== 'boolean'))
          fail(field, 'expected boolean timer flags');
        timers[name] = { timeleft: number(item.timeleft, `${field}.timeleft`, 0, 1), paused: item.paused,
          ...(item.blocklongupdate === undefined ? {} : { blocklongupdate: item.blocklongupdate }),
          ...(item.initial_time === undefined ? {} : { initial_time: number(item.initial_time, `${field}.initial_time`, 0, 9600) }) };
      }
      components.worldsettingstimer = { timers };
    }
    if (data.entitytracker !== undefined) {
      const tracker = object(data.entitytracker, `${path}.entitytracker`, ['entities']);
      if (!Array.isArray(tracker.entities)) fail(`${path}.entitytracker.entities`, 'expected array');
      components.entitytracker = { entities: tracker.entities.map((entry: unknown, index: number) => {
        const field = `${path}.entitytracker.entities.${index}`, item = object(entry, field, ['name', 'GUID']);
        if (item.name !== 'stalker' && item.name !== 'charlie_hand') fail(`${field}.name`, 'unsupported target');
        return { name: item.name, GUID: number(item.GUID, `${field}.GUID`, 0, Number.MAX_SAFE_INTEGER) };
      }) };
    }
    return components;
  }, true, ['atrium_gate.zip', 'atrium_gate_build.zip', 'atrium_floor.zip', 'atrium_gate_overload_fx.zip']),
  ruinsStatueMages: definePrefabs([RUINS_STATUE_MAGE_ID], (value, path) => {
    const data = object(value, path, ['ruinsStatueMage']);
    const state = object(data.ruinsStatueMage, `${path}.ruinsStatueMage`, ['gem']);
    if (!RUINS_STATUE_GEMS.includes(state.gem as typeof RUINS_STATUE_GEMS[number]))
      fail(`${path}.ruinsStatueMage.gem`, 'unsupported ruins statue gem');
    return { ruinsStatueMage: { gem: state.gem as typeof RUINS_STATUE_GEMS[number] } };
  }, true, ['statue_ruins.zip', 'statue_ruins_gem.zip']),
  // statueruins.lua nogem(true): onsave writes gem = nil.
  ruinsStatueHeadsNoGem: definePrefabs([RUINS_STATUE_HEAD_NOGEM_ID], empty, true, ['statue_ruins_small.zip']),
  // atrium_statue.lua has no OnSave data.
  atriumStatues: definePrefabs([ATRIUM_STATUE_ID], empty, true, ['atrium_statue.zip']),
  chessJunk: definePrefabs(CHESSJUNK_IDS, (value, path) => {
    const data = object(value, path, ['chessJunk']);
    if (data.chessJunk === undefined) return {};
    const state = object(data.chessJunk, `${path}.chessJunk`, ['repaired', 'repairerid', 'repairerchar']);
    if (state.repaired !== true) fail(`${path}.chessJunk.repaired`, 'expected true');
    for (const field of ['repairerid', 'repairerchar'] as const)
      if (state[field] !== undefined && typeof state[field] !== 'string') fail(`${path}.chessJunk.${field}`, 'expected string');
    return { chessJunk: { repaired: true,
      ...(state.repairerid === undefined ? {} : { repairerid: state.repairerid as string }),
      ...(state.repairerchar === undefined ? {} : { repairerchar: state.repairerchar as string }) } };
  }, true, ['chessmonster_ruins.zip']),
  buildings: definePrefabs(PLACEABLE_BUILDING_IDS.filter((id) => !id.endsWith('_item')), (value, path, context) => {
    const spec = Object.hasOwn(context.catalog.buildings, context.prefab) ? context.catalog.buildings[context.prefab] : undefined;
    if (spec) return (context.prefab === 'cookpot' ? cookPot : context.prefab === 'sculptingtable' ? sculptingTable
      : context.prefab === 'birdcage' ? birdcage : context.prefab === TENT_ID ? tent
      : context.prefab === 'moonbase' ? moonbase : context.prefab === 'lightning_rod' ? lightningRod
      : context.prefab === 'firepit' ? firepit : spec.container ? storage : building)(value, path, context);
    if (context.prefab === FENCE_ID) return fence(value, path, context);
    if (context.catalog.walls.includes(context.prefab)) return wall(value, path, context);
    return fail(path, `missing building definition for ${context.prefab}`);
  }, // fence_item is an ordinary ground item (c_spawn) and inventory item (c_give); only `fence` is placed by c_spawn.
    PLACEABLE_BUILDING_IDS.filter((id) => id !== FENCE_ITEM_ID), buildingArchives),
  groundItems: definePrefabs(['ground_item'], componentParser({ keys: ['stack', 'phonograph', 'torch', 'lantern'] }),
    [...new Set([...GROUND_ART_SPAWN_IDS, ROCK_AVOCADO_FRUIT_ID, ...TURF_ITEM_IDS, 'backpack', 'armorsnurtleshell', 'amulet', 'fireflies', 'lightflier', ...BIRD_IDS, 'bird_egg', 'rottenegg', 'smallmeat', 'pondfish', HEATROCK_ID, BERNIE_ITEM_ID, FARM_PLOW_ITEM_ID, 'torch', 'lantern', 'lightbulb', 'phonograph', 'record', 'seeds', ...VEGGIE_ITEM_IDS, 'meatballs', BANANAJUICE_ID, 'bananapop', ...MUSHROOM_ITEM_IDS, 'spoiled_food', 'farm_hoe', 'golden_farm_hoe', 'shovel', 'goldenshovel', 'pickaxe', 'goldenpickaxe', 'nightsword', 'dreadstone', 'wagpunk_bits', 'cutstone', 'marble', 'marblebean', 'moonrocknugget', 'moonglass', 'hammer', 'axe', 'goldenaxe', 'moonglassaxe', 'fishingrod', 'moon_tree_blossom', 'cactus_flower', 'foliage', 'beardhair', 'cookingrecipecard', 'scrapbook_page', 'blueprint', ...TRINKET_IDS, 'pinecone', 'acorn', 'mole', 'butterfly', 'butterflywings', 'butter', 'petals', 'moonbutterfly', 'moonbutterflywings', 'bugnet', 'razor', 'panflute', 'reskin_tool', 'greenstaff', 'firestaff', 'trident', 'opalstaff', 'opalpreciousgem', ...Object.keys(BURNABLE_ITEM_DEFINITIONS), 'ash'])], groundItemArchives),
  flowers: definePrefabs(['flower'], componentParser({ keys: ['flower'] }), ['planted_flower'], ['flowers.zip']),
  dwarfStars: definePrefabs(['stafflight'], componentParser({ keys: ['timer'], timerDuration: DWARF_STAR_DURATION }), true),
  polarLights: definePrefabs([POLAR_LIGHT_ID], componentParser({ keys: ['timer'], timerDuration: POLAR_LIGHT_DURATION }), true),
  bulbPlants: definePrefabs(BULB_PLANT_PREFABS, (value, path, context) =>
    (context.prefab === 'flower_cave' ? bulbSingle : context.prefab === 'flower_cave_double' ? bulbDouble : bulbTriple)(value, path, context), true,
    BULB_PLANT_VARIANTS.map(variant => `bulb_plant_${variant}.zip`)),
  lightflierFlowers: definePrefabs(['lightflier_flower'], componentParser({ keys: ['lightflierFlower'] }), true, ['bulb_plant_single.zip', 'bulb_plant_springy.zip', 'lightflier.zip']),
  molehills: definePrefabs(['molehill'], componentParser({ keys: ['molehill'] }), true),
  beefalos: definePrefabs(['beefalo'], componentParser({ keys: ['beefalo'] }), true),
  rocks: definePrefabs(ROCK_ENTITY_IDS, (value, path, context) =>
    (context.prefab === 'cavein_boulder' ? caveinBoulder : empty)(value, path, context), true,
    prefab => rockArchives(prefab)),
  caveEntrances: definePrefabs(CAVE_ENTRANCE_IDS, empty, true, ['cave_entrance.zip']),
  mushroomPlants: definePrefabs(MUSHROOM_PLANT_IDS, componentParser({ keys: ['pickable', 'mushroom'] }), true, ['mushrooms.zip', 'fire.zip']),
  mushtrees: definePrefabs(MUSHTREE_IDS, componentParser({ keys: ['mushtree', 'growable'], growthStages: MUSHTREE_GROWTH_STAGES,
    growthTime: Math.max(...MUSHTREE_GROWTH_TIME.map(({ base, random }) => base + random)) }), MUSHTREE_SPAWN_IDS,
    ['mushroom_tree_tall.zip', 'mushroom_tree_tall_bloom.zip', 'mutatedmushroom_tree_build.zip', 'mushroom_tree_med.zip', 'mushroom_tree_med_bloom.zip', 'fire.zip']),
  caveExits: definePrefabs(CAVE_EXIT_IDS, empty, true, ['cave_exit.zip']),
  grottoPools: definePrefabs(GROTTO_IDS, componentParser({ keys: ['grottoPool', 'grottoGlass'], grottoChildren: 5 }), true,
    ['moonglasspool_tile.zip', 'moonglass_bigwaterfall.zip', 'moonglass_bigwaterfall_steam.zip', 'moon_tea_fx.zip']),
  archiveProps: definePrefabs(ARCHIVE_PROP_IDS, (value, path, context) =>
    context.prefab === ARCHIVE_MOON_STATUE_ID ? archiveStatue(value, path, context)
      : context.prefab === ARCHIVE_RUNE_STATUE_ID ? archiveRune(value, path, context) : empty(value, path, context), ARCHIVE_PROP_SPAWN_IDS,
    (prefab) => prefab === ARCHIVE_MOON_STATUE_ID ? [{ animation: 'archive_moon_statue.zip', build: 'archive_moon_statue.zip' }, 'structure_collapse_fx.zip']
      : prefab === ARCHIVE_RUNE_STATUE_ID ? ['archive_runes.zip']
      : prefab === 'archive_portal' ? ['archive_portal.zip', 'archive_portal_base.zip']
      : prefab === 'archive_switch_base' ? ['archive_switch_ground.zip'] : []),
  skeletons: definePrefabs(SKELETON_IDS, (value, path, context) =>
    componentParser({ keys: ['skeleton'], skeletonAnims: SKELETON_ANIMS[context.prefab as keyof typeof SKELETON_ANIMS], skeletonDescribed: context.prefab === SKELETON_PLAYER_ID })(value, path, context), true, ['skeletons.zip', 'structure_collapse_fx.zip']),
  houndbones: definePrefabs([HOUNDBONE_ID], componentParser({ keys: ['houndbone'] }), true, ['hound_base.zip', 'structure_collapse_fx.zip']),
  beeQueenHives: definePrefabs([BEEQUEENHIVEGROWN_ID], beeQueenHiveComponents, true, ['bee_queen_hive.zip']),
  dragonflies: definePrefabs([DRAGONFLY_ID], (value, path) => {
    const data = object(value, path, ['dragonfly']);
    return { dragonfly: parseDragonflyState(data.dragonfly, `${path}.dragonfly`) };
  }, true, [{ animation: 'dragonfly_basic.zip', build: 'dragonfly_build.zip' },
    { animation: 'dragonfly_actions.zip', build: 'dragonfly_build.zip' }]),
  dragonflySpawners: definePrefabs([DRAGONFLY_SPAWNER_ID], (value, path) => {
    const data = object(value, path, ['dragonflySpawner']);
    const state = object(data.dragonflySpawner, `${path}.dragonflySpawner`, ['childspawner', 'worldsettingstimer']);
    const child = object(state.childspawner, `${path}.dragonflySpawner.childspawner`,
      ['childreninside', 'childrenoutside', 'spawning', 'regening', 'queued_spawn', 'timetonextspawn', 'timetonextregen', 'emergencychildreninside']);
    const childspawner = {
      childreninside: integer(child.childreninside, `${path}.dragonflySpawner.childspawner.childreninside`, 0, 1),
      childrenoutside: child.childrenoutside === undefined ? [] : array(child.childrenoutside, `${path}.dragonflySpawner.childspawner.childrenoutside`, 1)
        .map((id, i) => string(id, `${path}.dragonflySpawner.childspawner.childrenoutside[${i}]`)),
      ...Object.fromEntries((['timetonextspawn', 'timetonextregen', 'emergencychildreninside'] as const)
        .filter(key => child[key] !== undefined).map(key => [key, number(child[key], `${path}.dragonflySpawner.childspawner.${key}`, 0)])),
      ...Object.fromEntries((['spawning', 'regening', 'queued_spawn'] as const)
        .filter(key => child[key] !== undefined).map(key => {
          if (typeof child[key] !== 'boolean') fail(`${path}.dragonflySpawner.childspawner.${key}`, 'expected boolean');
          return [key, child[key]];
        })),
    };
    let worldsettingstimer: import('@dontstarve-web/prefab/dragonfly_spawner').DragonflySpawnerSaveState['worldsettingstimer'];
    if (state.worldsettingstimer !== undefined) {
      const timer = object(state.worldsettingstimer, `${path}.dragonflySpawner.worldsettingstimer`, ['timers']);
      const timers = object(timer.timers, `${path}.dragonflySpawner.worldsettingstimer.timers`, ['regen_dragonfly']);
      const value = object(timers.regen_dragonfly, `${path}.dragonflySpawner.worldsettingstimer.timers.regen_dragonfly`,
        ['timeleft', 'paused', 'initial_time']);
      if (typeof value.paused !== 'boolean') fail(`${path}.dragonflySpawner.worldsettingstimer.paused`, 'expected boolean');
      worldsettingstimer = { timers: { regen_dragonfly: { timeleft: number(value.timeleft, `${path}.dragonflySpawner.worldsettingstimer.timeleft`, 0),
        paused: value.paused, initial_time: number(value.initial_time, `${path}.dragonflySpawner.worldsettingstimer.initial_time`, 0) } } };
    }
    return { dragonflySpawner: { childspawner, ...(worldsettingstimer ? { worldsettingstimer } : {}) } };
  }, true),
  marbleBeanSaplings: definePrefabs([MARBLEBEAN_SAPLING_ID], componentParser({ keys: ['saplingTimer'] }), true, ['marblebean.zip']),
  marbleShrubs: definePrefabs([MARBLESHRUB_ID], componentParser({ keys: ['growable', 'marbleShrub'], growthTime: MARBLESHRUB_MAX_GROW_TIME }), MARBLESHRUB_SPAWN_IDS,
    ['marbleshrub.zip', 'marbleshrub_build.zip']),
  rockAvocadoSaplings: definePrefabs([ROCK_AVOCADO_SAPLING_ID], componentParser({ keys: ['saplingTimer'], timerDuration: ROCK_AVOCADO_SPROUT_GROW_TIME }), true),
  rockAvocadoBushes: definePrefabs([ROCK_AVOCADO_BUSH_ID], componentParser({ keys: ['pickable', 'witherable', 'growable', 'burning'], regrowTime: 0, pickCycles: 3, minimumPickCycles: 3, growthStages: 4 }), true),
  berrybushes: definePrefabs([BERRYBUSH_ID], componentParser({ keys: ['pickable', 'witherable', 'plant'], regrowTime: BERRYBUSH_MAX_REGROW_TIME, pickCycles: 5, minimumPickCycles: 4, plantSkins: BERRYBUSH_SKINS }), true,
    [{ animation: BERRYBUSH_DEFINITION.animArchive, build: BERRYBUSH_DEFINITION.buildArchive }]),
  monkeytails: definePrefabs([MONKEYTAIL_ID], componentParser({ keys: ['pickable', 'witherable'], regrowTime: MONKEYTAIL_REGROW_TIME, pickCycles: 7 }), true),
  grasses: definePrefabs([GRASS_ID], componentParser({ keys: ['pickable', 'witherable'], regrowTime: GRASS_REGROW_TIME, pickCycles: GRASS_CYCLES, minimumPickCycles: GRASS_CYCLES }), true,
    [{ animation: GRASS_DEFINITION.animArchive, build: GRASS_DEFINITION.buildArchive }]),
  caveFerns: definePrefabs(CAVE_FERN_IDS, componentParser({ keys: ['pickable', 'variant'], plantVariants: CAVE_FERN_ANIMATIONS }), true,
    prefab => [{ animation: CAVE_FERN_DEFINITIONS[prefab].animArchive, build: CAVE_FERN_DEFINITIONS[prefab].buildArchive }]),
  cacti: definePrefabs(CACTUS_IDS, componentParser({ keys: ['pickable'], regrowTime: CACTUS_REGROW_TIME }), true,
    prefab => [{ animation: CACTUS_DEFINITIONS[prefab].animArchive, build: CACTUS_DEFINITIONS[prefab].buildArchive }]),
  saplings: definePrefabs(SAPLING_PREFABS, componentParser({ keys: ['pickable', 'witherable'], regrowTime: SAPLING_REGROW_TIME }), true),
  ponds: definePrefabs([POND_ID], componentParser({ keys: ['fishable'] }), true, ['marsh_tile.zip']),
  lavaPonds: definePrefabs([LAVA_POND_ID], componentParser({ keys: ['lavaPond'] }), true, ['lava_tile.zip', 'scorched_rock.zip']),
  lavaPondRocks: definePrefabs(LAVA_POND_ROCK_IDS, empty, true, ['scorched_rock.zip']),
  tumbleweeds: definePrefabs([TUMBLEWEED_ID], empty, true),
  hotsprings: definePrefabs([HOTSPRING_ID], componentParser({ keys: ['hotspring'] }), true, ['crater_pool.zip', 'crater_steam.zip', 'slow_steam.zip']),
  nightmareGrowths: definePrefabs([NIGHTMAREGROWTH_ID], componentParser({ keys: ['nightmareGrowth'] }), true, ['nightmaregrowth.zip']),
  nightmareRocks: definePrefabs(NIGHTMAREROCK_IDS, empty, true),
  wormholes: definePrefabs([WORMHOLE_ID], componentParser({ keys: ['wormhole'] }), true),
  portals: definePrefabs([PORTAL_ID], empty, true),
  reskinEffects: definePrefabs([], empty),
  rain: definePrefabs([], empty),
  snow: definePrefabs([], empty),
  worldFx: definePrefabs([], empty, ['wortox_portal_jumpin_fx', 'wortox_portal_jumpout_fx', 'halloween_moonpuff']),
  staffProjectiles: definePrefabs([], empty),
  oceanWaves: definePrefabs([], empty),
  dockKit: definePrefabs([], empty),
} as const;

export function prefabSaveParsers(definitions: readonly PrefabDefinition[]): ReadonlyMap<string, PrefabComponentParser> {
  const parsers = new Map<string, PrefabComponentParser>();
  for (const definition of definitions) {
    for (const id of definition.prefabIds) {
      if (parsers.has(id)) throw new Error(`Duplicate saved prefab definition: ${id}`);
      parsers.set(id, definition.parseComponents);
    }
  }
  return parsers;
}

/** Archives for the prefab IDs present in a save; unlisted prefabs still load lazily when restored. */
export function savedPrefabArchives(
  definitions: readonly PrefabDefinition[], entities: Readonly<Record<string, readonly unknown[]>>,
): AnimationArchiveSpec[] {
  const archives = new Map<string, AnimationArchiveSpec>();
  for (const definition of definitions) {
    for (const id of definition.prefabIds) {
      if (!entities[id]?.length) continue;
      for (const spec of definition.archives(id, entities[id])) {
        archives.set(typeof spec === 'string' ? spec : `${spec.animation}\n${spec.build}`, spec);
      }
    }
  }
  return [...archives.values()];
}
