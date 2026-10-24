import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { getDstClock, getDstCycle, TUNING } from '../../../src/tuning';
import type { DstStatusHudElement } from '../src/status-hud';

async function setTime(page: Page, elapsedSeconds: number, dt = 0) {
  await page.evaluate(async ({ state, timeinphase, dt, signalsUrl }) => {
    const hud = document.querySelector('dst-status-hud') as DstStatusHudElement;
    hud.advanceClockAnimation(dt);
    const { clockstate, moonphasestate, batch } = await import(signalsUrl);
    const { moonPhase, ...clock } = state;
    batch(() => {
      clockstate.set({ ...clock, timeinphase });
      moonphasestate.set(moonPhase);
    });
    await Promise.resolve();
  }, { state: getDstClock(elapsedSeconds), timeinphase: getDstCycle(elapsedSeconds).phaseProgress, dt,
    signalsUrl: `/@fs${fileURLToPath(new URL('../../signals/src/index.ts', import.meta.url))}` });
}

test('follows world time, daytime segment pulses and source phase transitions', async ({ page }, testInfo) => {
  const assetRequests: string[] = [];
  page.on('request', (request) => {
    if (/clock_transitions|moon_phases/.test(request.url())) assetRequests.push(new URL(request.url()).pathname);
  });
  await page.goto('/tests/fixture.html');
  const clock = page.locator('dst-status-hud .world-clock__animation');
  await expect(clock).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
  expect(assetRequests).toEqual(expect.arrayContaining([
    '/dst/data/anim/clock_transitions.zip', '/dst/data/anim/moon_phases_clock.zip', '/dst/data/anim/moon_phases.zip',
  ]));
  expect(await clock.evaluate((canvas: HTMLCanvasElement) =>
    canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0),
  )).toBe(true);

  await setTime(page, 10, 10);
  await expect(clock).toHaveAttribute('data-animation', 'idle_day');
  await expect(clock).toHaveAttribute('data-rotation', '7.50');
  await page.locator('dst-status-hud .survival-hud').screenshot({ path: testInfo.outputPath('day-hud.png') });
  await setTime(page, TUNING.SEG_TIME, 20);
  await expect(clock).toHaveAttribute('data-animation', 'pulse_day');
  await expect(clock).toHaveAttribute('data-rotation', '22.50');
  await setTime(page, 32, 2);
  await expect(clock).toHaveAttribute('data-animation', 'idle_day');

  await setTime(page, TUNING.DAY_TIME_DEFAULT);
  await expect(clock).toHaveAttribute('data-animation', 'trans_day_dusk');
  await expect(clock).toHaveAttribute('data-rotation', '225.00');
  const decorativeFrames = await clock.evaluate((canvas: HTMLCanvasElement) => {
    const hud = document.querySelector('dst-status-hud') as DstStatusHudElement;
    const observer = new MutationObserver(() => {});
    observer.observe(canvas, { attributes: true, attributeFilter: ['data-rotation', 'data-day', 'data-phase'] });
    const frames = [canvas.toDataURL()];
    for (let frame = 0; frame < 8; frame++) {
      hud.advanceClockAnimation(1 / 60);
      frames.push(canvas.toDataURL());
    }
    const progressWrites = observer.takeRecords().length;
    observer.disconnect();
    return { distinctFrames: new Set(frames).size, progressWrites };
  });
  expect(decorativeFrames.distinctFrames).toBeGreaterThan(1);
  expect(decorativeFrames.progressWrites).toBe(0);
  await expect(clock).toHaveAttribute('data-rotation', '225.00');
  // Pausing during a transition must freeze both its pixels and settled clock progress.
  const pausedTransition = await clock.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.waitForTimeout(100);
  expect(await clock.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(pausedTransition);
  await setTime(page, 302, 2);
  await expect(clock).toHaveAttribute('data-animation', 'idle_dusk');
  await setTime(page, TUNING.DAY_TIME_DEFAULT + TUNING.DUSK_TIME_DEFAULT);
  await expect(clock).toHaveAttribute('data-animation', 'trans_dusk_night');
  await expect(clock).toHaveAttribute('data-rotation', '315.00');
  await expect(clock).toHaveAttribute('data-moon-symbol', 'moon_new');
  await setTime(page, 422, 2);
  await expect(clock).toHaveAttribute('data-animation', 'idle_night');
  await page.locator('dst-status-hud .survival-hud').screenshot({ path: testInfo.outputPath('night-hud.png') });

  // No wall-clock timer advances simulation state or animation while paused.
  const pausedFrame = await clock.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.waitForTimeout(100);
  expect(await clock.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(pausedFrame);

  await setTime(page, TUNING.TOTAL_DAY_TIME);
  await expect(clock).toHaveAttribute('data-animation', 'trans_night_day');
  await expect(clock).toHaveAttribute('data-day', '2');
  await expect(clock).toHaveAttribute('data-rotation', '0.00');
  await expect(page.locator('dst-status-hud .world-clock')).toHaveAttribute('aria-label', '世界第 2 日，白天');
});

test('uses the source 20-day moon cycle and preserves time after reconnecting', async ({ page }) => {
  await page.goto('/tests/fixture.html');
  const clock = page.locator('dst-status-hud .world-clock__animation');
  await expect(clock).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
  await setTime(page, 10 * TUNING.TOTAL_DAY_TIME + 422, 2);
  await expect(clock).toHaveAttribute('data-day', '11');
  await expect(clock).toHaveAttribute('data-moon-symbol', 'moon_full');
  await setTime(page, 17 * TUNING.TOTAL_DAY_TIME + 422, 2);
  await expect(clock).toHaveAttribute('data-moon-symbol', 'moon_quarter');
  await setTime(page, 21 * TUNING.TOTAL_DAY_TIME + 422, 2);
  await expect(clock).toHaveAttribute('data-moon-symbol', 'moon_quarter_wax');
  await page.evaluate(() => {
    const hud = document.querySelector('dst-status-hud')!;
    hud.remove();
    document.body.append(hud);
  });
  await expect(clock).toHaveAttribute('data-state', 'ready');
  await expect(clock).toHaveAttribute('data-day', '22');
  await expect(clock).toHaveAttribute('data-animation', 'idle_night');
  await expect(clock).toHaveAttribute('data-moon-symbol', 'moon_quarter_wax');
});
