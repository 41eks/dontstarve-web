import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const moduleUrl = (path: string) => `/@fs${fileURLToPath(new URL(path, import.meta.url))}`;

async function setup(page: Page) {
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    Element.prototype.animate = function (...args: Parameters<Element['animate']>) {
      const animation = original.apply(this, args);
      // Keep flight and landing frames deterministic; other game animations run normally.
      if (this.classList.contains('inventory-receive-flight')
        || this.classList.contains('inventory-slot__content') || this.classList.contains('inventory-slot__count')) {
        animation.pause();
        animation.currentTime = 0;
      }
      return animation;
    };
  });
  await page.goto('/tests/dst-lighting.html');
  await page.evaluate(async (url) => {
    (window as any).receiveFixture = await (await import(url)).createReceiveFixture();
  }, moduleUrl('./inventory-receive-fixture.ts'));
}

test('captured fireflies fly from their projected foot point into the actual slot with Lua easing and a landing pulse', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await setup(page);
  const result = await page.evaluate(() => (window as any).receiveFixture.capture());
  expect(result).toMatchObject({ ok: true, remaining: 0 });
  const flight = page.locator('.inventory-receive-flight');
  await expect(flight).toBeVisible();
  await expect(flight.locator('.inventory-slot__icon')).toHaveAttribute('data-loaded', 'true');
  await expect(flight).toHaveAttribute('data-item-id', 'fireflies');
  const slot = page.locator('dst-inventory-bar .inventory-slot[data-item-id="fireflies"]');
  await expect(slot.locator('.inventory-slot__content')).toBeHidden();
  const start = (await flight.boundingBox())!;
  const destination = await slot.locator('.inventory-slot__content').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  expect(start.x + start.width / 2).toBeCloseTo(result.source.x, 1);
  expect(start.y + start.height / 2).toBeCloseTo(result.source.y, 1);
  expect(await flight.evaluate((element) => element.getAnimations()[0].effect!.getTiming().duration)).toBe(300);
  await flight.evaluate((element) => { element.getAnimations()[0].currentTime = 150; });
  const middle = (await flight.boundingBox())!;
  expect(middle.x + middle.width / 2).toBeCloseTo(result.source.x + (destination.x - result.source.x) * 0.875, 1);
  expect(middle.y + middle.height / 2).toBeCloseTo(result.source.y + (destination.y - result.source.y) * 0.875, 1);
  await flight.evaluate((element) => element.getAnimations()[0].finish());
  await expect(flight).toHaveCount(0);
  await expect(slot.locator('.inventory-slot__content')).toBeVisible();
  const landing = await slot.locator('.inventory-slot__content').evaluate((element) => {
    const animation = element.getAnimations()[0];
    return { scale: new DOMMatrix(getComputedStyle(element).transform).a, duration: animation.effect!.getTiming().duration };
  });
  expect(landing).toEqual({ scale: 2, duration: 250 });
  expect(errors).toEqual([]);
});

test('stack gains keep the previous quantity visible and consecutive flights land independently', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => (window as any).receiveFixture.inventory.add('cutgrass', 2));
  const slot = page.locator('dst-inventory-bar .inventory-slot[data-item-id="cutgrass"]');
  await expect(slot.locator('.inventory-slot__icon')).toHaveAttribute('data-loaded', 'true');
  await page.evaluate(() => {
    (window as any).receiveFixture.add('cutgrass', 1);
    (window as any).receiveFixture.add('cutgrass', 2, 5, 2);
  });
  const flights = page.locator('.inventory-receive-flight');
  await expect(flights).toHaveCount(2);
  await expect(flights.nth(0)).toBeVisible();
  await expect(flights.nth(1)).toBeVisible();
  const width = (await flights.nth(0).boundingBox())!.width;
  await expect(slot.locator('.inventory-slot__content')).toBeVisible();
  await expect(slot.locator('.inventory-slot__count')).toHaveText('2');
  expect(await page.evaluate(() => (window as any).receiveFixture.inventory.count('cutgrass'))).toBe(5);
  await flights.nth(0).evaluate((element) => element.getAnimations()[0].finish());
  await expect(flights).toHaveCount(1);
  await expect(slot.locator('.inventory-slot__count')).toHaveText('3');
  await flights.nth(0).evaluate((element) => element.getAnimations()[0].finish());
  await expect(flights).toHaveCount(0);
  await expect(slot.locator('.inventory-slot__count')).toHaveText('5');
  // Landing is still paused at scale(2); the next flying icon must keep its base size.
  await page.evaluate(() => (window as any).receiveFixture.add('cutgrass', 1));
  await expect(flights).toBeVisible();
  expect((await flights.boundingBox())!.width).toBeCloseTo(width, 1);
});

