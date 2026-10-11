import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test('dwarf stars decode the source WAVs and stop independent loops on removal', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text()); });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async (url) => {
    const { prepareStarAudioCheck } = await import(url);
    return prepareStarAudioCheck() as Promise<{
      samples: { loop: boolean; length: number; channels: number; sampleRate: number }[];
      casting: { beforeSoundFrame: number; onSoundFrame: number; afterCastSources: number; casts: number;
        cancelledBeforeSound: boolean; duration: number; loop: boolean };
    }>;
  }, `/@fs${fileURLToPath(new URL('./stafflight-sound-fixture.ts', import.meta.url))}`);
  const { samples, casting } = result;
  expect(casting).toMatchObject({ beforeSoundFrame: 5, onSoundFrame: 6, afterCastSources: 6, casts: 1,
    cancelledBeforeSound: true, loop: false });
  expect(casting.duration).toBeCloseTo(129478 / 44100, 3);
  expect(samples.map(({ loop }) => loop)).toEqual([false, true, false, true, true]);
  // decodeAudioData resamples to the browser's device sample rate.
  expect(samples[0].length / samples[0].sampleRate).toBeCloseTo(61917 / 44100, 3);
  expect(samples[1].length / samples[1].sampleRate).toBeCloseTo(50275 / 44100, 3);
  expect(samples.every(({ channels }) => channels === 1)).toBe(true);
  await page.mouse.click(5, 5);
  const check = (action: string) => page.evaluate((value) =>
    (window as unknown as { checkStarAudio: (action: string) => { state: string; restoredRemoved: boolean; stops: number[] } })
      .checkStarAudio(value), action);
  await expect.poll(async () => (await check('inspect')).state).toBe('running');
  expect(await check('expire')).toMatchObject({ restoredRemoved: true, stops: [0, 0, 0, 0, 1, 0] });
  const disposed = await check('dispose');
  expect(disposed.stops[1]).toBe(1);
  expect(disposed.stops[3]).toBe(1);
  expect(disposed.stops[4]).toBe(1);
  await expect.poll(async () => (await check('inspect')).state).toBe('closed');
  expect(errors).toEqual([]);
});
