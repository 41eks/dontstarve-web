import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('pickable bushes share instance batches through sleep, wake and removal', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/fixture.html');
  const result = await page.evaluate(async url => (await import(url)).checkPickablePlantInstancing(),
    `/@fs${fileURLToPath(new URL('./pickable-plant-instancing-fixture.ts', import.meta.url))}`);
  expect(result).toEqual(Array.from({ length: 3 }, () => ({
    ready: { calls: 2, count: 12 }, asleep: { calls: 0, count: 0 }, restored: { calls: 2, count: 12 },
    shared: true, preserved: true, removed: { calls: 2, count: 11 },
  })));
  expect(errors).toEqual([]);
});
