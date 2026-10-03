import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('application lighting starts in the saved elapsed-time phase without a startup fade', async ({ page }) => {
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async (urls) => {
    const [{ dstLighting, scene }, { initialSave }, { getDstCycle }] = await Promise.all([
      import(urls.universal), import(urls.save), import(urls.tuning),
    ]);
    return {
      phase: dstLighting.getPhase(),
      expectedPhase: getDstCycle(initialSave.world.elapsedSeconds).phase,
      season: dstLighting.getSeason(),
      expectedSeason: initialSave.world.systems.season?.name ?? 'spring',
      lightLevel: dstLighting.sampleLightLevel(scene.position),
    };
  }, {
    universal: `/@fs${fileURLToPath(new URL('../../../src/universal.ts', import.meta.url))}`,
    save: `/@fs${fileURLToPath(new URL('../../../src/save/initialSave.ts', import.meta.url))}`,
    tuning: `/@fs${fileURLToPath(new URL('../../../src/tuning.ts', import.meta.url))}`,
  });
  expect(result.phase).toBe(result.expectedPhase);
  expect(result.season).toBe(result.expectedSeason);
  if (result.phase === 'night') expect(result.lightLevel).toBe(0);
  else expect(result.lightLevel).toBeGreaterThan(0);
});

test('spring night lights ground and late instanced sprites only around the equipped torch', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async (url) => {
    const { checkDstLocalLighting } = await import(url);
    return checkDstLocalLighting();
  }, `/@fs${fileURLToPath(new URL('./dst-lighting-fixture.ts', import.meta.url))}`);
  const brightness = (rgb: number[]) => rgb.reduce((sum, value) => sum + value, 0);
  expect(result.night).toMatchObject({ season: 'spring', phase: 'night' });
  expect(brightness(result.night.centre)).toBeLessThan(30);
  expect(brightness(result.torch.centre)).toBeGreaterThan(150);
  expect(brightness(result.torch.middle)).toBeGreaterThan(brightness(result.torch.far) + 50);
  expect(brightness(result.torch.centre)).toBeGreaterThan(brightness(result.torch.middle) + 50);
  expect(brightness(result.instances.near)).toBeGreaterThan(brightness(result.instances.far) + 100);
  expect(brightness(result.moved.current)).toBeGreaterThan(brightness(result.moved.previous) + 100);
  expect(result.removed.centre).toEqual(result.night.centre);
  expect(result.removed.instance).toEqual(result.night.centre);
  expect(brightness(result.day.far)).toBeGreaterThan(500);
  expect(Math.abs(brightness(result.day.near) - brightness(result.day.far))).toBeLessThan(5);
  const [dusk, cycleNight, nextDay] = result.cycleFrames;
  expect(dusk).toMatchObject({ cycles: 0, phase: 'dusk', phaseProgress: 0 });
  expect(cycleNight).toMatchObject({ cycles: 0, phase: 'night', phaseProgress: 0 });
  expect(nextDay).toMatchObject({ cycles: 1, phase: 'day', phaseProgress: 0 });
  expect(brightness(dusk.colour)).toBeLessThan(brightness(result.day.far));
  expect(brightness(dusk.halfway)).toBeGreaterThan(brightness(dusk.colour));
  expect(brightness(cycleNight.colour)).toBeLessThan(30);
  expect(brightness(cycleNight.halfway)).toBeGreaterThan(brightness(cycleNight.colour));
  expect(nextDay.colour).toEqual(result.day.far);
  expect(brightness(nextDay.halfway)).toBeLessThan(brightness(nextDay.colour));
  expect(result.restoredBackground).toBe(true);
  expect(errors).toEqual([]);
});
