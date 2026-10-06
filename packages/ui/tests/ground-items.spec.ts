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
