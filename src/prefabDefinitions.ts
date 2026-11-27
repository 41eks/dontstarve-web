import { groundItemRegistration } from '@dontstarve-web/prefab/itemPrefabs';
import { definePrefabIds, type PrefabIds } from '@dontstarve-web/prefab/prefabRegistration';
import { moonTreeRegistration } from '@dontstarve-web/prefab/moontree';
import { deciduousRegistration } from '@dontstarve-web/prefab/deciduoustrees';
import { evergreenRegistration } from '@dontstarve-web/prefab/evergreens';
import { pigKingRegistration } from '@dontstarve-web/prefab/pigking';
import { flowerRegistration } from '@dontstarve-web/prefab/flower';
import { lightflierFlowerRegistration } from '@dontstarve-web/prefab/lightflier_flower';
import { molehillRegistration } from '@dontstarve-web/prefab/molehill';
import { beefaloRegistration } from '@dontstarve-web/prefab/beefalo';
import { lightningGoatRegistration } from '@dontstarve-web/prefab/lightninggoat';
import { worldFxRegistration } from '@dontstarve-web/prefab/world_fx';
import { staffProjectileRegistration } from '@dontstarve-web/prefab/staff_projectile';
import { staffCastingLightRegistration } from '@dontstarve-web/prefab/staff_castinglight';
import { stalagmiteRegistration, stalagmiteBank } from '@dontstarve-web/prefab/stalagmite';
import {
  ruinsRelicRegistration,
  RUINS_RELIC_IDS,
  relicName,
  isRelicItem,
  isRelicReplica,
  relicSkins,
  type RuinsRelicId,
} from '@dontstarve-web/prefab/ruinsrelic';
import { bernieRegistration, bernieFormSkins } from '@dontstarve-web/prefab/bernie';
import { WALL_SKIN_ARCHIVES } from '@dontstarve-web/prefab/wallSkins';
import { FENCE_ID, FENCE_SKIN_ARCHIVES } from '@dontstarve-web/prefab/fenceSkins';
import { wormholeRegistration, WORMHOLE_SKINS } from '@dontstarve-web/prefab/wormhole';
import { GROUND_ART_DEFINITIONS, GROUND_ART_VARIANTS } from '@dontstarve-web/prefab/groundItems';
import { farmRegistration } from '@dontstarve-web/prefab/farm_plow';
import { staffLightRegistration } from '@dontstarve-web/prefab/stafflight';
import { bulbPlantRegistration, BULB_PLANT_VARIANTS } from '@dontstarve-web/prefab/bulb_plant';
import { caveHoleRegistration } from '@dontstarve-web/prefab/cave_hole';
import { pillarRegistration } from '@dontstarve-web/prefab/pillar';
import { atriumPillarRegistration } from '@dontstarve-web/prefab/atrium_pillar';
import { moonFissureRegistration } from '@dontstarve-web/prefab/moon_fissure';
import {
  watertreePillarRegistration,
  WATERTREE_PILLAR_ARCHIVES,
  type WatertreePillarSaveState,
} from '@dontstarve-web/prefab/watertree_pillar';
import { oceanTreePillarRegistration, OCEANTREE_PILLAR_ARCHIVES } from '@dontstarve-web/prefab/oceantree_pillar';
import {
  oceanTreeRegistration,
  OCEANTREE_ARCHIVES,
  STAGES_TO_SUPERTALL,
  type OceanTreeSaveState,
} from '@dontstarve-web/prefab/oceantree';
import { oceanVineRegistration, OCEANVINE_REGROW_TIME } from '@dontstarve-web/prefab/oceanvine';
import { oceanVineDecoRegistration, OCEANVINE_DECO_ANIMNUMS } from '@dontstarve-web/prefab/oceanvine_deco';
import { archivePillarRegistration, ARCHIVE_PILLAR_ARCHIVES } from '@dontstarve-web/prefab/archive_pillar';
import { vaultPillarRegistration } from '@dontstarve-web/prefab/vault_pillar';
import { monkeyPillarRegistration, MONKEY_PILLAR_IDS } from '@dontstarve-web/prefab/monkeypillar';
import {
  rockRegistration,
  moonglassRockRegistration,
  ROCK_PREFABS,
  moonglassRockArchives,
  rockArchives,
} from '@dontstarve-web/prefab/rocks';
import { caveinBoulderRegistration } from '@dontstarve-web/prefab/cavein_boulder';
import { moonrockseedRegistration } from '@dontstarve-web/prefab/moonrockseed';
import { marbleShrubRegistration, MARBLESHRUB_MAX_GROW_TIME } from '@dontstarve-web/prefab/marbleshrub';
import {
  archivePropsRegistration,
  ARCHIVE_PROP_IDS,
  ARCHIVE_MOON_STATUE_ID,
  ARCHIVE_RUNE_STATUE_ID,
  ARCHIVE_PORTAL_ID,
  ARCHIVE_SWITCH_BASE_ID,
} from '@dontstarve-web/prefab/archive_props';
import { houndboneRegistration } from '@dontstarve-web/prefab/houndbone';
import { beeQueenHiveRegistration, BEEQUEEN_HIVE_MAX_WORK } from '@dontstarve-web/prefab/beequeenhivegrown';
import { dragonflyRegistration } from '@dontstarve-web/prefab/dragonfly';
import { dragonflySpawnerRegistration } from '@dontstarve-web/prefab/dragonfly_spawner';
import { statueGlommerRegistration, STATUEGLOMMER_WORK } from '@dontstarve-web/prefab/statueglommer';
import { atriumGateRegistration, ATRIUM_GATE_TIMER_NAMES } from '@dontstarve-web/prefab/atrium_gate';
import { ruinsStatueRegistration, RUINS_STATUE_GEMS } from '@dontstarve-web/prefab/ruins_statue_mage';
import { atriumStatueRegistration } from '@dontstarve-web/prefab/atrium_statue';
import {
  atriumOvergrowthRegistration,
  ATRIUM_OVERGROWTH_ARCHIVES,
  ATRIUM_OVERGROWTH_STORY_LINES,
} from '@dontstarve-web/prefab/atrium_overgrowth';
import {
  atriumRubbleRegistration,
  ATRIUM_RUBBLE_ANIM_IDS,
  ATRIUM_RUBBLE_ARCHIVES,
  ATRIUM_RUBBLE_STORY_LINES,
} from '@dontstarve-web/prefab/atrium_rubble';
import { chessJunkRegistration } from '@dontstarve-web/prefab/chessjunk';
import { chesspieceRegistration, CHESSPIECE_MARBLE_MATERIAL_ID } from '@dontstarve-web/prefab/chesspieces';
import { archiveCentipedeHuskRegistration } from '@dontstarve-web/prefab/archive_centipede';
import { parseDragonflyState } from './save/dragonfly';
import {
  skeletonRegistration,
  SKELETON_IDS,
  SKELETON_ANIMS,
  SKELETON_PLAYER_ID,
} from '@dontstarve-web/prefab/skeleton';
import { marbleBeanSaplingRegistration } from '@dontstarve-web/prefab/marblebean_sapling';
import {
  rockAvocadoSaplingRegistration,
  ROCK_AVOCADO_SPROUT_GROW_TIME,
} from '@dontstarve-web/prefab/rock_avocado_fruit_sprout_sapling';
import { rockAvocadoBushRegistration } from '@dontstarve-web/prefab/rock_avocado_bush';
import {
  berrybushRegistration,
  BERRYBUSH_ARCHIVE,
  BERRYBUSH_MAX_REGROW_TIME,
  BERRYBUSH_SKINS,
} from '@dontstarve-web/prefab/berrybush';
import { monkeytailRegistration, MONKEYTAIL_REGROW_TIME } from '@dontstarve-web/prefab/monkeytail';
import {
  grassRegistration,
  GRASS_ANIM_ARCHIVE,
  GRASS_BUILD_ARCHIVE,
  GRASS_CYCLES,
  GRASS_REGROW_TIME,
} from '@dontstarve-web/prefab/grass';
import { lichenRegistration, LICHEN_ARCHIVE, LICHEN_REGROW_TIME } from '@dontstarve-web/prefab/lichen';
import {
  reedsRegistration,
  REEDS_ANIM_ARCHIVE,
  REEDS_BUILD_ARCHIVE,
  REEDS_REGROW_TIME,
} from '@dontstarve-web/prefab/reeds';
import {
  mastMalbatrossRegistration,
  MAST_MALBATROSS_ANIMATION_ARCHIVES,
  MAST_MALBATROSS_BUILD_ARCHIVE,
  MAST_MALBATROSS_SKINS,
} from '@dontstarve-web/prefab/mast_malbatross';
import {
  supportPillarRegistration,
  SUPPORT_PILLAR_ARCHIVES,
  SUPPORT_PILLAR_REINFORCED_LEVELS,
} from '@dontstarve-web/prefab/support_pillar';
import { oasislakeRegistration, OASISLAKE_ARCHIVES, OASISLAKE_MAX_FISH } from '@dontstarve-web/prefab/oasislake';
import {
  beehiveRegistration,
  BEEHIVE_ARCHIVES,
  BEEHIVE_HEALTH,
  BEEHIVE_MAX_BEES,
} from '@dontstarve-web/prefab/beehive';
import { shadowForgeRegistration, SHADOW_FORGE_ARCHIVES } from '@dontstarve-web/prefab/shadow_forge';
import { spiderdenRegistration, SPIDERDEN_ARCHIVES, SPIDERDEN_HEALTH } from '@dontstarve-web/prefab/spiderden';
import {
  seastackRegistration,
  SEASTACK_ARCHIVES,
  SEASTACK_MINE,
  SEASTACK_STACK_TYPES,
} from '@dontstarve-web/prefab/seastack';
import {
  wasphiveRegistration,
  WASPHIVE_ARCHIVES,
  WASPHIVE_HEALTH,
  WASPHIVE_WASPS,
} from '@dontstarve-web/prefab/wasphive';
import { saplingRegistration, SAPLING_REGROW_TIME } from '@dontstarve-web/prefab/sapling';
import { pondRegistration } from '@dontstarve-web/prefab/pond';
import { marshPlantRegistration } from '@dontstarve-web/prefab/marsh_plant';
import { tumbleweedRegistration } from '@dontstarve-web/prefab/tumbleweed';
import { hotspringRegistration } from '@dontstarve-web/prefab/hotspring';
import { lavaPondRegistration } from '@dontstarve-web/prefab/lava_pond';
import { portalRegistration } from '@dontstarve-web/prefab/portal';
import { nightmareGrowthRegistration } from '@dontstarve-web/prefab/nightmaregrowth';
import { nightmareRockRegistration } from '@dontstarve-web/prefab/nightmarerock';
import { caveEntranceRegistration } from '@dontstarve-web/prefab/cave_entrance';
import { caveExitRegistration } from '@dontstarve-web/prefab/cave_exit';
import { grottoPoolRegistration } from '@dontstarve-web/prefab/grotto_pool';
import {
  caveFernRegistration,
  CAVE_FERN_ANIM_ARCHIVE,
  CAVE_FERN_ANIMATIONS,
  CAVE_FERN_BUILD_ARCHIVES,
} from '@dontstarve-web/prefab/cave_fern';
import { cactusRegistration, CACTUS_REGROW_TIME } from '@dontstarve-web/prefab/cactus';
import { mushroomPlantRegistration } from '@dontstarve-web/prefab/mushroom_plant';
import { mushtreeRegistration, MUSHTREE_GROWTH_STAGES, MUSHTREE_GROWTH_TIME } from '@dontstarve-web/prefab/mushtree';
import { TENT_ID, TENT_USES } from '@dontstarve-web/prefab/tent';
import { BUILDING_PREFAB_IDS } from './placeableBuilding';
import { INVENTORY_ITEM_SPECS } from './inventoryItems';
import type { AnimationArchiveSpec } from '@dontstarve-web/animation/preloadArchives';
import definitions from '@dontstarve-web/prefab/definitions.json' with { type: 'json' };
import { componentParser, type PrefabComponentParser } from './save/prefabComponents';
import { fail } from './save/validation';
import { array, integer, number, object, string } from './save/validation';
import type { EntityPersistData } from '@dontstarve-web/prefab/saveRecord';
import { TORCH_ID } from '@dontstarve-web/prefab/torch';
import { LANTERN_ID } from '@dontstarve-web/prefab/lantern';
import { PHONOGRAPH_ID } from '@dontstarve-web/prefab/phonograph';
import { COOK_POT_ID } from '@dontstarve-web/prefab/cook_pot';
import { TREASURE_CHEST_ID } from '@dontstarve-web/prefab/treasurechest';
import { BOOKSTATION_ID } from '@dontstarve-web/prefab/bookstation';
import { WINTEROMETER_ID } from '@dontstarve-web/prefab/winterometer';
import { PIG_HEAD_ID, MERM_HEAD_ID } from '@dontstarve-web/prefab/stickheads';
import { livingTreeRegistration, LIVINGTREE_ART } from '@dontstarve-web/prefab/livingtree';
import { LIVINGTREE_CONFIG } from '../packages/prefab/src/generated/livingtree.schema';
import { stagehandRegistration, STAGEHAND_ART } from '@dontstarve-web/prefab/stagehand';
import { STAGEHAND_CONFIG } from '../packages/prefab/src/generated/stagehand.schema';
import { WOOD_CHAIR_ID } from '@dontstarve-web/prefab/furniture_chairs';
import { RESEARCH_LAB_IDS } from '@dontstarve-web/prefab/scienceprototyper';
import { SCULPTING_TABLE_ID } from '@dontstarve-web/prefab/sculptingtable';
import { BIRDCAGE_ID } from '@dontstarve-web/prefab/birdcage';
import { MOONBASE_ID } from '@dontstarve-web/prefab/moonbase';
import { LIGHTNING_ROD_ID } from '@dontstarve-web/prefab/lightning_rod';
import { FIRE_PIT_ID } from '@dontstarve-web/prefab/firepit';

