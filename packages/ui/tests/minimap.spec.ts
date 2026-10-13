import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const PLAYER_PATH = `/@fs${fileURLToPath(new URL('../../../src/player.ts', import.meta.url))}`;

test('the native player icon follows its live transform above cached terrain and disappears when disabled', async ({ page }, testInfo) => {
  await page.goto('/tests/minimap-edges.html');
  await expect.poll(() => page.evaluate(() => {
    const map = (window as any).minimapEdges?.map;
    return Boolean(map?.icons.get('willow.png') && map.base && !map.baseDirty);
  })).toBe(true);
  const snapshot = () => page.evaluate(() => {
    const { map } = (window as any).minimapEdges;
    const context = map.shadowRoot.querySelector('canvas').getContext('2d');
    const sample = (x: number, z: number) => {
      const at = map.view.worldToScreen(x, z);
      return Array.from(context.getImageData(at.x - 18, at.z - 18, 36, 36).data);
    };
    return { start: sample(6, 6), target: sample(-18, 18), dirty: map.baseDirty };
  });
  await page.evaluate(() => (window as any).minimapEdges.playerIcon.SetEnabled(false));
  // Wait for a complete map frame after each visibility or transform change.
  const frame = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await frame();
  const terrain = await snapshot();
  await page.evaluate(() => (window as any).minimapEdges.playerIcon.SetEnabled(true));
  await frame();
  const start = await snapshot();
  expect(start.start).not.toEqual(terrain.start);
  expect(start.target).toEqual(terrain.target);
  await page.screenshot({ path: testInfo.outputPath('player-minimap-icon.png') });
  await page.evaluate(() => (window as any).minimapEdges.playerIcon.position.set(-18, 0, 18));
  await frame();
  const moved = await snapshot();
  expect(moved.start).toEqual(terrain.start);
  expect(moved.target).not.toEqual(terrain.target);
  expect(moved.dirty).toBe(false);
  await page.evaluate(() => (window as any).minimapEdges.playerIcon.dispose());
  await frame();
  expect((await snapshot()).target).toEqual(terrain.target);
});

test('source masks blend land into the sea without changing the underlying ocean, and update after digging', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/minimap-edges.html');
  await expect.poll(() => page.evaluate(() => Boolean((window as any).minimapEdges?.map.base && !(window as any).minimapEdges.map.baseDirty))).toBe(true);
  const result = await page.evaluate(async () => {
    const { map, terrain, createMinimapTilePainter } = (window as any).minimapEdges;
    const layer = (await terrain.tileLayerImages()).get(terrain.tileIdAtCell(0, 0));
    const paint = createMinimapTilePainter(layer, 32);
    const edge = paint({ col: 1, row: 0, variant: 2 }).getContext('2d').getImageData(0, 0, 32, 32).data;
    const alphas = Array.from(edge).filter((_, i) => i % 4 === 3) as number[];
    const base = map.base.getContext('2d');
    const ocean = Array.from(base.getImageData(6 * 32, 4 * 32, 32, 32).data);
    const coast = Array.from(base.getImageData(5 * 32, 4 * 32, 32, 32).data);
    // Known shader arithmetic: RGB product, alpha from atlas, irrespective of noise alpha.
    const constant = createMinimapTilePainter({ cells: new Map([[1, { width: 1, height: 1, data: new Uint8ClampedArray([200, 100, 50, 128]) }]]),
      noise: { width: 1, height: 1, data: new Uint8ClampedArray([128, 64, 32, 128]) }, renderOrder: 0 }, 32);
    const product = Array.from(constant({ col: -1, row: -1, variant: 1 }).getContext('2d').getImageData(16, 16, 1, 1).data);
    return { transparent: alphas.some(a => a === 0), partial: alphas.some(a => a > 0 && a < 255), ocean, coast, product };
  });
  expect(result.transparent).toBe(true);
  expect(result.partial).toBe(true);
  [100, 25, 6, 128].forEach((value, i) => expect(Math.abs(result.product[i] - value)).toBeLessThanOrEqual(2));
  await page.screenshot({ path: testInfo.outputPath('minimap-source-edges.png') });
  await page.evaluate(() => {
    const { terrain } = (window as any).minimapEdges;
    terrain.dig({ x: 6, z: 6 });
  });
  await expect.poll(() => page.evaluate(() => (window as any).minimapEdges.map.baseDirty)).toBe(false);
  const after = await page.evaluate(() => {
    const context = (window as any).minimapEdges.map.base.getContext('2d');
    return { ocean: Array.from(context.getImageData(6 * 32, 4 * 32, 32, 32).data),
      coast: Array.from(context.getImageData(5 * 32, 4 * 32, 32, 32).data) };
  });
  expect(after.ocean).toEqual(result.ocean);
  expect(after.coast).not.toEqual(result.coast);
  expect(errors).toEqual([]);
});

