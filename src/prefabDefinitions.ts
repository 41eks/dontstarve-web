import { BERNIE_ITEM_ID } from '@dontstarve-web/prefab/bernie';
import { HEATROCK_ID } from '@dontstarve-web/prefab/heatrock';
import { GROUND_ITEM_DEFINITIONS, TURF_ITEM_IDS } from '@dontstarve-web/prefab/groundItems';
import { BURNABLE_ITEM_DEFINITIONS } from '@dontstarve-web/prefab/burnableItems';
import { BANANAJUICE_ID, MUSHROOM_ITEM_IDS } from '@dontstarve-web/prefab/food';
import { BIRD_IDS } from '@dontstarve-web/prefab/birds';
import { VEGGIE_ITEM_IDS } from '@dontstarve-web/prefab/veggies';
import { FARM_PLOW_ID, FARM_PLOW_ITEM_ID, FARM_DECOR_IDS, PLANTED_SEED_IDS } from '@dontstarve-web/prefab/farm_plow';
import { DWARF_STAR_DURATION, POLAR_LIGHT_DURATION, POLAR_LIGHT_ID } from '@dontstarve-web/prefab/stafflight';
import { BULB_PLANT_PREFABS, BULB_PLANT_VARIANTS } from '@dontstarve-web/prefab/bulb_plant';
import { ROCK_PREFABS } from '@dontstarve-web/prefab/rocks';
import { MARBLESHRUB_ID, MARBLESHRUB_SPAWN_IDS, MARBLESHRUB_MAX_GROW_TIME } from '@dontstarve-web/prefab/marbleshrub';
import { ARCHIVE_PROP_IDS, ARCHIVE_PROP_SPAWN_IDS, ARCHIVE_MOON_STATUE_ID, ARCHIVE_RUNE_STATUE_ID } from '@dontstarve-web/prefab/archive_props';
import { SKELETON_IDS, SKELETON_ANIMS, SKELETON_PLAYER_ID } from '@dontstarve-web/prefab/skeleton';
import { MARBLEBEAN_SAPLING_ID } from '@dontstarve-web/prefab/marblebean_sapling';
import { ROCK_AVOCADO_SAPLING_ID, ROCK_AVOCADO_SPROUT_GROW_TIME } from '@dontstarve-web/prefab/rock_avocado_fruit_sprout_sapling';
import { ROCK_AVOCADO_BUSH_ID, ROCK_AVOCADO_FRUIT_ID } from '@dontstarve-web/prefab/rock_avocado_bush';
import { BERRYBUSH_DEFINITION, BERRYBUSH_ID, BERRYBUSH_MAX_REGROW_TIME, BERRYBUSH_SKINS } from '@dontstarve-web/prefab/berrybush';
import { MONKEYTAIL_ID, MONKEYTAIL_REGROW_TIME } from '@dontstarve-web/prefab/monkeytail';
import { GRASS_DEFINITION, GRASS_ID, GRASS_REGROW_TIME } from '@dontstarve-web/prefab/grass';
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
import { TENT_ID, TENT_USES } from '@dontstarve-web/prefab/tent';
import { PLACEABLE_BUILDING_IDS } from './placeableBuilding';
import { FENCE_ID, FENCE_ITEM_ID } from '@dontstarve-web/prefab/fenceSkins';
import type { AnimationArchiveSpec } from '@dontstarve-web/animation/preloadArchives';
import definitions from '@dontstarve-web/prefab/definitions.json' with { type: 'json' };
import { componentParser, type PrefabComponentParser } from './save/prefabComponents';
import { fail } from './save/validation';

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
  for (const record of records as { components?: { stack?: { itemId?: string; skinId?: string } } }[]) {
    const stack = record.components?.stack;
    const item = stack?.itemId !== undefined && Object.hasOwn(GROUND_ITEM_DEFINITIONS, stack.itemId)
      ? GROUND_ITEM_DEFINITIONS[stack.itemId] : undefined;
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
const moonbase = componentParser({ keys: ['building', 'workable', 'moonbase'] });
const tent = componentParser({ keys: ['building', 'finiteuses'], finiteUses: TENT_USES });
const cookPot = componentParser({ keys: ['building', 'container', 'stewer'] });
const wall = componentParser({ keys: ['wall', 'health'] });
const fence = componentParser({ keys: ['fence'] });
const bulbSingle = componentParser({ keys: ['bulbPlant'], bulbVariants: ['single', 'springy'] });
const bulbDouble = componentParser({ keys: ['bulbPlant'], bulbVariants: ['double'] });
const bulbTriple = componentParser({ keys: ['bulbPlant'], bulbVariants: ['triple'] });

/** One declaration supplies saved IDs, debug aliases and component schemas to both consumers. */
export const PREFAB_DEFINITIONS = {
  farmPlow: definePrefabs([FARM_PLOW_ID], componentParser({ keys: ['farmPlow'] }), true),
  plantedSeeds: definePrefabs(PLANTED_SEED_IDS, empty, true),
  farmDecor: definePrefabs(FARM_DECOR_IDS, (value, path, context) =>
    (context.prefab === 'farm_soil' ? farmSoil : farmDebris)(value, path, context), true),
  moonTrees: definePrefabs(['moon_tree'], componentParser({ keys: ['moonTree', 'growable'] }),
    ['moon_tree', 'moon_tree_short', 'moon_tree_normal', 'moon_tree_tall'],
    [definitions.moonTree.archive, 'tree_petal_fx.zip', 'baby_moon_tree.zip', 'snow.zip']),
  moonTreeSaplings: definePrefabs(['moonbutterfly_sapling'], componentParser({ keys: ['saplingTimer'] }), true,
    ['baby_moon_tree.zip']),
  deciduousTrees: definePrefabs(['deciduoustree'], componentParser({ keys: ['deciduoustree', 'growable'] }),
    ['deciduoustree', 'deciduoustree_short', 'deciduoustree_normal', 'deciduoustree_tall'], [
      { animation: 'tree_leaf_trunk_build.zip', build: 'tree_leaf_trunk_build.zip' },
      ...['short', 'normal', 'tall'].map(stage => ({ animation: `tree_leaf_${stage}.zip`, build: 'tree_leaf_trunk_build.zip' })),
      ...['green', 'red', 'orange', 'yellow'].flatMap(color => [`tree_leaf_${color}_build.zip`, `tree_leaf_fx_${color}.zip`]),
    ]),
  evergreens: definePrefabs(['evergreen'], componentParser({ keys: ['evergreen', 'growable'], growthStages: 4 }),
    ['evergreen', 'evergreen_short', 'evergreen_normal', 'evergreen_tall'], [
      { animation: 'evergreen_short_normal.zip', build: 'evergreen_new.zip' },
      { animation: 'evergreen_tall_old.zip', build: 'evergreen_new.zip' }, 'pine_needles.zip',
    ]),
  pigKings: definePrefabs(['pigking'], empty, [], [definitions.pigKing.archive]),
  buildings: definePrefabs(PLACEABLE_BUILDING_IDS.filter((id) => !id.endsWith('_item')), (value, path, context) => {
    const spec = Object.hasOwn(context.catalog.buildings, context.prefab) ? context.catalog.buildings[context.prefab] : undefined;
    if (spec) return (context.prefab === 'cookpot' ? cookPot : context.prefab === 'sculptingtable' ? sculptingTable
      : context.prefab === 'birdcage' ? birdcage : context.prefab === TENT_ID ? tent
      : context.prefab === 'moonbase' ? moonbase : context.prefab === 'lightning_rod' ? lightningRod : spec.container ? storage : building)(value, path, context);
    if (context.prefab === FENCE_ID) return fence(value, path, context);
    if (context.catalog.walls.includes(context.prefab)) return wall(value, path, context);
    return fail(path, `missing building definition for ${context.prefab}`);
  }, // fence_item is an ordinary ground item (c_spawn) and inventory item (c_give); only `fence` is placed by c_spawn.
    PLACEABLE_BUILDING_IDS.filter((id) => id !== FENCE_ITEM_ID), buildingArchives),
  groundItems: definePrefabs(['ground_item'], componentParser({ keys: ['stack', 'phonograph', 'torch', 'lantern'] }),
    [ROCK_AVOCADO_FRUIT_ID, ...TURF_ITEM_IDS, 'backpack', 'armorsnurtleshell', 'amulet', 'fireflies', ...BIRD_IDS, 'bird_egg', 'rottenegg', 'smallmeat', 'pondfish', HEATROCK_ID, BERNIE_ITEM_ID, FARM_PLOW_ITEM_ID, 'torch', 'lantern', 'lightbulb', 'phonograph', 'record', 'seeds', ...VEGGIE_ITEM_IDS, 'meatballs', BANANAJUICE_ID, 'bananapop', ...MUSHROOM_ITEM_IDS, 'spoiled_food', 'farm_hoe', 'golden_farm_hoe', 'shovel', 'goldenshovel', 'pickaxe', 'goldenpickaxe', 'nightsword', 'dreadstone', 'wagpunk_bits', 'cutstone', 'marble', 'marblebean', 'moonrocknugget', 'hammer', 'axe', 'goldenaxe', 'moonglassaxe', 'fishingrod', 'moon_tree_blossom', 'foliage', 'beardhair', 'cookingrecipecard', 'scrapbook_page', 'blueprint', ...TRINKET_IDS, 'pinecone', 'acorn', 'mole', 'butterfly', 'butterflywings', 'butter', 'petals', 'moonbutterfly', 'moonbutterflywings', 'bugnet', 'razor', 'panflute', 'reskin_tool', 'greenstaff', 'firestaff', 'trident', 'opalstaff', 'opalpreciousgem', ...Object.keys(BURNABLE_ITEM_DEFINITIONS), 'ash'], groundItemArchives),
  flowers: definePrefabs(['flower'], componentParser({ keys: ['flower'] }), ['planted_flower'], ['flowers.zip']),
  dwarfStars: definePrefabs(['stafflight'], componentParser({ keys: ['timer'], timerDuration: DWARF_STAR_DURATION }), true),
  polarLights: definePrefabs([POLAR_LIGHT_ID], componentParser({ keys: ['timer'], timerDuration: POLAR_LIGHT_DURATION }), true),
  bulbPlants: definePrefabs(BULB_PLANT_PREFABS, (value, path, context) =>
    (context.prefab === 'flower_cave' ? bulbSingle : context.prefab === 'flower_cave_double' ? bulbDouble : bulbTriple)(value, path, context), true,
    BULB_PLANT_VARIANTS.map(variant => `bulb_plant_${variant}.zip`)),
  molehills: definePrefabs(['molehill'], componentParser({ keys: ['molehill'] }), true),
  beefalos: definePrefabs(['beefalo'], componentParser({ keys: ['beefalo'] }), true),
  rocks: definePrefabs(ROCK_PREFABS, empty, true),
  caveEntrances: definePrefabs(CAVE_ENTRANCE_IDS, empty, true, ['cave_entrance.zip']),
  archiveProps: definePrefabs(ARCHIVE_PROP_IDS, (value, path, context) =>
    context.prefab === ARCHIVE_MOON_STATUE_ID ? archiveStatue(value, path, context)
      : context.prefab === ARCHIVE_RUNE_STATUE_ID ? archiveRune(value, path, context) : empty(value, path, context), ARCHIVE_PROP_SPAWN_IDS,
    (prefab) => prefab === ARCHIVE_MOON_STATUE_ID ? [{ animation: 'archive_moon_statue.zip', build: 'archive_moon_statue.zip' }, 'structure_collapse_fx.zip']
      : prefab === ARCHIVE_RUNE_STATUE_ID ? ['archive_runes.zip']
      : prefab === 'archive_portal' ? ['archive_portal.zip', 'archive_portal_base.zip']
      : prefab === 'archive_switch_base' ? ['archive_switch_ground.zip'] : []),
  skeletons: definePrefabs(SKELETON_IDS, (value, path, context) =>
    componentParser({ keys: ['skeleton'], skeletonAnims: SKELETON_ANIMS[context.prefab as keyof typeof SKELETON_ANIMS], skeletonDescribed: context.prefab === SKELETON_PLAYER_ID })(value, path, context), true, ['skeletons.zip', 'structure_collapse_fx.zip']),
  marbleBeanSaplings: definePrefabs([MARBLEBEAN_SAPLING_ID], componentParser({ keys: ['saplingTimer'] }), true, ['marblebean.zip']),
  marbleShrubs: definePrefabs([MARBLESHRUB_ID], componentParser({ keys: ['growable', 'marbleShrub'], growthTime: MARBLESHRUB_MAX_GROW_TIME }), MARBLESHRUB_SPAWN_IDS,
    ['marbleshrub.zip', 'marbleshrub_build.zip']),
  rockAvocadoSaplings: definePrefabs([ROCK_AVOCADO_SAPLING_ID], componentParser({ keys: ['saplingTimer'], timerDuration: ROCK_AVOCADO_SPROUT_GROW_TIME }), true),
  rockAvocadoBushes: definePrefabs([ROCK_AVOCADO_BUSH_ID], componentParser({ keys: ['pickable', 'witherable', 'growable', 'burning'], regrowTime: 0, pickCycles: 3, minimumPickCycles: 3, growthStages: 4 }), true),
  berrybushes: definePrefabs([BERRYBUSH_ID], componentParser({ keys: ['pickable', 'witherable', 'plant'], regrowTime: BERRYBUSH_MAX_REGROW_TIME, pickCycles: 5, minimumPickCycles: 4, plantSkins: BERRYBUSH_SKINS }), true,
    [{ animation: BERRYBUSH_DEFINITION.animArchive, build: BERRYBUSH_DEFINITION.buildArchive }]),
  monkeytails: definePrefabs([MONKEYTAIL_ID], componentParser({ keys: ['pickable', 'witherable'], regrowTime: MONKEYTAIL_REGROW_TIME, pickCycles: 7 }), true),
  grasses: definePrefabs([GRASS_ID], componentParser({ keys: ['pickable'], regrowTime: GRASS_REGROW_TIME }), true,
    [{ animation: GRASS_DEFINITION.animArchive, build: GRASS_DEFINITION.buildArchive }]),
  saplings: definePrefabs(SAPLING_PREFABS, componentParser({ keys: ['pickable'], regrowTime: SAPLING_REGROW_TIME }), true),
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
  worldFx: definePrefabs([], empty, ['wortox_portal_jumpin_fx', 'wortox_portal_jumpout_fx']),
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
