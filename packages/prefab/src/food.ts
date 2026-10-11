import type { ItemEntity } from '@dontstarve-web/inventory';
import { Edible } from '../../componets/src/edible';
import { PERISH_FAST, PERISH_MED } from '../../componets/src/perishable';
import { foods } from '../../componets/src/preparedfoods';
import { SEEDS_HUNGER } from './seeds';
import { MOONBUTTERFLY_PERISH_TIME } from './moonbutterflyTuning';
import { BIRD_IDS, BIRD_PERISH_TIME } from './birds';
import { VEGGIE_FOOD_EFFECTS, VEGGIE_PERISH_TIMES } from './veggies';

export const BANANAJUICE_ID = 'bananajuice';
export const MUSHROOM_ITEM_IDS = [
  'red_cap', 'red_cap_cooked', 'green_cap', 'green_cap_cooked', 'blue_cap', 'blue_cap_cooked',
] as const;

export interface FoodEffects {
  readonly health: number;
  readonly hunger: number;
  readonly sanity: number;
  readonly foodDrink?: boolean;
}

/** Source edible values; food effects are applied only after inventory consumption succeeds. */
export const FOOD_EFFECTS: Readonly<Record<string, FoodEffects>> = {
  // lightbulb.lua: HEALING_TINY, zero hunger, default zero sanity, VEGGIE.
  lightbulb: { health: 1, hunger: 0, sanity: 0 },
  // prefabs/seeds.lua: raw seeds → health 0, hunger CALORIES_TINY / 2, default sanity 0.
  seeds: { health: 0, hunger: SEEDS_HUNGER, sanity: 0 },
  // prefabs/veggies.lua: raw, cooked, dried and seed items.
  ...VEGGIE_FOOD_EFFECTS,
  // preparedfoods.lua: meatballs → HEALING_SMALL / CALORIES_SMALL * 5 / SANITY_TINY.
  meatballs: { health: 3, hunger: 62.5, sanity: 5 },
  // preparedfoods.lua: bananajuice → HEALING_MEDSMALL / CALORIES_MED / SANITY_LARGE.
  // prefabs/preparedfoods.lua installs edible; the fooddrink tag selects quick drinking.
  [BANANAJUICE_ID]: { health: 8, hunger: 25, sanity: 33, foodDrink: true },
  // preparedfoods.lua: bananapop → HEALING_MED / CALORIES_SMALL / SANITY_LARGE (VEGGIE, not a drink).
  bananapop: { health: 20, hunger: 12.5, sanity: 33 },
  // prefabs/mushrooms.lua's data table, resolved against tuning.lua.
  // prefabs/moontree_blossom.lua: HEALING_TINY, no hunger, VEGGIE.
  moon_tree_blossom: { health: 1, hunger: 0, sanity: 0 },
  // prefabs/moonbutterflywings.lua: HEALING_MEDSMALL, CALORIES_TINY, SANITY_MED.
  moonbutterflywings: { health: 8, hunger: 9.375, sanity: 15 },
  red_cap: { health: -20, hunger: 12.5, sanity: 0 },
  red_cap_cooked: { health: 1, hunger: 0, sanity: -10 },
  green_cap: { health: 0, hunger: 12.5, sanity: -50 },
  green_cap_cooked: { health: -1, hunger: 0, sanity: 15 },
  blue_cap: { health: 20, hunger: 12.5, sanity: -15 },
  blue_cap_cooked: { health: -3, hunger: 0, sanity: 10 },
};

/** SetPerishTime, StartPerishing and spoiled_food replacement from the owning prefab file. */
export const PERISHABLE_FOODS: Readonly<Record<string, { readonly perishTime: number; readonly replacement?: string }>> = {
  lightbulb: { perishTime: PERISH_FAST, replacement: 'spoiled_food' },
  // prefabs/mushrooms.lua capcommonfn.
  red_cap: { perishTime: PERISH_MED, replacement: 'spoiled_food' },
  // prefabs/moontree_blossom.lua: PERISH_FAST, spoiled_food.
  moon_tree_blossom: { perishTime: PERISH_FAST, replacement: 'spoiled_food' },
  // prefabs/moonbutterflywings.lua: PERISH_FAST, spoiled_food.
  moonbutterflywings: { perishTime: PERISH_FAST, replacement: 'spoiled_food' },
  // prefabs/meats.lua smallmeat: PERISH_FAST, spoiled_food.
  smallmeat: { perishTime: PERISH_FAST, replacement: 'spoiled_food' },
  // prefabs/egg.lua: bird_egg spoils in PERISH_MED into rottenegg.
  bird_egg: { perishTime: PERISH_MED, replacement: 'rottenegg' },
  // prefabs/birds.lua MakeFeedableSmallLivestock(BIRD_PERISH_TIME): a starved bird is replaced by its loot, not a goop prefab.
  ...Object.fromEntries(BIRD_IDS.map(id => [id, { perishTime: BIRD_PERISH_TIME }])),
  // prefabs/moonbutterfly.lua: MOONBUTTERFLY_PERISH_TIME; no replacement (removed in an inventory, dies on the ground).
  moonbutterfly: { perishTime: MOONBUTTERFLY_PERISH_TIME },
  // prefabs/preparedfoods.lua uses the recipe's perishtime.
  bananapop: { perishTime: foods.bananapop.perishtime!, replacement: 'spoiled_food' },
  // prefabs/veggies.lua sets perishable with spoiled_food on every raw, cooked, dried and seed item.
  ...Object.fromEntries(Object.entries(VEGGIE_PERISH_TIMES).map(([id, perishTime]) => [id, { perishTime, replacement: 'spoiled_food' }])),
};

/** edible:GetHealth/GetHunger/GetSanity for the inst at eating time, including its perish stage. */
export function getFoodEffects(entity: Pick<ItemEntity, 'prefab' | 'components'>): FoodEffects | undefined {
  const values = FOOD_EFFECTS[entity.prefab];
  if (!values) return undefined;
  const perishable = entity.components.perishable;
  const edible = new Edible(() => perishable.perishtime.peek() === undefined ? undefined : perishable.stage.peek());
  edible.healthvalue = values.health;
  edible.hungervalue = values.hunger;
  edible.sanityvalue = values.sanity;
  return { ...values, health: edible.GetHealth(), hunger: edible.GetHunger(), sanity: edible.GetSanity() };
}
