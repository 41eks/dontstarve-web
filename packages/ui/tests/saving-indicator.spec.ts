import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { DstSavingIndicatorElement } from '../src/saving-indicator';

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
