import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('hammer and both pickaxes play source sounds once at the hit frame and respect cancellation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text()); });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async (url) => (await import(url)).checkToolSounds(),
    `/@fs${fileURLToPath(new URL('./tool-sound-fixture.ts', import.meta.url))}`);
  expect(result.cancellations).toEqual([true, true, true, true, true, true]);
  expect(result.cases).toHaveLength(4);
  for (const entry of result.cases) expect(entry).toMatchObject({ started: true, ignoresBusy: true,
    silentBeforeHit: true, soundAtHit: true, playsOnce: true, loop: false, channels: 1 });
  // Both equal-weight hammer variants and the shared normal/golden pickaxe sample.
  const durations = [16956 / 44100, 15933 / 44100, 34346 / 44100, 34346 / 44100];
  for (let i = 0; i < durations.length; i++) expect(result.cases[i].duration).toBeCloseTo(durations[i], 3);
  await page.mouse.click(5, 5);
  const audioState = (dispose = false) => page.evaluate((value) =>
    (window as unknown as { toolAudio: (dispose: boolean) => string }).toolAudio(value), dispose);
  await expect.poll(() => audioState()).toBe('running');
  await audioState(true);
  await expect.poll(() => audioState()).toBe('closed');
  expect(errors).toEqual([]);
});

test('gathering whooshes follow hand animation cycles and stop on cancellation', async ({ page }) => {
  await page.goto('/tests/fixture.html');
  const result = await page.evaluate(async url => (await import(url)).checkGatheringSounds(),
    `/@fs${fileURLToPath(new URL('./tool-sound-fixture.ts', import.meta.url))}`);
  expect(result.normal.committed).toBe(1);
  expect(result.normal.phases.length).toBeGreaterThan(0);
  expect(result.normal.phases.length).toBeLessThanOrEqual(3);
  expect(result.normal.phases.every(phase => phase === 'build_loop')).toBe(true);
  expect(result.normal.layers).toBe(result.normal.phases.length * 2);
  expect(result.normal.loops.every(loop => !loop)).toBe(true);
  expect(result).toMatchObject({ cancelStops: true, noSoundsAfterCancel: true, cancelPreservesProduct: true });
});