/** The fields of a saved entity that choose its art, read while the save is scanned before restore. */
export interface ArchiveSaveRecord {
  readonly components?: {
    readonly stack?: { readonly skinId?: string; readonly variant?: string };
    readonly rock_type?: import('@dontstarve-web/prefab/rocks').MoonglassRockType;
  };
}

/** Pure definitions are available before loading a save or constructing a scene. */
export interface PrefabDefinition<Id extends string = string> extends PrefabIds<Id> {
  readonly parseComponents: PrefabComponentParser;
  /**
   * Archives a saved instance needs, so a scan of the save can warm the decoders before restore. Method-typed, so a
   * definition of particular IDs is still a definition of strings.
   */
  archives(prefabId: Id, records: readonly ArchiveSaveRecord[]): readonly AnimationArchiveSpec[];
  /** The skins a saved instance's record.skinname may name, as SpawnPrefab(prefab, skinname) applies them. */
  skins(prefabId: Id): readonly string[];
}

/** A family's table of one value per prefab ID: the IDs a family lists, each to what that prefab declares. */
export type PerPrefab<Id extends string, T> = { readonly [K in Id]: T };

/** A table for every ID of a family: each ID's own entry, else the family's shared one. */
export function perPrefab<const Id extends string, T>(
  prefabIds: readonly Id[],
  shared: T,
  own: Partial<PerPrefab<Id, T>>,
): PerPrefab<Id, T> {
  return mapPrefabs(prefabIds, id => own[id] ?? shared);
}

/** A table for every ID of a family, each declared from its ID's own data. */
export function mapPrefabs<const Id extends string, T>(
  prefabIds: readonly Id[],
  declare: (prefabId: Id) => T,
): PerPrefab<Id, T> {
  return Object.fromEntries(prefabIds.map(id => [id, declare(id)])) as PerPrefab<Id, T>;
}

/**
 * A family's save schema and art. The component schema and the archives are either the family's for every ID or a
 * `PerPrefab` table, so a save record is read by its prefab's own declaration and never by a branch on its prefab ID.
 */
export function definePrefabs<const Id extends string, const SpawnId extends string = Id>(
  prefabIds: readonly Id[],
  parseComponents: PrefabComponentParser | PerPrefab<Id, PrefabComponentParser>,
  debugSpawn: readonly SpawnId[] | true = [],
  archives:
    | readonly AnimationArchiveSpec[]
    | PerPrefab<Id, readonly AnimationArchiveSpec[]>
    | ((prefabId: Id, records: readonly ArchiveSaveRecord[]) => readonly AnimationArchiveSpec[]) = [],
  skins: (prefabId: Id) => readonly string[] = () => [],
): PrefabDefinition<Id | SpawnId> {
  return describePrefabs(definePrefabIds(prefabIds, debugSpawn), parseComponents, archives, skins);
}

function describePrefabs<const Id extends string, const SpawnId extends string>(
  { prefabIds, debugSpawnIds }: PrefabIds<Id, SpawnId>,
  parseComponents: PrefabComponentParser | PerPrefab<Id, PrefabComponentParser>,
  archives:
    | readonly AnimationArchiveSpec[]
    | PerPrefab<Id, readonly AnimationArchiveSpec[]>
    | ((prefabId: Id, records: readonly ArchiveSaveRecord[]) => readonly AnimationArchiveSpec[]) = [],
  skins: (prefabId: Id) => readonly string[] = () => [],
): PrefabDefinition<Id | SpawnId> {
  if (new Set(prefabIds).size !== prefabIds.length || new Set(debugSpawnIds).size !== debugSpawnIds.length) {
    throw new Error('Duplicate prefab ID in definition');
  }
  const parsers: Readonly<Record<string, PrefabComponentParser>> =
    typeof parseComponents === 'function'
      ? Object.fromEntries(prefabIds.map(id => [id, parseComponents]))
      : parseComponents;
  const archivesOf =
    typeof archives === 'function'
      ? archives
      : Array.isArray(archives)
        ? () => archives
        : (prefabId: Id) => (archives as PerPrefab<Id, readonly AnimationArchiveSpec[]>)[prefabId];
  return Object.freeze({
    prefabIds: Object.freeze([...prefabIds]),
    debugSpawnIds: Object.freeze([...debugSpawnIds]),
    parseComponents:
      typeof parseComponents === 'function'
        ? parseComponents
        : (value, path, context) =>
            (Object.hasOwn(parsers, context.prefab)
              ? parsers[context.prefab]
              : fail(path, `${context.prefab} is not in this family`))(value, path, context),
    archives: archivesOf,
    skins,
  });
}

/** The skins a placed building's record may name: a wall's or the fence's, else its own in definitions.json. */
function buildingSkins(prefab: string): readonly string[] {
  const own: Readonly<Partial<Record<string, { archive: string; skinArchives?: Readonly<Record<string, string>> }>>> =
    definitions.animatedBuildings;
  return Object.keys(
    WALL_SKIN_ARCHIVES[prefab] ?? (prefab === FENCE_ID ? FENCE_SKIN_ARCHIVES : own[prefab]?.skinArchives) ?? {},
  );
}

/** definitions.json's building and wall archives, by the prefab a save names. */
const ARCHIVED_BUILDINGS: Readonly<Partial<Record<string, { archive: string; buildArchive?: string }>>> =
  definitions.animatedBuildings;
const ARCHIVED_WALLS: Readonly<Partial<Record<string, { archive: string; buildArchive?: string }>>> = definitions.walls;
/** Base art only; skins load when applied. definitions.json supplies each archive's bank and build. */
function buildingArchives(prefab: string): readonly AnimationArchiveSpec[] {
  const spec = ARCHIVED_BUILDINGS[prefab] ?? ARCHIVED_WALLS[prefab];
  return spec ? [{ animation: spec.archive, build: spec.buildArchive ?? spec.archive }] : [];
}

/** An item record's art: its prefab's ground art, for the variant and skin its stack names. */
function groundItemArchives(prefab: string, records: readonly ArchiveSaveRecord[]): readonly AnimationArchiveSpec[] {
  const specs: AnimationArchiveSpec[] = [];
  for (const record of records) {
    const stack = record.components?.stack;
    const item = Object.hasOwn(GROUND_ART_DEFINITIONS, prefab)
      ? { ...GROUND_ART_DEFINITIONS[prefab], ...GROUND_ART_VARIANTS[prefab]?.[stack?.variant ?? ''] }
      : undefined;
    if (!item) {
      continue;
    }
    for (const build of item.buildArchives) {
      specs.push({ animation: item.animationArchive, build });
    }
    for (const { archive } of Object.values(item.symbolOverrides)) {
      specs.push({ animation: item.animationArchive, build: archive });
    }
    const skin =
      stack?.skinId !== undefined && Object.hasOwn(item.skinArchives, stack.skinId)
        ? item.skinArchives[stack.skinId]
        : undefined;
    if (skin) {
      specs.push(skin);
    }
  }
  return specs;
}

