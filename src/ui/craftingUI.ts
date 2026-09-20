interface Recipe {
  name: string;
  description: string;
  color: string;
  material: string;
  materialColor: string;
  available: number;
  required: number;
  locked?: boolean;
}

const categories = [
  ['收藏', 'favorites'],
  ['工具', 'tool'],
  ['照明', 'fire'],
  ['科学', 'science'],
  ['精炼', 'refine'],
  ['武器', 'weapon'],
  ['护甲', 'armour'],
  ['服装', 'warable'],
  ['治疗', 'health'],
  ['暗影', 'skull'],
  ['装饰', 'cosmetic'],
  ['建筑', 'structure'],
  ['容器', 'containers'],
  ['烹饪', 'cooking'],
  ['园艺', 'gardening'],
  ['钓鱼', 'fishing'],
  ['骑乘', 'riding'],
  ['航海', 'sailing'],
  ['冬季', 'winter'],
  ['夏季', 'summer'],
  ['雨具', 'rain'],
  ['全部', 'none'],
] as const;

const recipes: Recipe[] = [
  { name: '斧头', description: '砍倒树木，收集木材。', color: '#8d877c', material: '燧石', materialColor: '#b7c5d0', available: 3, required: 1 },
  { name: '鹤嘴锄', description: '开采岩石与矿物。', color: '#6f787a', material: '树枝', materialColor: '#b08a4d', available: 2, required: 2 },
  { name: '铲子', description: '挖掘植物和松软土地。', color: '#8b6f57', material: '燧石', materialColor: '#b7c5d0', available: 3, required: 2 },
  { name: '草叉', description: '改变地面的样子。', color: '#72827d', material: '树枝', materialColor: '#b08a4d', available: 2, required: 2, locked: true },
  { name: '锤子', description: '拆除已经建造的物品。', color: '#806f67', material: '石块', materialColor: '#8a8c8b', available: 0, required: 3 },
  { name: '剃刀', description: '刮掉那些碍事的毛发。', color: '#969aa0', material: '燧石', materialColor: '#b7c5d0', available: 3, required: 2, locked: true },
  { name: '金斧头', description: '更耐用的伐木工具。', color: '#c8a93e', material: '金块', materialColor: '#d3a839', available: 0, required: 2 },
  { name: '金铲子', description: '耐用而闪亮的铲子。', color: '#d3b840', material: '金块', materialColor: '#d3a839', available: 0, required: 2 },
  { name: '金鹤嘴锄', description: '更长久地开采岩石。', color: '#b9a049', material: '金块', materialColor: '#d3a839', available: 0, required: 2 },
  { name: '地图卷轴', description: '记录走过的地方。', color: '#b8aa84', material: '莎草纸', materialColor: '#c8bc93', available: 1, required: 2 },
  { name: '指南针', description: '找到前进的方向。', color: '#8c7457', material: '金块', materialColor: '#d3a839', available: 0, required: 1 },
  { name: '羽毛笔', description: '用于绘制精细的标记。', color: '#63636f', material: '羽毛', materialColor: '#857e90', available: 0, required: 1, locked: true },
  { name: '钓竿', description: '从池塘里钓点吃的。', color: '#876947', material: '树枝', materialColor: '#b08a4d', available: 2, required: 2 },
  { name: '捕虫网', description: '抓住飞舞的小生物。', color: '#93876b', material: '蜘蛛丝', materialColor: '#d5d0c9', available: 0, required: 2 },
  { name: '羽毛扇', description: '带来一阵清凉的风。', color: '#665f76', material: '羽毛', materialColor: '#857e90', available: 0, required: 5, locked: true },
  { name: '天气仪', description: '观察风与天气。', color: '#718691', material: '石块', materialColor: '#8a8c8b', available: 0, required: 2 },
  { name: '园艺锄', description: '在土地上开垦农田。', color: '#738d64', material: '树枝', materialColor: '#b08a4d', available: 2, required: 2 },
  { name: '水壶', description: '为植物补充水分。', color: '#69899e', material: '木板', materialColor: '#9c7650', available: 0, required: 2 },
];

