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

test('instanced idle frames are assembled from source parts and switch to ordinary work rendering', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async url => (await import(url)).checkTreeSpriteRendering(true),
    `/@fs${fileURLToPath(new URL('./tree-sprite-fixture.ts', import.meta.url))}`);
  expect(result.paintedPixels).toBeGreaterThan(100);
  // Precomposition adds one resampling step; compare the actual images with a small per-channel tolerance.
  expect(result.meanErrors.every((error: number) => error < 2)).toBe(true);
  expect(result.drawCalls[0]).toBe(4);
  expect(result.drawCalls[1]).toBe(result.drawCalls[0] - 1);
  expect(result.drawCalls[2]).toBe(result.drawCalls[0]);
  expect(result.drawCalls[3]).toBe(0);
  result.occlusion[0].forEach((value: number, channel: number) =>
    expect(result.occlusion[1][channel]).toBeCloseTo(value, 0));
  expect(result.occlusion[2]).toEqual(result.occlusion[1]);
  expect(result.occlusion[3]).toEqual([255, 0, 0]);
  expect(result.stabilityDifferences).toEqual([0, 0, 0, 0]);
  expect(errors).toEqual([]);
});
