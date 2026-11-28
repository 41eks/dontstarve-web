import { expect, test } from '@playwright/test';

test('ground items share one draw call and retain the batch across sleep, wake and removal', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/browser/fixture.html');
  const result = await page.evaluate(async url => {
    const { checkGroundItemInstancing } = await import(url);
    return checkGroundItemInstancing();
  }, '/tests/browser/ground-item-instancing-fixture.ts');
  expect(result).toEqual({
    many: { calls: 1, count: 24 },
    asleep: { calls: 1, count: 23 },
    awake: { calls: 1, count: 24 },
    sameBatch: true,
    sameTexture: true,
    position: [-8, 0, -5],
    removed: { calls: 1, count: 23 },
    empty: { calls: 0, count: 0 },
  });
  expect(errors).toEqual([]);
});

test('base turf and woodfloor preserve complete ground sprites at different camera angles', async ({ page }) => {
  await page.goto('/tests/browser/fixture.html');
  const result = await page.evaluate(async url => {
    const { checkTurfOcclusion } = await import(url);
    return checkTurfOcclusion();
  }, '/tests/browser/turf-fixture.ts');
  expect(result).toEqual({ comparisons: 24, failures: [] });
});

test('nightmarefuel lets the background show through its source half-alpha ground animation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/browser/fixture.html');
  const result = await page.evaluate(async url => {
    const { checkNightmareFuelTransparency } = await import(url);
    return checkNightmareFuelTransparency();
  }, '/tests/browser/nightmarefuel-fixture.ts');
  expect(result.opaqueInterior).toBeGreaterThan(50);
  expect(result.translucentInterior).toBeGreaterThan(result.opaqueInterior * 0.9);
  expect(errors).toEqual([]);
});
