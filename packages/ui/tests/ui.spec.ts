import { expect, test, type Page } from '@playwright/test';
import { categories } from '../src/categories';

const fixtureUrl = '/tests/fixture.html';

test('keeps an independent recipe collection for every crafting category', () => {
  expect(categories.map(({ id }) => id)).toEqual([
    'favorites', 'crafting-station', 'special-event', 'character',
    'tool', 'fire', 'science', 'refine', 'weapon', 'armour', 'warable', 'health', 'skull', 'cosmetic',
    'structure', 'containers', 'cooking', 'gardening', 'fishing', 'sailing', 'riding', 'winter',
    'summer', 'rain', 'none',
  ]);
  expect(new Set(categories.map(({ recipes }) => recipes)).size).toBe(25);
  expect(categories.find(({ id }) => id === 'favorites')?.recipes).toEqual([]);
  expect(categories.find(({ id }) => id === 'tool')?.recipes).toHaveLength(56);
  expect(categories.find(({ id }) => id === 'fire')?.recipes).toHaveLength(23);
  expect(categories.find(({ id }) => id === 'crafting-station')?.recipes).toHaveLength(387);
  expect(categories.find(({ id }) => id === 'none')?.recipes).toHaveLength(972);
  expect(categories.find(({ id }) => id === 'tool')?.recipes[0].id).toBe('axe');
  expect(categories.find(({ id }) => id === 'tool')?.recipes[0].name).toBe('斧头');
  expect(categories.find(({ id }) => id === 'fire')?.recipes[0].id).toBe('lighter');
  expect(categories.find(({ id }) => id === 'science')?.recipes[0].id).toBe('researchlab');
});

async function openFixture(page: Page): Promise<void> {
  await page.goto(fixtureUrl);
  await expect(page.locator('dst-crafting-ui')).toHaveCount(1);
  await expect(page.locator('dst-status-hud')).toHaveCount(1);
  await expect(page.locator('dst-inventory-bar')).toHaveCount(1);
  await expect(page.locator('dst-map-controls')).toHaveCount(1);
}

test('registers all elements with open, styled shadow roots', async ({ page }) => {
  await openFixture(page);

  const components = await page.evaluate(() =>
    ['dst-crafting-ui', 'dst-status-hud', 'dst-inventory-bar', 'dst-map-controls'].map((tagName) => {
      const element = document.querySelector(tagName);
      return {
        tagName,
        isRegistered: Boolean(customElements.get(tagName)),
        hasOpenShadowRoot: Boolean(element?.shadowRoot),
        hasStyle: Boolean(element?.shadowRoot?.querySelector('style')),
      };
    }),
  );

  expect(components).toEqual([
    { tagName: 'dst-crafting-ui', isRegistered: true, hasOpenShadowRoot: true, hasStyle: true },
    { tagName: 'dst-status-hud', isRegistered: true, hasOpenShadowRoot: true, hasStyle: true },
    { tagName: 'dst-inventory-bar', isRegistered: true, hasOpenShadowRoot: true, hasStyle: true },
    { tagName: 'dst-map-controls', isRegistered: true, hasOpenShadowRoot: true, hasStyle: true },
  ]);

  await page.addStyleTag({ content: '.survival-hud { display: none !important; }' });
  await expect(page.locator('dst-status-hud').locator('.survival-hud')).toHaveCSS('display', 'block');
});

