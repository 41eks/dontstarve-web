import type { InventoryStack } from '@dontstarve-web/inventory';
import type { SavedContainer, SavedEntity, SavedTransform } from './types';
import type { SaveCatalog } from './deserialize';
import type { BulbPlantVariant } from '@dontstarve-web/prefab/bulb_plant';
import { FLOWER_ANIMATIONS } from '@dontstarve-web/prefab/flower';
import { BEEFALO_BEARD_BITS, BEEFALO_BEHAVIOR } from '@dontstarve-web/prefab/beefalo';
import type { BeardSave } from '../../packages/componets/src/beard';
import { BULB_PLANT_LIGHT_STATES, BULB_PLANT_MAX_ON_TIME, BULB_PLANT_MAX_RECHARGE_TIME,
  bulbPlantRegrowTime } from '@dontstarve-web/prefab/bulb_plant';
import { WORMHOLE_SKINS } from '@dontstarve-web/prefab/wormhole';
import { WALL_SKIN_ARCHIVES } from '@dontstarve-web/prefab/wallSkins';
import { FENCE_SKIN_ARCHIVES } from '@dontstarve-web/prefab/fenceSkins';
import { FARM_PLOW_DRILLING_DURATION, FARM_PLOW_USES, FARM_PLOW_ITEM_ID } from '@dontstarve-web/prefab/farm_plow';
import { PHONOGRAPH_PLAY_TIME } from '@dontstarve-web/prefab/phonograph';
import { SCULPTABLE_MATERIALS } from '@dontstarve-web/prefab/sculptingtable';
import { CAGE_STATES } from '@dontstarve-web/prefab/birdcage';
import { BIRD_IDS, isBirdId } from '@dontstarve-web/prefab/birds';
import { MOONBASE_TIMER_LIMITS } from '@dontstarve-web/prefab/moonbase';
import { LAVA_POND_ROCK_TYPES } from '@dontstarve-web/prefab/lava_pond';
import { BASE_COOK_TIME, GetRecipe } from '../../packages/componets/src/cooking';
import { array, choice, fail, integer, number, object, string } from './validation';

export interface EntitySaveContext {
  readonly prefab: string;
  readonly catalog: SaveCatalog;
  stack(value: unknown, path: string): InventoryStack;
  container(value: unknown, path: string, keys: readonly string[], maxStack?: number): SavedContainer;
  transform(value: unknown, path: string, grounded: boolean): SavedTransform;
}

export interface PrefabComponentSchema {
  readonly keys: readonly (keyof SavedEntity['components'])[];
  readonly timerDuration?: number;
  readonly bulbVariants?: readonly BulbPlantVariant[];
  /** pickable.lua regentime bounding a saved regrow task. */
  readonly pickCycles?: number;
  readonly minimumPickCycles?: number;
  readonly plantSkins?: readonly string[];
  readonly regrowTime?: number;
  /** finiteuses.lua maximum bounding the saved uses. */
  readonly finiteUses?: number;
  readonly growthStages?: number;
  /** growable.lua stage deadline limit; defaults to the 2100 s used by the existing growth tables. */
  readonly growthTime?: number;
}

export type PrefabComponentParser = (value: unknown, path: string, context: EntitySaveContext) => SavedEntity['components'];