const empty = componentParser({ keys: [] });
/** statueruins.lua onsave/onload for gem() statues: data.gem, saved under the mage's original field name. */
const ruinsStatueGem: PrefabComponentParser = (value, path) => {
  const data = object(value, path, ['ruinsStatueMage']);
  const state = object(data.ruinsStatueMage, `${path}.ruinsStatueMage`, ['gem']);
  if (!RUINS_STATUE_GEMS.includes(state.gem as (typeof RUINS_STATUE_GEMS)[number])) {
    fail(`${path}.ruinsStatueMage.gem`, 'unsupported ruins statue gem');
  }
  return { ruinsStatueMage: { gem: state.gem as (typeof RUINS_STATUE_GEMS)[number] } };
};
/** archive_pillar.lua OnSave: data.broken. */
const archivePillar: PrefabComponentParser = (value, path) => {
  const { broken } = object(value, path, ['broken']);
  if (broken !== undefined && typeof broken !== 'boolean') {
    fail(`${path}.broken`, 'expected boolean');
  }
  return broken === undefined ? {} : { broken };
};
/** vault_pillar.lua OnSave: data.capped or data.broken, and world generation's data.random. */
const vaultPillar: PrefabComponentParser = (value, path) => {
  const { capped, broken, random } = object(value, path, ['capped', 'broken', 'random']);
  const cap = capped === undefined || capped === 1 || capped === 2 ? capped : fail(`${path}.capped`, 'expected 1 or 2');
  if (broken !== undefined && broken !== 1) {
    fail(`${path}.broken`, 'expected 1');
  }
  if (random !== undefined && random !== true) {
    fail(`${path}.random`, 'expected true');
  }
  return {
    ...(cap ? { capped: cap } : {}),
    ...(broken ? { broken: 1 as const } : {}),
    ...(random ? { random: true as const } : {}),
  };
};
/** monkeypillar.lua OnSave: data.pillar_id. */
const monkeyPillar: PrefabComponentParser = (value, path) => {
  const { pillar_id } = object(value, path, ['pillar_id']);
  if (pillar_id === undefined) {
    return {};
  }
  const id =
    MONKEY_PILLAR_IDS.find(known => known === pillar_id) ?? fail(`${path}.pillar_id`, 'unsupported monkey pillar');
  return { pillar_id: id };
};
/** tuning.lua OCEANTREENUT_REGENERATE_TIME + _VARIANCE and OCEANVINE_COCOON_REGEN_BASE + _RAND, by the timer they bound. */
const WATERTREE_PILLAR_TIMERS: Readonly<Record<string, number>> = {
  regrow_oceantreenut: 480 * 1.5,
  cocoon_regrow_check: 480 * 5,
};
/** watertree_pillar.lua OnSave: num_oceantreenuts, last_ram_time and cocoons_to_regrow, with its childspawner and timer. */
const watertreePillar: PrefabComponentParser = (value, path) => {
  const { watertreePillar: state } = object(value, path, ['watertreePillar']);
  if (state === undefined) {
    return {};
  }
  const p = `${path}.watertreePillar`;
  const data = object(state, p, ['num_oceantreenuts', 'last_ram_time', 'cocoons_to_regrow', 'childspawner', 'timer']);
  const child = object(data.childspawner, `${p}.childspawner`, ['childreninside', 'childrenoutside']);
  // NUM_OCEANTREENUTS_MAX is 2; the grassgator children are not ported, so none is outside.
  const saved: WatertreePillarSaveState = {
    num_oceantreenuts: integer(data.num_oceantreenuts, `${p}.num_oceantreenuts`, 0, 2),
    childspawner: {
      childreninside: integer(child.childreninside, `${p}.childspawner.childreninside`, 0, 1),
      childrenoutside: array(child.childrenoutside, `${p}.childspawner.childrenoutside`, 0).map((id, i) =>
        string(id, `${p}.childspawner.childrenoutside[${i}]`),
      ),
    },
  };
  if (data.last_ram_time !== undefined) {
    saved.last_ram_time = number(data.last_ram_time, `${p}.last_ram_time`, 0);
  }
  if (data.cocoons_to_regrow !== undefined) {
    saved.cocoons_to_regrow = integer(data.cocoons_to_regrow, `${p}.cocoons_to_regrow`, 0, 1000);
  }
  if (data.timer !== undefined) {
    const timers = object(
      object(data.timer, `${p}.timer`, ['timers']).timers,
      `${p}.timer.timers`,
      Object.keys(WATERTREE_PILLAR_TIMERS),
    );
    saved.timer = {
      timers: Object.fromEntries(
        Object.entries(timers)
          .filter(([, timer]) => timer !== undefined)
          .map(([name, timer]) => {
            const tp = `${p}.timer.timers.${name}`,
              t = object(timer, tp, ['timeleft', 'paused', 'initial_time']);
            const limit = WATERTREE_PILLAR_TIMERS[name]!;
            if (typeof t.paused !== 'boolean') {
              fail(`${tp}.paused`, 'expected boolean');
            }
            return [
              name,
              {
                timeleft: number(t.timeleft, `${tp}.timeleft`, 0, limit),
                paused: t.paused,
                initial_time: number(t.initial_time, `${tp}.initial_time`, 0, limit),
              },
            ];
          }),
      ),
    };
  }
  return { watertreePillar: saved };
};
const oceanTreeGrowable = componentParser({ keys: ['growable'], growthStages: 3 });
/** oceantree.lua's growable and onsave. Its stump, burnt and enriched (timer) states and the pillar it grows into are not ported. */
const oceanTree: PrefabComponentParser = (value, path, context) => {
  const { growable, oceantree: state } = object(value, path, ['growable', 'oceantree']);
  const components = oceanTreeGrowable(growable === undefined ? {} : { growable }, path, context);
  if (state === undefined) {
    return components;
  }
  const p = `${path}.oceantree`;
  const data = object(state, p, ['no_grow', 'buds', 'buds_used', 'supertall_growth_progress']);
  const buds = (key: 'buds' | 'buds_used') =>
    array(data[key], `${p}.${key}`, 7).map((bud, i) => integer(bud, `${p}.${key}[${i}]`, 1, 7));
  const saved: OceanTreeSaveState = {
    supertall_growth_progress: integer(
      data.supertall_growth_progress,
      `${p}.supertall_growth_progress`,
      0,
      STAGES_TO_SUPERTALL - 1,
    ),
  };
  if (data.no_grow !== undefined) {
    if (typeof data.no_grow !== 'boolean') {
      fail(`${p}.no_grow`, 'expected boolean');
    }
    saved.no_grow = data.no_grow;
  }
  if (data.buds !== undefined) {
    saved.buds = buds('buds');
  }
  if (data.buds_used !== undefined) {
    saved.buds_used = buds('buds_used');
  }
  return { ...components, oceantree: saved };
};
/** oceantree_pillar.lua OnSave: data.droppedvines. */
const oceanTreePillar: PrefabComponentParser = (value, path) => {
  const { oceantreePillar: state } = object(value, path, ['oceantreePillar']);
  if (state === undefined) {
    return {};
  }
  const { droppedvines } = object(state, `${path}.oceantreePillar`, ['droppedvines']);
  if (droppedvines !== true) {
    fail(`${path}.oceantreePillar.droppedvines`, 'expected true');
  }
  return { oceantreePillar: { droppedvines: true } };
};
/** oceanvine_deco.lua onsave: data.animnum, 1..6. */
const oceanVineDeco: PrefabComponentParser = (value, path) => {
  const { animnum } = object(value, path, ['animnum']);
  if (animnum === undefined) {
    return {};
  }
  return { animnum: OCEANVINE_DECO_ANIMNUMS.find(n => n === animnum) ?? fail(`${path}.animnum`, 'expected 1..6') };
};
/** atrium_overgrowth.lua rune_onsave: data.storyprogress, 1..NUM_STORY_LINES once assigned. */
const atriumOvergrowth: PrefabComponentParser = (value, path) => {
  const { atriumOvergrowth: state } = object(value, path, ['atriumOvergrowth']);
  if (state === undefined) {
    return {};
  }
  const { storyprogress } = object(state, `${path}.atriumOvergrowth`, ['storyprogress']);
  if (storyprogress === undefined) {
    return {};
  }
  if (
    typeof storyprogress !== 'number' ||
    !Number.isInteger(storyprogress) ||
    storyprogress < 1 ||
    storyprogress > ATRIUM_OVERGROWTH_STORY_LINES
  ) {
    fail(`${path}.atriumOvergrowth.storyprogress`, `expected 1..${ATRIUM_OVERGROWTH_STORY_LINES}`);
  }
  return { atriumOvergrowth: { storyprogress } };
};
/** atrium_rubble.lua OnSave: data.animid (1..2) always, data.storyprogress (1..NUM_STORY_LINES) once assigned. */
const atriumRubble: PrefabComponentParser = (value, path) => {
  const { atriumRubble: state } = object(value, path, ['atriumRubble']);
  if (state === undefined) {
    return {};
  }
  const at = `${path}.atriumRubble`;
  const { animid, storyprogress } = object(state, at, ['animid', 'storyprogress']);
  const id =
    ATRIUM_RUBBLE_ANIM_IDS.find(n => n === animid) ??
    fail(`${at}.animid`, `expected ${ATRIUM_RUBBLE_ANIM_IDS.join(' or ')}`);
  if (storyprogress === undefined) {
    return { atriumRubble: { animid: id } };
  }
  if (
    typeof storyprogress !== 'number' ||
    !Number.isInteger(storyprogress) ||
    storyprogress < 1 ||
    storyprogress > ATRIUM_RUBBLE_STORY_LINES
  ) {
    fail(`${at}.storyprogress`, `expected 1..${ATRIUM_RUBBLE_STORY_LINES}`);
  }
  return { atriumRubble: { animid: id, storyprogress } };
};
/** mast.lua onsave of a mast off any boat (burnt, rotation, is_sail_raised), and upgradeable:OnSave. */
const mastMalbatross: PrefabComponentParser = (value, path) => {
  const { mastMalbatross: state, upgradeable } = object(value, path, ['mastMalbatross', 'upgradeable']);
  const result: ReturnType<PrefabComponentParser> = {};
  if (state !== undefined) {
    const at = `${path}.mastMalbatross`;
    const { burnt, rotation, is_sail_raised } = object(state, at, ['burnt', 'rotation', 'is_sail_raised']);
    if (burnt !== undefined && burnt !== true) {
      fail(`${at}.burnt`, 'expected true');
    }
    if (is_sail_raised !== undefined && typeof is_sail_raised !== 'boolean') {
      fail(`${at}.is_sail_raised`, 'expected a boolean');
    }
    result.mastMalbatross = {
      ...(burnt ? { burnt: true } : {}),
      ...(rotation === undefined ? {} : { rotation: number(rotation, `${at}.rotation`, -360, 360) }),
      ...(is_sail_raised === undefined ? {} : { is_sail_raised }),
    };
  }
  if (upgradeable !== undefined) {
    const at = `${path}.upgradeable`;
    const { numupgrades, stage } = object(upgradeable, at, ['numupgrades', 'stage']);
    result.upgradeable = {
      numupgrades: integer(numupgrades, `${at}.numupgrades`),
      ...(stage === undefined ? {} : { stage: integer(stage, `${at}.stage`, 1) }),
    };
  }
  return result;
};
/** support_pillar.lua OnSave's data.reinforced (1..SUPPORT_PILLAR_REINFORCED_LEVELS), and constructionsite:OnSave's rocks. */
const supportPillar: PrefabComponentParser = (value, path) => {
  const { supportPillar: state, constructionsite } = object(value, path, ['supportPillar', 'constructionsite']);
  const result: ReturnType<PrefabComponentParser> = {};
  if (state !== undefined) {
    const { reinforced } = object(state, `${path}.supportPillar`, ['reinforced']);
    if (reinforced !== undefined) {
      result.supportPillar = {
        reinforced: integer(reinforced, `${path}.supportPillar.reinforced`, 1, SUPPORT_PILLAR_REINFORCED_LEVELS),
      };
    }
  }
  if (constructionsite !== undefined) {
    const at = `${path}.constructionsite`;
    const { materials } = object(constructionsite, at, ['materials']);
    const { rocks } = object(materials, `${at}.materials`, ['rocks']);
    result.constructionsite = { materials: { rocks: integer(rocks, `${at}.materials.rocks`, 1, 40) } };
  }
  return result;
};
/** oasislake.lua OnSave's data.regrowth (only false), and fishable:OnSave's fish below OASISLAKE_MAX_FISH. */
const oasislake: PrefabComponentParser = (value, path) => {
  const { oasislake: state, fishable } = object(value, path, ['oasislake', 'fishable']);
  const result: ReturnType<PrefabComponentParser> = {};
  if (state !== undefined) {
    const { regrowth } = object(state, `${path}.oasislake`, ['regrowth']);
    if (regrowth !== false) {
      throw new Error(`${path}.oasislake.regrowth must be false`);
    }
    result.oasislake = { regrowth };
  }
  if (fishable !== undefined) {
    const { fish } = object(fishable, `${path}.fishable`, ['fish']);
    result.fishable = { fish: integer(fish, `${path}.fishable.fish`, 0, OASISLAKE_MAX_FISH - 1) };
  }
  return result;
};
/**
 * beehive.lua / wasphive.lua have no OnSave: health:OnSave as the record's `{ current, maximum }`, and childspawner:OnSave.
 * The bees outside are not ported, so a record keeps none outside, and only the hive's emergency children inside.
 */
