import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('shared hover text shows primary and secondary actions, honors overrides, and stays inside the screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/dst-lighting.html');
  await page.evaluate(async url => (await import(url)).setupHoverer(),
    `/@fs${fileURLToPath(new URL('./hoverer-fixture.ts', import.meta.url))}`);
  const hover = page.locator('.cursor-label-ui');
  const primary = hover.locator('[data-role="primary"]');
  const secondary = hover.locator('[data-role="secondary"]');
  const step = () => page.evaluate(() => (window as any).hoverer.step());
  await page.mouse.move(200, 200); await step();
  await expect(primary.locator('span')).toHaveText('捕捉');
  await expect(primary.locator('canvas')).toBeVisible();
  await expect(primary.locator('canvas')).toHaveAttribute('data-glyph', 'U+E100');
  await expect(secondary.locator('span')).toHaveText(': 打扫');
  await expect(secondary.locator('canvas')).toBeVisible();
  await expect(secondary.locator('canvas')).toHaveAttribute('data-glyph', 'U+E101');
  const buttonPixels = await hover.locator('canvas').evaluateAll(elements => elements.map(element => {
    const canvas = element as HTMLCanvasElement;
    return Array.from(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data);
  }));
  for (const pixels of buttonPixels) {
    expect(pixels.filter((alpha, index) => index % 4 === 3 && alpha > 0).length).toBeGreaterThan(300);
  }
  expect(buttonPixels[0]).not.toEqual(buttonPixels[1]);
  await page.evaluate(() => (window as any).hoverer.tooltip(true));
  await expect(primary.locator('span')).toHaveText('建造预览');
  await expect(secondary).toBeHidden();
  await page.evaluate(() => (window as any).hoverer.tooltip(false));
  await expect(primary.locator('span')).toHaveText('捕捉');
  const viewport = page.viewportSize()!;
  for (const point of [{ x: 2, y: 2 }, { x: viewport.width - 2, y: viewport.height - 2 }]) {
    await page.mouse.move(point.x, point.y); await step();
    const bounds = await hover.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(9);
    expect(bounds!.y).toBeGreaterThanOrEqual(9);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width - 9);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height - 9);
  }
  await page.evaluate(() => (window as any).hoverer.equip(false));
  await expect(hover).toBeHidden();
  await page.evaluate(() => { (window as any).hoverer.equip(true); (window as any).hoverer.valid(false); });
  await expect(hover).toBeHidden();
  await page.evaluate(() => (window as any).hoverer.valid(true));
  await expect(hover).toBeVisible();
  const blocker = await page.evaluate(() => {
    const div = document.createElement('div');
    div.id = 'hover-blocker'; div.style.cssText = 'position:fixed;inset:0;z-index:200'; document.body.append(div);
    (window as any).hoverer.step(); return div.id;
  });
  await expect(hover).toBeHidden();
  await page.locator(`#${blocker}`).evaluate(element => element.remove()); await step();
  await expect(hover).toBeVisible();
  await page.evaluate(() => (window as any).hoverer.dispose());
  await expect(hover).toHaveCount(0);
  expect(errors).toEqual([]);
});
