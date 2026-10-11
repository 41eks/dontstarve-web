import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const moduleUrl = (path: string) => `/@fs${fileURLToPath(new URL(path, import.meta.url))}`;

test('base turf and woodfloor preserve complete ground sprites at different camera angles', async ({ page }) => {
  await page.goto('/tests/fixture.html');
  const result = await page.evaluate(async (url) => {
    const { checkTurfOcclusion } = await import(url);
    return checkTurfOcclusion();
  }, moduleUrl('./turf-fixture.ts'));
  expect(result).toEqual({ comparisons: 24, failures: [] });
});

test('common ground items drop and pick up with native geometry and preserve saved feet', async ({ page }) => {
  await page.goto('/tests/fixture.html');
  const result = await page.evaluate(async (url) => {
    const { checkGroundItemPickup } = await import(url);
    return checkGroundItemPickup();
  }, moduleUrl('./ground-item-pickup-fixture.ts'));
  expect(result).toEqual({ failures: [],
    pickedUp: ['torch', 'meatballs', 'log', 'wall_stone_item', 'hammer'],
    blockedDistantPickups: 5, failedLoad: true, inventoryMutations: 0, failedTransfer: false, remaining: 0, restoredFoot: [2, 0.25, 3],
  });
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
