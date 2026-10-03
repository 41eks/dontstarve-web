import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('lantern worn symbols, ground poses and multiple lights survive drop, pickup and restore', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async (url) => {
    const { checkLanternLighting } = await import(url);
    return checkLanternLighting();
  }, `/@fs${fileURLToPath(new URL('./lantern-fixture.ts', import.meta.url))}`);
  expect(result.failures).toEqual([]);
  expect(result.skins).toBe(12);
  expect(result.hand.lit).toBe(true);
  expect(result.hand.brightness).toBeGreaterThan(result.baseline + 100);
  expect(result.emptyHand).toBe(true);
  expect(result.backpack.unlit).toBe(true);
  expect(result.backpack.brightness).toBe(result.baseline);
  expect(result.staleEquip).toBe(true);
  expect(result.failedDrop).toBe(false);
  expect(result.twoLights.left).toBeGreaterThan(result.baseline + 100);
  expect(result.twoLights.right).toBeGreaterThan(result.baseline + 100);
  expect(result.twoLights.far).toBe(result.baseline);
  expect(result.failedPickupCount).toBe(2);
  expect(result.pickedUp.count).toBe(1);
  expect(result.pickedUp.left).toBe(result.baseline);
  expect(result.pickedUp.right).toBeGreaterThan(result.baseline + 100);
  expect(result.save).toMatchObject({ itemId: 'lantern', foot: [30, 0, 0], restoredLit: true });
  expect(result.save.restoredBrightness).toBeGreaterThan(result.baseline + 100);
  expect(errors).toEqual([]);
});
