import { expect, test, type Page } from '@playwright/test';
import { categories } from '../src/categories';

const fixtureUrl = '/tests/fixture.html';

test('keeps an independent recipe collection for every crafting category', () => {
  expect(categories).toHaveLength(22);
  expect(new Set(categories.map(({ recipes }) => recipes)).size).toBe(22);
  expect(new Set(categories.map(({ recipes }) => recipes[0])).size).toBe(22);
  expect(categories.find(({ id }) => id === 'tool')?.recipes[0].name).toBe('斧头');
  expect(categories.find(({ id }) => id === 'fire')?.recipes[0].name).toBe('火炬');
  expect(categories
    .filter(({ id }) => id !== 'tool' && id !== 'fire')
    .every(({ recipes }) => recipes.length === 1 && recipes[0].asset === undefined && recipes[0].locked))
    .toBe(true);
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

  expect(imageUrls.length).toBeGreaterThan(30);
  for (const imageUrl of imageUrls) {
    expect(new URL(imageUrl).pathname).toMatch(/^\/dst\/data\/ui\//);
  }

  for (const imageUrl of new Set(imageUrls)) {
    const response = await page.request.get(imageUrl);
    expect(response.status(), imageUrl).toBe(200);
  }
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

test('updates the crafting selection and collapsed state', async ({ page }) => {
  await openFixture(page);

  const crafting = page.locator('dst-crafting-ui');
  const panel = crafting.locator('.craft-panel');
  const recipes = crafting.locator('.craft-recipe');

  await expect(crafting.locator('.craft-category')).toHaveCount(22);
  await expect(recipes).toHaveCount(1);
  await expect(recipes.first()).toHaveAttribute('aria-selected', 'true');
  await expect(crafting.locator('.craft-detail h2')).toHaveText('斧头');
  await expect(recipes.first().locator('.craft-recipe-asset')).toHaveAttribute(
    'src',
    /crafting\/filter\/tool\/axe\.tex\.png$/,
  );
  await expect(crafting.locator('.craft-selected-icon .craft-recipe-asset')).toHaveAttribute(
    'src',
    /crafting\/filter\/tool\/axe\.tex\.png$/,
  );
  await expect(crafting.locator('.craft-material-asset')).toHaveCount(2);
  await expect(crafting.locator('.craft-material-count')).toHaveText(['0/1', '0/1']);

  const fireCategory = crafting.locator('.craft-category[data-category="fire"]');
  await fireCategory.click();
  await expect(fireCategory).toHaveAttribute('aria-pressed', 'true');
  await expect(crafting.locator('.craft-header h1')).toHaveText('光源');
  await expect(crafting.locator('.craft-detail h2')).toHaveText('火炬');
  await expect(recipes.first().locator('.craft-recipe-asset')).toHaveAttribute(
    'src',
    /crafting\/filter\/fire\/torch\.tex\.png$/,
  );
  await expect(crafting.locator('.craft-material-asset').nth(0)).toHaveAttribute(
    'src',
    /crafting\/item\/cutgrass\.tex\.png$/,
  );
  await expect(crafting.locator('.craft-material-asset').nth(1)).toHaveAttribute(
    'src',
    /crafting\/item\/twigs\.tex\.png$/,
  );
  await expect(crafting.locator('.craft-material-count')).toHaveText(['3/2', '17/2']);
  await expect(crafting.locator('.craft-build')).toBeEnabled();

  const scienceCategory = crafting.locator('.craft-category[data-category="science"]');
  await scienceCategory.click();
  await expect(scienceCategory).toHaveAttribute('aria-pressed', 'true');
  await expect(crafting.locator('.craft-header h1')).toHaveText('科学');
  await expect(recipes).toHaveCount(1);
  await expect(recipes.first()).toHaveAttribute('aria-selected', 'true');
  await expect(recipes.first().locator('.craft-placeholder')).toHaveCount(1);
  await expect(crafting.locator('.craft-detail h2')).toHaveText('科学占位');
  await expect(crafting.locator('.craft-material')).toHaveCount(0);
  await expect(crafting.locator('.craft-build')).toBeDisabled();

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
