import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('flower frames stay at their foot point, reuse batches across appearances and recover their GPU atlas after context loss', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async url => (await import(url)).checkFlowerAtlasLifecycle(),
    `/@fs${fileURLToPath(new URL('./atlas-lifecycle-fixture.ts', import.meta.url))}`);
  for (const sample of [...result.samples, result.off, result.beforeRestore, result.afterRestore]) {
    expect(sample.painted).toBeGreaterThan(100);
    expect(sample.centroid).toBeGreaterThan(150);
    expect(sample.centroid).toBeLessThan(200);
    expect(sample.error).toBeLessThan(12);
  }
  expect(result.positions).toEqual(Array(5).fill([3, 0, 0]));
  expect(result.reusedForOff).toBe(true); expect(result.reusedForIdle).toBe(true);
  expect(result.rebuiltTexture).toBe(true); expect(result.identityPreserved).toBe(true);
  expect(result.afterRestore).toEqual(result.beforeRestore);
  expect(result.spareDetached).toBe(true); expect(result.reusedAfterShow).toBe(true);
  expect(result.afterShow).toEqual(result.afterRestore);
  expect(errors).toEqual([]);
});
