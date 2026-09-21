import recipeDataJson from '@three-roaming/wilson/recipes.json' with { type: 'json' };
import {
  filterRecipeIds,
  ingredientNames,
  recipeDescriptions,
  recipeNames,
} from './generated';
import type { CategoryConfig, Recipe, RecipeIngredient } from './types';

interface LuaExpression {
  readonly lua: string;
}

interface SourceIngredient {
  readonly type: string | LuaExpression;
  readonly amount: number | LuaExpression;
  readonly atlas?: string | LuaExpression;
  readonly image?: string | LuaExpression;
}

interface SourceRecipe {
  readonly name: string;
  readonly ingredients: readonly SourceIngredient[];
  readonly config: Readonly<Record<string, unknown>>;
}

interface RecipeData {
  readonly recipes: readonly SourceRecipe[];
}

export interface InventoryRecipeDefinition {
  readonly recipeId: string;
  readonly productId: string;
  readonly productCount: number;
  readonly ingredients: Readonly<Record<string, number>>;
  readonly buffered: boolean;
}

export interface InventoryProductSpec {
  readonly name: string;
  readonly icon: string;
  readonly atlas?: string;
}

export type CraftingFilterName = keyof typeof filterRecipeIds;

const recipeData = recipeDataJson as unknown as RecipeData;
const recipesById = new Map(recipeData.recipes.map((recipe) => [recipe.name, recipe]));

function recipeProduct(source: SourceRecipe) {
  const configuredProduct = source.config.product;
  const id = configuredProduct === undefined ? source.name : stringValue(configuredProduct);
  const configuredCount = source.config.numtogive;
  const count = configuredCount === undefined ? 1 : configuredCount;
  if (!id || typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) {
    return undefined;
  }
  return { id, count };
}

function createInventoryRecipe(
  source: SourceRecipe,
): InventoryRecipeDefinition | undefined {
  const product = recipeProduct(source);
  if (!product) return undefined;

  const ingredients: Record<string, number> = {};
  for (const ingredient of source.ingredients) {
    if (typeof ingredient.type !== 'string'
      || typeof ingredient.amount !== 'number'
      || !Number.isSafeInteger(ingredient.amount)
      || ingredient.amount <= 0) {
      return undefined;
    }
    ingredients[ingredient.type] = (ingredients[ingredient.type] ?? 0) + ingredient.amount;
  }
  return {
    recipeId: source.name,
    productId: product.id,
    productCount: product.count,
    ingredients,
    buffered: typeof source.config.placer === 'string',
  };
}

export const INVENTORY_RECIPES: Readonly<Record<string, InventoryRecipeDefinition>> =
  Object.fromEntries(recipeData.recipes.flatMap((source) => {
    const recipe = createInventoryRecipe(source);
    return recipe ? [[source.name, recipe]] : [];
  }));

function createInventoryProductSpec(
  source: SourceRecipe,
): readonly [string, InventoryProductSpec] | undefined {
  const product = recipeProduct(source);
  if (!product) return undefined;
  const nameOverride = stringValue(source.config.nameoverride);
  const nameKey = nameOverride ?? product.id;
  const atlas = stringValue(source.config.atlas);
  return [product.id, {
    name: ingredientNames[nameKey]
      ?? recipeNames[nameKey]
      ?? recipeNames[source.name]
      ?? humanize(product.id),
    icon: stringValue(source.config.image) ?? `${product.id}.tex`,
    ...(atlas ? { atlas } : {}),
  }];
}

const inventoryProductSpecs = new Map<string, InventoryProductSpec>();
for (const source of recipeData.recipes) {
  const entry = createInventoryProductSpec(source);
  if (!entry) continue;
  const [productId, spec] = entry;
  if (!inventoryProductSpecs.has(productId) || source.name === productId) {
    inventoryProductSpecs.set(productId, spec);
  }
}

export const INVENTORY_PRODUCT_SPECS: Readonly<Record<string, InventoryProductSpec>> =
  Object.fromEntries(inventoryProductSpecs);

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function humanize(id: string): string {
  return id.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function colorFor(id: string): string {
  let hash = 0;
  for (const character of id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 24% 48%)`;
}

function characterIngredientName(expression: string): string {
  const names: Readonly<Record<string, string>> = {
    HEALTH: '生命值',
    MAX_HEALTH: '最大生命值',
    MAX_SANITY: '最大理智值',
    SANITY: '理智值',
  };
  const id = expression.split('.').at(-1) ?? expression;
  return names[id] ?? humanize(id);
}

function createIngredient(source: SourceIngredient): RecipeIngredient {
  if (typeof source.type !== 'string') {
    return {
      id: source.type.lua,
      name: characterIngredientName(source.type.lua),
      color: '#9c6670',
      available: 0,
      required: 0,
      requiredLabel: typeof source.amount === 'number' ? String(source.amount) : source.amount.lua,
    };
  }

  const amount = typeof source.amount === 'number' ? source.amount : 0;
  const atlas = stringValue(source.atlas);
  const image = stringValue(source.image) ?? `${source.type}.tex`;
  return {
    id: source.type,
    name: ingredientNames[source.type] ?? humanize(source.type),
    color: colorFor(source.type),
    available: 0,
    required: amount,
    ...(typeof source.amount === 'number' ? {} : { requiredLabel: source.amount.lua }),
    ...(atlas ? { inventoryAtlas: atlas } : {}),
    inventoryIcon: image,
  };
}

function createRecipe(id: string, color: string): Recipe {
  const source = recipesById.get(id);
  if (!source) {
    return {
      id,
      name: recipeNames[id] ?? humanize(id),
      description: recipeDescriptions[id] ?? '',
      color,
      inventoryIcon: `${id}.tex`,
      ingredients: [],
    };
  }

  const product = stringValue(source.config.product) ?? id;
  const image = stringValue(source.config.image) ?? `${product}.tex`;
  const atlas = stringValue(source.config.atlas);
  return {
    id,
    name: recipeNames[id] ?? humanize(id),
    description: recipeDescriptions[id] ?? '',
    color,
    ...(atlas ? { inventoryAtlas: atlas } : {}),
    inventoryIcon: image,
    ingredients: source.ingredients.map(createIngredient),
  };
}

export function createCategory(
  id: string,
  filter: CraftingFilterName,
  name: string,
  icon: string,
  color: string,
): CategoryConfig {
  return {
    id,
    name,
    icon,
    recipes: filterRecipeIds[filter].map((recipeId) => createRecipe(recipeId, color)),
  };
}

export function createAllRecipesCategory(
  id: string,
  name: string,
  icon: string,
  color: string,
): CategoryConfig {
  return { id, name, icon, recipes: recipeData.recipes.map(({ name: recipeId }) => createRecipe(recipeId, color)) };
}

export function createEmptyCategory(
  id: string,
  name: string,
  icon: string,
): CategoryConfig {
  return { id, name, icon, recipes: [] };
}
