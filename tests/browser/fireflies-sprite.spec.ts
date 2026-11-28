import { expect, test } from '@playwright/test';

test('fireflies batch their loops, retain self-light and release instances on sleep and removal', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  await page.goto('/tests/browser/dst-lighting.html');
  const result = await page.evaluate(
    async url => (await import(url)).checkFirefliesInstances(),
    '/tests/browser/fireflies-sprite-fixture.ts',
  );
  expect(result.bright[0]).toBeGreaterThan(10);
  expect(result.bright[1]).toBe(0);
  expect(result.hiddenSourceCount).toBe(32);
  expect(result.mouseTargeting).toEqual([false, true, false]);
  expect(result.registrations).toEqual([0, 32, 0, 32, 0, 0, 32, 0, 0]);
  expect(result.preVisible).toBe(true);
  expect(result.loopVisible).toBe(false);
  expect(result.calls).toEqual([1, 0, 1, 2, 1, 0, 0, 1, 0]);
  expect(result.daylight).toEqual([0, 1, 0]);
  expect(result.retainedOffscreen).toBe(true);
  expect(result.unloaded).toBe(true);
  expect(result.cancelled).toBe(true);
  expect(errors).toEqual([]);
});