test('uses the mirrored DST data path for every image', async ({ page }) => {
  await openFixture(page);

  const imageUrls = await page.locator('dst-crafting-ui img, dst-status-hud img, dst-inventory-bar img, dst-map-controls img')
    .evaluateAll((images) => images.map((image) => (image as HTMLImageElement).src));

  expect(imageUrls.length).toBeGreaterThan(10);
  for (const imageUrl of imageUrls) {
    expect(new URL(imageUrl).pathname).toMatch(/^\/dst\/data\/ui\//);
  }

  for (const imageUrl of new Set(imageUrls)) {
    const response = await page.request.get(imageUrl);
    expect(response.status(), imageUrl).toBe(200);
  }

  const atlasArchives = await page.locator('dst-crafting-ui canvas[data-archive]')
    .evaluateAll((canvases) => canvases.map((canvas) => (canvas as HTMLElement).dataset.archive));
  expect(atlasArchives.length).toBeGreaterThan(0);
  expect(new Set(atlasArchives)).toEqual(new Set([`${new URL(fixtureUrl, page.url()).origin}/dst/data/databundles/images.zip`]));
});

test('renders the inventory and equipment slots and emits selection events', async ({ page }) => {
  await openFixture(page);

  const inventoryBar = page.locator('dst-inventory-bar');
  await expect(inventoryBar.locator('.inventory-bar__items .inventory-slot')).toHaveCount(15);
  await expect(inventoryBar.locator('.inventory-bar__equipment .inventory-slot')).toHaveCount(3);

  await page.evaluate(() => {
    const eventLog: Array<{ type: string; detail: unknown }> = [];
    window.addEventListener('game:inventory-slot-select', (event) => {
      eventLog.push({ type: event.type, detail: (event as CustomEvent).detail });
    });
    window.addEventListener('game:self-inspect', (event) => {
      eventLog.push({ type: event.type, detail: null });
    });
    (window as typeof window & { inventoryEventLog: typeof eventLog }).inventoryEventLog = eventLog;
  });

  await inventoryBar.locator('.inventory-bar__items .inventory-slot').nth(4).click();
  await inventoryBar.locator('.inventory-bar__equipment .inventory-slot').nth(1).click();
  await inventoryBar.locator('.inventory-bar__inspect').click();

  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { inventoryEventLog: unknown[] }).inventoryEventLog,
  )).toEqual([
    { type: 'game:inventory-slot-select', detail: { group: 'inventory', index: 4 } },
    { type: 'game:inventory-slot-select', detail: { group: 'equipment', index: 1, kind: 'body' } },
    { type: 'game:self-inspect', detail: null },
  ]);
});

test('updates individual inventory signals and emits paired drag deltas', async ({ page }) => {
  await openFixture(page);

  await page.evaluate(() => {
    const inventoryBar = document.querySelector('dst-inventory-bar') as HTMLElement & {
      setSlot(ref: unknown, item: unknown): void;
    };
    inventoryBar.setSlot({ group: 'inventory', index: 0 }, {
      id: 'cutgrass',
      name: '草',
      count: 3,
      maxStack: 40,
      icon: 'cutgrass.tex',
    });

    const eventLog: Array<{ type: string; detail: unknown }> = [];
    window.addEventListener('game:inventory-slot-decrease', (event) => {
      eventLog.push({ type: event.type, detail: (event as CustomEvent).detail });
    });
    window.addEventListener('game:inventory-slot-increase', (event) => {
      eventLog.push({ type: event.type, detail: (event as CustomEvent).detail });
    });
    (window as typeof window & { inventoryDragEventLog: typeof eventLog }).inventoryDragEventLog = eventLog;
  });

  const slots = page.locator('dst-inventory-bar .inventory-bar__items .inventory-slot');
  await expect(slots.nth(0).locator('.inventory-slot__count')).toHaveText('3');
  await expect(slots.nth(0)).toHaveAttribute('data-item-id', 'cutgrass');
  await expect(slots.nth(0).locator('.inventory-slot__icon')).toHaveAttribute('data-loaded', 'true');

  const sourceBox = await slots.nth(0).boundingBox();
  const targetBox = await slots.nth(2).boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, {
    steps: 4,
  });
  await page.mouse.up();

  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { inventoryDragEventLog: unknown[] }).inventoryDragEventLog,
  )).toEqual([
    {
      type: 'game:inventory-slot-decrease',
      detail: {
        operationId: 1,
        slot: { group: 'inventory', index: 0 },
        itemId: 'cutgrass',
        amount: 3,
      },
    },
    {
      type: 'game:inventory-slot-increase',
      detail: {
        operationId: 1,
        slot: { group: 'inventory', index: 2 },
        itemId: 'cutgrass',
        amount: 3,
      },
    },
  ]);
});