const hive =
  (maxChildren: number, maxHealth: number): PrefabComponentParser =>
  (value, path) => {
    const { health, childspawner } = object(value, path, ['health', 'childspawner']);
    const result: ReturnType<PrefabComponentParser> = {};
    if (health !== undefined) {
      const h = object(health, `${path}.health`, ['current', 'maximum']);
      const maximum = number(h.maximum, `${path}.health.maximum`, maxHealth, maxHealth);
      result.health = { current: number(h.current, `${path}.health.current`, 0, maximum), maximum };
    }
    if (childspawner !== undefined) {
      const p = `${path}.childspawner`;
      const child = object(childspawner, p, ['childreninside', 'childrenoutside', 'emergencychildreninside']);
      array(child.childrenoutside, `${p}.childrenoutside`, 0);
      result.childspawner = {
        childreninside: integer(child.childreninside, `${p}.childreninside`, 0, maxChildren),
        childrenoutside: [],
        ...(child.emergencychildreninside === undefined
          ? {}
          : { emergencychildreninside: integer(child.emergencychildreninside, `${p}.emergencychildreninside`, 0, 8) }),
      };
    }
    return result;
  };
/**
 * spiderden.lua has no OnSave: health:OnSave is kept as the record's `{ current, maximum }`, and growable,
 * childspawner and upgradeable save their own records. The spiders outside are not ported, so none is kept outside.
 * The shaveable and bedazzlement components are signature-only, so their saved fields are not written.
 */
const spiderDen: PrefabComponentParser = (value, path) => {
  const { health, childspawner, growable, upgradeable } = object(value, path, [
    'health',
    'childspawner',
    'growable',
    'upgradeable',
  ]);
  const components: ReturnType<PrefabComponentParser> = {};
  let stage: number | undefined;
  if (growable !== undefined) {
    const p = `${path}.growable`;
    const growth = object(growable, p, ['stage', 'time', 'sleeptime']);
    // AttemptMakeQueen's stage 4 is not ported.
    stage = integer(growth.stage, `${p}.stage`, 1, 3);
    components.growable = {
      stage,
      ...(growth.time === undefined ? {} : { time: number(growth.time, `${p}.time`, 0, 19200) }),
      ...(growth.sleeptime === undefined ? {} : { sleeptime: number(growth.sleeptime, `${p}.sleeptime`, 0) }),
    };
  }
  if (health !== undefined) {
    const p = `${path}.health`;
    const h = object(health, p, ['current', 'maximum']);
    const maximum = number(h.maximum, `${p}.maximum`, 1);
    if (!SPIDERDEN_HEALTH.some(known => known === maximum)) {
      fail(`${p}.maximum`, 'expected a spider den stage maximum');
    }
    if (stage !== undefined && maximum !== SPIDERDEN_HEALTH[stage - 1]) {
      fail(`${p}.maximum`, 'must match the growable stage');
    }
    components.health = { current: number(h.current, `${p}.current`, 0, maximum), maximum };
  }
  if (childspawner !== undefined) {
    const p = `${path}.childspawner`;
    const child = object(childspawner, p, ['childreninside', 'childrenoutside', 'emergencychildreninside']);
    array(child.childrenoutside, `${p}.childrenoutside`, 0);
    components.childspawner = {
      // 9 spiders in spring, floor(9 * 1.33); a runtime den clamps to its own max.
      childreninside: integer(child.childreninside, `${p}.childreninside`, 0, 11),
      childrenoutside: [],
      ...(child.emergencychildreninside === undefined
        ? {}
        : { emergencychildreninside: integer(child.emergencychildreninside, `${p}.emergencychildreninside`, 0, 8) }),
    };
  }
  if (upgradeable !== undefined) {
    const p = `${path}.upgradeable`;
    const upgrade = object(upgradeable, p, ['numupgrades', 'stage']);
    components.upgradeable = {
      numupgrades: integer(upgrade.numupgrades, `${p}.numupgrades`, 0),
      ...(upgrade.stage === undefined ? {} : { stage: integer(upgrade.stage, `${p}.stage`, 1, 3) }),
    };
  }
  return components;
};
/**
 * seastack.lua OnSave writes the stack shape and tint; workable.savestate writes its work, and upgradeable saves its own
 * record. The spawner prefabs in the same file are not ported.
 */
const seastack: PrefabComponentParser = (value, path) => {
  const { stackid, tinted, workable, upgradeable } = object(value, path, [
    'stackid',
    'tinted',
    'workable',
    'upgradeable',
  ]);
  const components: ReturnType<PrefabComponentParser> = {};
  if (stackid !== undefined) {
    components.stackid = integer(stackid, `${path}.stackid`, 1, SEASTACK_STACK_TYPES);
  }
  if (tinted !== undefined) {
    if (typeof tinted !== 'boolean') {
      fail(`${path}.tinted`, 'expected boolean');
    }
    components.tinted = tinted;
  }
  if (workable !== undefined) {
    const p = `${path}.workable`;
    const work = object(workable, p, ['workleft', 'maxwork']);
    if (work.maxwork !== undefined && work.maxwork !== -1) {
      fail(`${p}.maxwork`, 'expected -1');
    }
    components.workable = {
      workleft: number(work.workleft, `${p}.workleft`, 0, SEASTACK_MINE),
      ...(work.maxwork === undefined ? {} : { maxwork: -1 }),
    };
  }
  if (upgradeable !== undefined) {
    const p = `${path}.upgradeable`;
    const upgrade = object(upgradeable, p, ['numupgrades', 'stage']);
    components.upgradeable = {
      numupgrades: integer(upgrade.numupgrades, `${p}.numupgrades`, 0),
      ...(upgrade.stage === undefined ? {} : { stage: integer(upgrade.stage, `${p}.stage`, 1, 3) }),
    };
  }
  return components;
};
const archiveStatue = componentParser({ keys: ['archiveProp'], archivePropVariants: 4 });
const archiveRune = componentParser({ keys: ['archiveProp'], archivePropVariants: 3, archiveStoryLines: 5 });
const farmSoil = componentParser({ keys: ['farmSoil'] });
const farmDebris = componentParser({ keys: ['farmDebris'] });
const building = componentParser({ keys: ['building'] });
const storage = componentParser({ keys: ['building', 'container'] });
const burntBuilding = componentParser({ keys: ['building'], burntStructure: true });
const burntStorage = componentParser({ keys: ['building', 'container'], burntStructure: true });
const sculptingTable = componentParser({ keys: ['building', 'sculptingtable'] });
const birdcage = componentParser({ keys: ['building', 'CAGE_STATE', 'bird_type', 'occupiable', 'inventory'] });
const lightningRod = componentParser({ keys: ['building', 'lightningrod'] });
const firepit = componentParser({ keys: ['building', 'firepit'] });
const moonbase = componentParser({ keys: ['building', 'workable', 'moonbase'] });
/** furniture_chairs.lua OnSave writes only burnt (as building.burnt); savedrotation saves its own record. */
const woodChair = componentParser({ keys: ['building', 'savedrotation'], burntStructure: true });
const tent = componentParser({ keys: ['building', 'finiteuses'], finiteUses: TENT_USES });
const cookPot = componentParser({ keys: ['building', 'container', 'stewer'], burntStructure: true });
const wall = componentParser({ keys: ['health'] });
const fence = componentParser({ keys: ['fence'] });
const bulbSingle = componentParser({ keys: ['bulbPlant'], bulbVariants: ['single', 'springy'] });
const bulbDouble = componentParser({ keys: ['bulbPlant'], bulbVariants: ['double'] });
const bulbTriple = componentParser({ keys: ['bulbPlant'], bulbVariants: ['triple'] });
const caveinBoulder = componentParser({ keys: ['caveinBoulder'] });
/** A placed building without its own OnSave: the catalog says whether it is a container, or a wall. */
const catalogBuilding =
  (burntStructure: boolean): PrefabComponentParser =>
  (value, path, context) => {
    if (Object.hasOwn(context.catalog.buildings, context.prefab)) {
      const container = context.catalog.buildings[context.prefab].container;
      return (burntStructure ? (container ? burntStorage : burntBuilding) : container ? storage : building)(
        value,
        path,
        context,
      );
    }
    if (context.catalog.walls.includes(context.prefab)) {
      return wall(value, path, context);
    }
    return fail(path, `missing building definition for ${context.prefab}`);
  };
