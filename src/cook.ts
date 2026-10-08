import foods, { type IngredientNames, type IngredientTags, type PreparedFoodRecipe } from './preparedfoods';
import type { InventoryStack } from '@dontstarve-web/inventory';

/** scripts/cooking.lua: ingredient registration, aggregation and recipe selection. */
export const ingredients: Record<string, { tags: IngredientTags }> = Object.create(null);
export const recipes: Record<string, Record<string, PreparedFoodRecipe>> = Object.create(null);
export const aliases: Readonly<Record<string, string>> = Object.freeze(Object.assign(Object.create(null), {
  cookedsmallmeat: 'smallmeat_cooked', cookedmonstermeat: 'monstermeat_cooked', cookedmeat: 'meat_cooked',
}));
export const BASE_COOK_TIME = 30 * 2 * .3333;

export function AddIngredientValues(names: readonly string[], tags: IngredientTags, cancook = false, candry = false): void {
  for (const name of names) {
    ingredients[name] = { tags: { ...tags } };
    if (cancook) ingredients[`${name}_cooked`] = { tags: { ...tags, precook: 1 } };
    if (candry) ingredients[`${name}_dried`] = { tags: { ...tags, dried: 1 } };
  }
}

AddIngredientValues(['pomegranate', 'dragonfruit', 'cave_banana'], { fruit: 1 }, true);
AddIngredientValues(['wormlight'], { fruit: 1 });
AddIngredientValues(['wormlight_lesser'], { fruit: .5 });
AddIngredientValues(['berries', 'berries_juicy', 'fig'], { fruit: .5 }, true);
AddIngredientValues(['durian'], { fruit: 1, monster: 1 }, true);
AddIngredientValues(['honey', 'honeycomb'], { sweetener: 1 }, true);
AddIngredientValues(['royal_jelly'], { sweetener: 3 }, true);
AddIngredientValues(['carrot', 'corn', 'pumpkin', 'eggplant', 'cutlichen', 'asparagus', 'onion', 'garlic', 'tomato', 'potato', 'pepper'], { veggie: 1 }, true);
AddIngredientValues(['red_cap', 'green_cap', 'blue_cap', 'moon_cap'], { veggie: .5 }, true);
AddIngredientValues(['meat'], { meat: 1 }, true, true);
AddIngredientValues(['monstermeat'], { meat: 1, monster: 1 }, true, true);
AddIngredientValues(['froglegs', 'drumstick', 'batwing'], { meat: .5 }, true);
AddIngredientValues(['smallmeat', 'batnose'], { meat: .5 }, true, true);
AddIngredientValues(['eel'], { meat: .5, fish: 1 }, true);
AddIngredientValues(['fish'], { meat: 1, fish: 1 }, true);
AddIngredientValues(['pondeel'], { meat: .5, fish: 1 }, true);
AddIngredientValues(['pondfish'], { meat: .5, fish: .5 });
AddIngredientValues(['fishmeat_small'], { meat: .5, fish: .5 }, true, true);
AddIngredientValues(['fishmeat'], { meat: 1, fish: 1 }, true, true);

// cooking.lua imports these values from prefabs/oceanfishdef.lua.
AddIngredientValues([1, 2, 3, 4, 6, 7, 8, 9].map(i => `oceanfish_small_${i}_inv`), { meat: .5, fish: .5 });
AddIngredientValues([1, 2, 3, 4, 6, 7, 9].map(i => `oceanfish_medium_${i}_inv`), { meat: 1, fish: 1 });
AddIngredientValues(['oceanfish_small_5_inv', 'oceanfish_medium_5_inv'], { veggie: 1 });
AddIngredientValues(['oceanfish_medium_8_inv'], { meat: 1, fish: 1, frozen: 1 });

