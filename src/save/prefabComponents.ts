import type { SaveCatalog } from './deserialize';
import type { BulbPlantVariant } from '@dontstarve-web/prefab/bulb_plant';
import { FLOWER_ANIMATIONS } from '@dontstarve-web/prefab/flower';
import { BEEFALO_BEARD_BITS, BEEFALO_BEHAVIOR } from '@dontstarve-web/prefab/beefalo';
import type { BeardSave } from '../../packages/componets/src/beard';
import {
  BULB_PLANT_LIGHT_STATES,
  BULB_PLANT_MAX_ON_TIME,
  BULB_PLANT_MAX_RECHARGE_TIME,
  bulbPlantRegrowTime,
} from '@dontstarve-web/prefab/bulb_plant';
import { FARM_PLOW_DRILLING_DURATION, FARM_PLOW_USES, FARM_PLOW_ITEM_ID } from '@dontstarve-web/prefab/farm_plow';
import { SCULPTABLE_MATERIALS } from '@dontstarve-web/prefab/sculptingtable';
import { BIRDCAGE_STARVE_LOOT, CAGE_STATES } from '@dontstarve-web/prefab/birdcage';
import { COOK_POT_ID } from '@dontstarve-web/prefab/cook_pot';
import { MOLE_ID } from '@dontstarve-web/prefab/mole';
import { BIRD_IDS, isBirdId } from '@dontstarve-web/prefab/birds';
import { MOONBASE_KEY_STAFF, MOONBASE_MORPHED_STAFF, MOONBASE_TIMER_LIMITS } from '@dontstarve-web/prefab/moonbase';
/** The moonbase timers' limits by the timer name a save holds; object() has already rejected unknown names. */
const MOONBASE_TIMER_LIMITS_BY_NAME: Readonly<Partial<Record<string, number>>> = MOONBASE_TIMER_LIMITS;
import { LAVA_POND_ROCK_TYPES } from '@dontstarve-web/prefab/lava_pond';
import { BASE_COOK_TIME, GetRecipe } from '../../packages/componets/src/cooking';
import { array, choice, fail, integer, number, object, string } from './validation';
import type {
  EntityPersistData,
  HeldEntityRecord,
  SavedTransform,
  SlotItemsSave,
} from '@dontstarve-web/prefab/saveRecord';

export interface EntitySaveContext {
  readonly prefab: string;
  readonly catalog: SaveCatalog;
  /** GetSaveRecord of an item a holder saved; `refuse` names why the holder cannot hold that prefab. */
  held(value: unknown, path: string, refuse?: (prefab: string) => string | undefined): HeldEntityRecord;
  /** container.lua / inventory.lua OnSave's items by one-based slot, each stack within `maxStack`. */
  slotItems(
    value: unknown,
    path: string,
    slotCount: number,
    refuse?: (prefab: string) => string | undefined,
    maxStack?: number,
  ): SlotItemsSave;
  /** An item's GetPersistData, as its spec allows, with the prefab's own `extra` records. */
  item(value: unknown, path: string, prefab: string, extra?: readonly (keyof EntityPersistData)[]): EntityPersistData;
  transform(value: unknown, path: string, grounded: boolean): SavedTransform;
}

export interface PrefabComponentSchema {
  readonly keys: readonly (keyof EntityPersistData)[];
  /**
   * `health` is health.lua's own OnSave (`{ health, maxhealth, penalty? }`, written by the Health component), not a
   * structure's `{ current, maximum }` record.
   */
  readonly componentHealth?: true;
  /** MakeXBurnable(inst, nil, nil, true): a structure whose onsave can write `building.burnt`. */
  readonly burntStructure?: true;
  readonly timerDuration?: number;
  readonly bulbVariants?: readonly BulbPlantVariant[];
  /** pickable.lua regentime bounding a saved regrow task. */
  readonly pickCycles?: number;
  readonly minimumPickCycles?: number;
  /** cave_fern.lua `names`: the pose clips a plant may save as `variant.anim`. */
  readonly plantVariants?: readonly string[];
  readonly regrowTime?: number;
  /** finiteuses.lua maximum bounding the saved uses. */
  readonly finiteUses?: number;
  readonly growthStages?: number;
  /** growable.lua stage deadline limit; defaults to the 2100 s used by the existing growth tables. */
  readonly growthTime?: number;
  /** archive_props.lua: `math.random(n)` pose count, and the rune statues' number of story lines. */
  readonly archivePropVariants?: number;
  /** skeleton.lua animnum_min..animnum_max; only skeleton_player saves a description. */
  readonly skeletonAnims?: { min: number; max: number };
  readonly skeletonDescribed?: boolean;
  readonly archiveStoryLines?: number;
  /** inventory.lua's slots of a structure whose inventory saves itself, as the molehill's. */
  readonly inventorySlots?: number;
  /** grotto_pool_big.lua prefab_layout size. */
  readonly grottoChildren?: number;
}

export type PrefabComponentParser = (value: unknown, path: string, context: EntitySaveContext) => EntityPersistData;

