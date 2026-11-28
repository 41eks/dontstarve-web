import { expect, test } from '@playwright/test';

test('shared tree idle frames match independent WebGL rendering with tint, work and bloom builds', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  await page.goto('/tests/browser/dst-lighting.html');
  const result = await page.evaluate(
    async url => (await import(url)).checkTreeSpriteRendering(),
    '/tests/browser/tree-sprite-fixture.ts',
  );
  expect(result.paintedPixels).toBeGreaterThan(100);
  expect(result.differences).toEqual([0, 0, 0]);
  expect(errors).toEqual([]);
});

test('birch leaves match source layers without repeating absent symbol frames', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/browser/dst-lighting.html');
  const result = await page.evaluate(
    async url => (await import(url)).checkBirchLeafRendering(),
    '/tests/browser/tree-sprite-fixture.ts',
  );
  expect(result.expectedParts).toBe(13);
  expect(result.drawnParts).toBe(result.expectedParts);
  expect(result.meanError).toBeLessThan(1);
  expect(errors).toEqual([]);
});

test('an evergreen sway loop too large to compose is drawn from its part table like the ordinary sprite', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  await page.goto('/tests/browser/dst-lighting.html');
  const result = await page.evaluate(
    async url => (await import(url)).checkEvergreenPartRendering(),
    '/tests/browser/tree-sprite-fixture.ts',
  );
  expect(result.paintedPixels).toBeGreaterThan(1000);
  expect(result.partInstances).toHaveLength(1);
  expect(result.partInstances[0]).toBeGreaterThan(1);
  for (const meanError of result.meanErrors) {
    expect(meanError).toBeLessThan(1);
  }
  expect(errors).toEqual([]);
});
