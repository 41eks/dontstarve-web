import recipeData from '@dontstarve-web/animation/recipes.json';
import type { LootRecipe, LootInst, LootSpawn } from '../../componets/src/lootdropper';
import type { PrefabWorldContext } from './worldContext';

/** AllRecipes includes both crafting recipes and DeconstructRecipe returnIngredients. */
export const STRUCTURE_LOOT_RECIPES = new Map<string, LootRecipe>([
  ...recipeData.recipes
    .filter(recipe => recipe.ingredients.every(ingredient => typeof ingredient.type === 'string' && typeof ingredient.amount === 'number'))
    .map((recipe): [string, LootRecipe] => [recipe.name, { ingredients: recipe.ingredients as LootRecipe['ingredients'] }]),
  ...recipeData.deconstructionRecipes.map((recipe): [string, LootRecipe] => [recipe.name, { ingredients: recipe.returnIngredients as LootRecipe['ingredients'] }]),
]);

/** The structure lootdropper's spawn: the world's item spawning services; loot rules stay in the component. */
export function spawnStructureLoot(inst: LootInst & { worldServices?: Partial<PrefabWorldContext> }): LootSpawn {
  return (prefab, position, skinId) => {
    const world = inst.worldServices;
    if (world?.spawnItem && world.dropItem) {
      const item = world.spawnItem({ itemId: prefab, count: 1, ...(skinId ? { skinId } : {}) });
      world.dropItem(item, position);
      return item;
    }
    world?.dropLoot?.([{ itemId: prefab, count: 1, ...(skinId ? { skinId } : {}) }], position);
    return undefined;
  };
}
