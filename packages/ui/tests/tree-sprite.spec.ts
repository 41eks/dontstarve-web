import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('shared tree idle frames match independent WebGL rendering with tint, work and bloom builds', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async url => (await import(url)).checkTreeSpriteRendering(),
    `/@fs${fileURLToPath(new URL('./tree-sprite-fixture.ts', import.meta.url))}`);
  expect(result.paintedPixels).toBeGreaterThan(100);
  expect(result.differences).toEqual([0, 0, 0]);
  expect(errors).toEqual([]);
});
