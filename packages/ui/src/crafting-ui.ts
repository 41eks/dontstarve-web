import { AssetElement } from './assets';
import {
  categories,
  type Recipe,
  type RecipeIngredient,
  type RecipeSkin,
} from './categories';
import { createCategoryButtonMapper } from './craft-category-button';
import { createRecipeButtonMapper } from './craft-recipe-button';
import styles from './styles/crafting-ui.css?inline';
import { createAtlasImage } from './atlasImage';
import type { InventoryMaterialSummary } from '@three-roaming/inventory';
import { createEffect, createSignal } from './signal';

const baseUrl = (import.meta as ImportMeta & { env: { BASE_URL: string } }).env.BASE_URL;
const imageArchiveUrl = new URL(
  `${baseUrl}dst/data/databundles/images.zip`,
  document.baseURI,
).href;

const atlasImage = createAtlasImage(imageArchiveUrl);
const assetBaseUrl = new URL('dst/data/ui/', document.baseURI).href;

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

export interface CraftRequestDetail {
  recipeId: string;
  skinId?: string;
}

export interface CraftingStateDetail extends CraftRequestDetail {
  crafting: boolean;
}

export const CRAFT_DURATION_MS = 1_000;

let resolveCraftingUiReady: () => void;
/** Resolves after the first mounted crafting menu creates all groups, buttons and initial effects. */
export const craftingUiReady: Promise<void> = new Promise((resolve) => {
  resolveCraftingUiReady = resolve;
});

export class DstCraftingUiElement extends AssetElement {
  private readonly activeCategoryIdState = createSignal('tool');
  private bufferedRecipeIds = new Set<string>();
  private collapsed = true;
  private materialSummary?: InventoryMaterialSummary;
  private selectedRecipeId?: string;
  private readonly selectedSkinIds = new Map<string, string>();
  private craftingRecipeId?: string;
  private craftingSkinId?: string;
  private craftingTimer?: ReturnType<typeof setTimeout>;
  private readonly recipes = [...new Set(categories.flatMap((category) => category.recipes))];
  private readonly recipeIndices = new Map(this.recipes.map((recipe, index) => [recipe, index]));
  private isLockedArray = this.recipes.map((recipe) => this.calculateRecipeLocked(recipe));
  private readonly recipeLockStates = this.isLockedArray.map((locked) => createSignal(locked));
  private readonly recipeBufferedStates = this.recipes.map(() => createSignal(false));
  private readonly recipeButtonEffects: Array<() => void> = [];
  private readonly controlEffects: Array<() => void> = [];
  private refreshMaterials?: () => void;
  private refreshBuildButton?: () => void;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  setMaterialSummary(summary: InventoryMaterialSummary): void {
    const next = { ...summary };
    const previous = this.materialSummary;
    if (previous
      && Object.keys(previous).length === Object.keys(next).length
      && Object.entries(next).every(([itemId, count]) => previous[itemId] === count)) {
      return;
    }
    this.materialSummary = next;
    this.updateRecipeLocks();
    if (this.isConnected) this.refreshMaterials?.();
  }

  setBufferedRecipes(recipeIds: Iterable<string>): void {
    const next = new Set(recipeIds);
    if (next.size === this.bufferedRecipeIds.size
      && [...next].every((recipeId) => this.bufferedRecipeIds.has(recipeId))) {
      return;
    }
    this.bufferedRecipeIds = next;
    this.updateRecipeLocks();
    this.recipes.forEach((recipe, index) => {
      const buffered = next.has(recipe.id);
      if (buffered !== this.recipeBufferedStates[index].get()) this.recipeBufferedStates[index].set(buffered);
    });
  }

  disconnectedCallback(): void {
    this.disposeEffects();
    if (!this.craftingRecipeId) return;
    if (this.craftingTimer !== undefined) clearTimeout(this.craftingTimer);
    const recipeId = this.craftingRecipeId;
    const skinId = this.craftingSkinId;
    this.craftingRecipeId = undefined;
    this.craftingSkinId = undefined;
    this.craftingTimer = undefined;
    this.emitCraftingState(recipeId, false, skinId);
  }