/** Component readers are reusable; the prefab definition chooses its schema. */
export function componentParser(schema: PrefabComponentSchema): PrefabComponentParser {
  return (value, path, { prefab, catalog, stack, container, transform }) => {
    const { keys } = schema;
    const c = object(value, path, keys);
    const components: SavedEntity['components'] = {};
    if (keys.includes('molehill')) {
      const p = `${path}.molehill`, hill = object(c.molehill, p, ['items', 'child', 'childid', 'startdelay']);
      const child = hill.child === undefined ? undefined : stack(hill.child, `${p}.child`);
      if (child && child.itemId !== 'mole') fail(`${p}.child`, 'expected mole');
      if (hill.child !== undefined && hill.childid !== undefined) fail(p, 'occupied child and childid are exclusive');
      components.molehill = { items: array(hill.items, `${p}.items`, 50).map((item, i) => stack(item, `${p}.items[${i}]`)),
        ...(child === undefined ? {} : { child }),
        ...(hill.childid === undefined ? {} : { childid: string(hill.childid, `${p}.childid`) }),
        ...(hill.startdelay === undefined ? {} : { startdelay: number(hill.startdelay, `${p}.startdelay`, 0, 1200) }) };
    }
    if (keys.includes('lavaPond') && c.lavaPond !== undefined) {
      const p = `${path}.lavaPond`, pond = object(c.lavaPond, p, ['rocks']);
      components.lavaPond = {};
      if (pond.rocks !== undefined) components.lavaPond.rocks = array(pond.rocks, `${p}.rocks`).map((value, i) => {
        const r = `${p}.rocks[${i}]`, rock = object(value, r, ['rocktype', 'offset']);
        // Lua uses an empty string for the unnumbered first rock prefab.
        if (typeof rock.rocktype !== 'string' || !(LAVA_POND_ROCK_TYPES as readonly string[]).includes(rock.rocktype)) fail(`${r}.rocktype`, 'unknown lava pond rock type');
        const offset = array(rock.offset, `${r}.offset`, 3);
        if (offset.length !== 3) fail(`${r}.offset`, 'expected three coordinates');
        return { rocktype: rock.rocktype as typeof LAVA_POND_ROCK_TYPES[number],
          offset: offset.map((value, axis) => number(value, `${r}.offset[${axis}]`, -Number.MAX_SAFE_INTEGER)) as [number, number, number] };
      });
    }
    if (keys.includes('hotspring') && c.hotspring !== undefined) {
      const spring = object(c.hotspring, `${path}.hotspring`, ['isbathbombed']);
      components.hotspring = {};
      if (spring.isbathbombed !== undefined) {
        if (spring.isbathbombed !== true) fail(`${path}.hotspring.isbathbombed`, 'expected true');
        components.hotspring.isbathbombed = true;
      }
    }
    if (keys.includes('burning') && c.burning !== undefined) {
      if (c.burning !== true) fail(`${path}.burning`, 'expected true');
      components.burning = true;
    }
    if (keys.includes('plant') && c.plant !== undefined) {
      const p = `${path}.plant`, plant = object(c.plant, p, ['skinId']);
      components.plant = plant.skinId === undefined ? {} : { skinId: choice(plant.skinId, `${p}.skinId`, schema.plantSkins ?? []) };
    }
    if (keys.includes('pickable') && c.pickable !== undefined) {
      const p = `${path}.pickable`;
      const pickable = object(c.pickable, p, ['picked', 'regrowSeconds', 'paused', 'transplanted', ...(schema.pickCycles ? ['cyclesLeft', 'maxCycles', 'protectedCycles'] : [])]);
      for (const key of ['picked', 'paused', 'transplanted'] as const) {
        if (pickable[key] !== undefined && typeof pickable[key] !== 'boolean') fail(`${p}.${key}`, 'expected a boolean');
      }
      if (pickable.regrowSeconds !== undefined && pickable.picked !== true) fail(p, 'regrowth requires a picked plant');
      if (schema.pickCycles) {
        if ((pickable.cyclesLeft === undefined) !== (pickable.maxCycles === undefined)) fail(p, 'cyclesLeft and maxCycles must be saved together');
        if (pickable.maxCycles !== undefined) integer(pickable.maxCycles, `${p}.maxCycles`, schema.minimumPickCycles ?? 5, schema.pickCycles);
        if (pickable.cyclesLeft !== undefined) integer(pickable.cyclesLeft, `${p}.cyclesLeft`, 0, pickable.maxCycles as number);
        if (pickable.cyclesLeft === 0 && (pickable.picked !== true || pickable.regrowSeconds !== undefined)) fail(p, 'barren plants must be picked with no regrowth timer');
      }
      components.pickable = {
        ...(pickable.transplanted === true ? { transplanted: true } : {}),
        ...(pickable.maxCycles === undefined ? {} : { maxCycles: pickable.maxCycles as number, cyclesLeft: pickable.cyclesLeft as number }),
        ...(pickable.protectedCycles === undefined ? {} : { protectedCycles: number(pickable.protectedCycles, `${p}.protectedCycles`, Number.MIN_VALUE) }),
        ...(pickable.picked === true ? { picked: true } : {}),
        ...(pickable.paused === true ? { paused: true } : {}),
        ...(pickable.regrowSeconds !== undefined ? {
          regrowSeconds: number(pickable.regrowSeconds, `${p}.regrowSeconds`, 0, schema.regrowTime ?? Infinity),
        } : {}),
      };
    }
    if (keys.includes('witherable') && c.witherable !== undefined) {
      const p = `${path}.witherable`, wither = object(c.witherable, p, ['withered', 'restoreCycles', 'delaySeconds', 'taskSeconds']);
      if (wither.withered !== undefined && wither.withered !== true) fail(`${p}.withered`, 'expected true');
      if (wither.restoreCycles !== undefined && wither.withered !== true) fail(p, 'restored cycles require withering');
      if (wither.delaySeconds !== undefined && wither.taskSeconds !== undefined) fail(p, 'a delayed check cannot also be scheduled');
      components.witherable = {
        ...(wither.withered === true ? { withered: true } : {}),
        ...(wither.restoreCycles === undefined ? {} : { restoreCycles: integer(wither.restoreCycles, `${p}.restoreCycles`, 0, schema.pickCycles ?? Infinity) }),
        ...(wither.delaySeconds === undefined ? {} : { delaySeconds: number(wither.delaySeconds, `${p}.delaySeconds`, 0, 480) }),
        ...(wither.taskSeconds === undefined ? {} : { taskSeconds: number(wither.taskSeconds, `${p}.taskSeconds`, 0, 60) }),
      };
    }
    const building = keys.includes('building') ? catalog.buildings[prefab] : undefined;
    const containerDefinition = building?.container;
    const isContainer = containerDefinition !== undefined;
    const numericKeys = (count: number) => Array.from({ length: count }, (_, i) => String(i));
    if (keys.includes('farmPlow')) {
      const componentPath = `${path}.farmPlow`;
      const plow = object(c.farmPlow, componentPath, ['phase', 'remainingSeconds', 'deployItem', 'returnUses']);
      const phase = choice(plow.phase, `${componentPath}.phase`, ['drill_pre', 'drill_loop', 'collapse']);
      const remainingSeconds = number(plow.remainingSeconds, `${componentPath}.remainingSeconds`, 0, FARM_PLOW_DRILLING_DURATION);
      let deployItem: InventoryStack | null;
      if (Object.hasOwn(plow, 'deployItem')) {
        if (Object.hasOwn(plow, 'returnUses')) fail(componentPath, 'cannot combine deployItem and legacy returnUses');
        deployItem = plow.deployItem === null ? null : stack(plow.deployItem, `${componentPath}.deployItem`);
        if (deployItem && (deployItem.itemId !== FARM_PLOW_ITEM_ID || deployItem.count !== 1
          || deployItem.remainingUses === undefined || deployItem.remainingUses >= FARM_PLOW_USES)) {
          fail(`${componentPath}.deployItem`, 'expected one deployed farm_plow_item with remaining uses');
        }
      } else {
        const returnUses = integer(plow.returnUses, `${componentPath}.returnUses`, 0, FARM_PLOW_USES - 1);
        deployItem = returnUses === 0 ? null : { itemId: FARM_PLOW_ITEM_ID, count: 1, remainingUses: returnUses };
      }
      if (phase === 'collapse' && (remainingSeconds !== 0 || deployItem === null)) fail(componentPath, 'invalid fold-up state');
      components.farmPlow = { phase, remainingSeconds, deployItem };
    }
    if (keys.includes('farmSoil')) {
      const componentPath = `${path}.farmSoil`;
      const soil = object(c.farmSoil, componentPath, ['broken', 'plowId']);
      if (typeof soil.broken !== 'boolean') fail(`${componentPath}.broken`, 'expected a boolean');
      const plowId = soil.plowId === undefined ? undefined : string(soil.plowId, `${componentPath}.plowId`);
      components.farmSoil = { broken: soil.broken, ...(plowId === undefined ? {} : { plowId }) };
    }
    if (keys.includes('farmDebris')) {
      const componentPath = `${path}.farmDebris`;
      const debris = object(c.farmDebris, componentPath, ['animation']);
      components.farmDebris = { animation: choice(debris.animation, `${componentPath}.animation`, ['f1', 'f2', 'f3', 'f4']) };
    }
    if (keys.includes('wall') && c.wall !== undefined) {
      const componentPath = `${path}.wall`;
      const wall = object(c.wall, componentPath, ['skinId']);
      const skinId = wall.skinId === undefined ? undefined : string(wall.skinId, `${componentPath}.skinId`);
      if (skinId !== undefined && !Object.hasOwn(WALL_SKIN_ARCHIVES[prefab] ?? {}, skinId)) {
        fail(`${componentPath}.skinId`, 'unsupported wall skin');
      }
      components.wall = skinId === undefined ? {} : { skinId };
    }
    if (keys.includes('fence') && c.fence !== undefined) {
      const componentPath = `${path}.fence`;
      const fence = object(c.fence, componentPath, ['rot', 'skinId']);
      const rot = fence.rot === undefined ? undefined : number(fence.rot, `${componentPath}.rot`, 1, 7);
      if (rot !== undefined && !Number.isInteger(rot)) fail(`${componentPath}.rot`, 'expected an integer rotation enum');
      const skinId = fence.skinId === undefined ? undefined : string(fence.skinId, `${componentPath}.skinId`);
      if (skinId !== undefined && !Object.hasOwn(FENCE_SKIN_ARCHIVES, skinId)) fail(`${componentPath}.skinId`, 'unsupported fence skin');
      components.fence = { ...(rot === undefined ? {} : { rot }), ...(skinId === undefined ? {} : { skinId }) };
    }
    if (keys.includes('moonTree') && c.moonTree !== undefined) {
      const componentPath = `${path}.moonTree`;
      const tree = object(c.moonTree, componentPath, ['stump', 'burnt', 'size']);
      if (tree.stump !== undefined && tree.stump !== true) fail(`${componentPath}.stump`, 'expected true');
      if (tree.burnt !== undefined && tree.burnt !== true) fail(`${componentPath}.burnt`, 'expected true');
      if (tree.burnt && tree.stump) fail(componentPath, 'a burnt tree is not a stump');
      components.moonTree = { ...(tree.stump === true ? { stump: true } : {}), ...(tree.burnt === true ? { burnt: true } : {}),
        ...(tree.size === undefined ? {} : { size: choice(tree.size, `${componentPath}.size`, ['short', 'normal', 'tall']) }) };
    }
    if (keys.includes('fishable') && c.fishable !== undefined) {
      // fishable.lua OnSave: only a pond with fish taken out saves its remaining count.
      const p = `${path}.fishable`, fishable = object(c.fishable, p, ['fish']);
      components.fishable = { fish: integer(fishable.fish, `${p}.fish`, 0, 9) };
    }
    if (keys.includes('growable') && c.growable !== undefined) {
      const p = `${path}.growable`, growth = object(c.growable, p, ['stage', 'time', 'sleeptime']);
      components.growable = { stage: integer(growth.stage, `${p}.stage`, 1, schema.growthStages ?? 3),
        ...(growth.time === undefined ? {} : { time: number(growth.time, `${p}.time`, 0, schema.growthTime ?? 2100) }),
        ...(growth.sleeptime === undefined ? {} : { sleeptime: number(growth.sleeptime, `${p}.sleeptime`, 0) }) };
      const size = components.moonTree?.size;
      if (size && ['short', 'normal', 'tall'].indexOf(size) + 1 !== components.growable.stage) fail(p, 'stage must match moon tree size');
      if ((components.moonTree?.stump || components.moonTree?.burnt) && growth.time !== undefined) fail(p, 'stumps and burnt trees cannot grow');
    }
    if (keys.includes('marbleShrub')) {
      const p = `${path}.marbleShrub`, shrub = object(c.marbleShrub, p, ['shapenumber', 'color']);
      if (!components.growable) fail(`${path}.growable`, 'marbleshrub stage is required');
      components.marbleShrub = { ...shrub.shapenumber === undefined ? {} : { shapenumber: integer(shrub.shapenumber, `${p}.shapenumber`, 2, 3) },
        color: number(shrub.color, `${p}.color`, .5, 1) };
    }
    if (keys.includes('evergreen')) {
      if (c.evergreen !== undefined) {
        const p = `${path}.evergreen`, tree = object(c.evergreen, p, ['stump', 'burnt', 'burntcone']);
        for (const key of ['stump', 'burnt', 'burntcone'] as const) {
          if (tree[key] !== undefined && tree[key] !== true) fail(`${p}.${key}`, 'expected true');
        }
        if (tree.stump && (tree.burnt || tree.burntcone)) fail(p, 'a stump is not burnt');
        if (tree.burntcone && !tree.burnt) fail(`${p}.burntcone`, 'requires burnt');
        components.evergreen = { ...(tree.stump === true ? { stump: true as const } : {}),
          ...(tree.burnt === true ? { burnt: true as const } : {}), ...(tree.burntcone === true ? { burntcone: true as const } : {}) };
      }
      if (!components.growable) fail(`${path}.growable`, 'evergreen stage is required');
      if ((components.evergreen?.stump || components.evergreen?.burnt) && components.growable.time !== undefined) fail(`${path}.growable.time`, 'stumps and burnt trees cannot grow');
    }
    if (keys.includes('deciduoustree')) {
      const p = `${path}.deciduoustree`, tree = object(c.deciduoustree, p, ['stump', 'burnt', 'burntcone', 'build', 'leaf_state', 'target_leaf_state', 'leaveschangetime']);
      for (const key of ['stump', 'burnt', 'burntcone'] as const) {
        if (tree[key] !== undefined && tree[key] !== true) fail(`${p}.${key}`, 'expected true');
      }
      if (tree.stump && (tree.burnt || tree.burntcone)) fail(p, 'a stump is not burnt');
      if (tree.burntcone && !tree.burnt) fail(`${p}.burntcone`, 'requires burnt');
      components.deciduoustree = {
        ...(tree.stump === true ? { stump: true as const } : {}),
        ...(tree.burnt === true ? { burnt: true as const } : {}), ...(tree.burntcone === true ? { burntcone: true as const } : {}),
        ...(tree.build === undefined ? {} : { build: choice(tree.build, `${p}.build`, ['normal', 'red', 'orange', 'yellow', 'barren'] as const) }),
        leaf_state: choice(tree.leaf_state, `${p}.leaf_state`, ['normal', 'colorful', 'barren'] as const),
        target_leaf_state: choice(tree.target_leaf_state, `${p}.target_leaf_state`, ['normal', 'colorful', 'barren'] as const),
        ...(tree.leaveschangetime === undefined ? {} : { leaveschangetime: number(tree.leaveschangetime, `${p}.leaveschangetime`, 0, 900) }),
      };
      if (!components.growable) fail(`${path}.growable`, 'deciduoustree stage is required');
      if ((tree.stump || tree.burnt) && (components.growable.time !== undefined || tree.leaveschangetime !== undefined)) fail(p, 'stumps and burnt trees cannot grow or change leaves');
    }
    if (keys.includes('saplingTimer')) {
      const p = `${path}.saplingTimer`, timer = object(c.saplingTimer ?? (schema.timerDuration ? { timers: {} } : undefined), p, ['timers']);
      const timers = object(timer.timers, `${p}.timers`, ['grow']);
      if (timers.grow === undefined && schema.timerDuration !== undefined) components.saplingTimer = { timers: {} };
      else {
        const grow = object(timers.grow, `${p}.timers.grow`, ['timeleft', 'paused', 'initial_time']);
        if (typeof grow.paused !== 'boolean') fail(`${p}.timers.grow.paused`, 'expected a boolean');
        const initial_time = number(grow.initial_time, `${p}.timers.grow.initial_time`, schema.timerDuration ?? 150, schema.timerDuration ?? 300);
        components.saplingTimer = { timers: { grow: {
          timeleft: number(grow.timeleft, `${p}.timers.grow.timeleft`, 0, initial_time), paused: grow.paused, initial_time,
        } } };
      }
    }
    if (keys.includes('wormhole') && c.wormhole !== undefined) {
      const componentPath = `${path}.wormhole`;
      const wormhole = object(c.wormhole, componentPath, ['skinId']);
      components.wormhole = wormhole.skinId === undefined ? {} : {
        skinId: choice(wormhole.skinId, `${componentPath}.skinId`, WORMHOLE_SKINS),
      };
    }
    if (keys.includes('nightmareGrowth')) {
      const componentPath = `${path}.nightmareGrowth`;
      const growth = object(c.nightmareGrowth, componentPath, ['crackRotation']);
      components.nightmareGrowth = { crackRotation: number(growth.crackRotation, `${componentPath}.crackRotation`, 0, 360) };
    }
    if (keys.includes('building')) {
      if (!building) fail(path, `missing building definition for ${prefab}`);
      const b = object(c.building, `${path}.building`, ['state', 'skinId', 'burnt']);
      // Older cook pot saves only stored idle; migrate that to the closed state.
      const state = choice(prefab === 'cookpot' && b.state === 'idle' ? 'closed' : b.state,
        `${path}.building.state`, isContainer ? ['closed', 'open'] : ['idle']);
      const skinId = b.skinId === undefined ? undefined : string(b.skinId, `${path}.building.skinId`);
      if (skinId !== undefined && !Object.hasOwn(building.skinArchives ?? {}, skinId)) fail(`${path}.building.skinId`, 'unsupported building skin');
      components.building = { state, ...(skinId === undefined ? {} : { skinId }) };
      if (b.burnt !== undefined) {
        if (b.burnt !== true || (prefab !== 'treasurechest' && prefab !== 'cookpot' && prefab !== 'winterometer' && prefab !== 'pighead' && prefab !== 'mermhead')) fail(`${path}.building.burnt`, 'expected a burnt combustible building');
        components.building.burnt = true;
      }
      if (isContainer && (!b.burnt || c.container !== undefined)) {
        const slotCount = containerDefinition!.slotCount;
        components.container = c.container === undefined ? { slotCount, slots: [] }
          : container(c.container, `${path}.container`, numericKeys(slotCount),
            containerDefinition!.singleItems ? 1 : Infinity);
      }
    }
    if (keys.includes('sculptingtable') && c.sculptingtable !== undefined) {
      const componentPath = `${path}.sculptingtable`;
      const table = object(c.sculptingtable, componentPath, ['itemname']);
      components.sculptingtable = { itemname: choice(table.itemname, `${componentPath}.itemname`, Object.keys(SCULPTABLE_MATERIALS)) };
    }
    if (keys.includes('birdcage') && c.birdcage !== undefined) {
      const p = `${path}.birdcage`, cage = object(c.birdcage, p, ['cageState', 'birdType', 'occupant', 'item']);
      // The poisoned (sick) state needs the unported toadstool gas.
      const cageState = choice(cage.cageState, `${p}.cageState`,
        [CAGE_STATES.DEAD, CAGE_STATES.SKELETON, CAGE_STATES.EMPTY, CAGE_STATES.FULL]);
      const birdType = cage.birdType === undefined ? undefined : choice(cage.birdType, `${p}.birdType`, BIRD_IDS);
      const occupant = cage.occupant === undefined ? undefined : stack(cage.occupant, `${p}.occupant`);
      const item = cage.item === undefined ? undefined : stack(cage.item, `${p}.item`);
      if (occupant && (!isBirdId(occupant.itemId) || occupant.count !== 1)) fail(`${p}.occupant`, 'expected one bird');
      if (item && item.count !== 1) fail(`${p}.item`, 'expected one shelved item');
      if ((cageState === CAGE_STATES.FULL) !== (occupant !== undefined)) fail(p, 'an occupied cage needs exactly one occupant');
      if (cageState === CAGE_STATES.FULL && occupant!.itemId !== birdType) fail(`${p}.birdType`, 'must match the occupant');
      const shelved = cageState === CAGE_STATES.DEAD ? 'smallmeat' : cageState === CAGE_STATES.SKELETON ? 'spoiled_food' : undefined;
      if (item?.itemId !== shelved) fail(`${p}.item`, shelved ? `expected ${shelved} on the shelf` : 'unexpected shelved item');
      components.birdcage = { cageState, ...(birdType === undefined ? {} : { birdType }),
        ...(occupant ? { occupant } : {}), ...(item ? { item } : {}) };
    }
    if (keys.includes('workable') && c.workable !== undefined) {
      const p = `${path}.workable`, work = object(c.workable, p, ['workleft', 'maxwork']);
      const maxwork = number(work.maxwork, `${p}.maxwork`, 6, 6);
      components.workable = { maxwork, workleft: number(work.workleft, `${p}.workleft`, 0, maxwork) };
    }
    if (keys.includes('finiteuses') && c.finiteuses !== undefined) {
      const p = `${path}.finiteuses`, finite = object(c.finiteuses, p, ['uses']);
      components.finiteuses = { uses: number(finite.uses, `${p}.uses`, 0, schema.finiteUses) };
    }
    if (keys.includes('moonbase') && c.moonbase !== undefined) {
      const p = `${path}.moonbase`, moonbase = object(c.moonbase, p, ['staff', 'timer']);
      components.moonbase = {};
      if (moonbase.staff !== undefined) {
        const staff = stack(moonbase.staff, `${p}.staff`);
        if (!['yellowstaff', 'opalstaff'].includes(staff.itemId) || staff.count !== 1) fail(`${p}.staff`, 'expected one light staff');
        if ((components.workable?.workleft ?? 4) <= 0) fail(p, 'a destroyed moonbase cannot hold a staff');
        components.moonbase.staff = staff;
      }
      if (moonbase.timer !== undefined) {
        const t = `${p}.timer`, timer = object(moonbase.timer, t, ['timers']);
        const timers = object(timer.timers, `${t}.timers`, Object.keys(MOONBASE_TIMER_LIMITS));
        const parsed: import('../../packages/componets/src/timer').NamedTimerSave['timers'] = {};
        for (const [name, value] of Object.entries(timers)) {
          const entryPath = `${t}.timers.${name}`, entry = object(value, entryPath, ['timeleft', 'paused', 'initial_time']);
          if (typeof entry.paused !== 'boolean') fail(`${entryPath}.paused`, 'expected a boolean');
          const maximum = MOONBASE_TIMER_LIMITS[name as keyof typeof MOONBASE_TIMER_LIMITS];
          const initial_time = number(entry.initial_time, `${entryPath}.initial_time`, 0, maximum);
          parsed[name] = { timeleft: number(entry.timeleft, `${entryPath}.timeleft`, 0, initial_time), paused: entry.paused as boolean, initial_time };
        }
        const pending = ['mooncharge', 'moonchargepre', 'mooncharge2', 'mooncharge3'].some(name => Object.hasOwn(parsed, name));
        if (pending && (components.moonbase.staff?.itemId !== 'yellowstaff' || (components.workable?.workleft ?? 4) <= 0)) fail(t, 'charging requires a yellowstaff and a live moonbase');
        if (parsed.mooncharge && parsed.moonchargepre) fail(t, 'cannot prepare and charge together');
        if ((parsed.mooncharge2 || parsed.mooncharge3) && !parsed.mooncharge) fail(t, 'charge stages require the charge timer');
        if (parsed.mooncharge2 && parsed.mooncharge3) fail(t, 'cannot have both stage timers');
        components.moonbase.timer = { timers: parsed };
      }
    }
    if (keys.includes('stewer') && c.stewer !== undefined) {
      const p = `${path}.stewer`;
      const stewer = object(c.stewer, p, ['product', 'phase', 'remainingSeconds', 'ingredient_prefabs', 'chef_id']);
      const product = string(stewer.product, `${p}.product`);
      const recipe = GetRecipe('cookpot', product);
      if (!recipe) fail(`${p}.product`, 'unknown cooking product');
      const phase = choice(stewer.phase, `${p}.phase`, ['cooking', 'done']);
      const remainingSeconds = number(stewer.remainingSeconds, `${p}.remainingSeconds`, 0, BASE_COOK_TIME * recipe!.cooktime);
      if ((phase === 'done' && remainingSeconds !== 0) || (phase === 'cooking' && remainingSeconds === 0)) {
        fail(p, 'cooking needs remaining time; done needs zero remaining time');
      }
      if (components.building?.state !== 'closed' || components.container?.slots.length) {
        fail(p, 'cooking and full pots must be closed with no ingredients');
      }
      components.stewer = { product, phase, remainingSeconds };
      if (stewer.ingredient_prefabs !== undefined) {
        if (!Array.isArray(stewer.ingredient_prefabs) || stewer.ingredient_prefabs.length !== containerDefinition!.slotCount) fail(`${p}.ingredient_prefabs`, 'expected the cooked ingredients');
        components.stewer.ingredient_prefabs = (stewer.ingredient_prefabs as unknown[]).map((value, index) => string(value, `${p}.ingredient_prefabs[${index}]`));
      }
      if (stewer.chef_id !== undefined) components.stewer.chef_id = string(stewer.chef_id, `${p}.chef_id`);
    }
    if (keys.includes('stack')) components.stack = stack(c.stack, `${path}.stack`);
    if (keys.includes('stack') && c.torch !== undefined) {
      const componentPath = `${path}.torch`;
      if (components.stack?.itemId !== 'torch') fail(componentPath, 'torch state requires a torch');
      const torch = object(c.torch, componentPath, ['lit']);
      if (torch.lit !== true) fail(`${componentPath}.lit`, 'expected true');
      components.torch = { lit: true };
    }
    if (keys.includes('stack') && c.lantern !== undefined) {
      const componentPath = `${path}.lantern`;
      if (components.stack?.itemId !== 'lantern') fail(componentPath, 'machine state requires a lantern');
      const machine = object(c.lantern, componentPath, ['ison']);
      if (typeof machine.ison !== 'boolean') fail(`${componentPath}.ison`, 'expected boolean');
      components.lantern = { ison: machine.ison };
    }
    if (keys.includes('stack') && c.phonograph !== undefined) {
      const componentPath = `${path}.phonograph`;
      if (components.stack?.itemId !== 'phonograph' || !components.stack.phonographRecord) fail(componentPath, 'playing machine requires a record');
      const machine = object(c.phonograph, componentPath, ['remainingSeconds']);
      components.phonograph = { remainingSeconds: number(machine.remainingSeconds, `${componentPath}.remainingSeconds`, Number.MIN_VALUE, PHONOGRAPH_PLAY_TIME) };
    }
    if (keys.includes('beefalo')) {
      const componentPath = `${path}.beefalo`;
      const beefalo = object(c.beefalo, componentPath, ['home', 'heading', 'poopRemainingSeconds', 'beard', 'knownlocations']);
      const home = transform({ position: beefalo.home, rotationY: 0 }, `${componentPath}.home`, true).position;
      let knownlocations: NonNullable<SavedEntity['components']['beefalo']>['knownlocations'];
      if (beefalo.knownlocations !== undefined) {
        const locationsPath = `${componentPath}.knownlocations`;
        const saved = object(beefalo.knownlocations, locationsPath, ['locations']);
        const names = new Set<string>();
        knownlocations = { locations: array(saved.locations, `${locationsPath}.locations`).map((value, index) => {
          const p = `${locationsPath}.locations[${index}]`, location = object(value, p, ['name', 'x', 'y', 'z']);
          const name = string(location.name, `${p}.name`);
          if (names.has(name)) fail(`${p}.name`, 'duplicate location name');
          names.add(name);
          const [x, y, z] = transform({ position: [location.x, location.y, location.z], rotationY: 0 }, p, true).position;
          return { name, x, y, z };
        }) };
      }
      components.beefalo = { home, heading: number(beefalo.heading, `${componentPath}.heading`, 0, 360),
        poopRemainingSeconds: number(beefalo.poopRemainingSeconds, `${componentPath}.poopRemainingSeconds`,
          0, BEEFALO_BEHAVIOR.poopMaxSeconds),
        ...(knownlocations === undefined ? {} : { knownlocations }),
        // beard.lua OnSave; saves from before the beard component keep the full, hairy default.
        ...beefalo.beard === undefined ? {} : { beard: beard(beefalo.beard, `${componentPath}.beard`) } };
    }
    if (keys.includes('bulbPlant')) {
      const componentPath = `${path}.bulbPlant`;
      const plant = object(c.bulbPlant, componentPath, ['variant', 'lightState', 'remainingSeconds', 'picked', 'regrowSeconds']);
      const variant = choice(plant.variant, `${componentPath}.variant`, schema.bulbVariants!);
      const lightState = choice(plant.lightState, `${componentPath}.lightState`, BULB_PLANT_LIGHT_STATES);
      if (plant.picked !== undefined && typeof plant.picked !== 'boolean') fail(`${componentPath}.picked`, 'expected boolean');
      const picked = plant.picked === true;
      if (picked && lightState === 'ON') fail(`${componentPath}.lightState`, 'picked plant cannot emit light');
      if ((picked || lightState === 'CHARGED') && plant.remainingSeconds !== undefined) fail(`${componentPath}.remainingSeconds`, 'plant has no active light timer');
      if (!picked && plant.regrowSeconds !== undefined) fail(`${componentPath}.regrowSeconds`, 'mature plant has no regrowth timer');
      components.bulbPlant = { variant, lightState, ...(picked || lightState === 'CHARGED' ? {} : {
        remainingSeconds: number(plant.remainingSeconds, `${componentPath}.remainingSeconds`, Number.MIN_VALUE,
          lightState === 'ON' ? BULB_PLANT_MAX_ON_TIME : BULB_PLANT_MAX_RECHARGE_TIME),
      }), ...(plant.picked === undefined ? {} : { picked: plant.picked }), ...(picked ? {
        regrowSeconds: number(plant.regrowSeconds, `${componentPath}.regrowSeconds`, Number.MIN_VALUE, bulbPlantRegrowTime(variant)),
      } : {}) };
    }
    if (keys.includes('flower')) {
      const componentPath = `${path}.flower`;
      const flower = object(c.flower, componentPath, ['animation', 'planted']);
      if (flower.planted !== true) fail(`${componentPath}.planted`, 'expected true');
      components.flower = { animation: choice(flower.animation, `${componentPath}.animation`, FLOWER_ANIMATIONS), planted: true };
    }
    if (keys.includes('timer')) {
      const t = object(c.timer, `${path}.timer`, ['remainingSeconds']);
      components.timer = { remainingSeconds: number(t.remainingSeconds,
        `${path}.timer.remainingSeconds`, Number.MIN_VALUE,
        schema.timerDuration!) };
    }
    if (c.health !== undefined) {
      const h = object(c.health, `${path}.health`, ['current', 'maximum']);
      const maximum = number(h.maximum, `${path}.health.maximum`, 1);
      components.health = { current: number(h.current, `${path}.health.current`, 0, maximum), maximum };
    }
    return components;
  };
}

function beard(value: unknown, path: string): BeardSave {
  const data = object(value, path, ['growth', 'growthaccumulator', 'bits']);
  return { growth: integer(data.growth, `${path}.growth`), growthaccumulator: number(data.growthaccumulator, `${path}.growthaccumulator`),
    bits: integer(data.bits, `${path}.bits`, 0, BEEFALO_BEARD_BITS) };
}
