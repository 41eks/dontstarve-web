import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

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

test('game restores saved sanity and synchronizes debug commands, HUD and manual saves', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/saves/initial-world.json', async (route) => {
    const response = await route.fetch();
    const save = await response.json();
    save.players.local.stats = { health: 140, hunger: 90, sanity: 120 };
    await route.fulfill({ response, json: save });
  });
  await page.goto('/tests/dst-lighting.html');
  const urls = {
    main: `/@fs${fileURLToPath(new URL('../../../src/main.ts', import.meta.url))}`,
    universal: `/@fs${fileURLToPath(new URL('../../../src/universal.ts', import.meta.url))}`,
    stats: `/@fs${fileURLToPath(new URL('../../../src/playerStats.ts', import.meta.url))}`,
  };
  const initial = await page.evaluate(async (urls) => {
    await import(urls.main);
    const { dstLighting } = await import(urls.universal);
    return dstLighting.getSanityPercent();
  }, urls);
  expect(initial).toBe(0.6);
  const meter = page.locator('dst-status-hud .survival-meter--sanity');
  await expect(meter).toHaveAttribute('aria-label', '精神值 120');
  const submit = async (command: string) => page.evaluate((command) => {
    document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', {
      detail: { command },
    }));
  }, command);
  await submit('c_setsanity(0.175)');
  await expect(meter.locator('output')).toHaveText('35');
  expect(await page.evaluate(async (urls) => {
    const { dstLighting } = await import(urls.universal);
    const { playerStats } = await import(urls.stats);
    return { percent: dstLighting.getSanityPercent(), sanity: playerStats.sanity.peek() };
  }, urls)).toEqual({ percent: 0.175, sanity: 35 });
  // Writing the source signal directly must update both consumers without the command callback.
  await page.evaluate(async url => (await import(url)).playerStats.sanity.set(100), urls.stats);
  await expect(meter.locator('output')).toHaveText('100');
  expect(await page.evaluate(async url => (await import(url)).dstLighting.getSanityPercent(), urls.universal)).toBe(0.5);
  await submit('c_setsanity(0.175)');
  const downloadPromise = page.waitForEvent('download');
  await submit('c_save()');
  const download = await downloadPromise;
  const saved = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(saved.players.local.stats).toEqual({ health: 140, hunger: 90, sanity: 35 });
  await submit('c_setsanity(1)');
  await expect(meter.locator('output')).toHaveText('200');
  expect(await page.evaluate(async (url) => (await import(url)).dstLighting.getSanityPercent(), urls.universal)).toBe(1);
  await expect(page.locator('dst-status-hud .world-clock__animation')).toHaveAttribute('data-state', 'ready');
  await page.screenshot({ path: '/tmp/dontstarve-sanity-full.png' });
  await submit('c_setsanity(0)');
  await expect(meter.locator('output')).toHaveText('0');
  await page.screenshot({ path: '/tmp/dontstarve-sanity-zero.png' });
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload();
  expect(await page.evaluate(async urls => {
    await import(urls.main);
    return (await import(urls.universal)).dstLighting.getSanityPercent();
  }, urls)).toBe(0.175);
  await expect(meter.locator('output')).toHaveText('35');
  expect(errors).toEqual([]);
});