/** The catalog buildings whose prefab makes them a burnable structure: MakeXBurnable(inst, nil, nil, true). */
const BURNABLE_CATALOG_BUILDINGS = [
  TREASURE_CHEST_ID,
  WINTEROMETER_ID,
  BOOKSTATION_ID,
  PIG_HEAD_ID,
  MERM_HEAD_ID,
  ...RESEARCH_LAB_IDS,
] as const;
const beeQueenHiveComponents: PrefabComponentParser = (value, path) => {
  const data = object(value, path, ['workable', 'beeQueenHiveTimer']);
  const components: ReturnType<PrefabComponentParser> = {};
  if (data.workable !== undefined) {
    const work = object(data.workable, `${path}.workable`, ['maxwork', 'workleft']);
    const maximum = number(work.maxwork, `${path}.workable.maxwork`, BEEQUEEN_HIVE_MAX_WORK, BEEQUEEN_HIVE_MAX_WORK);
    components.workable = {
      maxwork: maximum,
      workleft: number(work.workleft, `${path}.workable.workleft`, 0, maximum),
    };
  }
  if (data.beeQueenHiveTimer !== undefined) {
    const timer = object(data.beeQueenHiveTimer, `${path}.beeQueenHiveTimer`, ['timers']);
    const timers = object(timer.timers, `${path}.beeQueenHiveTimer.timers`, ['hiveregen']);
    const regen = object(timers.hiveregen, `${path}.beeQueenHiveTimer.timers.hiveregen`, [
      'timeleft',
      'paused',
      'initial_time',
    ]);
    if (typeof regen.paused !== 'boolean') {
      fail(`${path}.beeQueenHiveTimer.timers.hiveregen.paused`, 'expected boolean');
    }
    const duration = number(regen.initial_time, `${path}.beeQueenHiveTimer.timers.hiveregen.initial_time`, 0, 120);
    components.beeQueenHiveTimer = {
      timers: {
        hiveregen: {
          timeleft: number(regen.timeleft, `${path}.beeQueenHiveTimer.timers.hiveregen.timeleft`, 0, duration),
          paused: regen.paused,
          initial_time: duration,
        },
      },
    };
  }
  return components;
};

/** ruinsrelic.lua's decor replicas save moisture; smashables.lua's relics save rubble and health. */
function ruinsRelicParser(id: RuinsRelicId): PrefabComponentParser {
  const replica = isRelicReplica(id),
    decor = isRelicItem(id);
  return (value, path) => {
    const data = object(value, path, [
      'ruinsRelic',
      ...(replica ? (decor ? ['inventoryitemmoisture'] : []) : ['health']),
    ]);
    const components: EntityPersistData = {};
    if (data.ruinsRelic !== undefined) {
      const state = object(data.ruinsRelic, `${path}.ruinsRelic`, replica ? [] : ['rubble']);
      if (state.rubble !== undefined && state.rubble !== true) {
        fail(`${path}.ruinsRelic.rubble`, 'expected true');
      }
      components.ruinsRelic = state as import('@dontstarve-web/prefab/ruinsrelic').RuinsRelicSaveState;
    }
    if (data.health !== undefined) {
      const health = object(data.health, `${path}.health`, ['current', 'maximum']);
      const maximum = number(health.maximum, `${path}.health.maximum`, Number.MIN_VALUE);
      components.health = { maximum, current: number(health.current, `${path}.health.current`, 0, maximum) };
    }
    if (data.inventoryitemmoisture !== undefined) {
      const moisture = object(data.inventoryitemmoisture, `${path}.inventoryitemmoisture`, ['moisture', 'wet']);
      if (moisture.wet !== undefined && moisture.wet !== true) {
        fail(`${path}.inventoryitemmoisture.wet`, 'expected true');
      }
      components.inventoryitemmoisture = {
        ...(moisture.moisture === undefined
          ? {}
          : { moisture: number(moisture.moisture, `${path}.inventoryitemmoisture.moisture`, 0, 100) }),
        ...(moisture.wet === true ? { wet: true as const } : {}),
      };
    }
    return components;
  };
}

/** An item's GetPersistData: its components' records as its spec allows, and the `extra` records its prefab's OnSave writes. */
function itemRecord(extra: readonly (keyof EntityPersistData)[] = []): PrefabComponentParser {
  return (value, path, context) => context.item(value, path, context.prefab, extra);
}

/** One declaration supplies saved IDs, debug aliases and component schemas to both consumers. */
/** stagehand.lua's workable uses the default savestate=false. Lunar hail is its only persistent component. */
const parseStagehandComponents: PrefabComponentParser = (value, path) => {
  const { lunarhailbuildup } = object(value, path, ['lunarhailbuildup']);
  if (lunarhailbuildup === undefined) {
    return {};
  }
  const p = `${path}.lunarhailbuildup`;
  const { workleft, buildupcurrent } = object(lunarhailbuildup, p, ['workleft', 'buildupcurrent']);
  return {
    lunarhailbuildup: {
      ...(workleft === undefined
        ? {}
        : { workleft: number(workleft, `${p}.workleft`, 0, STAGEHAND_CONFIG.lunarHail.totalWork) }),
      ...(buildupcurrent === undefined ? {} : { buildupcurrent: number(buildupcurrent, `${p}.buildupcurrent`, 0, 1) }),
    },
  };
};

const parseLivingTreeComponents: PrefabComponentParser = (value, path) => {
  const { livingtree, lunarhailbuildup } = object(value, path, ['livingtree', 'lunarhailbuildup']);
  const components: EntityPersistData = {};
  if (livingtree !== undefined) {
    const p = `${path}.livingtree`;
    const { stump, burnt } = object(livingtree, p, ['stump', 'burnt']);
    if ((stump !== undefined && stump !== true) || (burnt !== undefined && burnt !== true)) {
      fail(p, 'expected true stump and burnt flags');
    }
    components.livingtree = { ...(stump ? { stump: true } : {}), ...(burnt ? { burnt: true } : {}) };
  }
  if (lunarhailbuildup !== undefined) {
    const p = `${path}.lunarhailbuildup`;
    const { workleft, buildupcurrent } = object(lunarhailbuildup, p, ['workleft', 'buildupcurrent']);
    components.lunarhailbuildup = {
      ...(workleft === undefined
        ? {}
        : { workleft: number(workleft, `${p}.workleft`, 0, LIVINGTREE_CONFIG.lunarHail.work) }),
      ...(buildupcurrent === undefined ? {} : { buildupcurrent: number(buildupcurrent, `${p}.buildupcurrent`, 0, 1) }),
    };
  }
  return components;
};

