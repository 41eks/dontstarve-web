import { AssetElement } from './assets';
import { categories, type CategoryConfig, type Recipe, type RecipeIngredient } from './categories';
import styles from './styles/crafting-ui.css?inline';

export class DstCraftingUiElement extends AssetElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
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
      if (activeRecipes.length === 0) return;

      selectedIndex = (index + activeRecipes.length) % activeRecipes.length;
      const recipe = activeRecipes[selectedIndex];
      recipeGrid.querySelectorAll('.craft-recipe').forEach((item, itemIndex) => {
        item.setAttribute('aria-selected', String(itemIndex === selectedIndex));
      });
      title.textContent = recipe.name;
      description.textContent = recipe.description;
      selectedIcon.replaceChildren(this.recipeIcon(recipe));
      selectedName.textContent = recipe.name;
      materials.replaceChildren(...recipe.ingredients.map((ingredient) => this.ingredient(ingredient)));
      const hasAllMaterials = recipe.ingredients.every(({ available, required }) => available >= required);
      buildButton.disabled = Boolean(recipe.locked) || !hasAllMaterials;
      buildButton.textContent = recipe.locked ? '尚未解锁' : '建造';
    };

    const renderCategoryRecipes = (category: CategoryConfig) => {
      activeRecipes = category.recipes;
      selectedIndex = 0;
      recipeGrid.replaceChildren();
      quickbar.replaceChildren();

      activeRecipes.forEach((recipe, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'craft-recipe';
        button.setAttribute('role', 'option');
        button.setAttribute('aria-label', recipe.name);
        button.setAttribute('aria-selected', 'false');
        button.append(this.recipeIcon(recipe));
        if (recipe.locked) {
          const lock = document.createElement('span');
          lock.className = 'craft-lock';
          lock.textContent = '锁';
          button.append(lock);
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

      updateSelection(0);
    };

    categories.forEach((category) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'craft-category';
      button.dataset.category = category.id;
      button.title = category.name;
      button.setAttribute('aria-label', category.name);
      button.setAttribute('aria-pressed', String(category.id === 'tool'));
      button.innerHTML = `
        <img class="craft-category-frame craft-category-frame-inactive" src="${this.asset('crafting/filter/filter_button_inactive.tex.png')}" alt="" />
        <img class="craft-category-frame craft-category-frame-active" src="${this.asset('crafting/filter/filter_button_active.tex.png')}" alt="" />
        <img class="craft-category-icon" src="${this.asset(category.icon)}" alt="" />
      `;
      button.addEventListener('click', () => {
        root.querySelector('h1')!.textContent = category.name;
        root.querySelectorAll('.craft-category').forEach((item) => item.setAttribute('aria-pressed', 'false'));
        button.setAttribute('aria-pressed', 'true');
        renderCategoryRecipes(category);
      });
      categoryNav.append(button);
    });

    root.querySelector('.craft-arrow-left')!.addEventListener('click', () => updateSelection(selectedIndex - 1));
    root.querySelector('.craft-arrow-right')!.addEventListener('click', () => updateSelection(selectedIndex + 1));
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
    setCollapsed(false);
    renderCategoryRecipes(categories.find(({ id }) => id === 'tool') ?? categories[0]);
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
    if (!recipe.asset) return this.placeholder(recipe.color, recipe.name);

    const icon = document.createElement('img');
    icon.className = 'craft-recipe-asset';
    icon.src = this.asset(recipe.asset);
    icon.alt = '';
    return icon;
  }

  private ingredient(ingredient: RecipeIngredient): HTMLSpanElement {
    const item = document.createElement('span');
    const hasMaterial = ingredient.available >= ingredient.required;
    item.className = `craft-material ${hasMaterial ? 'has-materials' : 'missing-materials'}`;
    item.setAttribute('aria-label', `${ingredient.name} ${ingredient.available}/${ingredient.required}`);

    if (ingredient.asset) {
      const icon = document.createElement('img');
      icon.className = 'craft-material-asset';
      icon.src = this.asset(ingredient.asset);
      icon.alt = '';
      item.append(icon);
    } else {
      item.append(this.placeholder(ingredient.color, ingredient.name, 'craft-placeholder-material'));
    }

    const count = document.createElement('span');
    count.className = 'craft-material-count';
    count.textContent = `${ingredient.available}/${ingredient.required}`;
    item.append(count);
    return item;
  }
}
