import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('snow renders with winter lighting, drains after stopping and releases its GPU resources', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async url => (await import(url)).checkSnow(),
    `/@fs${fileURLToPath(new URL('./snow-fixture.ts', import.meta.url))}`);
  expect(result.prefilled).toBeGreaterThan(300);
  expect(result.prefilled).toBeLessThanOrEqual(4800);
  // Verify actual rendered pixels as well as size and mostly vertical motion at two camera headings.
  expect(result.changedPixels).toBeGreaterThan(20);
  expect(result.coveredPixels).toBeGreaterThan(100);
  expect(result.multicolorPixels).toBe(0);
  expect(result.eligible).toBeGreaterThan(0);
  expect(result.eligible).toBeLessThan(result.prefilled);
  expect(result.softEdgePixels).toBeGreaterThan(20);
  expect(result.softCentrePixels).toBe(0);
  expect(result.foregroundSnowPixels).toBeGreaterThan(20);
  expect(result.pausePreserved).toBe(true);
  expect(result.stopped).toEqual({ quads: 0, cover: 0.24, groundVisible: true });
  expect(result.melted).toBe(true);
  expect(result.released.sort()).toEqual(['ground', 'groundMaterial', 'groundTexture', 'material', 'particles', 'texture']);
  expect(result.removed).toBe(true);
  expect(result.pendingRemoved).toBe(true);
  for (const motion of result.motion) {
    expect(motion.count).toBeGreaterThan(0);
    expect(motion.minimumWidth).toBeGreaterThan(2);
    expect(motion.minimumSize).toBeGreaterThanOrEqual(0.9999);
    expect(motion.maximumSize).toBeLessThanOrEqual(2.0001);
    expect(motion.maximumSize - motion.minimumSize).toBeGreaterThan(0.5);
    expect(motion.sizeStable).toBe(true);
    expect(motion.falling).toBe(true);
    expect(motion.driftRatio).toBeLessThan(0.25);
  }
  expect(errors).toEqual([]);
});

test('the current world opens in snowy winter and c_save exports a reloadable snowy scene', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const paths = Object.fromEntries(['main', 'scene', 'universal', 'player'].map(name =>
    [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  const prepare = async () => {
    await page.goto('/tests/dst-lighting.html');
    await page.evaluate(async paths => {
      await import(paths.main);
      const { worldState } = await import(paths.scene);
      const { scene, dstLighting } = await import(paths.universal);
      const { player } = await import(paths.player);
      (window as any).snowGame = { worldState, scene, dstLighting, player };
    }, paths);
    await expect.poll(() => page.evaluate(() => {
      const game = (window as any).snowGame;
      return (game.scene.getObjectByName('snow')?.geometry.drawRange.count ?? 0) > 0;
    })).toBe(true);
  };
  await prepare();
  await page.screenshot({ path: '/tmp/dontstarve-winter-snow.png' });
  expect(await page.evaluate(() => {
    const { worldState, dstLighting } = (window as any).snowGame;
    return { season: worldState.season.peek().season, lighting: dstLighting.getSeason(), preciptype: worldState.weather.preciptype.peek() };
  })).toEqual({ season: 'winter', lighting: 'winter', preciptype: 'snow' });
  const download = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command: 'c_save()' } })));
  const saved = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(saved.world.systems.worldtemperature.season).toBe('winter');
  expect(saved.world.systems.weather.preciptype).toBe('snow');
  expect(saved.world.systems.weather.snowlevel).toBeGreaterThanOrEqual(0.08);
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await prepare();
  const restored = await page.evaluate(() => {
    const { worldState, scene, player } = (window as any).snowGame;
    return { season: worldState.season.peek().season, type: worldState.weather.preciptype.peek(),
      cover: scene.getObjectByName('SnowGroundOverlay').userData.snowCover, position: player.position.toArray() };
  });
  expect(restored.season).toBe('winter');
  expect(restored.type).toBe('snow');
  expect(restored.cover).toBeGreaterThanOrEqual(saved.world.systems.weather.snowlevel * 3);
  expect(restored.position[0]).toBeCloseTo(saved.players.local.transform.position[0]);
  expect(restored.position[2]).toBeCloseTo(saved.players.local.transform.position[2]);
  expect(errors).toEqual([]);
});
