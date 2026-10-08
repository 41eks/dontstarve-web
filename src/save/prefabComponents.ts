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
}

export type PrefabComponentParser = (value: unknown, path: string, context: EntitySaveContext) => SavedEntity['components'];

/** Component readers are reusable; the prefab definition chooses its schema. */
export function componentParser(schema: PrefabComponentSchema): PrefabComponentParser {
  return (value, path, { prefab, catalog, stack, container, transform }) => {
    const { keys } = schema;
    const c = object(value, path, keys);
    const components: SavedEntity['components'] = {};
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
      const b = object(c.building, `${path}.building`, ['state', 'skinId']);
      // Older cook pot saves only stored idle; migrate that to the closed state.
      const state = choice(prefab === 'cookpot' && b.state === 'idle' ? 'closed' : b.state,
        `${path}.building.state`, isContainer ? ['closed', 'open'] : ['idle']);
      const skinId = b.skinId === undefined ? undefined : string(b.skinId, `${path}.building.skinId`);
      if (skinId !== undefined && !Object.hasOwn(building.skinArchives ?? {}, skinId)) fail(`${path}.building.skinId`, 'unsupported building skin');
      components.building = { state, ...(skinId === undefined ? {} : { skinId }) };
      if (isContainer) {
        const slotCount = containerDefinition!.slotCount;
        components.container = c.container === undefined ? { slotCount, slots: [] }
          : container(c.container, `${path}.container`, numericKeys(slotCount),
            containerDefinition!.singleItems ? 1 : Infinity);
      }
    }
    if (keys.includes('stack')) components.stack = stack(c.stack, `${path}.stack`);
    if (keys.includes('stack') && c.torch !== undefined) {
      const componentPath = `${path}.torch`;
      if (components.stack?.itemId !== 'torch') fail(componentPath, 'torch state requires a torch');
      const torch = object(c.torch, componentPath, ['lit']);
      if (torch.lit !== true) fail(`${componentPath}.lit`, 'expected true');
      components.torch = { lit: true };
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