test('crafting and split acquisitions use their committed destination slots and skin atlas', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const fixture = (window as any).receiveFixture;
    fixture.inventory.add('cutgrass', 3);
    if (!fixture.craft()) throw new Error('Craft failed');
  });
  const rope = page.locator('dst-inventory-bar .inventory-slot[data-item-id="rope"]');
  const flight = page.locator('.inventory-receive-flight');
  await expect(flight).toBeVisible();
  await expect(flight).toHaveAttribute('data-slot-key', '0');
  await expect(rope.locator('.inventory-slot__content')).toBeHidden();
  await flight.evaluate((element) => element.getAnimations()[0].finish());
  await expect(rope.locator('.inventory-slot__content')).toBeVisible();
  await page.evaluate(() => {
    const fixture = (window as any).receiveFixture;
    fixture.inventory.add('cutgrass', 39);
    fixture.add('cutgrass', 3);
  });
  await expect(flight).toHaveCount(2);
  expect(await flight.evaluateAll((elements) => elements.map((element) => (element as HTMLElement).dataset.slotKey))).toEqual(['1', '2']);
  await page.evaluate(() => (window as any).receiveFixture.inventoryBar.cancelReceiveAnimations());
  const skinned = await page.evaluate(() => (window as any).receiveFixture.add('reskin_tool', 1, 0, 0, 'reskin_tool_brush'));
  expect(skinned.ok).toBe(true);
  await expect(flight).toBeVisible();
  await expect(flight.locator('.inventory-slot__icon')).toHaveAttribute('data-element', 'reskin_tool_brush.tex');
  const atlas = await page.locator('dst-inventory-bar .inventory-slot[data-skin-id="reskin_tool_brush"] .inventory-slot__icon').getAttribute('data-atlas');
  await expect(flight.locator('.inventory-slot__icon')).toHaveAttribute('data-atlas', atlas!);
});

test('failed acquisition, removing an item, resizing and disconnecting the UI leave no stale flights', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => (window as any).receiveFixture.add('cutgrass', 1));
  const flight = page.locator('.inventory-receive-flight');
  await expect(flight).toBeVisible();
  await page.evaluate(() => (window as any).receiveFixture.remove(0));
  await expect(flight).toHaveCount(0);
  const slot = page.locator('dst-inventory-bar .inventory-slot').first();
  await expect(slot).toHaveAttribute('data-item-id', '');
  await page.evaluate(() => (window as any).receiveFixture.add('cutgrass', 1));
  await expect(flight).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 720 });
  await expect(flight).toHaveCount(0);
  await expect(slot.locator('.inventory-slot__content')).toBeVisible();
  await page.evaluate(() => (window as any).receiveFixture.add('cutgrass', 1));
  await expect(flight).toBeVisible();
  await page.evaluate(() => (window as any).receiveFixture.dispose());
  await expect(flight).toHaveCount(0);
  const failed = await page.evaluate(() => (window as any).receiveFixture.add('cutgrass', 1000));
  expect(failed.ok).toBe(false);
  await expect(flight).toHaveCount(0);
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 375, height: 667 }]) {
test(`the production crafting event keeps the flying icon in its slot size at ${viewport.width}px`, async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize(viewport);
  await setup(page);
  await page.evaluate(() => (window as any).receiveFixture.dispose());
  const result = await page.evaluate(async (urls) => {
    const { inventory } = await import(urls.main);
    const { player } = await import(urls.player);
    const { view } = await import(urls.view);
    const { projectInventorySource } = await import(urls.receive);
    const changes = inventory.addresses().filter((slot: any) => slot.containerId === 'player:inventory')
      .flatMap((slot: any) => {
        const stack = inventory.get(slot);
        return stack ? [{ slot, itemId: stack.itemId, skinId: stack.skinId, delta: -stack.count }] : [];
      });
    inventory.applySlotChanges(changes);
    if (!inventory.add('cutgrass', 3)) throw new Error('No room for ingredients');
    const source = projectInventorySource(player.position, view.camera, view.renderer.domElement);
    document.querySelector('dst-crafting-ui')!.dispatchEvent(new CustomEvent('game:craft-request', {
      detail: { recipeId: 'rope' }, bubbles: true, composed: true,
    }));
    return { source, count: inventory.count('rope') };
  }, { main: moduleUrl('../../../src/main.ts'), player: moduleUrl('../../../src/player.ts'),
    view: moduleUrl('../../../src/view.ts'), receive: moduleUrl('../../../src/inventoryReceive.ts') });
  expect(result.count).toBe(1);
  const flight = page.locator('.inventory-receive-flight');
  await expect(flight).toBeVisible();
  await expect(flight).toHaveAttribute('data-item-id', 'rope');
  const rect = (await flight.boundingBox())!;
  const icon = (await flight.locator('.inventory-slot__icon').boundingBox())!;
  const slot = page.locator('dst-inventory-bar .inventory-slot[data-item-id="rope"]');
  const slotRect = (await slot.boundingBox())!;
  expect(icon.width).toBeCloseTo(rect.width, 1);
  expect(icon.height).toBeCloseTo(rect.height, 1);
  expect(icon.width).toBeLessThan(slotRect.width);
  expect(icon.height).toBeLessThan(slotRect.height);
  expect(icon.x).toBeGreaterThanOrEqual(0);
  expect(icon.y).toBeGreaterThanOrEqual(0);
  expect(icon.x + icon.width).toBeLessThanOrEqual(viewport.width);
  expect(icon.y + icon.height).toBeLessThanOrEqual(viewport.height);
  expect(rect.x + rect.width / 2).toBeCloseTo(result.source.x, 1);
  expect(rect.y + rect.height / 2).toBeCloseTo(result.source.y, 1);
  expect(icon.x + icon.width / 2).toBeCloseTo(result.source.x, 1);
  expect(icon.y + icon.height / 2).toBeCloseTo(result.source.y, 1);
  await flight.evaluate((element) => element.getAnimations()[0].finish());
  await expect(page.locator('dst-inventory-bar .inventory-slot[data-item-id="rope"] .inventory-slot__content')).toBeVisible();
  expect(errors).toEqual([]);
});
}