test('updates the crafting selection and collapsed state', async ({ page }) => {
  await openFixture(page);

  const crafting = page.locator('dst-crafting-ui');
  const panel = crafting.locator('.craft-panel');
  const recipes = crafting.locator('.craft-recipe');

  await expect(crafting.locator('.craft-category')).toHaveCount(25);
  await expect(recipes).toHaveCount(56);
  await expect(recipes.first()).toHaveAttribute('aria-selected', 'true');
  await expect(crafting.locator('.craft-detail h2')).toHaveText('斧头');
  const background = recipes.first().locator('.craft-recipe-bg');
  const frame = recipes.first().locator('.craft-recipe-frame');
  const lock = recipes.first().locator('.craft-lock');
  await expect(background).toHaveAttribute('data-atlas', 'images/crafting_menu.xml');
  await expect(background).toHaveAttribute('data-element', 'slot_bg.tex');
  await expect(frame).toHaveAttribute('data-element', 'slot_frame.tex');
  await expect(lock).toHaveAttribute('data-element', 'slot_fg_lock.tex');
  await expect(background).toHaveAttribute('data-loaded', 'true');
  await expect(frame).toHaveAttribute('data-loaded', 'true');
  await expect(lock).toHaveAttribute('data-loaded', 'true');
  await expect(background).toHaveJSProperty('width', 128);
  await expect(background).toHaveJSProperty('height', 128);
  await expect(recipes.first()).toHaveAttribute('data-recipe', 'axe');
  await expect(recipes.first().locator('.craft-recipe-asset')).toHaveAttribute('data-element', 'axe.tex');
  await expect(recipes.first().locator('.craft-recipe-asset')).toHaveAttribute('data-loaded', 'true');
  await expect(crafting.locator('.craft-selected-icon .craft-recipe-asset')).toHaveAttribute('data-element', 'axe.tex');
  await expect(crafting.locator('.craft-material-asset')).toHaveCount(2);
  await expect(crafting.locator('.craft-material-asset').nth(0)).toHaveAttribute(
    'data-atlas',
    'images/inventoryimages.xml',
  );
  await expect(crafting.locator('.craft-material-asset').nth(0)).toHaveAttribute('data-element', 'twigs.tex');
  await expect(crafting.locator('.craft-material-asset').nth(1)).toHaveAttribute('data-element', 'flint.tex');
  await expect(crafting.locator('.craft-material-asset[data-loaded="true"]')).toHaveCount(2);
  await expect(crafting.locator('.craft-material-count')).toHaveText(['17/1', '0/1']);

  const fireCategory = crafting.locator('.craft-category[data-category="fire"]');
  await fireCategory.click();
  await expect(fireCategory).toHaveAttribute('aria-pressed', 'true');
  await expect(crafting.locator('.craft-header h1')).toHaveText('光源');
  await expect(recipes).toHaveCount(23);
  await expect(recipes.first()).toHaveAttribute('data-recipe', 'lighter');
  const torchRecipe = recipes.filter({ has: page.locator('[data-element="torch.tex"]') });
  await torchRecipe.click();
  await expect(crafting.locator('.craft-detail h2')).toHaveText('火炬');
  await expect(recipes.locator('[data-element="torch.tex"]')).toHaveAttribute('data-loaded', 'true');
  await expect(crafting.locator('.craft-material-asset').nth(0)).toHaveAttribute('data-element', 'cutgrass.tex');
  await expect(crafting.locator('.craft-material-asset').nth(1)).toHaveAttribute('data-element', 'twigs.tex');
  await expect(crafting.locator('.craft-material-asset[data-loaded="true"]')).toHaveCount(2);
  await expect(crafting.locator('img[src*="crafting/item/"]')).toHaveCount(0);
  await expect(crafting.locator('.craft-material-count')).toHaveText(['3/2', '17/2']);
  await expect(crafting.locator('.craft-build')).toBeEnabled();
  await expect(torchRecipe.locator('.craft-lock')).toHaveCount(0);

  await page.evaluate(() => {
    window.addEventListener('game:craft-request', (event) => {
      (window as typeof window & { craftRequest?: unknown }).craftRequest =
        (event as CustomEvent).detail;
    });
  });
  await crafting.locator('.craft-build').click();
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { craftRequest?: unknown }).craftRequest,
  )).toEqual({ recipeId: 'torch' });

  await page.evaluate(() => {
    const element = document.querySelector('dst-crafting-ui') as HTMLElement & {
      setInventoryCounts(counts: Readonly<Record<string, number>>): void;
    };
    element.setInventoryCounts({ cutgrass: 1, twigs: 15, torch: 1 });
  });
  await expect(crafting.locator('.craft-header h1')).toHaveText('光源');
  await expect(crafting.locator('.craft-detail h2')).toHaveText('火炬');
  await expect(crafting.locator('.craft-material-count')).toHaveText(['1/2', '15/2']);
  await expect(crafting.locator('.craft-build')).toBeDisabled();

  const scienceCategory = crafting.locator('.craft-category[data-category="science"]');
  await scienceCategory.click();
  await expect(scienceCategory).toHaveAttribute('aria-pressed', 'true');
  await expect(crafting.locator('.craft-header h1')).toHaveText('科学');
  await expect(recipes).toHaveCount(22);
  await expect(recipes.first()).toHaveAttribute('aria-selected', 'true');
  await expect(recipes.first()).toHaveAttribute('data-recipe', 'researchlab');
  await expect(crafting.locator('.craft-detail h2')).toHaveText('科学机器');
  await expect(crafting.locator('.craft-material')).toHaveCount(3);
  await expect(crafting.locator('.craft-build')).toBeDisabled();

  await page.evaluate(() => {
    const element = document.querySelector('dst-crafting-ui') as HTMLElement & {
      setBufferedRecipes(recipeIds: Iterable<string>): void;
    };
    element.setBufferedRecipes(['researchlab']);
  });
  const bufferedResearchLab = recipes.filter({ has: page.locator('[data-element="researchlab.tex"]') });
  await expect(bufferedResearchLab).toHaveAttribute('data-buffered', 'true');
  await expect(bufferedResearchLab.locator('.craft-recipe-bg')).toHaveAttribute(
    'data-element',
    'slot_bg_buffered.tex',
  );
  await expect(bufferedResearchLab.locator('.craft-lock')).toHaveCount(0);
  await expect(crafting.locator('.craft-build')).toBeEnabled();
  await expect(crafting.locator('.craft-build')).toHaveText('放置');

  await crafting.locator('.craft-view-toggle').click();
  await expect(panel).toHaveClass(/is-collapsed/);
  await expect(crafting.locator('.craft-quick-toggle')).toHaveAttribute('aria-expanded', 'false');

  await crafting.locator('.craft-quick-toggle').click();
  await expect(panel).not.toHaveClass(/is-collapsed/);
  await expect(crafting.locator('.craft-quick-toggle')).toHaveAttribute('aria-expanded', 'true');
});