const WORLD_PREFAB_DEFINITIONS = {
  farmPlow: describePrefabs(farmRegistration.families.farmPlow, componentParser({ keys: ['farmPlow'] })),
  plantedSeeds: describePrefabs(farmRegistration.families.plantedSeeds, empty),
  farmDecor: describePrefabs(farmRegistration.families.farmDecor, {
    farm_soil: farmSoil,
    farm_soil_debris: farmDebris,
  }),
  moonTrees: describePrefabs(
    moonTreeRegistration.families.moonTrees,
    componentParser({ keys: ['moonTree', 'growable', 'moonTreeTimer'] }),
    [definitions.moonTree.archive, 'tree_petal_fx.zip', 'baby_moon_tree.zip', 'snow.zip'],
  ),
  moonTreeSaplings: describePrefabs(
    moonTreeRegistration.families.moonTreeSaplings,
    componentParser({ keys: ['saplingTimer'] }),
    ['baby_moon_tree.zip'],
  ),
  deciduousTrees: describePrefabs(
    deciduousRegistration.families.deciduousTrees,
    componentParser({ keys: ['deciduoustree', 'growable', 'deciduousTimer'] }),
    [
      { animation: 'tree_leaf_trunk_build.zip', build: 'tree_leaf_trunk_build.zip' },
      ...['short', 'normal', 'tall'].map(stage => ({
        animation: `tree_leaf_${stage}.zip`,
        build: 'tree_leaf_trunk_build.zip',
      })),
      ...['green', 'red', 'orange', 'yellow'].flatMap(color => [
        `tree_leaf_${color}_build.zip`,
        `tree_leaf_fx_${color}.zip`,
      ]),
      'snow.zip',
    ],
  ),
  livingtree: describePrefabs(
    livingTreeRegistration.families.livingtree,
    parseLivingTreeComponents,
    LIVINGTREE_ART.buildArchives.map(build => ({ animation: LIVINGTREE_ART.animationArchive, build })),
  ),
  evergreens: describePrefabs(
    evergreenRegistration.families.evergreens,
    componentParser({ keys: ['evergreen', 'growable', 'evergreenTimer'], growthStages: 4 }),
    [
      { animation: 'evergreen_short_normal.zip', build: 'evergreen_new.zip' },
      { animation: 'evergreen_tall_old.zip', build: 'evergreen_new.zip' },
      'pine_needles.zip',
      'snow.zip',
    ],
  ),
  pigKings: describePrefabs(pigKingRegistration.families.pigKings, empty, [definitions.pigKing.archive]),
  // bernie_active.lua / bernie_big.lua: the reanimated forms the item becomes near a crazy player.
  bernies: describePrefabs(
    bernieRegistration.families.bernies,
    componentParser({ keys: ['health'] }),
    [
      { animation: 'bernie.zip', build: 'bernie_build.zip' },
      { animation: 'bernie_big.zip', build: 'bernie_build.zip' },
    ],
    bernieFormSkins,
  ),
  glommerStatues: describePrefabs(
    statueGlommerRegistration.families.glommerStatues,
    (value, path) => {
      const data = object(value, path, ['statueglommer', 'pickable', 'workable']);
      const components: EntityPersistData = {};
      if (data.statueglommer !== undefined) {
        const state = object(data.statueglommer, `${path}.statueglommer`, ['worked', 'spawned']);
        for (const key of ['worked', 'spawned'] as const) {
          if (state[key] !== undefined && state[key] !== true) {
            fail(`${path}.statueglommer.${key}`, 'expected true');
          }
        }
        components.statueglommer = {
          ...(state.worked ? { worked: true } : {}),
          ...(state.spawned ? { spawned: true } : {}),
        };
      }
      if (data.pickable !== undefined) {
        const state = object(data.pickable, `${path}.pickable`, ['picked', 'caninteractwith']);
        if (state.picked !== undefined && state.picked !== true) {
          fail(`${path}.pickable.picked`, 'expected true');
        }
        if (state.caninteractwith !== undefined && state.caninteractwith !== true) {
          fail(`${path}.pickable.caninteractwith`, 'expected true');
        }
        components.pickable = {
          ...(state.picked ? { picked: true } : {}),
          ...(state.caninteractwith ? { caninteractwith: true } : {}),
        };
      }
      if (data.workable !== undefined) {
        const state = object(data.workable, `${path}.workable`, ['maxwork', 'workleft']);
        if (state.maxwork !== -1) {
          fail(`${path}.workable.maxwork`, 'expected -1');
        }
        components.workable = {
          maxwork: -1,
          workleft: number(state.workleft, `${path}.workable.workleft`, 0, STATUEGLOMMER_WORK),
        };
      }
      return components;
    },
    ['glommer_statue.zip', 'glommer_swap_flower.zip'],
  ),
  atriumGates: describePrefabs(
    atriumGateRegistration.families.atriumGates,
    (value, path) => {
      const data = object(value, path, [
        'atriumGate',
        'pickable',
        'charliecutscene',
        'worldsettingstimer',
        'entitytracker',
      ]);
      const components: EntityPersistData = {};
      const flags = (value: unknown, field: string, keys: readonly string[]) => {
        const record = object(value, field, keys);
        for (const [key, flag] of Object.entries(record)) {
          if (flag !== true) {
            fail(`${field}.${key}`, 'expected true');
          }
        }
        return record;
      };
      if (data.atriumGate !== undefined) {
        components.atriumGate = flags(data.atriumGate, `${path}.atriumGate`, [
          'vault_key_socketed',
          'can_spawn_charlie_hand_keystone',
          'launch_key',
        ]) as typeof components.atriumGate;
      }
      if (data.pickable !== undefined) {
        components.pickable = flags(data.pickable, `${path}.pickable`, [
          'picked',
          'paused',
          'caninteractwith',
        ]) as typeof components.pickable;
      }
      if (data.charliecutscene !== undefined) {
        components.charliecutscene = flags(data.charliecutscene, `${path}.charliecutscene`, [
          'running',
          'gatefixed',
        ]) as typeof components.charliecutscene;
      }
      if (data.worldsettingstimer !== undefined) {
        const timer = object(data.worldsettingstimer, `${path}.worldsettingstimer`, ['timers']);
        const entries = object(timer.timers, `${path}.worldsettingstimer.timers`, ATRIUM_GATE_TIMER_NAMES);
        const timers: NonNullable<typeof components.worldsettingstimer>['timers'] = {};
        for (const name of ATRIUM_GATE_TIMER_NAMES) {
          if (entries[name] !== undefined) {
            const field = `${path}.worldsettingstimer.timers.${name}`;
            const item = object(entries[name], field, ['timeleft', 'paused', 'blocklongupdate', 'initial_time']);
            if (
              typeof item.paused !== 'boolean' ||
              (item.blocklongupdate !== undefined && typeof item.blocklongupdate !== 'boolean')
            ) {
              fail(field, 'expected boolean timer flags');
            }
            timers[name] = {
              timeleft: number(item.timeleft, `${field}.timeleft`, 0, 1),
              paused: item.paused,
              ...(item.blocklongupdate === undefined ? {} : { blocklongupdate: item.blocklongupdate }),
              ...(item.initial_time === undefined
                ? {}
                : { initial_time: number(item.initial_time, `${field}.initial_time`, 0, 9600) }),
            };
          }
        }
        components.worldsettingstimer = { timers };
      }
      if (data.entitytracker !== undefined) {
        const tracker = object(data.entitytracker, `${path}.entitytracker`, ['entities']);
        if (!Array.isArray(tracker.entities)) {
          fail(`${path}.entitytracker.entities`, 'expected array');
        }
        components.entitytracker = {
          entities: tracker.entities.map((entry: unknown, index: number) => {
            const field = `${path}.entitytracker.entities.${index}`,
              item = object(entry, field, ['name', 'GUID']);
            if (item.name !== 'stalker' && item.name !== 'charlie_hand') {
              fail(`${field}.name`, 'unsupported target');
            }
            return { name: item.name, GUID: number(item.GUID, `${field}.GUID`, 0, Number.MAX_SAFE_INTEGER) };
          }),
        };
      }
      return components;
    },
    ['atrium_gate.zip', 'atrium_gate_build.zip', 'atrium_floor.zip', 'atrium_gate_overload_fx.zip'],
  ),
  ruinsStatueMages: describePrefabs(ruinsStatueRegistration.families.ruinsStatueMages, ruinsStatueGem, [
    'statue_ruins.zip',
    'statue_ruins_gem.zip',
  ]),
  ruinsStatueHeads: describePrefabs(ruinsStatueRegistration.families.ruinsStatueHeads, ruinsStatueGem, [
    'statue_ruins_small.zip',
    'statue_ruins_small_gem.zip',
  ]),
  // statueruins.lua nogem(): onsave writes gem = nil.
  ruinsStatueMagesNoGem: describePrefabs(ruinsStatueRegistration.families.ruinsStatueMagesNoGem, empty, [
    'statue_ruins.zip',
  ]),
  ruinsStatueHeadsNoGem: describePrefabs(ruinsStatueRegistration.families.ruinsStatueHeadsNoGem, empty, [
    'statue_ruins_small.zip',
  ]),
  ruinsRelics: describePrefabs(
    ruinsRelicRegistration.families.ruinsRelics,
    mapPrefabs(RUINS_RELIC_IDS, ruinsRelicParser),
    id => [`ruins_${relicName(id)}.zip`],
    id => Object.keys(relicSkins(id) ?? {}),
  ),
  // atrium_statue.lua has no OnSave data.
  atriumStatues: describePrefabs(atriumStatueRegistration.families.atriumStatues, empty, ['atrium_statue.zip']),
  atriumOvergrowths: describePrefabs(
    atriumOvergrowthRegistration.families.atriumOvergrowths,
    atriumOvergrowth,
    ATRIUM_OVERGROWTH_ARCHIVES,
  ),
  atriumRubbles: describePrefabs(atriumRubbleRegistration.families.atriumRubbles, atriumRubble, ATRIUM_RUBBLE_ARCHIVES),
  chessJunk: describePrefabs(
    chessJunkRegistration.families.chessJunk,
    (value, path) => {
      const data = object(value, path, ['chessJunk']);
      if (data.chessJunk === undefined) {
        return {};
      }
      const state = object(data.chessJunk, `${path}.chessJunk`, ['repaired', 'repairerid', 'repairerchar']);
      if (state.repaired !== true) {
        fail(`${path}.chessJunk.repaired`, 'expected true');
      }
      for (const field of ['repairerid', 'repairerchar'] as const) {
        if (state[field] !== undefined && typeof state[field] !== 'string') {
          fail(`${path}.chessJunk.${field}`, 'expected string');
        }
      }
      return {
        chessJunk: {
          repaired: true,
          ...(state.repairerid === undefined ? {} : { repairerid: state.repairerid as string }),
          ...(state.repairerchar === undefined ? {} : { repairerchar: state.repairerchar as string }),
        },
      };
    },
    ['chessmonster_ruins.zip'],
  ),
  // chesspieces.lua onsave writes materialid and submersible:OnSave its flag; this prefab is only ever marble.
  chesspieces: describePrefabs(
    chesspieceRegistration.families.chesspieces,
    (value, path) => {
      const data = object(value, path, ['chesspiece', 'submersible']);
      const components: EntityPersistData = {};
      if (data.chesspiece !== undefined) {
        if (
          object(data.chesspiece, `${path}.chesspiece`, ['materialid']).materialid !== CHESSPIECE_MARBLE_MATERIAL_ID
        ) {
          fail(`${path}.chesspiece.materialid`, 'expected marble');
        }
        components.chesspiece = { materialid: CHESSPIECE_MARBLE_MATERIAL_ID };
      }
      if (data.submersible !== undefined) {
        const flag = object(data.submersible, `${path}.submersible`, ['force_no_repositioning']).force_no_repositioning;
        if (typeof flag !== 'boolean') {
          fail(`${path}.submersible.force_no_repositioning`, 'expected boolean');
        }
        components.submersible = { force_no_repositioning: flag };
      }
      return components;
    },
    [{ animation: 'chesspiece.zip', build: 'swap_chesspiece_malbatross_marble.zip' }],
  ),
  // archive_centipede.lua huskfn has no OnSave; health:OnSave writes the current health.
  archiveCentipedeHusks: describePrefabs(
    archiveCentipedeHuskRegistration.families.archiveCentipedeHusks,
    componentParser({ keys: ['health'] }),
    [{ animation: 'archive_centipede.zip', build: 'archive_centipede_build.zip' }],
  ),
  buildings: describePrefabs(
    BUILDING_PREFAB_IDS,
    perPrefab(BUILDING_PREFAB_IDS.prefabIds, catalogBuilding(false), {
      ...mapPrefabs(BURNABLE_CATALOG_BUILDINGS, () => catalogBuilding(true)),
      [COOK_POT_ID]: cookPot,
      [SCULPTING_TABLE_ID]: sculptingTable,
      [BIRDCAGE_ID]: birdcage,
      [TENT_ID]: tent,
      [MOONBASE_ID]: moonbase,
      [WOOD_CHAIR_ID]: woodChair,
      [LIGHTNING_ROD_ID]: lightningRod,
      [FIRE_PIT_ID]: firepit,
      [FENCE_ID]: fence,
    }),
    {
      ...mapPrefabs(BUILDING_PREFAB_IDS.prefabIds, buildingArchives),
      [FENCE_ID]: [
        { animation: 'fence.zip', build: 'fence.zip' },
        { animation: 'fence_thin.zip', build: 'fence.zip' },
      ],
    },
    buildingSkins,
  ),
  flowers: describePrefabs(flowerRegistration.families.flowers, componentParser({ keys: ['flower'] }), ['flowers.zip']),
  staffLights: describePrefabs(staffLightRegistration.families.staffLights, componentParser({ keys: ['timer'] })),
  bulbPlants: describePrefabs(
    bulbPlantRegistration.families.bulbPlants,
    { flower_cave: bulbSingle, flower_cave_double: bulbDouble, flower_cave_triple: bulbTriple },
    BULB_PLANT_VARIANTS.map(variant => `bulb_plant_${variant}.zip`),
  ),
  lightflierFlowers: describePrefabs(
    lightflierFlowerRegistration.families.lightflierFlowers,
    componentParser({ keys: ['lightflierFlower'] }),
    ['bulb_plant_single.zip', 'bulb_plant_springy.zip', 'lightflier.zip'],
  ),
  molehills: describePrefabs(
    molehillRegistration.families.molehills,
    componentParser({ keys: ['inventory', 'spawner'], inventorySlots: 50 }),
  ),
  beefalos: describePrefabs(
    beefaloRegistration.families.beefalos,
    componentParser({
      keys: ['health', 'knownlocations', 'periodicspawner', 'beard', 'beefalo'],
      componentHealth: true,
    }),
  ),
  stagehand: describePrefabs(
    stagehandRegistration.families.stagehand,
    parseStagehandComponents,
    STAGEHAND_ART.buildArchives.map(build => ({ animation: STAGEHAND_ART.animationArchive, build })),
    buildingSkins,
  ),
  lightningGoats: describePrefabs(
    lightningGoatRegistration.families.lightningGoats,
    componentParser({ keys: ['health', 'knownlocations', 'lightninggoat'], componentHealth: true }),
  ),
  stalagmites: describePrefabs(stalagmiteRegistration.families.stalagmites, empty, id => [`${stalagmiteBank(id)}.zip`]),
  rocks: describePrefabs(rockRegistration.families.rocks, empty, mapPrefabs(ROCK_PREFABS, rockArchives)),
  caveinBoulders: describePrefabs(caveinBoulderRegistration.families.caveinBoulders, caveinBoulder, [
    { animation: 'cavein_boulder.zip', build: 'swap_cavein_boulder.zip' },
  ]),
  moonrockSeeds: describePrefabs(moonrockseedRegistration.families.moonrockSeeds, empty, [
    { animation: 'moonrock_seed.zip', build: 'moonrock_seed.zip' },
  ]),
  moonglassRocks: describePrefabs(
    moonglassRockRegistration.families.moonglassRocks,
    componentParser({ keys: ['rock_type'] }),
    (_prefab, records) => moonglassRockArchives(records),
  ),
  caveHoles: describePrefabs(caveHoleRegistration.families.caveHoles, componentParser({ keys: ['allowspawn'] }), [
    'cave_hole.zip',
  ]),
  pillarRuins: describePrefabs(pillarRegistration.families.pillarRuins, empty, ['pillar_ruins.zip']),
  cavePillars: describePrefabs(pillarRegistration.families.cavePillars, empty, prefab => [`${prefab}.zip`]),
  atriumPillars: describePrefabs(atriumPillarRegistration.families.atriumPillars, empty, ['pillar_atrium.zip']),
  // moon_fissure_fx is persists = false: c_spawn creates it, and no save holds it.
  moonFissures: describePrefabs(moonFissureRegistration.families.moonFissures, empty, [
    'moon_fissure.zip',
    'moon_fissure_fx.zip',
  ]),
  watertreePillars: describePrefabs(
    watertreePillarRegistration.families.watertreePillars,
    watertreePillar,
    WATERTREE_PILLAR_ARCHIVES,
  ),
  oceanTrees: describePrefabs(oceanTreeRegistration.families.oceanTrees, oceanTree, [
    ...OCEANTREE_ARCHIVES,
    'snow.zip',
  ]),
  // The ripples, roots and leaves are persists = false: c_spawn creates them, and no save holds them.
  oceanTreePillars: describePrefabs(
    oceanTreePillarRegistration.families.oceanTreePillars,
    oceanTreePillar,
    OCEANTREE_PILLAR_ARCHIVES,
  ),
  // oceanvine.lua has no OnSave of its own; pickable's record is its whole save.
  oceanVines: describePrefabs(
    oceanVineRegistration.families.oceanVines,
    componentParser({ keys: ['pickable'], regrowTime: OCEANVINE_REGROW_TIME }),
    ['oceanvine.zip'],
  ),
  oceanVineDecos: describePrefabs(oceanVineDecoRegistration.families.oceanVineDecos, oceanVineDeco, [
    'waterforest_vines.zip',
  ]),
  archivePillars: describePrefabs(
    archivePillarRegistration.families.archivePillars,
    archivePillar,
    ARCHIVE_PILLAR_ARCHIVES,
  ),
  vaultPillars: describePrefabs(vaultPillarRegistration.families.vaultPillars, vaultPillar, ['pillar_vault_deep.zip']),
  monkeyPillars: describePrefabs(monkeyPillarRegistration.families.monkeyPillars, monkeyPillar, [
    'pillar_monkey.zip',
    'snow.zip',
  ]),
  caveEntrances: describePrefabs(caveEntranceRegistration.families.caveEntrances, empty, ['cave_entrance.zip']),
  mushroomPlants: describePrefabs(
    mushroomPlantRegistration.families.mushroomPlants,
    componentParser({ keys: ['pickable', 'mushroom'] }),
    ['mushrooms.zip', 'fire.zip'],
  ),
  mushtrees: describePrefabs(
    mushtreeRegistration.families.mushtrees,
    componentParser({
      keys: ['mushtree', 'growable'],
      growthStages: MUSHTREE_GROWTH_STAGES,
      growthTime: Math.max(...MUSHTREE_GROWTH_TIME.map(({ base, random }) => base + random)),
    }),
    [
      'mushroom_tree_tall.zip',
      'mushroom_tree_tall_bloom.zip',
      'mutatedmushroom_tree_build.zip',
      'mushroom_tree_med.zip',
      'mushroom_tree_med_bloom.zip',
      'fire.zip',
    ],
  ),
  caveExits: describePrefabs(caveExitRegistration.families.caveExits, empty, ['cave_exit.zip']),
  grottoPools: describePrefabs(
    grottoPoolRegistration.families.grottoPools,
    componentParser({ keys: ['grottoPool', 'grottoGlass'], grottoChildren: 5 }),
    ['moonglasspool_tile.zip', 'moonglass_bigwaterfall.zip', 'moonglass_bigwaterfall_steam.zip', 'moon_tea_fx.zip'],
  ),
  archiveProps: describePrefabs(
    archivePropsRegistration.families.archiveProps,
    perPrefab(ARCHIVE_PROP_IDS, empty, {
      [ARCHIVE_MOON_STATUE_ID]: archiveStatue,
      [ARCHIVE_RUNE_STATUE_ID]: archiveRune,
    }),
    perPrefab(ARCHIVE_PROP_IDS, [], {
      [ARCHIVE_MOON_STATUE_ID]: [
        { animation: 'archive_moon_statue.zip', build: 'archive_moon_statue.zip' },
        'structure_collapse_fx.zip',
      ],
      [ARCHIVE_RUNE_STATUE_ID]: ['archive_runes.zip'],
      [ARCHIVE_PORTAL_ID]: ['archive_portal.zip', 'archive_portal_base.zip'],
      [ARCHIVE_SWITCH_BASE_ID]: ['archive_switch_ground.zip'],
    }),
  ),
  // skeleton.lua: each prefab's animnum range; only skeleton_player saves a description.
  skeletons: describePrefabs(
    skeletonRegistration.families.skeletons,
    mapPrefabs(SKELETON_IDS, id =>
      componentParser({
        keys: ['skeleton'],
        skeletonAnims: SKELETON_ANIMS[id],
        skeletonDescribed: id === SKELETON_PLAYER_ID,
      }),
    ),
    ['skeletons.zip', 'structure_collapse_fx.zip'],
  ),
  houndbones: describePrefabs(houndboneRegistration.families.houndbones, componentParser({ keys: ['houndbone'] }), [
    'hound_base.zip',
    'structure_collapse_fx.zip',
  ]),
  beeQueenHives: describePrefabs(beeQueenHiveRegistration.families.beeQueenHives, beeQueenHiveComponents, [
    'bee_queen_hive.zip',
  ]),
  dragonflies: describePrefabs(
    dragonflyRegistration.families.dragonflies,
    (value, path) => {
      const data = object(value, path, ['dragonfly']);
      return { dragonfly: parseDragonflyState(data.dragonfly, `${path}.dragonfly`) };
    },
    [
      { animation: 'dragonfly_basic.zip', build: 'dragonfly_build.zip' },
      { animation: 'dragonfly_actions.zip', build: 'dragonfly_build.zip' },
    ],
  ),
  dragonflySpawners: describePrefabs(dragonflySpawnerRegistration.families.dragonflySpawners, (value, path) => {
    const data = object(value, path, ['dragonflySpawner']);
    const state = object(data.dragonflySpawner, `${path}.dragonflySpawner`, ['childspawner', 'worldsettingstimer']);
    const child = object(state.childspawner, `${path}.dragonflySpawner.childspawner`, [
      'childreninside',
      'childrenoutside',
      'spawning',
      'regening',
      'queued_spawn',
      'timetonextspawn',
      'timetonextregen',
      'emergencychildreninside',
    ]);
    const childspawner = {
      childreninside: integer(child.childreninside, `${path}.dragonflySpawner.childspawner.childreninside`, 0, 1),
      childrenoutside:
        child.childrenoutside === undefined
          ? []
          : array(child.childrenoutside, `${path}.dragonflySpawner.childspawner.childrenoutside`, 1).map((id, i) =>
              string(id, `${path}.dragonflySpawner.childspawner.childrenoutside[${i}]`),
            ),
      ...Object.fromEntries(
        (['timetonextspawn', 'timetonextregen', 'emergencychildreninside'] as const)
          .filter(key => child[key] !== undefined)
          .map(key => [key, number(child[key], `${path}.dragonflySpawner.childspawner.${key}`, 0)]),
      ),
      ...Object.fromEntries(
        (['spawning', 'regening', 'queued_spawn'] as const)
          .filter(key => child[key] !== undefined)
          .map(key => {
            if (typeof child[key] !== 'boolean') {
              fail(`${path}.dragonflySpawner.childspawner.${key}`, 'expected boolean');
            }
            return [key, child[key]];
          }),
      ),
    };
    let worldsettingstimer: import('@dontstarve-web/prefab/dragonfly_spawner').DragonflySpawnerSaveState['worldsettingstimer'];
    if (state.worldsettingstimer !== undefined) {
      const timer = object(state.worldsettingstimer, `${path}.dragonflySpawner.worldsettingstimer`, ['timers']);
      const timers = object(timer.timers, `${path}.dragonflySpawner.worldsettingstimer.timers`, ['regen_dragonfly']);
      const value = object(
        timers.regen_dragonfly,
        `${path}.dragonflySpawner.worldsettingstimer.timers.regen_dragonfly`,
        ['timeleft', 'paused', 'initial_time'],
      );
      // worldsettingstimer.lua OnSave writes v.paused, which is nil for a timer that was never paused.
      if (value.paused !== undefined && typeof value.paused !== 'boolean') {
        fail(`${path}.dragonflySpawner.worldsettingstimer.paused`, 'expected boolean');
      }
      worldsettingstimer = {
        timers: {
          regen_dragonfly: {
            timeleft: number(value.timeleft, `${path}.dragonflySpawner.worldsettingstimer.timeleft`, 0),
            paused: value.paused === true,
            initial_time: number(value.initial_time, `${path}.dragonflySpawner.worldsettingstimer.initial_time`, 0),
          },
        },
      };
    }
    return { dragonflySpawner: { childspawner, ...(worldsettingstimer ? { worldsettingstimer } : {}) } };
  }),
  marbleBeanSaplings: describePrefabs(
    marbleBeanSaplingRegistration.families.marbleBeanSaplings,
    componentParser({ keys: ['saplingTimer'] }),
    ['marblebean.zip'],
  ),
  marbleShrubs: describePrefabs(
    marbleShrubRegistration.families.marbleShrubs,
    componentParser({ keys: ['growable', 'marbleShrub'], growthTime: MARBLESHRUB_MAX_GROW_TIME }),
    ['marbleshrub.zip', 'marbleshrub_build.zip'],
  ),
  rockAvocadoSaplings: describePrefabs(
    rockAvocadoSaplingRegistration.families.rockAvocadoSaplings,
    componentParser({ keys: ['saplingTimer'], timerDuration: ROCK_AVOCADO_SPROUT_GROW_TIME }),
  ),
  rockAvocadoBushes: describePrefabs(
    rockAvocadoBushRegistration.families.rockAvocadoBushes,
    componentParser({
      keys: ['pickable', 'witherable', 'growable', 'burning'],
      regrowTime: 0,
      pickCycles: 3,
      minimumPickCycles: 3,
      growthStages: 4,
    }),
  ),
  berrybushes: describePrefabs(
    berrybushRegistration.families.berrybushes,
    componentParser({
      keys: ['pickable', 'witherable'],
      regrowTime: BERRYBUSH_MAX_REGROW_TIME,
      pickCycles: 5,
      minimumPickCycles: 4,
    }),
    [{ animation: BERRYBUSH_ARCHIVE, build: BERRYBUSH_ARCHIVE }],
    () => BERRYBUSH_SKINS,
  ),
  monkeytails: describePrefabs(
    monkeytailRegistration.families.monkeytails,
    componentParser({ keys: ['pickable', 'witherable'], regrowTime: MONKEYTAIL_REGROW_TIME, pickCycles: 7 }),
  ),
  grasses: describePrefabs(
    grassRegistration.families.grasses,
    componentParser({
      keys: ['pickable', 'witherable'],
      regrowTime: GRASS_REGROW_TIME,
      pickCycles: GRASS_CYCLES,
      minimumPickCycles: GRASS_CYCLES,
    }),
    [{ animation: GRASS_ANIM_ARCHIVE, build: GRASS_BUILD_ARCHIVE }],
  ),
  // lichen.lua: only pickable saves state.
  lichens: describePrefabs(
    lichenRegistration.families.lichens,
    componentParser({ keys: ['pickable'], regrowTime: LICHEN_REGROW_TIME }),
    [{ animation: LICHEN_ARCHIVE, build: LICHEN_ARCHIVE }],
  ),
  supportPillars: describePrefabs(
    supportPillarRegistration.families.supportPillars,
    supportPillar,
    SUPPORT_PILLAR_ARCHIVES,
  ),
  oasislakes: describePrefabs(oasislakeRegistration.families.oasislakes, oasislake, OASISLAKE_ARCHIVES),
  beehives: describePrefabs(
    beehiveRegistration.families.beehives,
    hive(BEEHIVE_MAX_BEES, BEEHIVE_HEALTH),
    BEEHIVE_ARCHIVES,
  ),
  // shadow_forge.lua has no OnSave, and its workable sets no savestate: the record is identity and position only.
  shadowForges: describePrefabs(shadowForgeRegistration.families.shadowForges, empty, SHADOW_FORGE_ARCHIVES),
  // spiderden.lua makes spiderden, spiderden_2 and spiderden_3; SetPrefabName saves every level as `spiderden`, so
  // only that ID is registered. Its stage comes from growable.
  spiderDens: describePrefabs(
    spiderdenRegistration.families.spiderDens,
    spiderDen,
    SPIDERDEN_ARCHIVES.map(archive => ({ animation: archive, build: archive })),
  ),
  seastacks: describePrefabs(
    seastackRegistration.families.seastacks,
    seastack,
    SEASTACK_ARCHIVES.map(archive => ({ animation: archive, build: archive })),
  ),
  wasphives: describePrefabs(
    wasphiveRegistration.families.wasphives,
    hive(WASPHIVE_WASPS, WASPHIVE_HEALTH),
    WASPHIVE_ARCHIVES,
  ),
  mastMalbatross: describePrefabs(
    mastMalbatrossRegistration.families.mastMalbatross,
    mastMalbatross,
    MAST_MALBATROSS_ANIMATION_ARCHIVES.map(animation => ({ animation, build: MAST_MALBATROSS_BUILD_ARCHIVE })),
    () => MAST_MALBATROSS_SKINS,
  ),
  // reeds.lua has no OnSave of its own: only pickable saves state.
  reeds: describePrefabs(
    reedsRegistration.families.reeds,
    componentParser({ keys: ['pickable'], regrowTime: REEDS_REGROW_TIME }),
    [{ animation: REEDS_ANIM_ARCHIVE, build: REEDS_BUILD_ARCHIVE }],
  ),
  caveFerns: describePrefabs(
    caveFernRegistration.families.caveFerns,
    componentParser({ keys: ['pickable', 'variant'], plantVariants: CAVE_FERN_ANIMATIONS }),
    prefab => [{ animation: CAVE_FERN_ANIM_ARCHIVE, build: CAVE_FERN_BUILD_ARCHIVES[prefab] }],
  ),
  cacti: describePrefabs(
    cactusRegistration.families.cacti,
    componentParser({ keys: ['pickable'], regrowTime: CACTUS_REGROW_TIME }),
    prefab => [{ animation: `${prefab}.zip`, build: `${prefab}.zip` }],
  ),
  saplings: describePrefabs(
    saplingRegistration.families.saplings,
    componentParser({ keys: ['pickable', 'witherable'], regrowTime: SAPLING_REGROW_TIME }),
  ),
  ponds: describePrefabs(pondRegistration.families.ponds, componentParser({ keys: ['fishable', 'plants'] }), [
    'marsh_tile.zip',
  ]),
  marshPlants: describePrefabs(marshPlantRegistration.families.marshPlants, empty, ['marsh_plant.zip']),
  lavaPonds: describePrefabs(lavaPondRegistration.families.lavaPonds, componentParser({ keys: ['lavaPond'] }), [
    'lava_tile.zip',
    'scorched_rock.zip',
  ]),
  lavaPondRocks: describePrefabs(lavaPondRegistration.families.lavaPondRocks, empty, ['scorched_rock.zip']),
  tumbleweeds: describePrefabs(tumbleweedRegistration.families.tumbleweeds, empty),
  hotsprings: describePrefabs(hotspringRegistration.families.hotsprings, componentParser({ keys: ['hotspring'] }), [
    'crater_pool.zip',
    'crater_steam.zip',
    'slow_steam.zip',
  ]),
  nightmareGrowths: describePrefabs(
    nightmareGrowthRegistration.families.nightmareGrowths,
    componentParser({ keys: ['nightmareGrowth'] }),
    ['nightmaregrowth.zip'],
  ),
  nightmareRocks: describePrefabs(nightmareRockRegistration.families.nightmareRocks, empty),
  wormholes: describePrefabs(wormholeRegistration.families.wormholes, empty, [], () => WORMHOLE_SKINS),
  portals: describePrefabs(portalRegistration.families.portals, empty, ['portal_moonrock.zip', 'portal_stone.zip']),
  reskinEffects: definePrefabs([], empty),
  rain: definePrefabs([], empty),
  snow: definePrefabs([], empty),
  worldFx: describePrefabs(worldFxRegistration.families.worldFx, empty),
  staffProjectiles: describePrefabs(staffProjectileRegistration.families.staffProjectiles, empty),
  staffCastingLights: describePrefabs(staffCastingLightRegistration.families.staffCastingLights, empty),
  oceanWaves: definePrefabs([], empty),
} as const;

