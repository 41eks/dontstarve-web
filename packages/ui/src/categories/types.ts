export interface RecipeIngredient {
  id: string;
  name: string;
  color: string;
  available: number;
  required: number;
  requiredLabel?: string;
  inventoryAtlas?: string;
  inventoryIcon?: string;
}

export interface RecipeSkin {
  id: string;
  name: string;
  inventoryAtlas?: string;
  inventoryIcon: string;
}

export interface Recipe {
  id: string;
  name: string;
  description: string;
  color: string;
  asset?: string;
  inventoryAtlas?: string;
  inventoryIcon?: string;
  ingredients: readonly RecipeIngredient[];
  skins: readonly RecipeSkin[];
  locked?: boolean;
}

export interface CategoryConfig {
  id: string;
  name: string;
  icon: string;
  iconAtlas?: string;
  recipes: readonly Recipe[];
}
