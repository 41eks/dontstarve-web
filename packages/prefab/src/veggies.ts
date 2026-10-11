import { TOTAL_DAY_TIME } from '../../componets/src/perishable';

// tuning.lua values used by prefabs/veggies.lua.
const HEALING = { tiny: 1, small: 3, medsmall: 8, med: 20 } as const;
const SANITY = { tiny: 5, small: 10, med: 15 } as const;
const CALORIES = { tiny: 9.375, small: 12.5, medsmall: 18.75, med: 25, large: 37.5 } as const;
const PERISH = {
  oneDay: TOTAL_DAY_TIME, twoDay: 2 * TOTAL_DAY_TIME, superfast: 3 * TOTAL_DAY_TIME, fast: 6 * TOTAL_DAY_TIME,
  med: 10 * TOTAL_DAY_TIME, slow: 15 * TOTAL_DAY_TIME, preserved: 20 * TOTAL_DAY_TIME, superslow: 40 * TOTAL_DAY_TIME,
} as const;

interface Edibles { readonly health: number; readonly hunger: number; readonly sanity: number; readonly perish: number }

/** MakeVegStats arguments from the VEGGIES table; `seedless` mirrors SEEDLESS. */
interface Veggie { readonly raw: Edibles; readonly cooked: Edibles; readonly seedless?: true }
const v = (hunger: number, health: number, perish: number, sanity: number): Edibles => ({ hunger, health, perish, sanity });

export const VEGGIES: Readonly<Record<string, Veggie>> = {
  cave_banana: { seedless: true, raw: v(CALORIES.small, HEALING.tiny, PERISH.med, 0), cooked: v(CALORIES.small, HEALING.small, PERISH.fast, 0) },
  carrot: { raw: v(CALORIES.small, HEALING.tiny, PERISH.med, 0), cooked: v(CALORIES.small, HEALING.small, PERISH.fast, 0) },
  corn: { raw: v(CALORIES.med, HEALING.small, PERISH.med, 0), cooked: v(CALORIES.small, HEALING.small, PERISH.slow, 0) },
  // The Hallowed Nights perish override is event-only and is not active here.
  pumpkin: { raw: v(CALORIES.large, HEALING.small, PERISH.med, 0), cooked: v(CALORIES.large, HEALING.medsmall, PERISH.fast, 0) },
  eggplant: { raw: v(CALORIES.med, HEALING.medsmall, PERISH.med, 0), cooked: v(CALORIES.med, HEALING.med, PERISH.fast, 0) },
  durian: { raw: v(CALORIES.med, -HEALING.small, PERISH.med, -SANITY.tiny), cooked: v(CALORIES.med, 0, PERISH.fast, -SANITY.tiny) },
  pomegranate: { raw: v(CALORIES.tiny, HEALING.small, PERISH.fast, 0), cooked: v(CALORIES.small, HEALING.med, PERISH.superfast, 0) },
  dragonfruit: { raw: v(CALORIES.tiny, HEALING.small, PERISH.fast, 0), cooked: v(CALORIES.small, HEALING.med, PERISH.superfast, 0) },
  berries: { seedless: true, raw: v(CALORIES.tiny, 0, PERISH.fast, 0), cooked: v(CALORIES.small, HEALING.tiny, PERISH.superfast, 0) },
  berries_juicy: { seedless: true, raw: v(CALORIES.small, HEALING.tiny, PERISH.twoDay, 0), cooked: v(CALORIES.medsmall, HEALING.small, PERISH.oneDay, 0) },
  fig: { seedless: true, raw: v(CALORIES.small, 0, PERISH.fast, 0), cooked: v(CALORIES.medsmall, HEALING.tiny, PERISH.superfast, 0) },
  cactus_meat: { seedless: true, raw: v(CALORIES.small, -HEALING.small, PERISH.med, -SANITY.tiny), cooked: v(CALORIES.small, HEALING.tiny, PERISH.med, SANITY.med) },
  watermelon: { raw: v(CALORIES.small, HEALING.small, PERISH.fast, SANITY.tiny), cooked: v(CALORIES.small, HEALING.tiny, PERISH.superfast, SANITY.tiny * 1.5) },
  kelp: { seedless: true, raw: v(CALORIES.tiny, -HEALING.tiny, PERISH.med, -SANITY.small), cooked: v(CALORIES.tiny, 0, PERISH.med, -SANITY.tiny) },
  tomato: { raw: v(CALORIES.small, HEALING.small, PERISH.fast, 0), cooked: v(CALORIES.small, HEALING.med, PERISH.med, 0) },
  potato: { raw: v(CALORIES.small, -HEALING.small, PERISH.med, -SANITY.tiny), cooked: v(CALORIES.med, HEALING.med, PERISH.fast, 0) },
  asparagus: { raw: v(CALORIES.small, HEALING.small, PERISH.fast, 0), cooked: v(CALORIES.med, HEALING.small, PERISH.superfast, 0) },
  onion: { raw: v(CALORIES.tiny, 0, PERISH.slow, -SANITY.small), cooked: v(CALORIES.tiny, HEALING.tiny, PERISH.med, -SANITY.tiny) },
  garlic: { raw: v(CALORIES.tiny, 0, PERISH.slow, -SANITY.small), cooked: v(CALORIES.tiny, HEALING.tiny, PERISH.med, -SANITY.tiny) },
  pepper: { raw: v(CALORIES.tiny, -HEALING.med, PERISH.slow, -SANITY.med), cooked: v(CALORIES.tiny, -HEALING.small, PERISH.slow, -SANITY.small) },
};

