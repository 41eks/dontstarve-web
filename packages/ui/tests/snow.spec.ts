import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('snow renders with winter lighting, drains after stopping and releases its GPU resources', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async url => (await import(url)).checkSnow(),
    `/@fs${fileURLToPath(new URL('./snow-fixture.ts', import.meta.url))}`);
  expect(result.prefilled).toBeGreaterThan(300);
  expect(result.prefilled).toBeLessThanOrEqual(4800);
  // Verify actual rendered pixels as well as size and mostly vertical motion at two camera headings.
  expect(result.changedPixels).toBeGreaterThan(20);
  expect(result.coveredPixels).toBeGreaterThan(100);
  expect(result.multicolorPixels).toBe(0);
  expect(result.eligible).toBeGreaterThan(0);
  expect(result.eligible).toBeLessThan(result.prefilled);
  expect(result.softEdgePixels).toBeGreaterThan(20);
  expect(result.softCentrePixels).toBe(0);
  expect(result.foregroundSnowPixels).toBeGreaterThan(20);
  expect(result.pausePreserved).toBe(true);
  expect(result.stopped).toEqual({ quads: 0, cover: 0.24, groundVisible: true });
  expect(result.melted).toBe(true);
  expect(result.released.sort()).toEqual(['ground', 'groundMaterial', 'groundTexture', 'material', 'particles', 'texture']);
  expect(result.removed).toBe(true);
  expect(result.pendingRemoved).toBe(true);
  for (const motion of result.motion) {
    expect(motion.count).toBeGreaterThan(0);
    expect(motion.minimumWidth).toBeGreaterThan(2);
    expect(motion.minimumSize).toBeGreaterThanOrEqual(0.9999);
    expect(motion.maximumSize).toBeLessThanOrEqual(2.0001);
    expect(motion.maximumSize - motion.minimumSize).toBeGreaterThan(0.5);
    expect(motion.sizeStable).toBe(true);
    expect(motion.falling).toBe(true);
    expect(motion.driftRatio).toBeLessThan(0.25);
  }
  expect(errors).toEqual([]);
});
