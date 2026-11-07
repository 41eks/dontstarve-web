import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const moduleUrl = (path: string) => `/@fs${fileURLToPath(new URL(path, import.meta.url))}`;

test('ground items share two draw calls and retain the batch across sleep, wake and removal', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/fixture.html');
  const result = await page.evaluate(async url => {
    const { checkGroundItemInstancing } = await import(url);
    return checkGroundItemInstancing();
  }, moduleUrl('./ground-item-instancing-fixture.ts'));
  expect(result).toEqual({
    many: { calls: 2, count: 24 }, asleep: { calls: 2, count: 23 }, awake: { calls: 2, count: 24 },
    sameBatch: true, sameTexture: true, position: [-8, 0, -5], removed: { calls: 2, count: 23 }, empty: { calls: 0, count: 0 },
  });
  expect(errors).toEqual([]);
});

test('base turf and woodfloor preserve complete ground sprites at different camera angles', async ({ page }) => {
  await page.goto('/tests/fixture.html');
  const result = await page.evaluate(async (url) => {
    const { checkTurfOcclusion } = await import(url);
    return checkTurfOcclusion();
  }, moduleUrl('./turf-fixture.ts'));
  expect(result).toEqual({ comparisons: 24, failures: [] });
});

test('nightmarefuel lets the background show through its source half-alpha ground animation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/fixture.html');
  const result = await page.evaluate(async url => {
    const { checkNightmareFuelTransparency } = await import(url);
    return checkNightmareFuelTransparency();
  }, moduleUrl('./nightmarefuel-fixture.ts'));
  expect(result.opaqueInterior).toBeGreaterThan(50);
  expect(result.translucentInterior).toBeGreaterThan(result.opaqueInterior * 0.9);
  expect(errors).toEqual([]);
});
