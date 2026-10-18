import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('rocks batch their source poses and split-build art while retaining alpha picking', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async url => (await import(url)).checkRockInstances(),
    `/@fs${fileURLToPath(new URL('./rock-sprite-fixture.ts', import.meta.url))}`);
  expect(result.calls).toEqual([2, 4, 2, 4, 0]);
  expect(result.hiddenSources).toBe(32);
  expect(result.alphaPickable).toBe(true);
  expect(result.painted).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('a broken shell erodes independently inside a shared batch and disappears on game time', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async url => (await import(url)).checkMoonShellErosion(),
    `/@fs${fileURLToPath(new URL('./rock-sprite-fixture.ts', import.meta.url))}`);
  expect(errors).toEqual([]);
  expect(result.intact[0], JSON.stringify(result)).toBeGreaterThan(100);
  expect(result.half[0]).toBeGreaterThan(0);
  expect(result.half[0]).toBeLessThan(result.intact[0] * .8);
  expect(result.half[1]).toBe(result.intact[1]);
  expect(result.removed).toEqual([0, 0]);
  expect(errors).toEqual([]);
});
