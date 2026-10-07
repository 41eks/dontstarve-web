import { AssetElement } from './assets';
import {
  categories,
  type Recipe,
  type RecipeIngredient,
} from './categories';
import { initializeCraftingControls } from './crafting-controls';
import { createCraftingBackground } from './crafting-background';
import styles from './styles/crafting-ui.css?inline';
import type { InventoryMaterialSummary } from '@dontstarve-web/inventory';
import { createSignal } from '@dontstarve-web/signals';

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
  private readonly selectedRecipeState = createSignal<Recipe | undefined>(undefined);
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
  private collapseListeners?: AbortController;
  private disposeControls?: () => void;
  private disposeBackground?: () => void;
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
        <div class="craft-background" aria-hidden="true"></div>
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
        <div class="craft-recipes-area">
          <div class="craft-recipes" id="craft-recipes" role="listbox" aria-label="配方列表"></div>
          <div class="craft-recipe-scrollbar">
            <button class="craft-scroll-arrow craft-scroll-up" type="button" aria-label="向上滚动配方"></button>
            <div class="craft-scroll-track" role="scrollbar" tabindex="0" aria-label="滚动配方列表" aria-controls="craft-recipes" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">
              <div class="craft-scroll-thumb"></div>
            </div>
            <button class="craft-scroll-arrow craft-scroll-down" type="button" aria-label="向下滚动配方"></button>
          </div>
        </div>
        <div class="craft-scroll-marker" aria-hidden="true"></div>
        <article class="craft-detail" aria-live="polite">
          <div class="craft-copy">
            <div class="craft-detail-heading"><span class="craft-detail-favorite" aria-hidden="true"></span><h2></h2></div>
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
          <div class="craft-quick-page" aria-label="配方页码">
            <button class="craft-quick-page-arrow craft-quick-page-arrow-left" type="button" aria-label="上一页"></button>
            <b>1</b>
            <button class="craft-quick-page-arrow" type="button" aria-label="下一页"></button>
          </div>
          <div class="craft-quick-items"></div>
        </aside>
      </section>
    `;

    const listeners = new AbortController();
    this.collapseListeners = listeners;
    const panel = root.querySelector<HTMLElement>('.craft-panel')!;
    const viewToggle = root.querySelector<HTMLButtonElement>('.craft-view-toggle')!;
    const quickToggle = root.querySelector<HTMLButtonElement>('.craft-quick-toggle')!;
    const setCollapsed = (collapsed: boolean) => {
      this.collapsed = collapsed;
      panel.classList.toggle('is-collapsed', collapsed);
      root.querySelectorAll<HTMLElement>('.craft-header, .craft-categories, .craft-recipes-area, .craft-detail').forEach((section) => {
        section.inert = collapsed;
        section.setAttribute('aria-hidden', String(collapsed));
      });
      viewToggle.setAttribute('aria-expanded', String(!collapsed));
      quickToggle.setAttribute('aria-expanded', String(!collapsed));
      quickToggle.setAttribute('aria-label', collapsed ? '展开制作菜单' : '收起制作菜单');
    };
    viewToggle.addEventListener('click', () => setCollapsed(true), { signal: listeners.signal });
    quickToggle.addEventListener('click', () => setCollapsed(!this.collapsed), { signal: listeners.signal });
    setCollapsed(this.collapsed);

    const controls = initializeCraftingControls(root, {
      activeCategoryIdState: this.activeCategoryIdState,
      selectedRecipeState: this.selectedRecipeState,
      selectedSkinIds: this.selectedSkinIds,
      recipeButtonEffects: this.recipeButtonEffects,
      controlEffects: this.controlEffects,
      availableCount: (ingredient) => this.availableCount(ingredient),
      isRecipeLocked: (recipe) => this.isRecipeLocked(recipe),
      isRecipeBuffered: (recipe) => this.isRecipeBuffered(recipe),
      getCraftingRecipeId: () => this.craftingRecipeId,
      emitCraftRequest: (recipeId, skinId) => this.emitCraftRequest(recipeId, skinId),
      startCrafting: (recipeId, skinId) => this.startCrafting(recipeId, skinId),
    });
    this.refreshMaterials = controls.refreshMaterials;
    this.refreshBuildButton = controls.refreshBuildButton;
    this.disposeControls = controls.dispose;
    this.disposeBackground = createCraftingBackground(root).dispose;
    resolveCraftingUiReady();
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
    this.disposeBackground?.();
    this.disposeBackground = undefined;
    this.collapseListeners?.abort();
    this.collapseListeners = undefined;
    this.disposeControls?.();
    this.disposeControls = undefined;
    this.recipeButtonEffects.splice(0).forEach((dispose) => dispose());
    this.controlEffects.splice(0).forEach((dispose) => dispose());
    this.refreshMaterials = undefined;
    this.refreshBuildButton = undefined;
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