test('the fullscreen map opens, pauses the game, zooms, pans, follows terrain changes and closes', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const paths = Object.fromEntries(['main', 'building', 'autopause'].map(name =>
    [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  await page.goto('/tests/dst-lighting.html');
  await page.evaluate(async paths => {
    await import(paths.main);
    const { turfMap } = await import(paths.building);
    const { IsAutopaused } = await import(paths.autopause);
    (window as any).mapGame = { turfMap, IsAutopaused };
  }, paths);
  const map = page.locator('dst-minimap');
  const section = map.locator('section.minimap');
  await expect(section).toBeHidden();
  const inspectImage = page.locator('dst-inventory-bar').locator('.inventory-bar__inspect img');
  await expect(inspectImage).toHaveAttribute('src', /self_inspect_waxwell\.tex\.png$/);
  await expect.poll(() => inspectImage.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(98);

  await page.locator('dst-map-controls').getByRole('button', { name: '打开地图' }).click();
  await expect(section).toBeVisible();
  expect(await page.evaluate(() => (window as any).mapGame.IsAutopaused())).toBe(true);
  expect(await page.evaluate(async playerPath => {
    const { player } = await import(playerPath);
    const icon = player.MiniMapEntity;
    return { icon: icon.icon, priority: icon.priority, canUseCache: icon.canUseCache,
      drawOverFogOfWar: icon.drawOverFogOfWar, ownsPosition: icon.position === player.position };
  }, PLAYER_PATH)).toEqual({ icon: 'waxwell.png', priority: 10, canUseCache: false, drawOverFogOfWar: true, ownsPosition: true });
  await expect.poll(() => map.evaluate((element: any) => Boolean(element.icons.get('waxwell.png')))).toBe(true);

  const canvas = map.locator('canvas');
  // Sample the canvas centre: land colour at the player's start, never transparent.
  const pixel = (x: number, y: number) => canvas.evaluate((element: HTMLCanvasElement, [x, y]) =>
    Array.from(element.getContext('2d')!.getImageData(x, y, 1, 1).data), [x, y]);
  const centre = await pixel(await canvas.evaluate((c: HTMLCanvasElement) => c.width / 2), await canvas.evaluate((c: HTMLCanvasElement) => c.height / 2));
  expect(centre[3]).toBeGreaterThan(0);

  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -600);
  await expect.poll(() => map.evaluate((element: any) => element.view.zoom)).toBeGreaterThan(1.5);
  const startX = await map.evaluate((element: any) => element.view.centerX);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy, { steps: 4 });
  await page.mouse.up();
  expect(await map.evaluate((element: any) => element.view.centerX)).toBeLessThan(startX);

  // Digging the tile under the player turns its pixels to the dirt colour (marker excluded by sampling the tile corners).
  await map.getByRole('button', { name: '定位玩家' }).click();
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -3000); await page.waitForTimeout(150); }
  await expect.poll(() => map.evaluate((element: any) => element.view.zoom)).toBeGreaterThan(15);
  const sample = () => page.evaluate(async playerPath => {
    const { turfMap } = (window as any).mapGame;
    const element = document.querySelector('dst-minimap') as any;
    const { player } = await import(playerPath);
    const centre = turfMap.tileCenter({ x: player.position.x, z: player.position.z });
    const half = 12 / 2 * element.view.scale * 0.6;
    const at = element.view.worldToScreen(centre.x, centre.z);
    const canvas = element.shadowRoot.querySelector('canvas') as HTMLCanvasElement;
    const context = canvas.getContext('2d')!;
    return [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([dx, dy]) =>
      Array.from(context.getImageData(at.x + dx * half, at.z + dy * half, 1, 1).data.slice(0, 3)));
  }, PLAYER_PATH);
  const before = await sample();
  await page.evaluate(async playerPath => {
    const { player } = await import(playerPath);
    (window as any).mapGame.turfMap.dig({ x: player.position.x, z: player.position.z });
  }, PLAYER_PATH);
  // Dirt appears through the neighbour mask; the original terrain may still cover
  // individual corner samples, unlike the old hard rectangle replacement.
  await expect.poll(async () => (await sample()).filter((colour, i) =>
    colour.reduce((sum, v, c) => sum + Math.abs(v - before[i][c]), 0) > 12).length).toBeGreaterThanOrEqual(2);

  await page.keyboard.press('Escape');
  await expect(section).toBeHidden();
  expect(await page.evaluate(() => (window as any).mapGame.IsAutopaused())).toBe(false);
  expect(await page.locator('dst-map-controls').getByRole('button', { name: '打开地图' }).getAttribute('aria-pressed')).toBe('false');
  expect(errors).toEqual([]);
});
