import type { Recipe } from './categories';
import { createEffect } from './signal';

interface RecipeButtonMapperOptions {
  atlasImage: (className: string, atlasPath: string, elementName: string) => HTMLCanvasElement;
  isBuffered: (recipe: Recipe) => boolean;
  isLocked: (recipe: Recipe) => boolean;
  recipeIcon: (recipe: Recipe) => HTMLElement;
  selectRecipe: (recipe: Recipe) => void;
  effects: Array<() => void>;
}

export function createRecipeButtonMapper({
  atlasImage,
  isBuffered,
  isLocked,
  recipeIcon,
  selectRecipe,
  effects,
}: RecipeButtonMapperOptions): (recipe: Recipe) => HTMLButtonElement {
  return (recipe) => {
    let buffered = false;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'craft-recipe';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-label', recipe.name);
    button.setAttribute('aria-selected', 'false');
    button.append(
      atlasImage(
        'craft-recipe-bg',
        'images/crafting_menu.xml',
        'slot_bg.tex',
      ),
      recipeIcon(recipe),
      atlasImage('craft-recipe-frame', 'images/crafting_menu.xml', 'slot_frame.tex'),
    );
    effects.push(createEffect(() => {
      const lock = button.querySelector('.craft-lock');
      if (isLocked(recipe)) {
        if (!lock) button.append(atlasImage('craft-lock', 'images/crafting_menu.xml', 'slot_fg_lock.tex'));
      } else {
        lock?.remove();
      }
    }));
    effects.push(createEffect(() => {
      const nextBuffered = isBuffered(recipe);
      if (nextBuffered === buffered) return;
      buffered = nextBuffered;
      button.setAttribute('aria-label', buffered ? `${recipe.name}（已制作）` : recipe.name);
      button.querySelector('.craft-recipe-bg')!.replaceWith(atlasImage(
        'craft-recipe-bg',
        'images/crafting_menu.xml',
        buffered ? 'slot_bg_buffered.tex' : 'slot_bg.tex',
      ));
    }));
    button.addEventListener('click', () => selectRecipe(recipe));
    return button;
  };
}
