import type { Recipe } from './categories';

interface RecipeButtonMapperOptions {
  atlasImage: (className: string, atlasPath: string, elementName: string) => HTMLCanvasElement;
  isBuffered: (recipe: Recipe) => boolean;
  isLocked: (recipe: Recipe) => boolean;
  recipeIcon: (recipe: Recipe) => HTMLElement;
  selectRecipe: (index: number) => void;
}

export function createRecipeButtonMapper({
  atlasImage,
  isBuffered,
  isLocked,
  recipeIcon,
  selectRecipe,
}: RecipeButtonMapperOptions): (recipe: Recipe, index: number) => HTMLButtonElement {
  return (recipe, index) => {
    const buffered = isBuffered(recipe);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'craft-recipe';
    button.dataset.recipe = recipe.id;
    button.dataset.buffered = String(buffered);
    button.setAttribute('role', 'option');
    button.setAttribute('aria-label', buffered ? `${recipe.name}（已制作）` : recipe.name);
    button.setAttribute('aria-selected', 'false');
    button.append(
      atlasImage(
        'craft-recipe-bg',
        'images/crafting_menu.xml',
        buffered ? 'slot_bg_buffered.tex' : 'slot_bg.tex',
      ),
      recipeIcon(recipe),
      atlasImage('craft-recipe-frame', 'images/crafting_menu.xml', 'slot_frame.tex'),
    );
    if (isLocked(recipe)) {
      button.append(atlasImage('craft-lock', 'images/crafting_menu.xml', 'slot_fg_lock.tex'));
    }
    button.addEventListener('click', () => selectRecipe(index));
    return button;
  };
}
