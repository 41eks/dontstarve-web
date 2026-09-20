export interface RecipeIngredient {
  name: string;
  color: string;
  available: number;
  required: number;
  asset?: string;
}

export interface Recipe {
  name: string;
  description: string;
  color: string;
  asset?: string;
  ingredients: readonly RecipeIngredient[];
  locked?: boolean;
}

export interface CategoryConfig {
  id: string;
  name: string;
  icon: string;
  recipes: readonly Recipe[];
}
