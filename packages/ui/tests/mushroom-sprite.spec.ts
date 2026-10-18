import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('blue mushrooms instance non-looping poses and keep alpha picking and independent playback', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async url => (await import(url)).checkMushroomInstances(),
    `/@fs${fileURLToPath(new URL('./mushroom-sprite-fixture.ts', import.meta.url))}`);
  expect(result.calls).toEqual([2, 2, 4, 2, 0]);
  expect(result.hiddenSources).toBe(32);
  expect(result.alphaPickable).toBe(true);
  expect(result.brightPixels).toBeGreaterThan(100);
  expect(result.independent).toEqual(['picked', 'blue']);
  expect(result.releasedBatch).toBe(true);
  expect(errors).toEqual([]);
});
