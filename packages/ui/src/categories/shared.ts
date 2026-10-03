import { HAT_DEFINITIONS, HAT_RECIPES, HAT_SKIN_SPECS, isHatId } from '@three-roaming/prefab/hats';
import { GROUND_ITEM_SKIN_SPECS } from '@three-roaming/prefab/groundItems';
import recipeDataJson from '@three-roaming/animation/recipes.json' with { type: 'json' };
import type { InventoryRecipeDefinition, InventorySkinSpec } from '@three-roaming/inventory';
import {
  ingredientNames,
  recipeDescriptions,
  recipeNames,
  recipeSkins,
} from './generated';
import type { Recipe, RecipeIngredient } from './types';

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

export type { InventoryRecipeDefinition, InventorySkinSpec } from '@three-roaming/inventory';

export interface InventoryProductSpec {
  readonly name: string;
  readonly icon: string;
  readonly atlas?: string;
}

const recipeData = recipeDataJson as unknown as RecipeData;
const recipesById = new Map(recipeData.recipes.map((recipe) => [recipe.name, recipe]));

export { recipeData };

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
  { ...Object.fromEntries(recipeData.recipes.flatMap((source) => {
    const productId = recipeProduct(source)?.id;
    const recipe = productId && isHatId(productId) ? HAT_RECIPES[source.name] : createInventoryRecipe(source);
    return recipe ? [[source.name, recipe]] : [];
  })), ...HAT_RECIPES };

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

export const INVENTORY_SKIN_SPECS: Readonly<Record<string, InventorySkinSpec>> =
  { ...Object.fromEntries(Object.entries(recipeSkins).flatMap(([recipeId, skins]) => skins.map((skin) => [skin.id, {
    itemId: INVENTORY_RECIPES[recipeId]?.productId ?? recipeId,
    name: skin.name,
    icon: `${skin.id.replace(/_builder$/, '').replaceAll('_none', '')}.tex`,
    atlas: 'images/inventoryimages.xml',
  }]))), ...GROUND_ITEM_SKIN_SPECS, ...HAT_SKIN_SPECS };

export const INVENTORY_RECIPE_SKINS: Readonly<Record<string, readonly string[]>> =
  Object.fromEntries(Object.entries(recipeSkins).map(([id, skins]) => [id, skins.map((skin) => skin.id)]));

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

export function createRecipe(id: string): Recipe {
  const source = recipesById.get(id);
  if (!source) {
    return {
      id,
      name: recipeNames[id] ?? humanize(id),
      description: recipeDescriptions[id] ?? '',
      color: colorFor(id),
      inventoryIcon: `${id}.tex`,
      ingredients: [],
      skins: [],
    };
  }

  const product = stringValue(source.config.product) ?? id;
  const hat = HAT_DEFINITIONS[product];
  const image = hat?.icon ?? stringValue(source.config.image) ?? `${product}.tex`;
  const atlas = hat?.atlas ?? stringValue(source.config.atlas);
  return {
    id,
    name: recipeNames[id] ?? humanize(id),
    description: recipeDescriptions[id] ?? '',
    color: colorFor(id),
    ...(atlas ? { inventoryAtlas: atlas } : {}),
    inventoryIcon: image,
    ...(hat && !HAT_RECIPES[id] ? { locked: true } : {}),
    ingredients: source.ingredients.map((ingredient) => {
      const display = createIngredient(ingredient);
      return hat && ingredient.amount === 0
        ? { ...display, required: 1, requiredLabel: '1（不消耗）' } : display;
    }),
    skins: (recipeSkins[product] ?? []).map((skin) => ({
      ...skin,
      inventoryAtlas: HAT_SKIN_SPECS[skin.id]?.atlas ?? 'images/inventoryimages.xml',
      inventoryIcon: HAT_SKIN_SPECS[skin.id]?.icon ?? `${skin.id.replace(/_builder$/, '').replaceAll('_none', '')}.tex`,
    })),
  };
}
