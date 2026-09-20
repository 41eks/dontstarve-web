import type { CategoryConfig, Recipe } from './types';

export function createPlaceholderRecipe(categoryName: string, color: string): Recipe {
  return {
    name: `${categoryName}占位`,
    description: '暂无配方数据。',
    color,
    ingredients: [],
    locked: true,
  };
}

export function createPlaceholderCategory(
  id: string,
  name: string,
  icon: string,
  color: string,
): CategoryConfig {
  return { id, name, icon, recipes: [createPlaceholderRecipe(name, color)] };
}