/** fn_dried: only kelp has a dryable table. */
const DRIED: Readonly<Record<string, Edibles>> = { kelp_dried: v(CALORIES.tiny, HEALING.tiny, PERISH.preserved, SANITY.small) };
/** fn_seeds edible values and perish time; stackable defaults to STACK_SIZE_MEDITEM unless set. */
const SEED_EDIBLES = v(CALORIES.tiny, HEALING.tiny / 2, PERISH.superslow, 0);
/** fn raw items that leave stackable at its default (STACK_SIZE_MEDITEM). */
export const MEDIUM_STACK_VEGGIES = ['pumpkin', 'eggplant', 'durian', 'watermelon'] as const;

/** farm_plant_defs.lua bank/build overrides; the default for both is farm_plant_<name>. */
const PLANT_ART_OVERRIDES: Readonly<Record<string, { bank?: string; build?: string }>> = {
  corn: { build: 'farm_plant_corn_build', bank: 'farm_plant_pumpkin' },
  onion: { build: 'farm_plant_onion_build', bank: 'farm_plant_pumpkin' },
  dragonfruit: { build: 'farm_plant_dragonfruit_build', bank: 'farm_plant_potato' },
  pomegranate: { build: 'farm_plant_pomegranate_build', bank: 'farm_plant_potato' },
  eggplant: { build: 'farm_plant_eggplant_build', bank: 'farm_plant_potato' },
  watermelon: { build: 'farm_plant_watermelon_build', bank: 'farm_plant_tomato' },
  durian: { build: 'farm_plant_durian_build', bank: 'farm_plant_pepper' },
};
/** farm_plant_<name> bank/build for every veggie that has seeds. */
export const FARM_PLANT_ART: Readonly<Record<string, { bank: string; build: string }>> = Object.fromEntries(
  Object.entries(VEGGIES).filter(([, veggie]) => !veggie.seedless).map(([name]) => [`farm_plant_${name}`, {
    bank: PLANT_ART_OVERRIDES[name]?.bank ?? `farm_plant_${name}`, build: PLANT_ART_OVERRIDES[name]?.build ?? `farm_plant_${name}`,
  }]));

export const VEGGIE_SEED_IDS = Object.entries(VEGGIES).filter(([, veggie]) => !veggie.seedless).map(([name]) => `${name}_seeds`);

const ITEMS: Record<string, Edibles> = { ...DRIED };
for (const [name, veggie] of Object.entries(VEGGIES)) {
  ITEMS[name] = veggie.raw; ITEMS[`${name}_cooked`] = veggie.cooked;
}
for (const id of VEGGIE_SEED_IDS) ITEMS[id] = SEED_EDIBLES;

export const VEGGIE_ITEM_IDS: readonly string[] = Object.keys(ITEMS);
/** Edible values; fn_seeds, fn, fn_cooked and fn_dried all set sanity (default 0). */
export const VEGGIE_FOOD_EFFECTS = Object.fromEntries(Object.entries(ITEMS)
  .map(([id, { health, hunger, sanity }]) => [id, { health, hunger, sanity }]));
export const VEGGIE_PERISH_TIMES = Object.fromEntries(Object.entries(ITEMS).map(([id, { perish }]) => [id, perish]));
