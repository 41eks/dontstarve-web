import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 900, height: 600 } });

test('cave cliffs preserve occlusion and transparent blending after face-order reversal and camera rotation', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tests/ground-falloff.html');
  await expect.poll(() => page.evaluate(() => Boolean((window as any).falloffTest))).toBe(true);
  const comparisons = await page.evaluate(() => [135, 315].map(heading => (window as any).falloffTest.compare(heading)));
  for (const result of comparisons) expect(result.orderDifferences).toBeLessThanOrEqual(4);
  expect(comparisons.some(result => result.occlusionDifferences > 100)).toBe(true);
  await page.evaluate(() => { (window as any).falloffTest.preview(); });
  await page.screenshot({ path: testInfo.outputPath('cave-falloff-depth.png') });
  expect(errors).toEqual([]);
});
