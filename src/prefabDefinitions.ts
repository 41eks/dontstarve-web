import { BERNIE_ITEM_ID } from '@dontstarve-web/prefab/bernie';
import { FARM_PLOW_ID, FARM_PLOW_ITEM_ID, FARM_DECOR_IDS, PLANTED_SEED_ID } from '@dontstarve-web/prefab/farm_plow';
import { DWARF_STAR_DURATION, POLAR_LIGHT_DURATION, POLAR_LIGHT_ID } from '@dontstarve-web/prefab/stafflight';
import { BULB_PLANT_PREFABS } from '@dontstarve-web/prefab/bulb_plant';
import { ROCK_PREFABS } from '@dontstarve-web/prefab/rocks';
import { GRASS_ID } from '@dontstarve-web/prefab/grass';
import { SAPLING_PREFABS } from '@dontstarve-web/prefab/sapling';
import { POND_ID } from '@dontstarve-web/prefab/pond';
import { WORMHOLE_ID } from '@dontstarve-web/prefab/wormhole';
import { PORTAL_ID } from '@dontstarve-web/prefab/portal';
import { NIGHTMAREGROWTH_ID } from '@dontstarve-web/prefab/nightmaregrowth';
import { PLACEABLE_BUILDING_IDS } from './placeableBuilding';
import { componentParser, type PrefabComponentParser } from './save/prefabComponents';
import { fail } from './save/validation';

/** Pure definitions are available before loading a save or constructing a scene. */
export interface PrefabDefinition<Id extends string = string> {
  readonly prefabIds: readonly Id[];
  readonly debugSpawnIds: readonly Id[];
  readonly parseComponents: PrefabComponentParser;
}

export function definePrefabs<const Id extends string>(
  prefabIds: readonly Id[], parseComponents: PrefabComponentParser, debugSpawn: readonly Id[] | true = [],
): PrefabDefinition<Id> {
  const debugSpawnIds = debugSpawn === true ? prefabIds : debugSpawn;
  if (new Set(prefabIds).size !== prefabIds.length || new Set(debugSpawnIds).size !== debugSpawnIds.length) {
    throw new Error('Duplicate prefab ID in definition');
  }
  return Object.freeze({ prefabIds: Object.freeze([...prefabIds]), debugSpawnIds: Object.freeze([...debugSpawnIds]), parseComponents });
}

const empty = componentParser({ keys: [] });
const farmSoil = componentParser({ keys: ['farmSoil'] });
const farmDebris = componentParser({ keys: ['farmDebris'] });
const building = componentParser({ keys: ['building'] });
const storage = componentParser({ keys: ['building', 'container'] });
const wall = componentParser({ keys: ['wall', 'health'] });
const bulbSingle = componentParser({ keys: ['bulbPlant'], bulbVariants: ['single', 'springy'] });
const bulbDouble = componentParser({ keys: ['bulbPlant'], bulbVariants: ['double'] });
const bulbTriple = componentParser({ keys: ['bulbPlant'], bulbVariants: ['triple'] });

/** One declaration supplies saved IDs, debug aliases and component schemas to both consumers. */
export const PREFAB_DEFINITIONS = {
  farmPlow: definePrefabs([FARM_PLOW_ID], componentParser({ keys: ['farmPlow'] }), true),
  plantedSeeds: definePrefabs([PLANTED_SEED_ID], empty, true),
  farmDecor: definePrefabs(FARM_DECOR_IDS, (value, path, context) =>
    (context.prefab === 'farm_soil' ? farmSoil : farmDebris)(value, path, context), true),
  moonTrees: definePrefabs(['moon_tree'], empty),
  pigKings: definePrefabs(['pigking'], empty),
  buildings: definePrefabs(PLACEABLE_BUILDING_IDS.filter((id) => !id.endsWith('_item')), (value, path, context) => {
    const spec = Object.hasOwn(context.catalog.buildings, context.prefab) ? context.catalog.buildings[context.prefab] : undefined;
    if (spec) return (spec.container ? storage : building)(value, path, context);
    if (context.catalog.walls.includes(context.prefab)) return wall(value, path, context);
    return fail(path, `missing building definition for ${context.prefab}`);
  }, PLACEABLE_BUILDING_IDS),
  groundItems: definePrefabs(['ground_item'], componentParser({ keys: ['stack', 'phonograph'] }),
    ['fireflies', BERNIE_ITEM_ID, FARM_PLOW_ITEM_ID, 'torch', 'phonograph', 'record', 'seeds', 'farm_hoe', 'golden_farm_hoe', 'shovel', 'goldenshovel']),
  flowers: definePrefabs(['flower'], componentParser({ keys: ['flower'] })),
  dwarfStars: definePrefabs(['stafflight'], componentParser({ keys: ['timer'], timerDuration: DWARF_STAR_DURATION })),
  polarLights: definePrefabs([POLAR_LIGHT_ID], componentParser({ keys: ['timer'], timerDuration: POLAR_LIGHT_DURATION })),
  bulbPlants: definePrefabs(BULB_PLANT_PREFABS, (value, path, context) =>
    (context.prefab === 'flower_cave' ? bulbSingle : context.prefab === 'flower_cave_double' ? bulbDouble : bulbTriple)(value, path, context), true),
  beefalos: definePrefabs(['beefalo'], componentParser({ keys: ['beefalo'] }), true),
  rocks: definePrefabs(ROCK_PREFABS, empty, true),
  grasses: definePrefabs([GRASS_ID], empty, true),
  saplings: definePrefabs(SAPLING_PREFABS, empty, true),
  ponds: definePrefabs([POND_ID], empty, true),
  nightmareGrowths: definePrefabs([NIGHTMAREGROWTH_ID], componentParser({ keys: ['nightmareGrowth'] }), true),
  wormholes: definePrefabs([WORMHOLE_ID], componentParser({ keys: ['wormhole'] }), true),
  portals: definePrefabs([PORTAL_ID], empty, true),
  reskinEffects: definePrefabs([], empty),
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
