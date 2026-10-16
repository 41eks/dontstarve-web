import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('local lights share one submission and two draws, preserve additive colour and release their geometry', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async url => (await import(url)).checkLocalLightBatch(),
    `/@fs${fileURLToPath(new URL('./local-light-batch-fixture.ts', import.meta.url))}`);
  expect(result.empty).toEqual({ calls: 1, submissions: 1, restored: true });
  for (const state of [result.overlapping, result.stress, result.shrunk]) {
    expect(state).toMatchObject({ calls: 2, submissions: 1, restored: true });
  }
  for (const pixel of [result.overlapping.pixel, result.shrunk.pixel]) {
    for (const [index, expected] of [115, 128, 38].entries()) expect(Math.abs(pixel[index] - expected)).toBeLessThanOrEqual(1);
  }
  expect(result.removed).toMatchObject({ calls: 1, submissions: 1, restored: true });
  for (const [index, expected] of [13, 26, 38].entries()) expect(Math.abs(result.removed.pixel[index] - expected)).toBeLessThanOrEqual(1);
  expect(result.remainingGeometries).toBe(1); // Only the test's copy quad remains.
  expect(errors).toEqual([]);
});
