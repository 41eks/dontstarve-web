import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('rocks batch their source poses and split-build art while retaining alpha picking', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(
    async url => (await import(url)).checkRockInstances(),
    `/@fs${fileURLToPath(new URL('./rock-sprite-fixture.ts', import.meta.url))}`,
  );
  // One draw per batch in key order. The boulders stand among the first row of rocks, so the two pages interleave
  // there and are drawn as seven runs.
  expect(result.calls).toEqual([1, 2, 1, 7, 0]);
  expect(result.hiddenSources).toBe(32);
  expect(result.alphaPickable).toBe(true);
  expect(result.painted).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});