/** Component readers are reusable; the prefab definition chooses its schema. */
export function componentParser(schema: PrefabComponentSchema): PrefabComponentParser {
  return (value, path, { prefab, catalog, held, slotItems, transform }) => {
    const { keys } = schema;
    const c = object(value, path, keys);
    const components: EntityPersistData = {};
    if (keys.includes('caveinBoulder') && c.caveinBoulder !== undefined) {
      const p = `${path}.caveinBoulder`,
        boulder = object(c.caveinBoulder, p, ['variation', 'raised', 'formed']);
      const state: NonNullable<EntityPersistData['caveinBoulder']> = {
        variation: integer(boulder.variation, `${p}.variation`, 1, 8),
      };
      for (const flag of ['raised', 'formed'] as const) {
        if (boulder[flag] !== undefined) {
          if (boulder[flag] !== true) {
            fail(`${p}.${flag}`, 'expected true');
          }
          state[flag] = true;
        }
      }
      if (state.raised && state.formed) {
        fail(p, 'raised boulders do not save formed');
      }
      components.caveinBoulder = state;
    }
    if (keys.includes('allowspawn') && c.allowspawn !== undefined) {
      if (typeof c.allowspawn !== 'boolean') {
        fail(`${path}.allowspawn`, 'expected boolean');
      }
      components.allowspawn = c.allowspawn;
    }
    if (keys.includes('rock_type') && c.rock_type !== undefined) {
      components.rock_type = integer(c.rock_type, `${path}.rock_type`, 1, 4) as NonNullable<
        EntityPersistData['rock_type']
      >;
    }
    if (keys.includes('lightflierFlower')) {
      const p = `${path}.lightflierFlower`,
        data = object(c.lightflierFlower, p, [
          'variant',
          'lightState',
          'rechargeSeconds',
          'turnoffSeconds',
          'picked',
          'paused',
          'regrowSeconds',
          'childspawner',
        ]);
      if (data.picked !== undefined && typeof data.picked !== 'boolean') {
        fail(`${p}.picked`, 'expected boolean');
      }
      if (data.paused !== undefined && typeof data.paused !== 'boolean') {
        fail(`${p}.paused`, 'expected boolean');
      }
      const child = object(data.childspawner, `${p}.childspawner`, ['childreninside', 'childrenoutside']);
      const ids = array(child.childrenoutside, `${p}.childspawner.childrenoutside`, 100).map((v, i) =>
        string(v, `${p}.childspawner.childrenoutside[${i}]`),
      );
      if (new Set(ids).size !== ids.length) {
        fail(`${p}.childspawner.childrenoutside`, 'duplicate child');
      }
      components.lightflierFlower = {
        variant: choice(data.variant, `${p}.variant`, ['single', 'springy'] as const),
        lightState: choice(data.lightState, `${p}.lightState`, BULB_PLANT_LIGHT_STATES),
        ...(data.picked === undefined ? {} : { picked: data.picked }),
        ...(data.paused === undefined ? {} : { paused: data.paused }),
        ...(data.regrowSeconds === undefined
          ? {}
          : { regrowSeconds: number(data.regrowSeconds, `${p}.regrowSeconds`, 0, 5760) }),
        ...(data.rechargeSeconds === undefined
          ? {}
          : { rechargeSeconds: number(data.rechargeSeconds, `${p}.rechargeSeconds`, 0, 118) }),
        ...(data.turnoffSeconds === undefined
          ? {}
          : { turnoffSeconds: number(data.turnoffSeconds, `${p}.turnoffSeconds`, 0, 198) }),
        childspawner: {
          childreninside: integer(child.childreninside, `${p}.childspawner.childreninside`, 0, 1),
          childrenoutside: ids,
        },
      };
    }
    if (keys.includes('inventory') && schema.inventorySlots !== undefined && c.inventory !== undefined) {
      components.inventory = slotItems(c.inventory, `${path}.inventory`, schema.inventorySlots);
    }
    if (keys.includes('spawner') && c.spawner !== undefined) {
      // spawner.lua OnSave writes one of the occupant's record, a living child's GUID or the spawn delay.
      const p = `${path}.spawner`,
        saved = object(c.spawner, p, ['child', 'childid', 'startdelay']);
      if (['child', 'childid', 'startdelay'].filter(key => saved[key] !== undefined).length > 1) {
        fail(p, 'child, childid and startdelay are exclusive');
      }
      components.spawner =
        saved.child !== undefined
          ? { child: held(saved.child, `${p}.child`, child => (child === MOLE_ID ? undefined : `expected ${MOLE_ID}`)) }
          : saved.childid !== undefined
            ? { childid: string(saved.childid, `${p}.childid`) }
            : saved.startdelay !== undefined
              ? { startdelay: number(saved.startdelay, `${p}.startdelay`, 0, 1200) }
              : {};
    }
    if (keys.includes('lavaPond') && c.lavaPond !== undefined) {
      const p = `${path}.lavaPond`,
        pond = object(c.lavaPond, p, ['rocks']);
      components.lavaPond = {};
      if (pond.rocks !== undefined) {
        components.lavaPond.rocks = array(pond.rocks, `${p}.rocks`).map((value, i) => {
          const r = `${p}.rocks[${i}]`,
            rock = object(value, r, ['rocktype', 'offset']);
          // Lua uses an empty string for the unnumbered first rock prefab.
          if (typeof rock.rocktype !== 'string' || !LAVA_POND_ROCK_TYPES.some(known => known === rock.rocktype)) {
            fail(`${r}.rocktype`, 'unknown lava pond rock type');
          }
          const offset = array(rock.offset, `${r}.offset`, 3);
          if (offset.length !== 3) {
            fail(`${r}.offset`, 'expected three coordinates');
          }
          return {
            rocktype: rock.rocktype as (typeof LAVA_POND_ROCK_TYPES)[number],
            offset: offset.map((value, axis) => number(value, `${r}.offset[${axis}]`, -Number.MAX_SAFE_INTEGER)) as [
              number,
              number,
              number,
            ],
          };
        });
      }
    }
    if (keys.includes('hotspring') && c.hotspring !== undefined) {
      const spring = object(c.hotspring, `${path}.hotspring`, ['isbathbombed']);
      components.hotspring = {};
      if (spring.isbathbombed !== undefined) {
        if (spring.isbathbombed !== true) {
          fail(`${path}.hotspring.isbathbombed`, 'expected true');
        }
        components.hotspring.isbathbombed = true;
      }
    }
    if (keys.includes('burning') && c.burning !== undefined) {
      if (c.burning !== true) {
        fail(`${path}.burning`, 'expected true');
      }
      components.burning = true;
    }
    if (keys.includes('variant') && c.variant !== undefined) {
      const p = `${path}.variant`,
        variant = object(c.variant, p, ['anim']);
      components.variant = { anim: choice(variant.anim, `${p}.anim`, schema.plantVariants ?? []) };
    }
    if (keys.includes('pickable') && c.pickable !== undefined) {
      const p = `${path}.pickable`;
      const pickable = object(c.pickable, p, [
        'picked',
        'regrowSeconds',
        'paused',
        'transplanted',
        'cyclesLeft',
        ...(schema.pickCycles ? ['maxCycles', 'protectedCycles'] : []),
      ]);
      for (const key of ['picked', 'paused', 'transplanted'] as const) {
        if (pickable[key] !== undefined && typeof pickable[key] !== 'boolean') {
          fail(`${p}.${key}`, 'expected a boolean');
        }
      }
      if (pickable.regrowSeconds !== undefined && pickable.picked !== true) {
        fail(p, 'regrowth requires a picked plant');
      }
      let cyclesLeft: number | undefined, maxCycles: number | undefined;
      if (schema.pickCycles) {
        if ((pickable.cyclesLeft === undefined) !== (pickable.maxCycles === undefined)) {
          fail(p, 'cyclesLeft and maxCycles must be saved together');
        }
        if (pickable.maxCycles !== undefined) {
          maxCycles = integer(pickable.maxCycles, `${p}.maxCycles`, schema.minimumPickCycles ?? 5, schema.pickCycles);
        }
        if (pickable.cyclesLeft !== undefined) {
          cyclesLeft = integer(pickable.cyclesLeft, `${p}.cyclesLeft`, 0, maxCycles);
        }
        if (cyclesLeft === 0 && pickable.picked !== true) {
          fail(p, 'barren plants must be picked');
        }
      } else if (pickable.cyclesLeft !== undefined) {
        // pickable.lua MakeBarren saves cycles_left = 0 even when max_cycles is nil.
        if (pickable.cyclesLeft !== 0 || pickable.picked !== true) {
          fail(`${p}.cyclesLeft`, 'only a picked barren plant may save cyclesLeft without maxCycles');
        }
        cyclesLeft = 0;
      }
      components.pickable = {
        ...(pickable.transplanted === true ? { transplanted: true } : {}),
        ...(cyclesLeft === undefined ? {} : { cyclesLeft }),
        ...(maxCycles === undefined ? {} : { maxCycles }),
        ...(pickable.protectedCycles === undefined
          ? {}
          : { protectedCycles: number(pickable.protectedCycles, `${p}.protectedCycles`, Number.MIN_VALUE) }),
        ...(pickable.picked === true ? { picked: true } : {}),
        ...(pickable.paused === true ? { paused: true } : {}),
        ...(pickable.regrowSeconds !== undefined
          ? {
              regrowSeconds: number(pickable.regrowSeconds, `${p}.regrowSeconds`, 0, schema.regrowTime ?? Infinity),
            }
          : {}),
      };
    }
    if (keys.includes('witherable') && c.witherable !== undefined) {
      const p = `${path}.witherable`,
        wither = object(c.witherable, p, [
          'withered',
          'restoreCycles',
          'delaySeconds',
          'taskSeconds',
          'protectSeconds',
        ]);
      if (wither.withered !== undefined && wither.withered !== true) {
        fail(`${p}.withered`, 'expected true');
      }
      if (wither.restoreCycles !== undefined && wither.withered !== true) {
        fail(p, 'restored cycles require withering');
      }
      if (wither.delaySeconds !== undefined && wither.taskSeconds !== undefined) {
        fail(p, 'a delayed check cannot also be scheduled');
      }
      components.witherable = {
        ...(wither.withered === true ? { withered: true } : {}),
        ...(wither.restoreCycles === undefined
          ? {}
          : { restoreCycles: integer(wither.restoreCycles, `${p}.restoreCycles`, 0, schema.pickCycles ?? Infinity) }),
        ...(wither.delaySeconds === undefined
          ? {}
          : { delaySeconds: number(wither.delaySeconds, `${p}.delaySeconds`, 0, 480) }),
        ...(wither.taskSeconds === undefined
          ? {}
          : { taskSeconds: number(wither.taskSeconds, `${p}.taskSeconds`, 0, 60) }),
        ...(wither.protectSeconds === undefined
          ? {}
          : { protectSeconds: number(wither.protectSeconds, `${p}.protectSeconds`, 0, 9600) }),
      };
    }
    const building = keys.includes('building') ? catalog.buildings[prefab] : undefined;
    const containerDefinition = building?.container;
    const isContainer = containerDefinition !== undefined;
    if (keys.includes('farmPlow')) {
      const componentPath = `${path}.farmPlow`;
      const plow = object(c.farmPlow, componentPath, ['phase', 'remainingSeconds', 'deployItem', 'returnUses']);
      const phase = choice(plow.phase, `${componentPath}.phase`, ['drill_pre', 'drill_loop', 'collapse']);
      const remainingSeconds = number(
        plow.remainingSeconds,
        `${componentPath}.remainingSeconds`,
        0,
        FARM_PLOW_DRILLING_DURATION,
      );
      // farm_plow.lua deploy_item_save_record: the deployed item's GetSaveRecord, after finiteuses:Use(1).
      const deployItem =
        plow.deployItem === null || plow.deployItem === undefined
          ? null
          : held(plow.deployItem, `${componentPath}.deployItem`, item =>
              item === FARM_PLOW_ITEM_ID ? undefined : `expected ${FARM_PLOW_ITEM_ID}`,
            );
      if (deployItem && (deployItem.components.finiteuses?.uses ?? FARM_PLOW_USES) >= FARM_PLOW_USES) {
        fail(`${componentPath}.deployItem`, 'expected a deployed farm_plow_item with uses spent');
      }
      if (phase === 'collapse' && (remainingSeconds !== 0 || deployItem === null)) {
        fail(componentPath, 'invalid fold-up state');
      }
      components.farmPlow = { phase, remainingSeconds, deployItem };
    }
    if (keys.includes('farmSoil')) {
      const componentPath = `${path}.farmSoil`;
      const soil = object(c.farmSoil, componentPath, ['broken', 'plowId']);
      if (typeof soil.broken !== 'boolean') {
        fail(`${componentPath}.broken`, 'expected a boolean');
      }
      const plowId = soil.plowId === undefined ? undefined : string(soil.plowId, `${componentPath}.plowId`);
      components.farmSoil = { broken: soil.broken, ...(plowId === undefined ? {} : { plowId }) };
    }
    if (keys.includes('farmDebris')) {
      const componentPath = `${path}.farmDebris`;
      const debris = object(c.farmDebris, componentPath, ['animation']);
      components.farmDebris = {
        animation: choice(debris.animation, `${componentPath}.animation`, ['f1', 'f2', 'f3', 'f4']),
      };
    }
    if (keys.includes('fence') && c.fence !== undefined) {
      const componentPath = `${path}.fence`;
      const fence = object(c.fence, componentPath, ['rot']);
      const rot = fence.rot === undefined ? undefined : number(fence.rot, `${componentPath}.rot`, 1, 7);
      if (rot !== undefined && !Number.isInteger(rot)) {
        fail(`${componentPath}.rot`, 'expected an integer rotation enum');
      }
      components.fence = rot === undefined ? {} : { rot };
    }
    if (keys.includes('moonTree') && c.moonTree !== undefined) {
      const componentPath = `${path}.moonTree`;
      const tree = object(c.moonTree, componentPath, ['stump', 'burnt', 'size']);
      if (tree.stump !== undefined && tree.stump !== true) {
        fail(`${componentPath}.stump`, 'expected true');
      }
      if (tree.burnt !== undefined && tree.burnt !== true) {
        fail(`${componentPath}.burnt`, 'expected true');
      }
      if (tree.burnt && tree.stump) {
        fail(componentPath, 'a burnt tree is not a stump');
      }
      components.moonTree = {
        ...(tree.stump === true ? { stump: true } : {}),
        ...(tree.burnt === true ? { burnt: true } : {}),
        ...(tree.size === undefined
          ? {}
          : { size: choice(tree.size, `${componentPath}.size`, ['short', 'normal', 'tall']) }),
      };
    }
    if (keys.includes('mushtree') && c.mushtree !== undefined) {
      // mushtree.lua OnSave: stump, treestate and burning; of its timers, the stump's decay and acidvisualsupdate.
      const componentPath = `${path}.mushtree`;
      const tree = object(c.mushtree, componentPath, ['stump', 'burnt', 'treestate', 'decay', 'acidvisualsupdate']);
      if (tree.stump !== undefined && tree.stump !== true) {
        fail(`${componentPath}.stump`, 'expected true');
      }
      if (tree.burnt !== undefined && tree.burnt !== true) {
        fail(`${componentPath}.burnt`, 'expected true');
      }
      if (tree.burnt && tree.stump) {
        fail(componentPath, 'a burnt tree is not a stump');
      }
      if (tree.decay !== undefined && tree.stump !== true) {
        fail(`${componentPath}.decay`, 'only a stump decays');
      }
      components.mushtree = {
        ...(tree.stump === true ? { stump: true } : {}),
        ...(tree.burnt === true ? { burnt: true } : {}),
        ...(tree.treestate === undefined
          ? {}
          : { treestate: choice(tree.treestate, `${componentPath}.treestate`, ['normal', 'bloom']) }),
        ...(tree.decay === undefined ? {} : { decay: number(tree.decay, `${componentPath}.decay`, 0, 21600) }),
        ...(tree.acidvisualsupdate === undefined
          ? {}
          : { acidvisualsupdate: number(tree.acidvisualsupdate, `${componentPath}.acidvisualsupdate`, 0, 10) }),
      };
    }
    if (keys.includes('grottoPool') && c.grottoPool !== undefined) {
      // grotto_pool_big.lua / grotto_pool_small.lua on_save: the child entity IDs with their prefab_layout indexes.
      const p = `${path}.grottoPool`,
        pool = object(c.grottoPool, p, ['children']);
      components.grottoPool = {
        children: array(pool.children, `${p}.children`, schema.grottoChildren).map((value, i) => {
          const q = `${p}.children[${i}]`,
            child = object(value, q, ['index', 'id']);
          return {
            index: integer(child.index, `${q}.index`, 1, schema.grottoChildren),
            id: string(child.id, `${q}.id`),
          };
        }),
      };
    }
    if (keys.includes('grottoGlass') && c.grottoGlass !== undefined) {
      // grotto_pool_moonglass.lua workable.savestate: only workleft, up to TUNING.ROCKS_MINE.
      const p = `${path}.grottoGlass`,
        glass = object(c.grottoGlass, p, ['workleft']);
      components.grottoGlass = { workleft: number(glass.workleft, `${p}.workleft`, 0, 6) };
    }
    if (keys.includes('mushroom') && c.mushroom !== undefined) {
      // mushrooms.lua OnSave: rain is saved only while positive (10 + math.random(10) at most).
      const p = `${path}.mushroom`,
        mushroom = object(c.mushroom, p, ['rain']);
      components.mushroom = { rain: integer(mushroom.rain, `${p}.rain`, 1, 20) };
    }
    if (keys.includes('plants') && c.plants !== undefined) {
      // pond.lua OnSave: data.plants, the offsets its plants stand at.
      components.plants = array(c.plants, `${path}.plants`, 16).map((plant, index) => {
        const p = `${path}.plants[${index}]`,
          offset = array(object(plant, p, ['offset']).offset, `${p}.offset`, 3);
        if (offset.length !== 3) {
          fail(`${p}.offset`, 'expected three coordinates');
        }
        const [x, y, z] = offset.map((value, axis) => number(value, `${p}.offset[${axis}]`, -16, 16));
        return { offset: [x, y, z] };
      });
    }
    if (keys.includes('fishable') && c.fishable !== undefined) {
      // fishable.lua OnSave: only a pond with fish taken out saves its remaining count.
      const p = `${path}.fishable`,
        fishable = object(c.fishable, p, ['fish']);
      components.fishable = { fish: integer(fishable.fish, `${p}.fish`, 0, 9) };
    }
    if (keys.includes('growable') && c.growable !== undefined) {
      const p = `${path}.growable`,
        growth = object(c.growable, p, ['stage', 'time', 'sleeptime']);
      components.growable = {
        stage: integer(growth.stage, `${p}.stage`, 1, schema.growthStages ?? 3),
        ...(growth.time === undefined ? {} : { time: number(growth.time, `${p}.time`, 0, schema.growthTime ?? 2100) }),
        ...(growth.sleeptime === undefined ? {} : { sleeptime: number(growth.sleeptime, `${p}.sleeptime`, 0) }),
      };
      const size = components.moonTree?.size;
      if (size && ['short', 'normal', 'tall'].indexOf(size) + 1 !== components.growable.stage) {
        fail(p, 'stage must match moon tree size');
      }
      if ((components.moonTree?.stump || components.moonTree?.burnt) && growth.time !== undefined) {
        fail(p, 'stumps and burnt trees cannot grow');
      }
    }
    if (keys.includes('marbleShrub')) {
      const p = `${path}.marbleShrub`,
        shrub = object(c.marbleShrub, p, ['shapenumber', 'color']);
      if (!components.growable) {
        fail(`${path}.growable`, 'marbleshrub stage is required');
      }
      components.marbleShrub = {
        ...(shrub.shapenumber === undefined
          ? {}
          : { shapenumber: integer(shrub.shapenumber, `${p}.shapenumber`, 2, 3) }),
        color: number(shrub.color, `${p}.color`, 0.5, 1),
      };
    }
    if (keys.includes('archiveProp')) {
      const p = `${path}.archiveProp`,
        prop = object(c.archiveProp, p, ['anim', 'storyprogress']);
      if (prop.storyprogress !== undefined && schema.archiveStoryLines === undefined) {
        fail(`${p}.storyprogress`, 'only rune statues have a story line');
      }
      components.archiveProp = {
        anim: integer(prop.anim, `${p}.anim`, 1, schema.archivePropVariants ?? 1),
        ...(prop.storyprogress === undefined
          ? {}
          : { storyprogress: integer(prop.storyprogress, `${p}.storyprogress`, 1, schema.archiveStoryLines) }),
      };
    }
    if (keys.includes('houndbone')) {
      // houndbone.lua OnSave: bonetype 1..#names.
      const p = `${path}.houndbone`,
        bone = object(c.houndbone, p, ['bonetype']);
      components.houndbone = { bonetype: integer(bone.bonetype, `${p}.bonetype`, 1, 3) };
    }
    if (keys.includes('skeleton')) {
      // skeleton.lua OnSave / Player_OnSave: anim (idle1..6) plus char, playername, userid, pkname and cause.
      const p = `${path}.skeleton`,
        bones = object(
          c.skeleton,
          p,
          schema.skeletonDescribed ? ['anim', 'char', 'playername', 'userid', 'pkname', 'cause'] : ['anim'],
        );
      const optional = (key: 'char' | 'playername' | 'userid' | 'pkname' | 'cause') =>
        bones[key] === undefined ? {} : { [key]: string(bones[key], `${p}.${key}`) };
      components.skeleton = {
        anim: integer(bones.anim, `${p}.anim`, schema.skeletonAnims?.min ?? 1, schema.skeletonAnims?.max ?? 6),
        ...optional('char'),
        ...optional('playername'),
        ...optional('userid'),
        ...optional('pkname'),
        ...optional('cause'),
      };
    }
    if (keys.includes('evergreen')) {
      if (c.evergreen !== undefined) {
        const p = `${path}.evergreen`,
          tree = object(c.evergreen, p, ['stump', 'burnt', 'burntcone']);
        for (const key of ['stump', 'burnt', 'burntcone'] as const) {
          if (tree[key] !== undefined && tree[key] !== true) {
            fail(`${p}.${key}`, 'expected true');
          }
        }
        if (tree.stump && (tree.burnt || tree.burntcone)) {
          fail(p, 'a stump is not burnt');
        }
        if (tree.burntcone && !tree.burnt) {
          fail(`${p}.burntcone`, 'requires burnt');
        }
        components.evergreen = {
          ...(tree.stump === true ? { stump: true as const } : {}),
          ...(tree.burnt === true ? { burnt: true as const } : {}),
          ...(tree.burntcone === true ? { burntcone: true as const } : {}),
        };
      }
      if (!components.growable && !components.evergreen?.burnt && !components.evergreen?.stump) {
        fail(`${path}.growable`, 'evergreen stage is required');
      }
      if ((components.evergreen?.stump || components.evergreen?.burnt) && components.growable?.time !== undefined) {
        fail(`${path}.growable.time`, 'stumps and burnt trees cannot grow');
      }
    }
    if (keys.includes('deciduoustree')) {
      const p = `${path}.deciduoustree`,
        tree = object(c.deciduoustree, p, [
          'stump',
          'burnt',
          'burntcone',
          'build',
          'leaf_state',
          'target_leaf_state',
          'leaveschangetime',
        ]);
      for (const key of ['stump', 'burnt', 'burntcone'] as const) {
        if (tree[key] !== undefined && tree[key] !== true) {
          fail(`${p}.${key}`, 'expected true');
        }
      }
      if (tree.stump && (tree.burnt || tree.burntcone)) {
        fail(p, 'a stump is not burnt');
      }
      if (tree.burntcone && !tree.burnt) {
        fail(`${p}.burntcone`, 'requires burnt');
      }
      components.deciduoustree = {
        ...(tree.stump === true ? { stump: true as const } : {}),
        ...(tree.burnt === true ? { burnt: true as const } : {}),
        ...(tree.burntcone === true ? { burntcone: true as const } : {}),
        ...(tree.build === undefined
          ? {}
          : { build: choice(tree.build, `${p}.build`, ['normal', 'red', 'orange', 'yellow', 'barren'] as const) }),
        leaf_state: choice(tree.leaf_state, `${p}.leaf_state`, ['normal', 'colorful', 'barren'] as const),
        ...(tree.target_leaf_state === undefined && (tree.stump || tree.burnt)
          ? {}
          : {
              target_leaf_state: choice(tree.target_leaf_state, `${p}.target_leaf_state`, [
                'normal',
                'colorful',
                'barren',
              ] as const),
            }),
        ...(tree.leaveschangetime === undefined
          ? {}
          : { leaveschangetime: number(tree.leaveschangetime, `${p}.leaveschangetime`, 0, 900) }),
      };
      if (!components.growable && !tree.stump && !tree.burnt) {
        fail(`${path}.growable`, 'deciduoustree stage is required');
      }
      if (
        (tree.stump || tree.burnt) &&
        (components.growable?.time !== undefined || tree.leaveschangetime !== undefined)
      ) {
        fail(p, 'stumps and burnt trees cannot grow or change leaves');
      }
    }
    for (const timerKey of ['evergreenTimer', 'deciduousTimer', 'moonTreeTimer'] as const) {
      if (!keys.includes(timerKey) || c[timerKey] === undefined) {
        continue;
      }
      const p = `${path}.${timerKey}`,
        timer = object(c[timerKey], p, ['timers']);
      const timers = object(timer.timers, `${p}.timers`, ['decay']);
      components[timerKey] = { timers: {} };
      if (timers.decay !== undefined) {
        const decay = object(timers.decay, `${p}.timers.decay`, ['timeleft', 'paused', 'initial_time']);
        if (typeof decay.paused !== 'boolean') {
          fail(`${p}.timers.decay.paused`, 'expected a boolean');
        }
        const initial_time = number(decay.initial_time, `${p}.timers.decay.initial_time`, 0, 21600);
        components[timerKey].timers.decay = {
          timeleft: number(decay.timeleft, `${p}.timers.decay.timeleft`, 0, initial_time),
          paused: decay.paused,
          initial_time,
        };
      }
    }
    if (keys.includes('saplingTimer')) {
      const p = `${path}.saplingTimer`,
        timer = object(c.saplingTimer ?? (schema.timerDuration ? { timers: {} } : undefined), p, ['timers']);
      const timers = object(timer.timers, `${p}.timers`, ['grow']);
      if (timers.grow === undefined && schema.timerDuration !== undefined) {
        components.saplingTimer = { timers: {} };
      } else {
        const grow = object(timers.grow, `${p}.timers.grow`, ['timeleft', 'paused', 'initial_time']);
        if (typeof grow.paused !== 'boolean') {
          fail(`${p}.timers.grow.paused`, 'expected a boolean');
        }
        const initial_time = number(
          grow.initial_time,
          `${p}.timers.grow.initial_time`,
          schema.timerDuration ?? 150,
          schema.timerDuration ?? 300,
        );
        components.saplingTimer = {
          timers: {
            grow: {
              timeleft: number(grow.timeleft, `${p}.timers.grow.timeleft`, 0, initial_time),
              paused: grow.paused,
              initial_time,
            },
          },
        };
      }
    }
    if (keys.includes('nightmareGrowth')) {
      const componentPath = `${path}.nightmareGrowth`;
      const growth = object(c.nightmareGrowth, componentPath, ['crackRotation']);
      components.nightmareGrowth = {
        crackRotation: number(growth.crackRotation, `${componentPath}.crackRotation`, 0, 360),
      };
    }
    // savedrotation.lua OnSave: Transform:GetRotation, a heading in (-180, 180], absent at 0.
    if (keys.includes('savedrotation') && c.savedrotation !== undefined) {
      const componentPath = `${path}.savedrotation`;
      const saved = object(c.savedrotation, componentPath, ['rotation']);
      const rotation = number(saved.rotation, `${componentPath}.rotation`, -180, 180);
      if (rotation === 0) {
        fail(`${componentPath}.rotation`, 'savedrotation does not save a rotation of 0');
      }
      components.savedrotation = { rotation };
    }
    if (keys.includes('building')) {
      if (!building) {
        fail(path, `missing building definition for ${prefab}`);
      }
      const b = object(c.building, `${path}.building`, ['state', 'burnt']);
      // Older saves also carry `state`; source OnSave has no open state, so it is ignored.
      if (b.burnt !== undefined && (b.burnt !== true || !schema.burntStructure)) {
        fail(`${path}.building.burnt`, 'expected a burnt combustible building');
      }
      components.building = b.burnt ? { burnt: true } : {};
      if (isContainer && (!b.burnt || c.container !== undefined)) {
        components.container =
          c.container === undefined
            ? { items: {} }
            : slotItems(
                c.container,
                `${path}.container`,
                containerDefinition!.slotCount,
                item => (catalog.items[item].canGoInContainer === false ? 'item cannot go in a container' : undefined),
                containerDefinition!.singleItems ? 1 : Infinity,
              );
      }
    }
    if (keys.includes('sculptingtable') && c.sculptingtable !== undefined) {
      const componentPath = `${path}.sculptingtable`;
      const table = object(c.sculptingtable, componentPath, ['itemname']);
      components.sculptingtable = {
        itemname: choice(table.itemname, `${componentPath}.itemname`, Object.keys(SCULPTABLE_MATERIALS)),
      };
    }
    if (keys.includes('CAGE_STATE') && c.CAGE_STATE !== undefined) {
      // birdcage.lua OnSave: CAGE_STATE and bird_type; occupiable saves the bird, the inventory the shelf's item.
      // The poisoned (sick) state needs the unported toadstool gas.
      const cageState = choice(c.CAGE_STATE, `${path}.CAGE_STATE`, [
        CAGE_STATES.DEAD,
        CAGE_STATES.SKELETON,
        CAGE_STATES.EMPTY,
        CAGE_STATES.FULL,
      ]);
      const birdType = c.bird_type === undefined ? undefined : choice(c.bird_type, `${path}.bird_type`, BIRD_IDS);
      const occupiable =
        c.occupiable === undefined ? undefined : object(c.occupiable, `${path}.occupiable`, ['occupant']);
      const occupant =
        occupiable?.occupant === undefined
          ? undefined
          : held(occupiable.occupant, `${path}.occupiable.occupant`, bird =>
              isBirdId(bird) ? undefined : 'expected a bird',
            );
      if (occupant?.components.stackable) {
        fail(`${path}.occupiable.occupant`, 'expected one bird');
      }
      const shelf =
        c.inventory === undefined ? undefined : slotItems(c.inventory, `${path}.inventory`, 1, undefined, 1);
      const item = shelf?.items['1'];
      if ((cageState === CAGE_STATES.FULL) !== (occupant !== undefined)) {
        fail(path, 'an occupied cage needs exactly one occupant');
      }
      if (cageState === CAGE_STATES.FULL && occupant!.prefab !== birdType) {
        fail(`${path}.bird_type`, 'must match the occupant');
      }
      const shelved =
        cageState === CAGE_STATES.DEAD
          ? BIRDCAGE_STARVE_LOOT
          : cageState === CAGE_STATES.SKELETON
            ? catalog.items[BIRDCAGE_STARVE_LOOT].perishReplacement
            : undefined;
      if (item?.prefab !== shelved) {
        fail(`${path}.inventory`, shelved ? `expected ${shelved} on the shelf` : 'unexpected shelved item');
      }
      components.CAGE_STATE = cageState;
      if (birdType !== undefined) {
        components.bird_type = birdType;
      }
      if (occupant) {
        components.occupiable = { occupant };
      }
      if (shelf && item) {
        components.inventory = shelf;
      }
    }
    if (keys.includes('workable') && c.workable !== undefined) {
      const p = `${path}.workable`,
        work = object(c.workable, p, ['workleft', 'maxwork']);
      const maxwork = number(work.maxwork, `${p}.maxwork`, 6, 6);
      components.workable = { maxwork, workleft: number(work.workleft, `${p}.workleft`, 0, maxwork) };
    }
    if (keys.includes('finiteuses') && c.finiteuses !== undefined) {
      const p = `${path}.finiteuses`,
        finite = object(c.finiteuses, p, ['uses']);
      components.finiteuses = { uses: number(finite.uses, `${p}.uses`, 0, schema.finiteUses) };
    }
    if (keys.includes('lightningrod') && c.lightningrod !== undefined) {
      const p = `${path}.lightningrod`,
        rod = object(c.lightningrod, p, ['charged', 'chargeleft']);
      // OnSave only writes charged rods; setcharged(3) is the largest charge and the day callback only decrements it.
      if (rod.charged !== true) {
        fail(`${p}.charged`, 'expected true');
      }
      components.lightningrod = {
        charged: true,
        chargeleft: number(rod.chargeleft, `${p}.chargeleft`, Number.MIN_VALUE, 3),
      };
    }
    if (keys.includes('lightninggoat') && c.lightninggoat !== undefined) {
      const p = `${path}.lightninggoat`,
        goat = object(c.lightninggoat, p, ['charged', 'chargeleft']);
      // OnSave only writes charged goats; setcharged gives three charges and each day boundary takes one.
      if (goat.charged !== true) {
        fail(`${p}.charged`, 'expected true');
      }
      components.lightninggoat = { charged: true, chargeleft: integer(goat.chargeleft, `${p}.chargeleft`, 1, 3) };
    }
    if (keys.includes('firepit') && c.firepit !== undefined) {
      const p = `${path}.firepit`,
        firepit = object(c.firepit, p, ['fueled', 'queued_charcoal']);
      if (firepit.queued_charcoal !== undefined && firepit.queued_charcoal !== true) {
        fail(`${p}.queued_charcoal`, 'expected true');
      }
      const fueled = firepit.fueled === undefined ? undefined : object(firepit.fueled, `${p}.fueled`, ['fuel']);
      // fueled.lua OnSave omits a full pit; FIREPIT_FUEL_MAX is 360.
      components.firepit = {
        ...(fueled ? { fueled: { fuel: number(fueled.fuel, `${p}.fueled.fuel`, 0, 360) } } : {}),
        ...(firepit.queued_charcoal ? { queued_charcoal: true as const } : {}),
      };
    }
    if (keys.includes('moonbase') && c.moonbase !== undefined) {
      const p = `${path}.moonbase`,
        moonbase = object(c.moonbase, p, ['staff', 'timer']);
      components.moonbase = {};
      if (moonbase.staff !== undefined) {
        const staff = held(moonbase.staff, `${p}.staff`, item =>
          item === MOONBASE_KEY_STAFF || item === MOONBASE_MORPHED_STAFF ? undefined : 'expected one light staff',
        );
        if ((components.workable?.workleft ?? 4) <= 0) {
          fail(p, 'a destroyed moonbase cannot hold a staff');
        }
        components.moonbase.staff = staff;
      }
      if (moonbase.timer !== undefined) {
        const t = `${p}.timer`,
          timer = object(moonbase.timer, t, ['timers']);
        const timers = object(timer.timers, `${t}.timers`, Object.keys(MOONBASE_TIMER_LIMITS));
        const parsed: import('../../packages/componets/src/timer').NamedTimerSave['timers'] = {};
        for (const [name, value] of Object.entries(timers)) {
          const entryPath = `${t}.timers.${name}`,
            entry = object(value, entryPath, ['timeleft', 'paused', 'initial_time']);
          if (typeof entry.paused !== 'boolean') {
            fail(`${entryPath}.paused`, 'expected a boolean');
          }
          const maximum = MOONBASE_TIMER_LIMITS_BY_NAME[name];
          const initial_time = number(entry.initial_time, `${entryPath}.initial_time`, 0, maximum);
          parsed[name] = {
            timeleft: number(entry.timeleft, `${entryPath}.timeleft`, 0, initial_time),
            paused: entry.paused,
            initial_time,
          };
        }
        const pending = ['mooncharge', 'moonchargepre', 'mooncharge2', 'mooncharge3'].some(name =>
          Object.hasOwn(parsed, name),
        );
        if (
          pending &&
          (components.moonbase.staff?.prefab !== MOONBASE_KEY_STAFF || (components.workable?.workleft ?? 4) <= 0)
        ) {
          fail(t, `charging requires a ${MOONBASE_KEY_STAFF} and a live moonbase`);
        }
        if (parsed.mooncharge && parsed.moonchargepre) {
          fail(t, 'cannot prepare and charge together');
        }
        if ((parsed.mooncharge2 || parsed.mooncharge3) && !parsed.mooncharge) {
          fail(t, 'charge stages require the charge timer');
        }
        if (parsed.mooncharge2 && parsed.mooncharge3) {
          fail(t, 'cannot have both stage timers');
        }
        components.moonbase.timer = { timers: parsed };
      }
    }
    if (keys.includes('stewer') && c.stewer !== undefined) {
      const p = `${path}.stewer`;
      // stewer.lua OnSave: the product, done, and the time left while it cooks; a harvested pot keeps only what was cooked
      // last, which OnLoad ignores.
      const saved = object(c.stewer, p, [
        'product',
        'done',
        'remainingtime',
        'phase',
        'remainingSeconds',
        'ingredient_prefabs',
        'chef_id',
      ]);
      // The earlier { phase, remainingSeconds } shape migrates on read and is no longer written.
      const stewer = { ...saved };
      if (saved.phase !== undefined || saved.remainingSeconds !== undefined) {
        if (saved.done !== undefined || saved.remainingtime !== undefined) {
          fail(p, 'mixes the stewer save shapes');
        }
        const done = choice(saved.phase, `${p}.phase`, ['cooking', 'done']) === 'done';
        stewer.done = done ? true : undefined;
        stewer.remainingtime = done ? undefined : saved.remainingSeconds;
      }
      if (stewer.product === undefined) {
        if (stewer.done !== undefined || stewer.remainingtime !== undefined) {
          fail(p, 'cooking state requires a product');
        }
        components.stewer = {};
      } else {
        const product = string(stewer.product, `${p}.product`);
        const recipe = GetRecipe(COOK_POT_ID, product);
        if (!recipe) {
          fail(`${p}.product`, 'unknown cooking product');
        }
        if (stewer.done !== undefined && stewer.done !== true) {
          fail(`${p}.done`, 'expected true');
        }
        const done = stewer.done === true;
        if (done === (stewer.remainingtime !== undefined)) {
          fail(p, 'cooking needs remaining time; done has none');
        }
        if (Object.keys(components.container?.items ?? {}).length) {
          fail(p, 'cooking and full pots must have no ingredients');
        }
        components.stewer = done
          ? { product, done: true }
          : {
              product,
              remainingtime: number(stewer.remainingtime, `${p}.remainingtime`, 0, BASE_COOK_TIME * recipe!.cooktime),
            };
      }
      if (stewer.ingredient_prefabs !== undefined) {
        if (
          !Array.isArray(stewer.ingredient_prefabs) ||
          stewer.ingredient_prefabs.length !== containerDefinition!.slotCount
        ) {
          fail(`${p}.ingredient_prefabs`, 'expected the cooked ingredients');
        }
        components.stewer.ingredient_prefabs = (stewer.ingredient_prefabs as unknown[]).map((value, index) =>
          string(value, `${p}.ingredient_prefabs[${index}]`),
        );
      }
      if (stewer.chef_id !== undefined) {
        components.stewer.chef_id = string(stewer.chef_id, `${p}.chef_id`);
      }
    }
    const locations = (value: unknown, locationsPath: string) => {
      const saved = object(value, locationsPath, ['locations']);
      const names = new Set<string>();
      return {
        locations: array(saved.locations, `${locationsPath}.locations`).map((entry, index) => {
          const p = `${locationsPath}.locations[${index}]`,
            location = object(entry, p, ['name', 'x', 'y', 'z']);
          const name = string(location.name, `${p}.name`);
          if (names.has(name)) {
            fail(`${p}.name`, 'duplicate location name');
          }
          names.add(name);
          const [x, y, z] = transform(
            { position: [location.x, location.y, location.z], rotationY: 0 },
            p,
            true,
          ).position;
          return { name, x, y, z };
        }),
      };
    };
    // knownlocations.lua, periodicspawner.lua and beard.lua OnSave.
    if (keys.includes('knownlocations') && c.knownlocations !== undefined) {
      components.knownlocations = locations(c.knownlocations, `${path}.knownlocations`);
    }
    if (keys.includes('periodicspawner') && c.periodicspawner !== undefined) {
      const p = `${path}.periodicspawner`,
        spawner = object(c.periodicspawner, p, ['time']);
      components.periodicspawner = { time: number(spawner.time, `${p}.time`, 0, BEEFALO_BEHAVIOR.poopMaxSeconds) };
    }
    if (keys.includes('beard') && c.beard !== undefined) {
      components.beard = beard(c.beard, `${path}.beard`);
    }
    // A beefalo save from before its components saved themselves; the prefab's OnLoad reads it.
    if (keys.includes('beefalo') && c.beefalo !== undefined) {
      const componentPath = `${path}.beefalo`;
      const beefalo = object(c.beefalo, componentPath, [
        'home',
        'heading',
        'poopRemainingSeconds',
        'beard',
        'knownlocations',
      ]);
      const home = transform({ position: beefalo.home, rotationY: 0 }, `${componentPath}.home`, true).position;
      components.beefalo = {
        home,
        heading: number(beefalo.heading, `${componentPath}.heading`, 0, 360),
        poopRemainingSeconds: number(
          beefalo.poopRemainingSeconds,
          `${componentPath}.poopRemainingSeconds`,
          0,
          BEEFALO_BEHAVIOR.poopMaxSeconds,
        ),
        ...(beefalo.knownlocations === undefined
          ? {}
          : { knownlocations: locations(beefalo.knownlocations, `${componentPath}.knownlocations`) }),
        // beard.lua OnSave; saves from before the beard component keep the full, hairy default.
        ...(beefalo.beard === undefined ? {} : { beard: beard(beefalo.beard, `${componentPath}.beard`) }),
      };
    }
    if (keys.includes('bulbPlant')) {
      const componentPath = `${path}.bulbPlant`;
      const plant = object(c.bulbPlant, componentPath, [
        'variant',
        'lightState',
        'remainingSeconds',
        'picked',
        'regrowSeconds',
      ]);
      const variant = choice(plant.variant, `${componentPath}.variant`, schema.bulbVariants!);
      const lightState = choice(plant.lightState, `${componentPath}.lightState`, BULB_PLANT_LIGHT_STATES);
      if (plant.picked !== undefined && typeof plant.picked !== 'boolean') {
        fail(`${componentPath}.picked`, 'expected boolean');
      }
      const picked = plant.picked === true;
      if (picked && lightState === 'ON') {
        fail(`${componentPath}.lightState`, 'picked plant cannot emit light');
      }
      if ((picked || lightState === 'CHARGED') && plant.remainingSeconds !== undefined) {
        fail(`${componentPath}.remainingSeconds`, 'plant has no active light timer');
      }
      if (!picked && plant.regrowSeconds !== undefined) {
        fail(`${componentPath}.regrowSeconds`, 'mature plant has no regrowth timer');
      }
      components.bulbPlant = {
        variant,
        lightState,
        ...(picked || lightState === 'CHARGED'
          ? {}
          : {
              remainingSeconds: number(
                plant.remainingSeconds,
                `${componentPath}.remainingSeconds`,
                Number.MIN_VALUE,
                lightState === 'ON' ? BULB_PLANT_MAX_ON_TIME : BULB_PLANT_MAX_RECHARGE_TIME,
              ),
            }),
        ...(plant.picked === undefined ? {} : { picked: plant.picked }),
        ...(picked
          ? {
              regrowSeconds: number(
                plant.regrowSeconds,
                `${componentPath}.regrowSeconds`,
                Number.MIN_VALUE,
                bulbPlantRegrowTime(variant),
              ),
            }
          : {}),
      };
    }
    if (keys.includes('flower')) {
      const componentPath = `${path}.flower`;
      const flower = object(c.flower, componentPath, ['animation', 'planted']);
      if (flower.planted !== undefined && flower.planted !== true) {
        fail(`${componentPath}.planted`, 'expected true');
      }
      components.flower = {
        animation: choice(flower.animation, `${componentPath}.animation`, FLOWER_ANIMATIONS),
        ...(flower.planted === true ? { planted: true as const } : {}),
      };
    }
    if (keys.includes('timer')) {
      // timer.lua OnSave. The source's durations differ from a new star's, so the record's own initial_time is the limit.
      const p = `${path}.timer`,
        timer = object(c.timer, p, ['timers']);
      const timers = object(timer.timers, `${p}.timers`, ['extinguish']);
      const extinguish = object(timers.extinguish, `${p}.timers.extinguish`, ['timeleft', 'paused', 'initial_time']);
      if (typeof extinguish.paused !== 'boolean') {
        fail(`${p}.timers.extinguish.paused`, 'expected a boolean');
      }
      const initial_time = number(extinguish.initial_time, `${p}.timers.extinguish.initial_time`, Number.MIN_VALUE);
      components.timer = {
        timers: {
          extinguish: {
            timeleft: number(extinguish.timeleft, `${p}.timers.extinguish.timeleft`, 0, initial_time),
            paused: extinguish.paused,
            initial_time,
          },
        },
      };
    }
    if (c.health !== undefined && schema.componentHealth) {
      const p = `${path}.health`,
        h = object(c.health, p, ['health', 'maxhealth', 'penalty']);
      // this port's Health always writes its maximum.
      const maxhealth = number(h.maxhealth, `${p}.maxhealth`, Number.MIN_VALUE);
      components.health = {
        health: number(h.health, `${p}.health`, 0, maxhealth),
        maxhealth,
        ...(h.penalty === undefined ? {} : { penalty: number(h.penalty, `${p}.penalty`, 0, 1) }),
      };
    } else if (c.health !== undefined) {
      const h = object(c.health, `${path}.health`, ['current', 'maximum']);
      const maximum = number(h.maximum, `${path}.health.maximum`, 1);
      components.health = { current: number(h.current, `${path}.health.current`, 0, maximum), maximum };
    }
    return components;
  };
}

function beard(value: unknown, path: string): BeardSave {
  const data = object(value, path, ['growth', 'growthaccumulator', 'bits']);
  return {
    growth: integer(data.growth, `${path}.growth`),
    growthaccumulator: number(data.growthaccumulator, `${path}.growthaccumulator`),
    bits: integer(data.bits, `${path}.bits`, 0, BEEFALO_BEARD_BITS),
  };
}
