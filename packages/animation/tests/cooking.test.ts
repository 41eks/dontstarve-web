import { expect, it } from 'vitest';
import foods from '../../componets/src/preparedfoods';
import {
  AddCookerRecipe, BASE_COOK_TIME, CalculateRecipe, GetCandidateRecipes, GetIngredientValues,
  GetRecipe, IsCookingIngredient,
} from '../../componets/src/cooking';
import { BEEFALO_FEED_COOK_TIME } from '../../prefab/src/cook_pot';

it('uses source ingredient tags, cooked/dried forms and the inconsistent meat aliases', () => {
  expect(GetIngredientValues(['red_cap', 'red_cap_cooked', 'cookedsmallmeat', 'smallmeat_dried'])).toEqual({
    names: { red_cap: 1, red_cap_cooked: 1, smallmeat_cooked: 1, smallmeat_dried: 1 },
    tags: { veggie: 1, precook: 2, meat: 1, dried: 1 },
  });
  expect(IsCookingIngredient('cookedsmallmeat')).toBe(true);
  expect(IsCookingIngredient('seeds')).toBe(false);
  expect(IsCookingIngredient('log')).toBe(false);
  expect(GetIngredientValues(['unknown'])).toEqual({ names: { unknown: 1 }, tags: {} });
  expect(GetIngredientValues(['oceanfish_small_5_inv', 'oceanfish_medium_8_inv']).tags)
    .toEqual({ veggie: 1, meat: 1, fish: 1, frozen: 1 });
});

it('resolves mixed roughage by tags and lets higher-priority recipes win', () => {
  const mixed = ['twigs', 'red_cap', 'red_cap', 'red_cap'];
  expect(CalculateRecipe('cookpot', mixed)).toEqual(['beefalofeed', .5]);
  expect(CalculateRecipe('cookpot', ['twigs', 'twigs', 'twigs', 'twigs'])).toEqual(['beefalofeed', .5]);
  const banana = GetIngredientValues(['twigs', 'cave_banana', 'ice', 'red_cap']);
  expect(foods.beefalofeed.test('cookpot', banana.names, banana.tags)).toBe(true);
  expect(GetCandidateRecipes('cookpot', banana).map(recipe => recipe.name)).toEqual(['bananapop']);
  expect(CalculateRecipe('cookpot', ['twigs', 'cave_banana', 'ice', 'red_cap'])).toEqual(['bananapop', .5]);
  expect(CalculateRecipe('cookpot', ['twigs', 'red_cap', 'red_cap', 'monstermeat'])).toEqual(['kabobs', 2]);
  expect(foods.beefalofeed.test('cookpot', {}, { inedible: 0 })).toBe(true);
  expect(foods.beefalofeed.test('cookpot', {}, { inedible: 1, monster: 0 })).toBe(false);
  expect(BASE_COOK_TIME * foods.beefalofeed.cooktime).toBe(BEEFALO_FEED_COOK_TIME);
  expect(foods.beefalofeed.card_def?.ingredients).toEqual([['twigs', 3], ['acorn', 1]]);
});

it('selects only top-priority candidates by weight, and has no result for an unregistered cooker', () => {
  for (const [name, priority, weight] of [['rare', 2, 1], ['common', 2, 3], ['lower', 1, 100]] as const) {
    AddCookerRecipe('test:cooking', { ...foods.beefalofeed, name, priority, weight, test: () => true });
  }
  expect(GetCandidateRecipes('test:cooking', GetIngredientValues([])).map(recipe => recipe.name)).toEqual(['rare', 'common']);
  expect(CalculateRecipe('test:cooking', [], () => 0)).toEqual(['common', .5]);
  expect(CalculateRecipe('test:cooking', [], () => .99)).toEqual(['rare', .5]);
  expect(CalculateRecipe('missing', [])).toBeUndefined();
  expect(GetRecipe('missing', 'beefalofeed')).toBeUndefined();
  expect(GetRecipe('archive_cookpot', 'beefalofeed')).toBe(foods.beefalofeed);
});