  protected render(): void {
    this.disposeEffects();
    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>${styles}</style>
      <section class="craft-panel" aria-label="制作菜单">
        <header class="craft-header">
          <button class="craft-favorite" type="button" aria-label="收藏配方">
            <img class="craft-favorite-bg craft-favorite-bg-inactive" src="${this.asset('crafting/filter/filter_button_inactive.tex.png')}" alt="" />
            <img class="craft-favorite-bg craft-favorite-bg-active" src="${this.asset('crafting/filter/filter_button_active.tex.png')}" alt="" />
            <img class="craft-favorite-icon" src="${this.asset('crafting/filter/filter_favorites.tex.png')}" alt="" />
          </button>
          <h1>工具</h1>
          <button class="craft-view-toggle" type="button" aria-label="切换网格视图"><span></span><span></span><span></span><span></span></button>
        </header>
        <nav class="craft-categories" aria-label="制作分类"></nav>
        <div class="craft-recipes" role="listbox" aria-label="配方列表"></div>
        <div class="craft-scroll-marker" aria-hidden="true"></div>
        <article class="craft-detail" aria-live="polite">
          <div class="craft-copy">
            <div class="craft-detail-heading"><span aria-hidden="true">★</span><h2></h2></div>
            <p></p>
          </div>
          <div class="craft-preview">
            <button class="craft-arrow craft-arrow-left" type="button" aria-label="上一个皮肤"><img src="${this.asset('crafting/crafting_inventory_arrow_l_idle.tex.png')}" alt="" /></button>
            <div class="craft-selected-icon"></div>
            <button class="craft-arrow craft-arrow-right" type="button" aria-label="下一个皮肤"><img src="${this.asset('crafting/crafting_inventory_arrow_r_idle.tex.png')}" alt="" /></button>
            <strong></strong>
          </div>
          <div class="craft-materials"></div>
          <button class="craft-build" type="button">建造</button>
        </article>
        <aside class="craft-quickbar" aria-label="快捷制作">
          <button class="craft-quick-toggle" type="button" aria-label="展开制作菜单">
            <img class="craft-quick-tab-background" src="${this.asset('crafting/crafting_tab.tex.png')}" alt="" />
            <img class="craft-quick-tab-mark" src="${this.asset('crafting/station_none.tex.png')}" alt="" />
          </button>
          <div class="craft-quick-page" aria-label="配方页码"><span>‹</span><b>1</b><span>›</span></div>
          <div class="craft-quick-items"></div>
        </aside>
      </section>
    `;

    this.initializeControls(root);
    resolveCraftingUiReady();
  }

  private initializeControls(root: ShadowRoot): void {
    const panel = root.querySelector<HTMLElement>('.craft-panel')!;
    const categoryNav = root.querySelector<HTMLElement>('.craft-categories')!;
    const recipeGrid = root.querySelector<HTMLElement>('.craft-recipes')!;
    const quickbar = root.querySelector<HTMLElement>('.craft-quick-items')!;
    const title = root.querySelector<HTMLHeadingElement>('.craft-detail h2')!;
    const description = root.querySelector<HTMLParagraphElement>('.craft-copy p')!;
    const selectedIcon = root.querySelector<HTMLElement>('.craft-selected-icon')!;
    const selectedName = root.querySelector<HTMLElement>('.craft-preview strong')!;
    const previousSkinButton = root.querySelector<HTMLButtonElement>('.craft-arrow-left')!;
    const nextSkinButton = root.querySelector<HTMLButtonElement>('.craft-arrow-right')!;
    const materials = root.querySelector<HTMLElement>('.craft-materials')!;
    const buildButton = root.querySelector<HTMLButtonElement>('.craft-build')!;
    const categoryTitle = root.querySelector<HTMLHeadingElement>('h1')!;
    let selectedIndex = 0;
    let activeRecipes: readonly Recipe[] = [];
    let activeRecipeButtons: readonly HTMLButtonElement[] = [];
    let selectedRecipeButton: HTMLButtonElement | undefined;
    const selectedRecipeState = createSignal<Recipe | undefined>(undefined);

    this.refreshMaterials = () => {
      const recipe = activeRecipes[selectedIndex];
      recipe?.ingredients.forEach((ingredient, index) => {
        this.updateIngredient(materials.children[index] as HTMLSpanElement, ingredient);
      });
    };
    this.refreshBuildButton = () => {
      const recipe = selectedRecipeState.get();
      if (!recipe) {
        buildButton.disabled = true;
        buildButton.textContent = '暂无配方';
        return;
      }
      buildButton.disabled = this.isRecipeLocked(recipe) || Boolean(this.craftingRecipeId);
      const buffered = this.isRecipeBuffered(recipe);
      buildButton.textContent = this.craftingRecipeId
        ? this.craftingRecipeId === recipe.id ? '制作中…' : '请稍候'
        : buffered ? '放置' : recipe.locked ? '尚未解锁' : '建造';
    };

    const updateSkinSelection = (recipe: Recipe) => {
      const selectedSkinId = this.selectedSkinIds.get(recipe.id);
      const skinIndex = recipe.skins.findIndex(({ id }) => id === selectedSkinId) + 1;
      if (skinIndex === 0 && selectedSkinId !== undefined) {
        this.selectedSkinIds.delete(recipe.id);
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
      const recipe = activeRecipes[selectedIndex];
      if (!recipe || recipe.skins.length === 0) return;
      const selectedSkinId = this.selectedSkinIds.get(recipe.id);
      const currentIndex = selectedSkinId === undefined
        ? 0
        : recipe.skins.findIndex(({ id }) => id === selectedSkinId) + 1;
      const optionCount = recipe.skins.length + 1;
      const nextIndex = (currentIndex + offset + optionCount) % optionCount;
      if (nextIndex === 0) this.selectedSkinIds.delete(recipe.id);
      else this.selectedSkinIds.set(recipe.id, recipe.skins[nextIndex - 1].id);
      updateSkinSelection(recipe);
    };

    const updateSelection = (index: number) => {
      if (activeRecipes.length === 0) {
        selectedRecipeButton?.setAttribute('aria-selected', 'false');
        selectedRecipeButton = undefined;
        selectedRecipeState.set(undefined);
        title.textContent = '暂无配方';
        description.textContent = '';
        selectedIcon.replaceChildren();
        selectedName.textContent = '';
        previousSkinButton.disabled = true;
        nextSkinButton.disabled = true;
        materials.replaceChildren();
        return;
      }

      selectedIndex = (index + activeRecipes.length) % activeRecipes.length;
      const recipe = activeRecipes[selectedIndex];
      selectedRecipeState.set(recipe);
      this.selectedRecipeId = recipe.id;
      const nextButton = activeRecipeButtons[selectedIndex];
      if (nextButton !== selectedRecipeButton) {
        selectedRecipeButton?.setAttribute('aria-selected', 'false');
        nextButton.setAttribute('aria-selected', 'true');
        selectedRecipeButton = nextButton;
      }
      title.textContent = recipe.name;
      description.textContent = recipe.description;
      updateSkinSelection(recipe);
      materials.replaceChildren(...recipe.ingredients.map((ingredient) => this.ingredient(ingredient)));
    };

    const selectRecipe = (recipe: Recipe) => {
      const index = activeRecipes.indexOf(recipe);
      if (index >= 0) updateSelection(index);
    };

    const mapRecipeToButton = createRecipeButtonMapper({
      atlasImage,
      isBuffered: (recipe) => this.isRecipeBuffered(recipe),
      isLocked: (recipe) => this.isRecipeLocked(recipe),
      recipeIcon,
      selectRecipe,
      effects: this.recipeButtonEffects,
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
        button.append(recipeIcon(recipe));
        button.addEventListener('click', () => selectRecipe(recipe));
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
      activeCategoryId: this.activeCategoryIdState.get(),
      assetBaseUrl,
      atlasImage,
      selectCategory: (category) => this.activeCategoryIdState.set(category.id),
    }));
    categoryNav.append(...categoryButtons);

    this.controlEffects.push(createEffect(() => {
      const activeCategoryId = this.activeCategoryIdState.get();
      categoryViews.forEach(({ category, recipeGroup, quickGroup }) => {
        const recipeHidden = activeCategoryId !== 'none' && category.id !== activeCategoryId;
        const quickHidden = category.id !== (activeCategoryId === 'none' ? categoryViews[0].category.id : activeCategoryId);
        if (recipeGroup.hidden !== recipeHidden) recipeGroup.hidden = recipeHidden;
        if (quickGroup.hidden !== quickHidden) quickGroup.hidden = quickHidden;
      });
    }));

    let previousCategoryId: string | undefined;
    this.controlEffects.push(createEffect(() => {
      const activeCategoryId = this.activeCategoryIdState.get();
      const view = activeCategoryId === 'none'
        ? allView
        : categoryViews.find(({ category }) => category.id === activeCategoryId) ?? categoryViews[0];
      if (previousCategoryId !== undefined) this.selectedRecipeId = undefined;
      previousCategoryId = view.category.id;
      activeRecipes = view.category.recipes;
      activeRecipeButtons = view.recipeButtons;
      categoryTitle.textContent = view.category.name;
      categoryButtons.forEach((button, index) => {
        const pressed = String(categories[index].id === view.category.id);
        if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
      });
      const preservedIndex = activeRecipes.findIndex(({ id }) => id === this.selectedRecipeId);
      updateSelection(preservedIndex < 0 ? 0 : preservedIndex);
    }));

    previousSkinButton.addEventListener('click', () => changeSkin(-1));
    nextSkinButton.addEventListener('click', () => changeSkin(1));
    buildButton.addEventListener('click', () => {
      const recipe = activeRecipes[selectedIndex];
      if (!recipe || this.isRecipeLocked(recipe) || this.craftingRecipeId) return;
      const skinId = this.selectedSkinIds.get(recipe.id);
      if (this.isRecipeBuffered(recipe)) {
        this.emitCraftRequest(recipe.id, skinId);
        return;
      }
      this.startCrafting(recipe.id, skinId);
    });
    const setCollapsed = (collapsed: boolean) => {
      this.collapsed = collapsed;
      panel.classList.toggle('is-collapsed', collapsed);
      const viewToggle = root.querySelector<HTMLButtonElement>('.craft-view-toggle')!;
      const quickToggle = root.querySelector<HTMLButtonElement>('.craft-quick-toggle')!;
      viewToggle.setAttribute('aria-expanded', String(!collapsed));
      quickToggle.setAttribute('aria-expanded', String(!collapsed));
      quickToggle.setAttribute('aria-label', collapsed ? '展开制作菜单' : '收起制作菜单');
    };
    root.querySelector('.craft-view-toggle')!.addEventListener('click', () => setCollapsed(true));
    root.querySelector('.craft-quick-toggle')!.addEventListener('click', () => {
      setCollapsed(!panel.classList.contains('is-collapsed'));
    });
    setCollapsed(this.collapsed);
    this.controlEffects.push(createEffect(this.refreshBuildButton));
  }

  private isRecipeLocked(recipe: Recipe): boolean {
    return this.recipeLockStates[this.recipeIndices.get(recipe)!].get();
  }

  private calculateRecipeLocked(recipe: Recipe): boolean {
    return !this.bufferedRecipeIds.has(recipe.id) && (Boolean(recipe.locked)
      || recipe.ingredients.some((ingredient) => this.availableCount(ingredient) < ingredient.required));
  }

  private isRecipeBuffered(recipe: Recipe): boolean {
    return this.recipeBufferedStates[this.recipeIndices.get(recipe)!].get();
  }

  private updateRecipeLocks(): void {
    const nextIsLockedArray = this.recipes.map((recipe) => this.calculateRecipeLocked(recipe));
    nextIsLockedArray.forEach((locked, index) => {
      if (locked !== this.isLockedArray[index]) this.recipeLockStates[index].set(locked);
    });
    this.isLockedArray = nextIsLockedArray;
  }

  private disposeEffects(): void {
    this.recipeButtonEffects.splice(0).forEach((dispose) => dispose());
    this.controlEffects.splice(0).forEach((dispose) => dispose());
    this.refreshMaterials = undefined;
    this.refreshBuildButton = undefined;
  }

  private ingredient(ingredient: RecipeIngredient): HTMLSpanElement {
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
    this.updateIngredient(item, ingredient);
    return item;
  }

  private updateIngredient(item: HTMLSpanElement, ingredient: RecipeIngredient): void {
    const available = this.availableCount(ingredient);
    item.className = `craft-material ${available >= ingredient.required ? 'has-materials' : 'missing-materials'}`;
    const required = ingredient.requiredLabel ?? String(ingredient.required);
    item.setAttribute('aria-label', `${ingredient.name} ${available}/${required}`);
    item.querySelector('.craft-material-count')!.textContent = ingredient.requiredLabel ?? `${available}/${ingredient.required}`;
  }

  private availableCount(ingredient: RecipeIngredient): number {
    return this.materialSummary?.[ingredient.id] ?? ingredient.available;
  }

  private startCrafting(recipeId: string, skinId?: string): void {
    this.craftingRecipeId = recipeId;
    this.craftingSkinId = skinId;
    this.emitCraftingState(recipeId, true, skinId);
    this.refreshBuildButton?.();
    this.craftingTimer = setTimeout(() => {
      this.craftingTimer = undefined;
      this.craftingRecipeId = undefined;
      this.craftingSkinId = undefined;
      this.emitCraftRequest(recipeId, skinId);
      this.emitCraftingState(recipeId, false, skinId);
      if (this.isConnected) this.refreshBuildButton?.();
    }, CRAFT_DURATION_MS);
  }

  private emitCraftRequest(recipeId: string, skinId?: string): void {
    this.dispatchEvent(new CustomEvent<CraftRequestDetail>('game:craft-request', {
      bubbles: true,
      composed: true,
      detail: { recipeId, ...(skinId === undefined ? {} : { skinId }) },
    }));
  }

  private emitCraftingState(recipeId: string, crafting: boolean, skinId?: string): void {
    this.dispatchEvent(new CustomEvent<CraftingStateDetail>('game:crafting-state-change', {
      bubbles: true,
      composed: true,
      detail: { recipeId, crafting, ...(skinId === undefined ? {} : { skinId }) },
    }));
  }
}
import { urlString } from './utils';
