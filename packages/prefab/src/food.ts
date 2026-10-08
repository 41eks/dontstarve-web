import { SEEDS_HUNGER } from './seeds';

export const BANANAJUICE_ID = 'bananajuice';

export interface FoodEffects {
  readonly health: number;
  readonly hunger: number;
  readonly sanity: number;
  readonly foodDrink?: boolean;
}

/** Source edible values; food effects are applied only after inventory consumption succeeds. */
export const FOOD_EFFECTS: Readonly<Record<string, FoodEffects>> = {
  seeds: { health: 0, hunger: SEEDS_HUNGER, sanity: 0 },
  // preparedfoods.lua: bananajuice → HEALING_MEDSMALL / CALORIES_MED / SANITY_LARGE.
  // prefabs/preparedfoods.lua installs edible; the fooddrink tag selects quick drinking.
  [BANANAJUICE_ID]: { health: 8, hunger: 25, sanity: 33, foodDrink: true },
};
