import { AssetElement } from './assets';
import { categories, type CategoryConfig, type Recipe, type RecipeIngredient } from './categories';
import styles from './styles/crafting-ui.css?inline';
import { loadImageAtlas, type ImageAtlas } from '@three-roaming/wilson/imageAtlas';

const atlasRequests = new Map<string, Promise<ImageAtlas>>();

export interface CraftRequestDetail {
  recipeId: string;
}

function requestAtlas(archiveUrl: string, atlasPath: string) {
  const key = `${archiveUrl}\n${atlasPath}`;
  let request = atlasRequests.get(key);
  if (!request) {
    request = loadImageAtlas(archiveUrl, atlasPath);
    atlasRequests.set(key, request);
  }
  return request;
}

export class DstCraftingUiElement extends AssetElement {
  private activeCategoryId = 'tool';
  private bufferedRecipeIds = new Set<string>();
  private inventoryCounts?: Readonly<Record<string, number>>;
  private selectedRecipeId?: string;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  setInventoryCounts(counts: Readonly<Record<string, number>>): void {
    const next = { ...counts };
    const previous = this.inventoryCounts;
    if (previous
      && Object.keys(previous).length === Object.keys(next).length
      && Object.entries(next).every(([itemId, count]) => previous[itemId] === count)) {
      return;
    }
    this.inventoryCounts = next;
    if (this.isConnected) this.render();
  }

  setBufferedRecipes(recipeIds: Iterable<string>): void {
    const next = new Set(recipeIds);
    if (next.size === this.bufferedRecipeIds.size
      && [...next].every((recipeId) => this.bufferedRecipeIds.has(recipeId))) {
      return;
    }
    this.bufferedRecipeIds = next;
    if (this.isConnected) this.render();
  }

  protected render(): void {
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
            <button class="craft-arrow craft-arrow-left" type="button" aria-label="上一个配方"><img src="${this.asset('crafting/crafting_inventory_arrow_l_idle.tex.png')}" alt="" /></button>
            <div class="craft-selected-icon"></div>
            <button class="craft-arrow craft-arrow-right" type="button" aria-label="下一个配方"><img src="${this.asset('crafting/crafting_inventory_arrow_r_idle.tex.png')}" alt="" /></button>
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
    const materials = root.querySelector<HTMLElement>('.craft-materials')!;
    const buildButton = root.querySelector<HTMLButtonElement>('.craft-build')!;
    let selectedIndex = 0;
    let activeRecipes: readonly Recipe[] = [];

    const updateSelection = (index: number) => {
      if (activeRecipes.length === 0) {
        title.textContent = '暂无配方';
        description.textContent = '';
        selectedIcon.replaceChildren();
        selectedName.textContent = '';
        materials.replaceChildren();
        buildButton.disabled = true;
        buildButton.textContent = '暂无配方';
        return;
      }

      selectedIndex = (index + activeRecipes.length) % activeRecipes.length;
      const recipe = activeRecipes[selectedIndex];
      this.selectedRecipeId = recipe.id;
      recipeGrid.querySelectorAll('.craft-recipe').forEach((item, itemIndex) => {
        item.setAttribute('aria-selected', String(itemIndex === selectedIndex));
      });
      title.textContent = recipe.name;
      description.textContent = recipe.description;
      selectedIcon.replaceChildren(this.recipeIcon(recipe));
      selectedName.textContent = recipe.name;
      materials.replaceChildren(...recipe.ingredients.map((ingredient) => this.ingredient(ingredient)));
      buildButton.disabled = this.isRecipeLocked(recipe);
      buildButton.textContent = this.isRecipeBuffered(recipe)
        ? '放置'
        : recipe.locked ? '尚未解锁' : '建造';
    };

    const renderCategoryRecipes = (category: CategoryConfig) => {
      this.activeCategoryId = category.id;
      activeRecipes = category.recipes;
      const preservedIndex = activeRecipes.findIndex(({ id }) => id === this.selectedRecipeId);
      selectedIndex = preservedIndex < 0 ? 0 : preservedIndex;
      recipeGrid.replaceChildren();
      quickbar.replaceChildren();

      activeRecipes.forEach((recipe, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'craft-recipe';
        button.dataset.recipe = recipe.id;
        button.dataset.buffered = String(this.isRecipeBuffered(recipe));
        button.setAttribute('role', 'option');
        button.setAttribute(
          'aria-label',
          this.isRecipeBuffered(recipe) ? `${recipe.name}（已制作）` : recipe.name,
        );
        button.setAttribute('aria-selected', 'false');
        button.append(
          this.atlasImage(
            'craft-recipe-bg',
            'images/crafting_menu.xml',
            this.isRecipeBuffered(recipe) ? 'slot_bg_buffered.tex' : 'slot_bg.tex',
          ),
          this.recipeIcon(recipe),
          this.atlasImage('craft-recipe-frame', 'images/crafting_menu.xml', 'slot_frame.tex'),
        );
        if (this.isRecipeLocked(recipe)) {
          button.append(this.atlasImage('craft-lock', 'images/crafting_menu.xml', 'slot_fg_lock.tex'));
        }
        button.addEventListener('click', () => updateSelection(index));
        recipeGrid.append(button);
      });

      activeRecipes.slice(0, 10).forEach((recipe, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'craft-quick-item';
        button.setAttribute('aria-label', recipe.name);
        button.dataset.label = recipe.name;
        button.append(this.recipeIcon(recipe));
        button.addEventListener('click', () => updateSelection(index));
        quickbar.append(button);
      });

      updateSelection(selectedIndex);
    };

    categories.forEach((category) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'craft-category';
      button.dataset.category = category.id;
      button.title = category.name;
      button.setAttribute('aria-label', category.name);
      button.setAttribute('aria-pressed', String(category.id === this.activeCategoryId));
      button.innerHTML = `
        <img class="craft-category-frame craft-category-frame-inactive" src="${this.asset('crafting/filter/filter_button_inactive.tex.png')}" alt="" />
        <img class="craft-category-frame craft-category-frame-active" src="${this.asset('crafting/filter/filter_button_active.tex.png')}" alt="" />
      `;
      button.append(this.atlasImage(
        'craft-category-icon',
        category.iconAtlas ?? 'images/crafting_menu_icons.xml',
        category.icon,
      ));
      button.addEventListener('click', () => {
        this.selectedRecipeId = undefined;
        root.querySelector('h1')!.textContent = category.name;
        root.querySelectorAll('.craft-category').forEach((item) => item.setAttribute('aria-pressed', 'false'));
        button.setAttribute('aria-pressed', 'true');
        renderCategoryRecipes(category);
      });
      categoryNav.append(button);
    });