export const ITEM_PREFAB_REGISTRATION = groundItemRegistration(
  Object.keys(INVENTORY_ITEM_SPECS),
  new Set(Object.values(WORLD_PREFAB_DEFINITIONS).flatMap((definition: PrefabDefinition) => definition.prefabIds)),
);
export const ITEM_PREFAB_IDS = ITEM_PREFAB_REGISTRATION.families.groundItems.prefabIds;

export const PREFAB_DEFINITIONS = {
  ...WORLD_PREFAB_DEFINITIONS,
  // An item record is its stack, and the record of a machine its prefab's OnSave also writes.
  groundItems: describePrefabs(
    ITEM_PREFAB_REGISTRATION.families.groundItems,
    perPrefab(ITEM_PREFAB_IDS, itemRecord(), {
      [TORCH_ID]: itemRecord(['torch']),
      [LANTERN_ID]: itemRecord(['machine']),
      [PHONOGRAPH_ID]: itemRecord(['phonograph']),
    }),
    groundItemArchives,
  ),
} as const;

export function prefabSaveParsers(
  definitions: readonly PrefabDefinition[],
): ReadonlyMap<string, PrefabComponentParser> {
  const parsers = new Map<string, PrefabComponentParser>();
  for (const definition of definitions) {
    for (const id of definition.prefabIds) {
      if (parsers.has(id)) {
        throw new Error(`Duplicate saved prefab definition: ${id}`);
      }
      parsers.set(id, definition.parseComponents);
    }
  }
  return parsers;
}

/** Each saved prefab's skins, which its record.skinname may name. */
export function prefabSaveSkins(definitions: readonly PrefabDefinition[]): ReadonlyMap<string, readonly string[]> {
  return new Map(
    definitions.flatMap(definition => definition.prefabIds.map(id => [id, definition.skins(id)] as const)),
  );
}

/** Archives needed by the selected save records. Prefabs can still load art on demand. */
export function savedPrefabArchives<RecordType extends ArchiveSaveRecord>(
  definitions: readonly PrefabDefinition[],
  entities: Readonly<Record<string, readonly RecordType[]>>,
  includeRecord?: (record: RecordType) => boolean,
): AnimationArchiveSpec[] {
  const archives = new Map<string, AnimationArchiveSpec>();
  for (const definition of definitions) {
    for (const id of definition.prefabIds) {
      const records = includeRecord ? entities[id]?.filter(includeRecord) : entities[id];
      if (!records?.length) {
        continue;
      }
      for (const spec of definition.archives(id, records)) {
        archives.set(typeof spec === 'string' ? spec : `${spec.animation}\n${spec.build}`, spec);
      }
    }
  }
  return [...archives.values()];
}
