import { expect, test } from '@playwright/test';

test('a failed colour-cube load rejects startup without publishing lighting readiness', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route('**/images/colour_cubes/insane_day_cc.tex', route => route.fulfill({ status: 503, body: '' }));
  await page.goto('/tests/browser/dst-lighting.html');
  const result = await page.evaluate(
    async urls => {
      let readyCount = 0;
      window.addEventListener('game:lighting-ready', () => readyCount++);
      let failure = '';
      try {
        await import(urls.main);
      } catch (error) {
        failure = String(error);
      }
      const { dstLighting } = await import(urls.universal);
      return { readyCount, hasLighting: dstLighting !== undefined, failure };
    },
    {
      main: '/src/main.ts',
      universal: '/src/universal.ts',
    },
  );
  expect(result.readyCount).toBe(0);
  expect(result.hasLighting).toBe(false);
  expect(result.failure).toContain('insane_day_cc.tex: HTTP 503');
});

test('application lighting starts in the saved elapsed-time phase without a startup fade', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/tests/browser/dst-lighting.html');
  const result = await page.evaluate(
    async urls => {
      const { scene } = await import(urls.universal);
      let readyCount = 0;
      let publishedLighting: unknown;
      let initialLightLevel: number | undefined;
      window.addEventListener('game:lighting-ready', event => {
        readyCount++;
        publishedLighting = event.detail;
        // Measure initial ambient before saved local-light entities enter the scene.
        initialLightLevel = event.detail.sampleLightLevel(scene.position);
      });
      await import(urls.main);
      const [{ dstLighting }, { initialSave }, { getDstClock }] = await Promise.all([
        import(urls.universal),
        import(urls.save),
        import(urls.tuning),
      ]);
      const clock = getDstClock(initialSave.world.elapsedSeconds);
      return {
        readyCount,
        publishedSharedInstance: publishedLighting === dstLighting,
        phase: dstLighting.getPhase(),
        expectedPhase: clock.phase === 'night' && clock.moonPhase === 'full' ? 'full_moon' : clock.phase,
        season: dstLighting.getSeason(),
        expectedSeason:
          initialSave.world.systems.worldtemperature?.season ?? initialSave.world.systems.season?.name ?? 'spring',
        lightLevel: initialLightLevel,
      };
    },
    {
      main: '/src/main.ts',
      universal: '/src/universal.ts',
      save: '/src/save/initialSave.ts',
      tuning: '/src/tuning.ts',
    },
  );
  expect(result.phase).toBe(result.expectedPhase);
  expect(result.readyCount).toBe(1);
  expect(result.publishedSharedInstance).toBe(true);
  expect(result.season).toBe(result.expectedSeason);
  if (result.phase === 'night') {
    expect(result.lightLevel).toBe(0);
  } else {
    expect(result.lightLevel).toBeGreaterThan(0);
  }
});

test('spring night lights ground and late instanced sprites only around the equipped torch', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  await page.goto('/tests/browser/dst-lighting.html');
  const result = await page.evaluate(async url => {
    const { checkDstLocalLighting } = await import(url);
    return checkDstLocalLighting();
  }, '/tests/browser/dst-lighting-fixture.ts');
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
