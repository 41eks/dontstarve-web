import { categories, type Recipe, type RecipeIngredient, type RecipeSkin } from './categories';
import { createCategoryButtonMapper } from './craft-category-button';
import { createRecipeButtonMapper } from './craft-recipe-button';
import { createCraftingScrollbar } from './crafting-scrollbar';
import { createAtlasImage as atlasImage } from '@dontstarve-web/animation/atlasImage';
import { createEffect, type createSignal } from './signal';
import { urlString } from './utils';

interface CraftingControlsOptions {
  activeCategoryIdState: ReturnType<typeof createSignal<string>>;
  selectedRecipeState: ReturnType<typeof createSignal<Recipe | undefined>>;
  selectedSkinIds: Map<string, string>;
  recipeButtonEffects: Array<() => void>;
  controlEffects: Array<() => void>;
  availableCount: (ingredient: RecipeIngredient) => number;
  isRecipeLocked: (recipe: Recipe) => boolean;
  isRecipeBuffered: (recipe: Recipe) => boolean;
  getCraftingRecipeId: () => string | undefined;
  emitCraftRequest: (recipeId: string, skinId?: string) => void;
  startCrafting: (recipeId: string, skinId?: string) => void;
}

const baseUrl = (import.meta as ImportMeta & { env: { BASE_URL: string } }).env.BASE_URL;
const assetBaseUrl = new URL(`${baseUrl}dst/data/ui/`, document.baseURI).href;

