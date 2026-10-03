import { createRecipe, recipeData } from './shared';
import { filterRecipeIds } from './generated';
import type { CategoryConfig } from './types';

export type { CategoryConfig, Recipe, RecipeIngredient, RecipeSkin } from './types';

function category(id: string, filter: keyof typeof filterRecipeIds, name: string, icon: string, iconAtlas?: string): CategoryConfig {
  return { id, name, icon, ...(iconAtlas ? { iconAtlas } : {}), recipes: filterRecipeIds[filter].map((recipeId) => createRecipe(recipeId)) };
}

export const favoritesCategory: CategoryConfig = { id: 'favorites', name: '收藏', icon: 'filter_favorites.tex', recipes: [] };
export const craftingStationCategory = category('crafting-station', 'CRAFTING_STATION', '制作站', 'filter_none.tex');
export const specialEventCategory = category('special-event', 'SPECIAL_EVENT', '活动', 'filter_events.tex');

export const categories = [
  category('character', 'CHARACTER', '角色', 'avatar_wilson.tex', 'images/crafting_menu_avatars.xml'),
  category('tool', 'TOOLS', '工具', 'filter_tool.tex'),
  category('fire', 'LIGHT', '光源', 'filter_fire.tex'),
  category('science', 'PROTOTYPERS', '科学', 'filter_science.tex'),
  category('refine', 'REFINE', '精炼', 'filter_refine.tex'),
  category('weapon', 'WEAPONS', '武器', 'filter_weapon.tex'),
  category('armour', 'ARMOUR', '护甲', 'filter_armour.tex'),
  category('warable', 'CLOTHING', '服装', 'filter_warable.tex'),
  category('health', 'RESTORATION', '生存', 'filter_health.tex'),
  category('skull', 'MAGIC', '魔法', 'filter_skull.tex'),
  category('cosmetic', 'DECOR', '装饰', 'filter_cosmetic.tex'),
  category('structure', 'STRUCTURES', '建筑', 'filter_structure.tex'),
  category('containers', 'CONTAINERS', '容器', 'filter_containers.tex'),
  category('cooking', 'COOKING', '烹饪', 'filter_cooking.tex'),
  category('gardening', 'GARDENING', '农业', 'filter_gardening.tex'),
  category('fishing', 'FISHING', '钓鱼', 'filter_fishing.tex'),
  category('sailing', 'SEAFARING', '航海', 'filter_sailing.tex'),
  category('riding', 'RIDING', '骑行', 'filter_riding.tex'),
  category('winter', 'WINTER', '冬季', 'filter_winter.tex'),
  category('summer', 'SUMMER', '夏季', 'filter_summer.tex'),
  category('rain', 'RAIN', '雨天', 'filter_rain.tex'),
  { id: 'none', name: '全部', icon: 'filter_none.tex', recipes: recipeData.recipes.map(({ name: recipeId }) => createRecipe(recipeId)) },
] as const;