function placeholder(color: string, label: string, className = '') {
  const icon = document.createElement('span');
  icon.className = `craft-placeholder ${className}`.trim();
  icon.style.setProperty('--placeholder-color', color);
  icon.textContent = label.slice(0, 1);
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

export function mountCraftingUI() {
  const root = document.querySelector<HTMLDivElement>('#app');
  if (!root) return;

  root.innerHTML = `
    <section class="craft-panel" aria-label="制作菜单">
      <header class="craft-header">
        <button class="craft-favorite" type="button" aria-label="收藏配方">
          <img class="craft-favorite-bg craft-favorite-bg-inactive" src="${import.meta.env.BASE_URL}dst/ui/crafting/filter/filter_button_inactive.tex.png" alt="" />
          <img class="craft-favorite-bg craft-favorite-bg-active" src="${import.meta.env.BASE_URL}dst/ui/crafting/filter/filter_button_active.tex.png" alt="" />
          <img class="craft-favorite-icon" src="${import.meta.env.BASE_URL}dst/ui/crafting/filter/filter_favorites.tex.png" alt="" />
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
          <button class="craft-arrow craft-arrow-left" type="button" aria-label="上一个配方">
            <img src="${import.meta.env.BASE_URL}dst/ui/crafting/crafting_inventory_arrow_l_idle.tex.png" alt="" />
          </button>
          <div class="craft-selected-icon"></div>
          <button class="craft-arrow craft-arrow-right" type="button" aria-label="下一个配方">
            <img src="${import.meta.env.BASE_URL}dst/ui/crafting/crafting_inventory_arrow_r_idle.tex.png" alt="" />
          </button>
          <strong></strong>
        </div>
        <div class="craft-materials"></div>
        <button class="craft-build" type="button">建造</button>
      </article>
      <aside class="craft-quickbar" aria-label="快捷制作">
        <button class="craft-quick-toggle" type="button" aria-label="展开制作菜单">
          <img class="craft-quick-tab-background" src="${import.meta.env.BASE_URL}dst/ui/crafting/crafting_tab.tex.png" alt="" />
          <img class="craft-quick-tab-mark" src="${import.meta.env.BASE_URL}dst/ui/crafting/station_none.tex.png" alt="" />
        </button>
        <div class="craft-quick-page" aria-label="配方页码"><span>‹</span><b>1</b><span>›</span></div>
        <div class="craft-quick-items"></div>
      </aside>
    </section>
  `;

  const panel = root.querySelector<HTMLElement>('.craft-panel')!;
  const categoryNav = panel.querySelector<HTMLElement>('.craft-categories')!;
  const recipeGrid = panel.querySelector<HTMLElement>('.craft-recipes')!;
  const quickbar = panel.querySelector<HTMLElement>('.craft-quick-items')!;
  const title = panel.querySelector<HTMLHeadingElement>('.craft-detail h2')!;
  const description = panel.querySelector<HTMLParagraphElement>('.craft-copy p')!;
  const selectedIcon = panel.querySelector<HTMLElement>('.craft-selected-icon')!;
  const selectedName = panel.querySelector<HTMLElement>('.craft-preview strong')!;
  const materials = panel.querySelector<HTMLElement>('.craft-materials')!;
  const buildButton = panel.querySelector<HTMLButtonElement>('.craft-build')!;
  let selectedIndex = 0;

  categories.forEach(([name, asset]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'craft-category';
    button.title = name;
    button.setAttribute('aria-label', name);
    button.setAttribute('aria-pressed', String(asset === 'tool'));

    const inactiveFrame = document.createElement('img');
    inactiveFrame.className = 'craft-category-frame craft-category-frame-inactive';
    inactiveFrame.src = `${import.meta.env.BASE_URL}dst/ui/crafting/filter/filter_button_inactive.tex.png`;
    inactiveFrame.alt = '';

    const activeFrame = document.createElement('img');
    activeFrame.className = 'craft-category-frame craft-category-frame-active';
    activeFrame.src = `${import.meta.env.BASE_URL}dst/ui/crafting/filter/filter_button_active.tex.png`;
    activeFrame.alt = '';

    const icon = document.createElement('img');
    icon.className = 'craft-category-icon';
    icon.src = `${import.meta.env.BASE_URL}dst/ui/crafting/filter/filter_${asset}.tex.png`;
    icon.alt = '';

    button.append(inactiveFrame, activeFrame, icon);
    button.addEventListener('click', () => {
      panel.querySelector('h1')!.textContent = name;
      panel.querySelectorAll('.craft-category').forEach((item) => item.setAttribute('aria-pressed', 'false'));
      button.setAttribute('aria-pressed', 'true');
    });
    categoryNav.append(button);
  });

  const updateSelection = (index: number) => {
    selectedIndex = (index + recipes.length) % recipes.length;
    const recipe = recipes[selectedIndex];
    recipeGrid.querySelectorAll('.craft-recipe').forEach((item, itemIndex) => {
      item.setAttribute('aria-selected', String(itemIndex === selectedIndex));
    });
    title.textContent = recipe.name;
    description.textContent = recipe.description;
    selectedIcon.replaceChildren(placeholder(recipe.color, recipe.name, 'craft-placeholder-large'));
    selectedName.textContent = recipe.name;
    materials.replaceChildren(placeholder(recipe.materialColor, recipe.material, 'craft-placeholder-material'));
    const count = document.createElement('span');
    count.className = recipe.available >= recipe.required ? 'has-materials' : 'missing-materials';
    count.textContent = `${recipe.available}/${recipe.required}`;
    materials.append(count);
    buildButton.disabled = recipe.locked || recipe.available < recipe.required;
    buildButton.textContent = recipe.locked ? '尚未解锁' : '建造';
  };

  recipes.forEach((recipe, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'craft-recipe';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-label', recipe.name);
    button.setAttribute('aria-selected', 'false');
    button.append(placeholder(recipe.color, recipe.name));
    if (recipe.locked) {
      const lock = document.createElement('span');
      lock.className = 'craft-lock';
      lock.textContent = '锁';
      button.append(lock);
    }
    button.addEventListener('click', () => updateSelection(index));
    recipeGrid.append(button);
  });

  recipes.slice(0, 10).forEach((recipe, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'craft-quick-item';
    button.setAttribute('aria-label', recipe.name);
    button.dataset.label = recipe.name;
    button.append(placeholder(recipe.color, recipe.name));
    button.addEventListener('click', () => updateSelection(index));
    quickbar.append(button);
  });

  panel.querySelector('.craft-arrow-left')!.addEventListener('click', () => updateSelection(selectedIndex - 1));
  panel.querySelector('.craft-arrow-right')!.addEventListener('click', () => updateSelection(selectedIndex + 1));
  const setCollapsed = (collapsed: boolean) => {
    panel.classList.toggle('is-collapsed', collapsed);
    const viewToggle = panel.querySelector<HTMLButtonElement>('.craft-view-toggle')!;
    const quickToggle = panel.querySelector<HTMLButtonElement>('.craft-quick-toggle')!;
    viewToggle.setAttribute('aria-expanded', String(!collapsed));
    quickToggle.setAttribute('aria-expanded', String(!collapsed));
    quickToggle.setAttribute('aria-label', collapsed ? '展开制作菜单' : '收起制作菜单');
  };
  panel.querySelector('.craft-view-toggle')!.addEventListener('click', () => setCollapsed(true));
  panel.querySelector('.craft-quick-toggle')!.addEventListener('click', () => {
    setCollapsed(!panel.classList.contains('is-collapsed'));
  });
  setCollapsed(false);
  updateSelection(0);
}

mountCraftingUI();