function placeholder(color: string, label: string, className = ''): HTMLSpanElement {
  const icon = document.createElement('span');
  icon.className = `craft-placeholder ${className}`.trim();
  icon.style.setProperty('--placeholder-color', color);
  icon.textContent = label.slice(0, 1);
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

function recipeIcon(recipe: Recipe): HTMLElement {
  if (recipe.asset) {
    const icon = document.createElement('img');
    icon.className = 'craft-recipe-asset';
    icon.src = urlString`${assetBaseUrl}/${recipe.asset}`;
    icon.alt = '';
    return icon;
  }

  if (recipe.inventoryIcon) {
    const icon = atlasImage(
      'craft-recipe-asset',
      recipe.inventoryAtlas ?? 'images/inventoryimages.xml',
      recipe.inventoryIcon,
    );
    icon.addEventListener('error', () => {
      icon.replaceWith(placeholder(recipe.color, recipe.name));
    }, { once: true });
    return icon;
  }

  return placeholder(recipe.color, recipe.name);
}

function skinIcon(recipe: Recipe, skin: RecipeSkin): HTMLElement {
  const icon = atlasImage(
    'craft-recipe-asset',
    skin.inventoryAtlas ?? 'images/inventoryimages.xml',
    skin.inventoryIcon,
  );
  icon.addEventListener('error', () => {
    icon.replaceWith(recipeIcon(recipe));
  }, { once: true });
  return icon;
}

export function initializeCraftingControls(root: ShadowRoot, {
  activeCategoryIdState,
  selectedRecipeState,
  selectedSkinIds,
  recipeButtonEffects,
  controlEffects,
  availableCount,
  isRecipeLocked,
  isRecipeBuffered,
  getCraftingRecipeId,
  emitCraftRequest,
  startCrafting,
}: CraftingControlsOptions) {
  const listeners = new AbortController();
  const scrollbar = createCraftingScrollbar(root);
  const categoryNav = root.querySelector<HTMLElement>('.craft-categories')!;
  const recipeGrid = root.querySelector<HTMLElement>('.craft-recipes')!;
  const quickbar = root.querySelector<HTMLElement>('.craft-quick-items')!;
  root.querySelectorAll('.craft-quick-page-arrow').forEach((arrow) => {
    arrow.append(
      atlasImage('craft-quick-page-arrow-normal', 'images/crafting_menu.xml', 'page_arrow.tex'),
      atlasImage('craft-quick-page-arrow-highlight', 'images/crafting_menu.xml', 'page_arrow_hl.tex'),
    );
  });
  const title = root.querySelector<HTMLHeadingElement>('.craft-detail h2')!;
  const description = root.querySelector<HTMLParagraphElement>('.craft-copy p')!;
  const selectedIcon = root.querySelector<HTMLElement>('.craft-selected-icon')!;
  const selectedName = root.querySelector<HTMLElement>('.craft-preview strong')!;
  const previousSkinButton = root.querySelector<HTMLButtonElement>('.craft-arrow-left')!;
  const nextSkinButton = root.querySelector<HTMLButtonElement>('.craft-arrow-right')!;
  const materials = root.querySelector<HTMLElement>('.craft-materials')!;
  const buildButton = root.querySelector<HTMLButtonElement>('.craft-build')!;
  const categoryTitle = root.querySelector<HTMLHeadingElement>('h1')!;
  root.querySelector('.craft-detail-favorite')!.append(
    atlasImage('craft-detail-favorite-unchecked', 'images/crafting_menu.xml', 'favorite_unchecked.tex'),
    atlasImage('craft-detail-favorite-checked', 'images/crafting_menu.xml', 'favorite_checked.tex'),
  );
  let activeRecipes: readonly Recipe[] = [];
  let activeRecipeButtons: readonly HTMLButtonElement[] = [];
  let selectedRecipeButton: HTMLButtonElement | undefined;
  let renderedIngredients: readonly RecipeIngredient[] = [];
  const initialSelectedRecipeId = selectedRecipeState.get()?.id;

  const refreshMaterials = () => {
    renderedIngredients.forEach((ingredient, index) => {
      updateIngredient(materials.children[index] as HTMLSpanElement, ingredient);
    });
  };
  const refreshBuildButton = () => {
    const recipe = selectedRecipeState.get();
    if (!recipe) {
      buildButton.disabled = true;
      buildButton.textContent = '暂无配方';
      return;
    }
    const craftingRecipeId = getCraftingRecipeId();
    buildButton.disabled = isRecipeLocked(recipe) || Boolean(craftingRecipeId);
    const buffered = isRecipeBuffered(recipe);
    buildButton.textContent = craftingRecipeId
      ? craftingRecipeId === recipe.id ? '制作中…' : '请稍候'
      : buffered ? '放置' : recipe.locked ? '尚未解锁' : '建造';
  };

  const updateSkinSelection = (recipe: Recipe) => {
    const selectedSkinId = selectedSkinIds.get(recipe.id);
    const skinIndex = recipe.skins.findIndex(({ id }) => id === selectedSkinId) + 1;
    if (skinIndex === 0 && selectedSkinId !== undefined) {
      selectedSkinIds.delete(recipe.id);
    }
    const skin = skinIndex === 0 ? undefined : recipe.skins[skinIndex - 1];
    selectedIcon.replaceChildren(skin ? skinIcon(recipe, skin) : recipeIcon(recipe));
    selectedName.textContent = skin?.name ?? '默认';
    const hasSkins = recipe.skins.length > 0;
    previousSkinButton.disabled = !hasSkins;
    nextSkinButton.disabled = !hasSkins;
    previousSkinButton.title = hasSkins ? '上一个皮肤' : '没有可用皮肤';
    nextSkinButton.title = hasSkins ? '下一个皮肤' : '没有可用皮肤';
  };

  const changeSkin = (offset: number) => {
    const recipe = selectedRecipeState.get();
    if (!recipe || recipe.skins.length === 0) return;
    const selectedSkinId = selectedSkinIds.get(recipe.id);
    const currentIndex = selectedSkinId === undefined
      ? 0
      : recipe.skins.findIndex(({ id }) => id === selectedSkinId) + 1;
    const optionCount = recipe.skins.length + 1;
    const nextIndex = (currentIndex + offset + optionCount) % optionCount;
    if (nextIndex === 0) selectedSkinIds.delete(recipe.id);
    else selectedSkinIds.set(recipe.id, recipe.skins[nextIndex - 1].id);
    updateSkinSelection(recipe);
  };

  const updateSelectedButton = (recipe: Recipe | undefined) => {
    const nextButton = recipe ? activeRecipeButtons[activeRecipes.indexOf(recipe)] : undefined;
    if (nextButton === selectedRecipeButton) return;
    selectedRecipeButton?.setAttribute('aria-selected', 'false');
    nextButton?.setAttribute('aria-selected', 'true');
    selectedRecipeButton = nextButton;
  };

  const updateSelection = (index: number) => {
    const recipe = activeRecipes.length === 0
      ? undefined
      : activeRecipes[(index + activeRecipes.length) % activeRecipes.length];
    updateSelectedButton(recipe);
    selectedRecipeState.set(recipe);
  };

  const selectRecipe = (recipe: Recipe) => {
    const index = activeRecipes.indexOf(recipe);
    if (index >= 0) updateSelection(index);
  };

  const mapRecipeToButton = createRecipeButtonMapper({
    atlasImage,
    isBuffered: isRecipeBuffered,
    isLocked: isRecipeLocked,
    recipeIcon,
    selectRecipe,
    effects: recipeButtonEffects,
  });

  const categoryViews = categories.filter(({ id }) => id !== 'none').map((category) => {
    const recipeGroup = document.createElement('div');
    recipeGroup.className = 'craft-recipe-category';
    recipeGroup.hidden = true;
    const recipeButtons = category.recipes.map(mapRecipeToButton);
    for (let index = 0; index < recipeButtons.length; index += 7) {
      const row = document.createElement('div');
      row.className = 'craft-recipe-row';
      row.append(...recipeButtons.slice(index, index + 7));
      recipeGroup.append(row);
    }
    recipeGrid.append(recipeGroup);

    const quickGroup = document.createElement('div');
    quickGroup.className = 'craft-quick-category';
    quickGroup.hidden = true;
    category.recipes.slice(0, 10).forEach((recipe) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'craft-quick-item';
      button.setAttribute('aria-label', recipe.name);
      button.dataset.label = recipe.name;
      button.append(
        atlasImage('craft-quick-item-bg', 'images/crafting_menu.xml', 'pinslot_bg.tex'),
        recipeIcon(recipe),
      );
      button.addEventListener('click', () => selectRecipe(recipe), { signal: listeners.signal });
      quickGroup.append(button);
    });
    quickbar.append(quickGroup);
    return { category, recipeGroup, quickGroup, recipeButtons };
  });
  const allView = {
    category: categories.find(({ id }) => id === 'none')!,
    recipeButtons: categoryViews.flatMap(({ recipeButtons }) => recipeButtons),
  };

  const categoryButtons = categories.map(createCategoryButtonMapper({
    activeCategoryId: activeCategoryIdState.get(),
    assetBaseUrl,
    atlasImage,
    selectCategory: (category) => activeCategoryIdState.set(category.id),
  }));
  categoryNav.append(...categoryButtons);

  controlEffects.push(createEffect(() => {
    const activeCategoryId = activeCategoryIdState.get();
    categoryViews.forEach(({ category, recipeGroup, quickGroup }) => {
      const recipeHidden = activeCategoryId !== 'none' && category.id !== activeCategoryId;
      const quickHidden = category.id !== (activeCategoryId === 'none' ? categoryViews[0].category.id : activeCategoryId);
      if (recipeGroup.hidden !== recipeHidden) recipeGroup.hidden = recipeHidden;
      if (quickGroup.hidden !== quickHidden) quickGroup.hidden = quickHidden;
    });
  }));

  let previousCategoryId: string | undefined;
  controlEffects.push(createEffect(() => {
    const activeCategoryId = activeCategoryIdState.get();
    const view = activeCategoryId === 'none'
      ? allView
      : categoryViews.find(({ category }) => category.id === activeCategoryId) ?? categoryViews[0];
    if (previousCategoryId !== undefined && previousCategoryId !== view.category.id) recipeGrid.scrollTop = 0;
    activeRecipes = view.category.recipes;
    activeRecipeButtons = view.recipeButtons;
    categoryTitle.textContent = view.category.name;
    categoryButtons.forEach((button, index) => {
      const pressed = String(categories[index].id === view.category.id);
      if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
    });
    const preservedIndex = previousCategoryId === undefined
      ? activeRecipes.findIndex(({ id }) => id === initialSelectedRecipeId)
      : -1;
    previousCategoryId = view.category.id;
    updateSelection(preservedIndex < 0 ? 0 : preservedIndex);
    scrollbar.refresh();
  }));

  controlEffects.push(createEffect(() => {
    const recipe = selectedRecipeState.get();
    renderedIngredients = recipe?.ingredients ?? [];
    updateSelectedButton(recipe);
    if (!recipe) {
      title.textContent = '暂无配方';
      description.textContent = '';
      selectedIcon.replaceChildren();
      selectedName.textContent = '';
      previousSkinButton.disabled = true;
      nextSkinButton.disabled = true;
      materials.replaceChildren();
      return;
    }
    title.textContent = recipe.name;
    description.textContent = recipe.description;
    updateSkinSelection(recipe);
    materials.replaceChildren(...recipe.ingredients.map(ingredient));
  }));

  previousSkinButton.addEventListener('click', () => changeSkin(-1), { signal: listeners.signal });
  nextSkinButton.addEventListener('click', () => changeSkin(1), { signal: listeners.signal });
  buildButton.addEventListener('click', () => {
    const recipe = selectedRecipeState.get();
    if (!recipe || isRecipeLocked(recipe) || getCraftingRecipeId()) return;
    const skinId = selectedSkinIds.get(recipe.id);
    if (isRecipeBuffered(recipe)) {
      emitCraftRequest(recipe.id, skinId);
      return;
    }
    startCrafting(recipe.id, skinId);
  }, { signal: listeners.signal });
  controlEffects.push(createEffect(refreshBuildButton));

  function ingredient(ingredient: RecipeIngredient): HTMLSpanElement {
    const item = document.createElement('span');

    if (ingredient.inventoryIcon) {
      item.append(atlasImage(
        'craft-material-asset',
        ingredient.inventoryAtlas ?? 'images/inventoryimages.xml',
        ingredient.inventoryIcon,
      ));
    } else {
      item.append(placeholder(ingredient.color, ingredient.name, 'craft-placeholder-material'));
    }

    const count = document.createElement('span');
    count.className = 'craft-material-count';
    item.append(count);
    updateIngredient(item, ingredient);
    return item;
  }

  function updateIngredient(item: HTMLSpanElement, ingredient: RecipeIngredient): void {
    const available = availableCount(ingredient);
    item.className = `craft-material ${available >= ingredient.required ? 'has-materials' : 'missing-materials'}`;
    const required = ingredient.requiredLabel ?? String(ingredient.required);
    item.setAttribute('aria-label', `${ingredient.name} ${available}/${required}`);
    item.querySelector('.craft-material-count')!.textContent = ingredient.requiredLabel ?? `${available}/${ingredient.required}`;
  }

  return {
    refreshMaterials,
    refreshBuildButton,
    dispose: () => {
      scrollbar.dispose();
      listeners.abort();
    },
  };
}
