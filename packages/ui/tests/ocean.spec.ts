import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('ocean renders moving water and phase colours while snow follows terrain coast masks', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async url => (await import(url)).checkOceanRendering(),
    `/@fs${fileURLToPath(new URL('./ocean-fixture.ts', import.meta.url))}`);
  expect(result.landAfter).toEqual(result.landBefore);
  expect(result.oceanAfter).not.toEqual(result.oceanBefore);
  expect(result.oceanMoved).not.toEqual(result.oceanAfter);
  expect(result.oceanDusk).not.toEqual(result.oceanMoved);
  expect(result.oceanDusk.slice(0, 3).reduce((sum: number, value: number) => sum + value, 0))
    .toBeLessThan(result.oceanMoved.slice(0, 3).reduce((sum: number, value: number) => sum + value, 0));
  expect(result.oceanSnow).toEqual(result.oceanDusk);
  expect(result.snowyLand).not.toEqual(result.landAfter);
  expect(result.coastalSnowPixels).toBeGreaterThan(100);
  expect(result.coastUpdated).toBe(true);
  expect(result.previousGeometryReleased).toBe(1);
  expect(result.atlasesPreserved).toBe(true);
  expect(result.terrainReleasedAtlases).toBe(true);
  expect(result.matrixUpdatesPerRender).toEqual([1, 1, 1, 1, 1]);
  expect(errors).toEqual([]);
  await page.locator('canvas').screenshot({ path: testInfo.outputPath('coastal-snow.png') });
});

test('ocean GPU passes preserve source blur, RGBA phase blend, light encoding and renderer resources', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async url => (await import(url)).checkOceanPipeline(),
    `/@fs${fileURLToPath(new URL('./ocean-pipeline-fixture.ts', import.meta.url))}`);
  const attenuation = 0.98 ** 6; // source nine-tap sum, three horizontal/vertical rounds
  for (const [actual, source] of [[result.dayFar, [25, 123, 167, 100]],
    [result.duskFar, [10, 120, 125, 120]], [result.primaryFar, [220, 255, 255, 28]]] as const) {
    source.forEach((value, channel) => expect(actual[channel]).toBeCloseTo(value / 255 * attenuation, 2));
  }
  result.blendFar.forEach((value: number, channel: number) =>
    expect(value).toBeCloseTo(result.dayFar[channel] * 0.75 + result.duskFar[channel] * 0.25, 3));
  expect(result.landBoundary[3]).toBeGreaterThan(0);
  expect(result.seaBoundary[3]).toBeLessThan(result.dayFar[3]);
  expect(result.landBoundary[3] + result.seaBoundary[3]).toBeCloseTo(result.dayFar[3], 2);
  const noise = Math.sin(3 * (128 / 255) ** 2) * 0.5 + 0.5;
  [64 / 255, 128 / 255, 1].forEach((light, channel) => {
    const colour = result.blendFar[channel] * (1 - noise * result.primaryFar[3])
      + result.primaryFar[channel] * noise * result.primaryFar[3];
    expect(result.encoded[channel]).toBeCloseTo(colour * light * 2, 2);
  });
  expect(result.encoded[2]).toBeGreaterThan(1);
  expect(result.encoded[3]).toBeCloseTo(result.blendFar[3] + result.primaryFar[3] * noise, 2);
  result.expectedResolved.forEach((value: number, channel: number) => expect(result.resolved[channel]).toBeCloseTo(value, 2));
  expect(result.resolved[3]).toBe(1);
  expect(result.initialSize).toEqual([240, 160]);
  expect(result.resized).toEqual([96, 64]);
  expect(result.statePreserved).toBe(true);
  expect(result.floorTriangles).toBe(2);
  expect(result.floorBounds).toEqual([[-96, 0, -192], [96, 0, 192]]);
  expect(result.targetsDisposed).toBe(7);
  expect(result.borrowedNoiseDisposed).toBe(false);
  expect(result.removedPass).toBe(true);
  expect(errors).toEqual([]);
});
