import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('loaded moon statues batch full, med and low idles through mining and sleep/wake', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async url => (await import(url)).checkArchiveStatueInstancing(),
    `/@fs${fileURLToPath(new URL('./archive-statue-instancing-fixture.ts', import.meta.url))}`);
  expect(result).toEqual({
    full: { calls: 2, count: 8 }, med: { calls: 2, count: 8 }, low: { calls: 2, count: 8 },
    asleep: { calls: 0, count: 0 }, restored: { calls: 2, count: 8 }, shared: true, preserved: true, remaining: 7,
  });
  expect(errors).toEqual([]);
});
