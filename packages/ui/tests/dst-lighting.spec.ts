import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('spring night lights ground and late instanced sprites only around the equipped torch', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async (url) => {
    const { checkDstLocalLighting } = await import(url);
    return checkDstLocalLighting();
  }, `/@fs${fileURLToPath(new URL('./dst-lighting-fixture.ts', import.meta.url))}`);
  const brightness = (rgb: number[]) => rgb.reduce((sum, value) => sum + value, 0);
  expect(result.night).toMatchObject({ season: 'spring', phase: 'night' });
  expect(brightness(result.night.centre)).toBeLessThan(30);
  expect(brightness(result.torch.centre)).toBeGreaterThan(150);
  expect(brightness(result.torch.middle)).toBeGreaterThan(brightness(result.torch.far) + 50);
  expect(brightness(result.torch.centre)).toBeGreaterThan(brightness(result.torch.middle) + 50);
  expect(brightness(result.instances.near)).toBeGreaterThan(brightness(result.instances.far) + 100);
  expect(brightness(result.moved.current)).toBeGreaterThan(brightness(result.moved.previous) + 100);
  expect(result.removed.centre).toEqual(result.night.centre);
  expect(result.removed.instance).toEqual(result.night.centre);
  expect(brightness(result.day.far)).toBeGreaterThan(500);
  expect(Math.abs(brightness(result.day.near) - brightness(result.day.far))).toBeLessThan(5);
  expect(result.restoredBackground).toBe(true);
  expect(errors).toEqual([]);
});