test('emits composed map, pause, and camera events', async ({ page }) => {
  await openFixture(page);

  await page.evaluate(() => {
    const eventLog: Array<{ type: string; detail: unknown }> = [];
    for (const type of ['game:map-toggle', 'game:pause-toggle', 'game:camera-turn']) {
      window.addEventListener(type, (event) => {
        eventLog.push({ type, detail: (event as CustomEvent).detail });
      });
    }
    (window as typeof window & { eventLog: typeof eventLog }).eventLog = eventLog;
  });

  const controls = page.locator('dst-map-controls');
  await controls.locator('.map-controls__map').click();
  await controls.locator('.map-controls__pause').click();
  await controls.locator('.map-controls__turn--left').click();
  await controls.locator('.map-controls__turn--right').click();

  await expect(controls.locator('.map-controls__map')).toHaveAttribute('aria-pressed', 'true');
  await expect(controls.locator('.map-controls__pause')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { eventLog: unknown[] }).eventLog,
  )).toEqual([
    { type: 'game:map-toggle', detail: { isOpen: true } },
    { type: 'game:pause-toggle', detail: { isPaused: true } },
    { type: 'game:camera-turn', detail: { direction: 'left' } },
    { type: 'game:camera-turn', detail: { direction: 'right' } },
  ]);
});

test('rerenders asset URLs when asset-base changes', async ({ page }) => {
  await openFixture(page);

  const controls = page.locator('dst-map-controls');
  await controls.evaluate((element) => element.setAttribute('asset-base', '/custom-ui/'));

  await expect(controls.locator('.map-controls__map img')).toHaveAttribute(
    'src',
    '/custom-ui/map/map_button.tex.png',
  );
});
