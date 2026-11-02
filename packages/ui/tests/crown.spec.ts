import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('Enlightened Crown floats, orbits, skins and illuminates the ground until removed', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async url => {
    const { checkCrown } = await import(url);
    return checkCrown();
  }, `/@fs${fileURLToPath(new URL('./crown-fixture.ts', import.meta.url))}`);
  const screenshot = testInfo.outputPath('crown-activation.png');
  await page.locator('#crown-gallery').screenshot({ path: screenshot });
  await testInfo.attach('crown-activation.png', { path: screenshot, contentType: 'image/png' });
  expect(errors).toEqual([]);
  expect(result.differentFrames).toBe(true);
  expect(result.bloomChangesPixels).toBe(true);
  expect(result.failures).toEqual([]);
  expect(result.groundLight.lit).toBeGreaterThan(result.groundLight.dark + 100);
  expect(result.groundLight.lit).toBeGreaterThan(result.groundLight.far + 100);
  expect(result.groundLight.moved).toBeGreaterThan(result.groundLight.removed + 100);
  expect(result.groundLight.removed).toBeLessThan(30);
  expect(result.removedLight).toBe(true);
});
