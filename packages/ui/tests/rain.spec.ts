import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('rain emits streaks, splashes and the intensity-driven ambience, then stops cleanly', async ({ page }) => {
  const errors: string[] = [];
  const audioRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text()); });
  page.on('request', (request) => { if (request.url().endsWith('.wav')) audioRequests.push(new URL(request.url()).pathname); });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async (url) => (await import(url)).checkRain(),
    `/@fs${fileURLToPath(new URL('./rain-fixture.ts', import.meta.url))}`);

  expect(result.dry).toEqual({ quads: 0, splashes: 0, sources: 0 });
  // forest_stream heavy / medium / light amb_rain_*_LP loops; each plays once for the whole rain.
  expect(result.ambience.map((sample: { loop: boolean }) => sample.loop)).toEqual([true, true, true]);
  expect(audioRequests.sort()).toEqual(['/dst/data/sound/forest_stream.fsb-74.wav',
    '/dst/data/sound/forest_stream.fsb-75.wav', '/dst/data/sound/forest_stream.fsb-76.wav']);
  // AMB/rain `intensity` envelopes: all layers full at 1, heavy silent and medium partial at 0.2.
  expect(result.heavyGains).toEqual([1, 1, 1]);
  expect(result.lightGains[0]).toBe(0);
  expect(result.lightGains[1]).toBeCloseTo(0.2 / 0.342896, 2);
  expect(result.lightGains[2]).toBe(1);
  // rain.lua: 5 particles and 2 splashes per tick at the heaviest rate, within the 4800 particle cap.
  expect(result.heavy.quads).toBeGreaterThan(150);
  expect(result.heavy.quads).toBeLessThanOrEqual(4800);
  expect(result.heavy.splashes).toBeGreaterThan(5);
  expect(result.stopped).toBe(true);
  // Particles live 2 s and raindrop animations end by themselves once emission stops.
  expect(result.after).toEqual({ quads: 0, splashes: 0 });
  // A restarted rain makes a fresh ambience; disposal removes the art.
  expect(result.restarted).toBe(6);
  expect(result.removed).toBe(true);
  expect(errors).toEqual([]);
});
