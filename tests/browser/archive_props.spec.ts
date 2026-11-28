import { expect, test } from '@playwright/test';

test('loaded moon statues batch full, med and low idles through mining and sleep/wake', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/browser/dst-lighting.html');
  const result = await page.evaluate(
    async url => (await import(url)).checkArchiveStatueInstancing(),
    '/tests/browser/archive-statue-instancing-fixture.ts',
  );
  expect(result).toEqual({
    full: { calls: 1, count: 8 },
    med: { calls: 1, count: 8 },
    low: { calls: 1, count: 8 },
    asleep: { calls: 0, count: 0 },
    restored: { calls: 1, count: 8 },
    shared: true,
    preserved: true,
    remaining: 7,
  });
  expect(errors).toEqual([]);
});
