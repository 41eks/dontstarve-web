import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { DstSavingIndicatorElement } from '../src/saving-indicator';

test('saving indicator loops for active saves, cleans up failures and can restart during the outro', async ({ page }) => {
  await page.goto('/tests/fixture.html');
  const indicator = page.locator('dst-saving-indicator');
  const canvas = indicator.locator('canvas');
  const panel = indicator.locator('.saving-indicator');
  await expect(canvas).toHaveAttribute('data-loaded', 'true');
  await expect(canvas).toHaveAttribute('data-archive', /\/dst\/data\/anim\/saving\.zip$/);
  await expect(panel).toBeHidden();
  await indicator.evaluate((host: DstSavingIndicatorElement) => { host.startSave(); host.startSave(); });
  await expect(canvas).toHaveAttribute('data-animation', 'save_pre');
  await expect(canvas).toHaveAttribute('data-animation', 'save_loop');
  await expect(indicator.locator('.saving-indicator__text')).toBeVisible();
  const bounds = (await panel.boundingBox())!;
  expect(bounds.x).toBeGreaterThan(640);
  expect(bounds.y).toBeLessThan(80);
  expect(bounds.y + bounds.height).toBeLessThan(350);
  await page.screenshot({ path: '/tmp/three-roaming-saving-indicator.png' });
  await indicator.evaluate((host: DstSavingIndicatorElement) => host.endSave());
  await expect(panel).toHaveAttribute('data-state', 'loop');
  await expect(indicator.locator('.saving-indicator__text')).toBeVisible();
  await indicator.evaluate((host: DstSavingIndicatorElement) => host.endSave());
  await expect(canvas).toHaveAttribute('data-animation', 'save_post');
  await indicator.evaluate((host: DstSavingIndicatorElement) => host.startSave());
  await expect(canvas).toHaveAttribute('data-animation', 'save_pre');
  await expect(panel).toBeVisible();
  await indicator.evaluate((host: DstSavingIndicatorElement) => host.endSave());
  await expect(panel).toBeHidden({ timeout: 10_000 });
  const failure = await indicator.evaluate(async (host: DstSavingIndicatorElement) => {
    try { await host.whileSaving(() => { throw new Error('save failed'); }); }
    catch (error) { return (error as Error).message; }
  });
  expect(failure).toBe('save failed');
  await expect(panel).toBeHidden({ timeout: 10_000 });
  await expect(indicator.locator('.saving-indicator__text')).toBeHidden();
});

test('c_save downloads the game and plays all three saving clips before hiding', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/dst-lighting.html');
  await page.evaluate(async (url) => { await import(url); },
    `/@fs${fileURLToPath(new URL('../../../src/main.ts', import.meta.url))}`);
  const indicator = page.locator('dst-saving-indicator');
  await expect(indicator.locator('canvas')).toHaveAttribute('data-loaded', 'true');
  await indicator.evaluate((host) => {
    const canvas = host.shadowRoot!.querySelector('canvas')!;
    (window as any).savingClips = [];
    new MutationObserver(() => {
      const clips = (window as any).savingClips;
      if (canvas.dataset.animation && clips.at(-1) !== canvas.dataset.animation) clips.push(canvas.dataset.animation);
    }).observe(canvas, { attributes: true, attributeFilter: ['data-animation'] });
  });
  await page.keyboard.press('Backquote');
  await page.locator('dst-debug-console input').fill('c_save()');
  const download = page.waitForEvent('download');
  await page.locator('dst-debug-console input').press('Enter');
  expect((await download).suggestedFilename()).toBe('initial-world.json');
  await expect.poll(() => page.evaluate(() => (window as any).savingClips), { timeout: 10_000 })
    .toEqual(['save_pre', 'save_loop', 'save_post']);
  await expect(indicator.locator('.saving-indicator')).toBeHidden({ timeout: 10_000 });
  expect(errors).toEqual([]);
});
