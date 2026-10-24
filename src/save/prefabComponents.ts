import type { InventoryStack } from '@dontstarve-web/inventory';
import type { SavedContainer, SavedEntity, SavedTransform } from './types';
import type { SaveCatalog } from './deserialize';
import type { BulbPlantVariant } from '@dontstarve-web/prefab/bulb_plant';
import { FLOWER_ANIMATIONS } from '@dontstarve-web/prefab/flower';
import { BEEFALO_BEHAVIOR } from '@dontstarve-web/prefab/beefalo';
import { BULB_PLANT_LIGHT_STATES, BULB_PLANT_MAX_ON_TIME, BULB_PLANT_MAX_RECHARGE_TIME,
  bulbPlantRegrowTime } from '@dontstarve-web/prefab/bulb_plant';
import { WORMHOLE_SKINS } from '@dontstarve-web/prefab/wormhole';
import { WALL_SKIN_ARCHIVES } from '@dontstarve-web/prefab/wallSkins';
import { FARM_PLOW_DRILLING_DURATION, FARM_PLOW_USES, FARM_PLOW_ITEM_ID } from '@dontstarve-web/prefab/farm_plow';
import { PHONOGRAPH_PLAY_TIME } from '@dontstarve-web/prefab/phonograph';
import { SCULPTABLE_MATERIALS } from '@dontstarve-web/prefab/sculptingtable';
import { MOONBASE_TIMER_LIMITS } from '@dontstarve-web/prefab/moonbase';
import { BASE_COOK_TIME, GetRecipe } from '../../packages/componets/src/cooking';
import { choice, fail, integer, number, object, string } from './validation';

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
  readonly regrowTime?: number;
}

export type PrefabComponentParser = (value: unknown, path: string, context: EntitySaveContext) => SavedEntity['components'];

/** Component readers are reusable; the prefab definition chooses its schema. */
export function componentParser(schema: PrefabComponentSchema): PrefabComponentParser {
  return (value, path, { prefab, catalog, stack, container, transform }) => {
    const { keys } = schema;
    const c = object(value, path, keys);
    const components: SavedEntity['components'] = {};
    if (keys.includes('pickable') && c.pickable !== undefined) {
      const p = `${path}.pickable`;
      const pickable = object(c.pickable, p, ['picked', 'regrowSeconds', 'paused']);
      for (const key of ['picked', 'paused'] as const) {
        if (pickable[key] !== undefined && typeof pickable[key] !== 'boolean') fail(`${p}.${key}`, 'expected a boolean');
      }
      if (pickable.regrowSeconds !== undefined && pickable.picked !== true) fail(p, 'regrowth requires a picked plant');
      components.pickable = {
        ...(pickable.picked === true ? { picked: true } : {}),
        ...(pickable.paused === true ? { paused: true } : {}),
        ...(pickable.regrowSeconds !== undefined ? {
          regrowSeconds: number(pickable.regrowSeconds, `${p}.regrowSeconds`, 0, schema.regrowTime ?? Infinity),
        } : {}),
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
    if (keys.includes('moonTree') && c.moonTree !== undefined) {
      const componentPath = `${path}.moonTree`;
      const tree = object(c.moonTree, componentPath, ['stump']);
      if (tree.stump !== true) fail(`${componentPath}.stump`, 'expected true');
      components.moonTree = { stump: true };
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
        if (b.burnt !== true || (prefab !== 'treasurechest' && prefab !== 'cookpot')) fail(`${path}.building.burnt`, 'expected a burnt combustible building');
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
    if (keys.includes('workable') && c.workable !== undefined) {
      const p = `${path}.workable`, work = object(c.workable, p, ['workleft', 'maxwork']);
      const maxwork = number(work.maxwork, `${p}.maxwork`, 6, 6);
      components.workable = { maxwork, workleft: number(work.workleft, `${p}.workleft`, 0, maxwork) };
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
      const beefalo = object(c.beefalo, componentPath, ['home', 'heading', 'poopRemainingSeconds']);
      const home = transform({ position: beefalo.home, rotationY: 0 }, `${componentPath}.home`, true).position;
      components.beefalo = { home, heading: number(beefalo.heading, `${componentPath}.heading`, 0, 360),
        poopRemainingSeconds: number(beefalo.poopRemainingSeconds, `${componentPath}.poopRemainingSeconds`,
          Number.MIN_VALUE, BEEFALO_BEHAVIOR.poopMaxSeconds) };
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
