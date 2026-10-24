import catalog from '../../animation/recipes.json' with { type: 'json' };

export interface DeconstructionRecipe {
  readonly ingredients: readonly { type: string; amount: number }[];
  readonly numtogive: number;
  readonly noDeconstruction: boolean;
  readonly ignoresFiniteUses: boolean;
}

// AllRecipes is keyed by recipe name, including DeconstructRecipe entries.
const recipes = new Map<string, DeconstructionRecipe>();
for (const entry of [...catalog.recipes, ...catalog.deconstructionRecipes]) {
  const config = entry.config as Record<string, unknown>;
  const rawIngredients = 'ingredients' in entry ? entry.ingredients : entry.returnIngredients;
  // Runtime Lua ingredient functions belong to prefabs outside the supported source branches.
  if (rawIngredients.some(ingredient => typeof ingredient.type !== 'string' || typeof ingredient.amount !== 'number')) continue;
  recipes.set(entry.name, {
    ingredients: rawIngredients as { type: string; amount: number }[],
    numtogive: typeof config.numtogive === 'number' ? config.numtogive : 1,
    noDeconstruction: !!config.no_deconstruction,
    ignoresFiniteUses: config.decon_ignores_finiteuses === true,
  });
}
export function getDeconstructionRecipe(prefab: string): DeconstructionRecipe | undefined {
  const recipe = recipes.get(prefab);
  return recipe?.noDeconstruction ? undefined : recipe;
}