AddIngredientValues(['kelp'], { veggie: .5 }, true, true);
AddIngredientValues(['mandrake'], { veggie: 1, magic: 1 }, true);
AddIngredientValues(['egg', 'bird_egg'], { egg: 1 }, true);
AddIngredientValues(['tallbirdegg'], { egg: 4 }, true);
AddIngredientValues(['butterflywings', 'moonbutterflywings'], { decoration: 2 });
AddIngredientValues(['butter'], { fat: 1, dairy: 1 });
AddIngredientValues(['twigs', 'lightninggoathorn'], { inedible: 1 });
AddIngredientValues(['ice'], { frozen: 1 });
AddIngredientValues(['mole'], { meat: .5 });
AddIngredientValues(['cactus_meat', 'rock_avocado_fruit_ripe'], { veggie: 1 }, true);
AddIngredientValues(['watermelon'], { fruit: 1 }, true);
AddIngredientValues(['cactus_flower'], { veggie: .5 });
AddIngredientValues(['acorn', 'acorn_cooked'], { seed: 1 });
AddIngredientValues(['goatmilk', 'milkywhites'], { dairy: 1 });
AddIngredientValues(['nightmarefuel'], { inedible: 1, magic: 1 });
AddIngredientValues(['boneshard'], { inedible: 1 });
AddIngredientValues(['wobster_sheller_land'], { meat: 1, fish: 1 });
AddIngredientValues(['barnacle', 'barnacle_cooked'], { meat: .25, fish: .25 });
AddIngredientValues(['plantmeat', 'plantmeat_cooked'], { meat: 1 });
AddIngredientValues(['refined_dust'], { decoration: 2 });
AddIngredientValues(['forgetmelots'], { decoration: 1 });
AddIngredientValues(['trunk_summer', 'trunk_winter', 'trunk_cooked'], { meat: 1 });
AddIngredientValues(['ancientfruit_nightvision'], { fruit: 1 }, true);
AddIngredientValues(['petals_dried', 'foliage_dried', 'succulent_picked_dried', 'firenettles_dried', 'tillweed_dried', 'moon_tree_blossom_dried', 'forgetmelots_dried'], { decoration: 1, dried: 1 });
AddIngredientValues(['petals_evil_dried'], { decoration: 1, magic: .5, dried: 1 });
AddIngredientValues(['wx78_foodbrick'], { inedible: 1 });
AddIngredientValues(['mitegland'], { meat: .5, monster: .5 }, true);
// Source deliberately does not register seeds or ordinary undried petals/leaves.

export function IsCookingIngredient(prefabname: string): boolean {
  return Object.hasOwn(ingredients, aliases[prefabname] ?? prefabname);
}

export function GetIngredientValues(prefablist: readonly string[]): { names: IngredientNames; tags: IngredientTags } {
  const names: Record<string, number> = Object.create(null), tags: IngredientTags = Object.create(null);
  for (const prefab of prefablist) {
    const name = aliases[prefab] ?? prefab;
    names[name] = (names[name] ?? 0) + 1;
    for (const [tag, value] of Object.entries(ingredients[name]?.tags ?? {})) {
      if (value !== undefined) tags[tag] = (tags[tag] ?? 0) + value;
    }
  }
  return { names, tags };
}

export function AddCookerRecipe(cooker: string, recipe: PreparedFoodRecipe): void {
  (recipes[cooker] ??= Object.create(null))[recipe.name] = recipe;
}

for (const recipe of Object.values(foods)) {
  for (const cooker of ['cookpot', 'portablecookpot', 'archive_cookpot']) AddCookerRecipe(cooker, recipe);
}

export function GetRecipe(cooker: string, product: string): PreparedFoodRecipe | undefined {
  return recipes[cooker]?.[product];
}

export function GetCandidateRecipes(cooker: string, ingdata: ReturnType<typeof GetIngredientValues>): PreparedFoodRecipe[] {
  const candidates = Object.values(recipes[cooker] ?? {})
    .filter(recipe => recipe.test(cooker, ingdata.names, ingdata.tags))
    .sort((a, b) => b.priority - a.priority);
  if (!candidates.length) return candidates;
  return candidates.filter(recipe => recipe.priority === candidates[0].priority);
}

/** Source returns product and its cooktime multiplier; no candidate means no result. */
export function CalculateRecipe(cooker: string, names: readonly string[], random: () => number = Math.random): readonly [string, number] | undefined {
  const candidates = GetCandidateRecipes(cooker, GetIngredientValues(names)).sort((a, b) => b.weight - a.weight);
  if (!candidates.length) return undefined;
  let value = random() * candidates.reduce((sum, recipe) => sum + recipe.weight, 0);
  for (const recipe of candidates) {
    value -= recipe.weight;
    if (value <= 0) return [recipe.name, recipe.cooktime];
  }
  return undefined;
}

/** Only the existing beefalofeed cooking process is playable in this stage. */
export function canCookBeefaloFeed(items: readonly (Pick<InventoryStack, 'itemId' | 'count'> | null)[]): boolean {
  if (items.length !== 4 || items.some(item => !item || item.count !== 1 || !IsCookingIngredient(item.itemId))) return false;
  const candidates = GetCandidateRecipes('cookpot', GetIngredientValues(items.map(item => item!.itemId)));
  return candidates.length === 1 && candidates[0].name === 'beefalofeed';
}
