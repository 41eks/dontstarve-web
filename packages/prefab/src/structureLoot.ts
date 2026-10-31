import recipeData from '@dontstarve-web/animation/recipes.json';
import { LootDropper, type LootRecipe } from '../../componets/src/lootdropper';
import type { PrefabInstance } from './prefabInstance';

/** AllRecipes includes both crafting recipes and DeconstructRecipe returnIngredients. */
const recipes = new Map<string, LootRecipe>([
  ...recipeData.recipes
    .filter(recipe => recipe.ingredients.every(ingredient => typeof ingredient.type === 'string' && typeof ingredient.amount === 'number'))
    .map((recipe): [string, LootRecipe] => [recipe.name, { ingredients: recipe.ingredients as LootRecipe['ingredients'] }]),
  ...recipeData.deconstructionRecipes.map((recipe): [string, LootRecipe] => [recipe.name, { ingredients: recipe.returnIngredients as LootRecipe['ingredients'] }]),
]);

/** Bind lootdropper to the world's item spawning services; loot rules stay in the component. */
export function createStructureLootDropper(inst: PrefabInstance): LootDropper {
  return new LootDropper(inst, (prefab, position, skinId) => {
    const world = inst.worldServices;
    if (world?.spawnItem && world.dropItem) {
      const item = world.spawnItem({ itemId: prefab, count: 1, ...(skinId ? { skinId } : {}) });
      world.dropItem(item, position);
      return item;
    }
    world?.dropLoot?.([{ itemId: prefab, count: 1 }], position);
    return undefined;
  }, recipes);
}
