import type { ItemEntity } from '@dontstarve-web/inventory';
import { Tradable } from '../../componets/src/tradable';

// tuning.lua GOLD_VALUES.MEAT
const MEAT = 1;

/**
 * Every cataloged item whose Lua adds the tradable component, with its `goldvalue`. meats.lua common()
 * pays MEAT; the monster, human and barnacle variants reset it to 0 and so does every item that never
 * sets one. A trader refuses those (the pig king plays `unimpressed`) instead of not offering GIVE.
 */
export const TRADABLE_GOLD_VALUES: Readonly<Record<string, number>> = {
  goldnugget: 1, bird_egg: 1, pigskin: MEAT,
  meat: MEAT, cookedmeat: MEAT, meat_dried: MEAT,
  smallmeat: MEAT, cookedsmallmeat: MEAT, smallmeat_dried: MEAT,
  drumstick: MEAT, drumstick_cooked: MEAT,
  fishmeat_small: MEAT, fishmeat_small_cooked: MEAT, fishmeat_small_dried: MEAT,
  fishmeat: MEAT, fishmeat_cooked: MEAT, fishmeat_dried: MEAT,
  batwing: MEAT, batwing_cooked: MEAT, plantmeat: MEAT, plantmeat_cooked: MEAT,
  batnose: MEAT, batnose_cooked: MEAT, mitegland: MEAT, mitegland_cooked: MEAT,
  humanmeat_dried: MEAT, monstermeat_dried: MEAT,
  monstermeat: 0, cookedmonstermeat: 0, humanmeat: 0, humanmeat_cooked: 0, barnacle: 0, barnacle_cooked: 0,
  rottenegg: 0, acorn: 0, acorn_cooked: 0, heatrock: 0, moon_tree_blossom: 0, petals: 0, petals_evil: 0,
  butterfly: 0, ash: 0, beefalowool: 0, butterflywings: 0, charcoal: 0, cutgrass: 0, cutstone: 0,
  deerclops_eyeball: 0, dreadstone: 0, fireflies: 0, flint: 0, honey: 0, honeycomb: 0, rocks: 0, lightbulb: 0,
  log: 0, moonbutterflywings: 0, moonrocknugget: 0, nitre: 0, record: 0, rope: 0, silk: 0, spidergland: 0,
  thulecite: 0, thulecite_pieces: 0, twigs: 0,
};

export function hasTradableGoldValue(itemId: string): boolean {
  return Object.hasOwn(TRADABLE_GOLD_VALUES, itemId);
}

/** inst:AddComponent("tradable") with the item's goldvalue. */
export function configureTradableEntity(entity: ItemEntity): void {
  if (entity.components.tradable) return;
  const tradable = new Tradable();
  tradable.goldvalue = TRADABLE_GOLD_VALUES[entity.prefab] ?? 0;
  entity.components.tradable = tradable;
  entity.addTag('tradable');
}