    root.querySelector('.craft-arrow-left')!.addEventListener('click', () => updateSelection(selectedIndex - 1));
    root.querySelector('.craft-arrow-right')!.addEventListener('click', () => updateSelection(selectedIndex + 1));
    buildButton.addEventListener('click', () => {
      const recipe = activeRecipes[selectedIndex];
      if (!recipe || this.isRecipeLocked(recipe)) return;
      this.dispatchEvent(new CustomEvent<CraftRequestDetail>('game:craft-request', {
        bubbles: true,
        composed: true,
        detail: { recipeId: recipe.id },
      }));
    });
    const setCollapsed = (collapsed: boolean) => {
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
    setCollapsed(true);
    const initialCategory = categories.find(({ id }) => id === this.activeCategoryId) ?? categories[0];
    root.querySelector('h1')!.textContent = initialCategory.name;
    renderCategoryRecipes(initialCategory);
  }

  private placeholder(color: string, label: string, className = ''): HTMLSpanElement {
    const icon = document.createElement('span');
    icon.className = `craft-placeholder ${className}`.trim();
    icon.style.setProperty('--placeholder-color', color);
    icon.textContent = label.slice(0, 1);
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  private recipeIcon(recipe: Recipe): HTMLElement {
    if (recipe.asset) {
      const icon = document.createElement('img');
      icon.className = 'craft-recipe-asset';
      icon.src = this.asset(recipe.asset);
      icon.alt = '';
      return icon;
    }

    if (recipe.inventoryIcon) {
      const icon = this.atlasImage(
        'craft-recipe-asset',
        recipe.inventoryAtlas ?? 'images/inventoryimages.xml',
        recipe.inventoryIcon,
      );
      icon.addEventListener('error', () => {
        icon.replaceWith(this.placeholder(recipe.color, recipe.name));
      }, { once: true });
      return icon;
    }

    return this.placeholder(recipe.color, recipe.name);
  }

  private atlasImage(className: string, atlasPath: string, elementName: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    const archiveUrl = this.dataAsset('databundles/images.zip');
    canvas.className = className;
    canvas.width = 1;
    canvas.height = 1;
    canvas.dataset.archive = archiveUrl;
    canvas.dataset.atlas = atlasPath;
    canvas.dataset.element = elementName;
    canvas.setAttribute('aria-hidden', 'true');

    void requestAtlas(archiveUrl, atlasPath).then((atlas) => {
      if (!canvas.isConnected) return;
      const sprite = atlas.require(elementName);
      canvas.width = sprite.width;
      canvas.height = sprite.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas 2D context is unavailable');
      const pixels = Uint8ClampedArray.from(sprite.pixels);
      context.putImageData(new ImageData(pixels, sprite.width, sprite.height), 0, 0);
      canvas.dataset.loaded = 'true';
    }).catch((error: unknown) => {
      canvas.dataset.error = error instanceof Error ? error.message : String(error);
      canvas.dispatchEvent(new Event('error'));
    });
    return canvas;
  }

  private isRecipeLocked(recipe: Recipe): boolean {
    return !this.isRecipeBuffered(recipe) && (Boolean(recipe.locked)
      || recipe.ingredients.some((ingredient) => this.availableCount(ingredient) < ingredient.required));
  }

  private isRecipeBuffered(recipe: Recipe): boolean {
    return this.bufferedRecipeIds.has(recipe.id);
  }

  private ingredient(ingredient: RecipeIngredient): HTMLSpanElement {
    const item = document.createElement('span');
    const available = this.availableCount(ingredient);
    const hasMaterial = available >= ingredient.required;
    item.className = `craft-material ${hasMaterial ? 'has-materials' : 'missing-materials'}`;
    const required = ingredient.requiredLabel ?? String(ingredient.required);
    item.setAttribute('aria-label', `${ingredient.name} ${available}/${required}`);

    if (ingredient.inventoryIcon) {
      item.append(this.atlasImage(
        'craft-material-asset',
        ingredient.inventoryAtlas ?? 'images/inventoryimages.xml',
        ingredient.inventoryIcon,
      ));
    } else {
      item.append(this.placeholder(ingredient.color, ingredient.name, 'craft-placeholder-material'));
    }

    const count = document.createElement('span');
    count.className = 'craft-material-count';
    count.textContent = ingredient.requiredLabel ?? `${available}/${ingredient.required}`;
    item.append(count);
    return item;
  }

  private availableCount(ingredient: RecipeIngredient): number {
    return this.inventoryCounts?.[ingredient.id] ?? ingredient.available;
  }
}
