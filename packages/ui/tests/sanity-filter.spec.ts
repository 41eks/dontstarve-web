
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('source vig animation draws red screen edges, follows sanity state and releases its overlay', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async url => (await import(url)).checkSanityVignette(),
    `/@fs${fileURLToPath(new URL('./sanity-vignette-fixture.ts', import.meta.url))}`);
  expect(result.edgeRedPixels).toBeGreaterThan(1000);
  expect(result.centreAlpha).toBe(0);
  expect(result.initialFrame).toBe('0');
  expect(result.advancedFrame).toBe('1');
  expect(result.animated).toBe(true);
  expect(result.paused).toBe(true);
  expect(result.stillInsane).toBe('insane');
  expect(result.restored).toBe(true);
  expect(result.restoredAnimation).toBe('basic');
  expect(result.blocksInput).toBe(false);
  expect(result.disposed).toBe(true);
  expect(errors).toEqual([]);
});

test('insanity LUTs use discrete grading levels, fade across phases and distort only screen edges', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async (url) => {
    const { checkSanityFilter } = await import(url);
    return checkSanityFilter();
  }, `/@fs${fileURLToPath(new URL('./sanity-filter-fixture.ts', import.meta.url))}`);
  expect(result.initialPercent).toBe(35 / 200);
  for (const phase of result.phases) {
    expect(phase.restored).toEqual(phase.normal);
    phase.insane.forEach((v, c) => expect(Math.abs(v - phase.expected[c])).toBeLessThanOrEqual(2));
    phase.halfSanity.forEach((v, c) => {
      const expected = phase.normal[c] * 0.75 + phase.insane[c] * 0.25;
      expect(Math.abs(v - expected)).toBeLessThanOrEqual(2);
    });
    expect(phase.insane).not.toEqual(phase.normal);
    for (const [index, strength] of [0.81, 0.64, 0.64, 0.64, 0.49, 0].entries()) {
      const level = phase.levels[index];
      expect(level.actualPercent).toBe(level.percent);
      level.colour.forEach((v, c) => {
        const expected = phase.normal[c] * (1 - strength) + phase.insane[c] * strength;
        expect(Math.abs(v - expected)).toBeLessThanOrEqual(2);
      });
    }
    expect(phase.levels[1].colour).toEqual(phase.levels[2].colour);
    expect(phase.levels[2].colour).toEqual(phase.levels[3].colour);
    expect(phase.levels[0].colour).not.toEqual(phase.levels[1].colour);
    expect(phase.levels[3].colour).not.toEqual(phase.levels[4].colour);
  }
  expect(result.dusk).not.toEqual(result.night);
  result.halfway.forEach((v, c) => expect(Math.abs(v - (result.dusk[c] + result.night[c]) / 2)).toBeLessThanOrEqual(2));
  expect(result.centreChanges).toBe(0);
  expect(result.edgeChanges).toBeGreaterThan(100);
  expect(result.saneChanges).toBe(false);
  expect(result.maxBoundaryError).toBeLessThanOrEqual(1);
  expect(result.subscriptionReleased).toBe(true);
  expect(errors).toEqual([]);
});
