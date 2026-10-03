import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('lightbulb uses source ground art and only lights the world while dropped', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async (url) => {
    const { checkLightbulbLighting } = await import(url);
    return checkLightbulbLighting();
  }, `/@fs${fileURLToPath(new URL('./lightbulb-fixture.ts', import.meta.url))}`);
  expect(result.parameters).toMatchObject({ radius: 1.5, intensity: 0.5, falloff: 0.7 });
  expect(result.source).toMatchObject({ animationArchive: 'bulb.zip', buildArchives: ['bulb.zip'],
    bank: 'bulb', animation: 'idle', icon: 'lightbulb.tex' });
  expect(result.glowing.near).toBeGreaterThan(result.baseline + 100);
  expect(result.glowing.far).toBe(result.baseline);
  expect(result.disabled).toBe(result.baseline);
  expect(result.reenabled).toBe(result.glowing.near);
  expect(result.disposed).toBe(result.baseline);
  expect(result.failedDrop).toBe(false);
  expect(result.failedDropBrightness).toBe(result.baseline);
  expect(result.dropped).toBeGreaterThan(result.baseline + 100);
  expect(result.failedPickupCount).toBe(1);
  expect(result.failedPickupBrightness).toBe(result.dropped);
  expect(result.saved.transform.position).toEqual([5, 0, 0]);
  expect(result.saved.components.stack).toEqual({ itemId: 'lightbulb', count: 1 });
  expect(result.pickedUp).toEqual({ count: 0, brightness: result.baseline });
  expect(result.restoredLit).toBe(true);
  expect(result.restoredBrightness).toBeGreaterThan(result.baseline + 100);
  expect(errors).toEqual([]);
});
