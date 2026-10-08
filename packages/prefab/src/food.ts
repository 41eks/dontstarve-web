import { SEEDS_HUNGER } from './seeds';

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
  // prefabs/seeds.lua: raw seeds → health 0, hunger CALORIES_TINY / 2, default sanity 0.
  seeds: { health: 0, hunger: SEEDS_HUNGER, sanity: 0 },
  // preparedfoods.lua: meatballs → HEALING_SMALL / CALORIES_SMALL * 5 / SANITY_TINY.
  meatballs: { health: 3, hunger: 62.5, sanity: 5 },
  // preparedfoods.lua: bananajuice → HEALING_MEDSMALL / CALORIES_MED / SANITY_LARGE.
  // prefabs/preparedfoods.lua installs edible; the fooddrink tag selects quick drinking.
  [BANANAJUICE_ID]: { health: 8, hunger: 25, sanity: 33, foodDrink: true },
  // prefabs/mushrooms.lua's data table, resolved against tuning.lua.
  red_cap: { health: -20, hunger: 12.5, sanity: 0 },
  red_cap_cooked: { health: 1, hunger: 0, sanity: -10 },
  green_cap: { health: 0, hunger: 12.5, sanity: -50 },
  green_cap_cooked: { health: -1, hunger: 0, sanity: 15 },
  blue_cap: { health: 20, hunger: 12.5, sanity: -15 },
  blue_cap_cooked: { health: -3, hunger: 0, sanity: 10 },
};
