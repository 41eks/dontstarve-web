import { expect, test } from '@playwright/test';

test('uses atlas arrows and scrolls with clicks, wheel, keyboard and a scaled thumb drag', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/tests/fixture.html');
  const crafting = page.locator('dst-crafting-ui');
  await crafting.locator('.craft-quick-toggle').click();
  const viewport = crafting.locator('.craft-recipes');
  const up = crafting.locator('.craft-scroll-up');
  const down = crafting.locator('.craft-scroll-down');
  const track = crafting.locator('.craft-scroll-track');
  const thumb = crafting.locator('.craft-scroll-thumb');
  const scrollbar = crafting.locator('.craft-recipe-scrollbar');
  await expect(scrollbar.locator('[data-loaded="true"]')).toHaveCount(4);
  await expect(up.locator('.craft-scroll-arrow-normal')).toHaveAttribute('data-element', 'scrollbar_arrow_up.tex');
  await expect(up.locator('.craft-scroll-arrow-highlight')).toHaveAttribute('data-element', 'scrollbar_arrow_up_hl.tex');
  await expect(down.locator('.craft-scroll-arrow-normal')).toHaveAttribute('data-element', 'scrollbar_arrow_down.tex');
  await expect(down.locator('.craft-scroll-arrow-highlight')).toHaveAttribute('data-element', 'scrollbar_arrow_down_hl.tex');
  await expect(up).toBeDisabled();
  await down.hover();
  await expect(down.locator('.craft-scroll-arrow-highlight')).toHaveCSS('opacity', '1');
  await down.click();
  await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect(up).toBeEnabled();
  await track.focus();
  await page.keyboard.press('End');
  await expect(down).toBeDisabled();
  expect(await viewport.evaluate((node) => node.scrollTop)).toBe(await viewport.evaluate((node) => node.scrollHeight - node.clientHeight));
  await page.keyboard.press('Home');
  await expect(up).toBeDisabled();
  await viewport.hover();
  await page.mouse.wheel(0, 120);
  await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(50);

  await track.focus();
  await page.keyboard.press('Home');
  await expect(up).toBeDisabled();
  const handle = (await thumb.boundingBox())!;
  const rail = (await track.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + (rail.height - handle.height) / 2);
  await page.mouse.up();
  const fraction = await viewport.evaluate((node) => node.scrollTop / (node.scrollHeight - node.clientHeight));
  expect(fraction).toBeGreaterThan(0.35);
  expect(fraction).toBeLessThan(0.75);

  await crafting.locator('.craft-category[aria-label="光源"]').click();
  await expect(scrollbar).toBeHidden();
  expect(await viewport.evaluate((node) => node.scrollTop)).toBe(0);
  await crafting.locator('.craft-category[aria-label="工具"]').click();
  await expect(scrollbar).toBeVisible();
  await expect(up).toBeDisabled();
});

test('keeps the recipe viewport, scrollbar and details inside the painted frame at smaller sizes', async ({ page }) => {
  await page.goto('/tests/fixture.html');
  await page.locator('dst-crafting-ui .craft-quick-toggle').click();
  for (const size of [{ width: 1280, height: 900 }, { width: 640, height: 640 }, { width: 1280, height: 480 }, { width: 375, height: 667 }]) {
    await page.setViewportSize(size);
    const bounds = await page.locator('dst-crafting-ui').evaluate((host) => {
      const root = host.shadowRoot!;
      const panel = root.querySelector('.craft-panel')!.getBoundingClientRect();
      const inset = panel.width * 34 / 1024;
      const viewport = root.querySelector<HTMLElement>('.craft-recipes')!;
      const areas = ['.craft-recipes-area', '.craft-recipe-scrollbar', '.craft-detail'].map((selector) => {
        const area = root.querySelector(selector)!.getBoundingClientRect();
        return { selector, left: area.left, right: area.right, top: area.top, bottom: area.bottom };
      });
      return { panel: { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom }, inset,
        areas, horizontalOverflow: viewport.scrollWidth - viewport.clientWidth, nativeScrollbar: getComputedStyle(viewport).scrollbarWidth };
    });
    for (const area of bounds.areas) {
      expect(area.left, `${area.selector} at ${size.width}x${size.height}`).toBeGreaterThanOrEqual(bounds.panel.left + bounds.inset - 1);
      expect(area.right).toBeLessThanOrEqual(bounds.panel.right - bounds.inset + 1);
      expect(area.top).toBeGreaterThanOrEqual(bounds.panel.top);
      expect(area.bottom).toBeLessThanOrEqual(bounds.panel.bottom + 1);
    }
    expect(bounds.horizontalOverflow).toBe(0);
    expect(bounds.nativeScrollbar).toBe('none');
  }
});
