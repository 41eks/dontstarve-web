import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const PLAYER_PATH = `/@fs${fileURLToPath(new URL('../../../src/player.ts', import.meta.url))}`;

test('the source HUD frame fills landscape and portrait screens and stays fixed while the map moves', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/tests/minimap-edges.html');
  await page.waitForFunction(() => Boolean((window as any).minimapEdges));
  const map = page.locator('dst-minimap'), background = map.locator('.minimap__background');
  await expect(background).toHaveAttribute('data-loaded', 'true');
  const texture = await background.getAttribute('data-image');
  for (const [width, height] of [[1280, 720], [600, 900]]) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => background.evaluate(element => {
      const sprite = element.shadowRoot!.querySelector('.sprite')!;
      const rect = sprite.getBoundingClientRect();
      return [rect.x, rect.y, rect.width, rect.height];
    })).toEqual([0, 0, width, height]);
    await page.evaluate(async () => {
      const { map, heading } = (window as any).minimapEdges;
      heading.set(45);
      map.setView({ x: 12, z: -12, zoom: 20 });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(await background.getAttribute('data-image')).toBe(texture);
    await expect(background).toHaveAttribute('data-atlas', 'images/hud.xml');
    await expect(background).toHaveAttribute('data-element', 'map.tex');
    expect(await map.locator('.minimap__viewport').evaluate(element => getComputedStyle(element).mixBlendMode)).toBe('plus-lighter');
    await page.screenshot({ path: testInfo.outputPath(`map-hud-frame-${width}x${height}.png`) });
  }
  await page.keyboard.press('Escape');
  await expect(background).toBeHidden();
  await page.keyboard.press('m');
  await expect(background).toBeVisible();
  expect(await background.getAttribute('data-image')).toBe(texture);
  expect(errors).toEqual([]);
});

test('the land cursor and map actions follow tiles through holes, map transforms and terrain changes', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1000 });
  await page.goto('/tests/minimap-edges.html');
  await page.waitForFunction(() => Boolean((window as any).minimapEdges));
  const map = page.locator('dst-minimap'), section = map.locator('section');
  // Make an ocean hole inside a surrounding island, plus a separate small island.
  await page.evaluate(() => {
    const { terrain, map, WORLD_TILES } = (window as any).minimapEdges;
    for (let row = -2; row <= 2; row++) for (let col = -2; col <= 2; col++)
      terrain.setTile(col, row, WORLD_TILES.GRASS);
    terrain.setTile(0, 0, WORLD_TILES.OCEAN_COASTAL);
    terrain.setTile(3, 0, WORLD_TILES.GRASS);
    (window as any).mapRequests = [];
    map.addEventListener('game:map-action-request', (event: CustomEvent) => (window as any).mapRequests.push(event.detail.position.toArray()));
  });
  const screen = (x: number, z: number) => page.evaluate(({ x, z }) => (window as any).minimapEdges.map.view.worldToScreen(x, z), { x, z });
  const moveTo = async (x: number, z: number) => {
    const point = await screen(x, z);
    await page.mouse.move(point.x, point.z);
    return section.evaluate(element => ({ land: element.classList.contains('minimap--land'), cursor: getComputedStyle(element).cursor }));
  };
  for (const [angle, zoom] of [[-90, 19], [45, 20]]) {
    await page.evaluate(async ({ angle, zoom }) => {
      const { map, heading } = (window as any).minimapEdges;
      heading.set(angle);
      await new Promise(resolve => setTimeout(resolve, 0));
      map.setView({ x: 6, z: 6, zoom });
    }, { angle, zoom });
    expect(await moveTo(-6, 6)).toEqual({ land: true, cursor: 'crosshair' });
    expect(await moveTo(6, 6)).toEqual({ land: false, cursor: 'none' });
    expect(await moveTo(42, 6)).toEqual({ land: true, cursor: 'crosshair' });
    expect(await moveTo(6, -30)).toEqual({ land: false, cursor: 'none' });
  }
  // Right click requests a map action only over land.
  await moveTo(6, 6); await page.mouse.click(...Object.values(await screen(6, 6)) as [number, number], { button: 'right' });
  await moveTo(-6, 6); await page.mouse.click(...Object.values(await screen(-6, 6)) as [number, number], { button: 'right' });
  const requests = await page.evaluate(() => (window as any).mapRequests);
  expect(requests).toHaveLength(1);
  expect(Math.floor(requests[0][0] / 12)).toBe(-1); expect(Math.floor(requests[0][2] / 12)).toBe(0);
  // Actual pointer capture still pans the map across both land and sea.
  await moveTo(-6, 6);
  const beforePan = await page.evaluate(() => (window as any).minimapEdges.map.view.centerX);
  const mouse = await screen(-6, 6);
  await page.mouse.down();
  await page.mouse.move(mouse.x + 60, mouse.z + 20, { steps: 3 });
  await expect(section).toHaveClass(/minimap--dragging/);
  await page.mouse.up();
  expect(await page.evaluate(() => (window as any).minimapEdges.map.view.centerX)).not.toBe(beforePan);
  expect(await moveTo(6, 6)).toEqual({ land: false, cursor: 'none' });
  // Filling the hole changes the drawn terrain and the land test together.
  const sample = () => page.evaluate(async () => {
    const { sampleMapTerrain } = await import('./minimap-terrain-samples.ts');
    return sampleMapTerrain((window as any).minimapEdges.map, [{ x: 6, z: 6 }], { ocean: false })[0];
  });
  expect((await sample())[3]).toBe(0);
  await page.evaluate(() => {
    const { terrain, WORLD_TILES } = (window as any).minimapEdges;
    terrain.setTile(0, 0, WORLD_TILES.GRASS);
  });
  expect((await sample())[3]).toBe(255);
  expect(await moveTo(6, 6)).toEqual({ land: true, cursor: 'crosshair' });
  await page.keyboard.press('Escape');
  await expect(section).toBeHidden();
});

test('draws a large sparse world from chunk geometry and rebuilds only the chunks a terrain edit touches', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto('/tests/minimap-edges.html');
  await page.waitForFunction(() => Boolean((window as any).minimapEdges));
  const result = await page.evaluate(async () => {
    const { terrain, map, WORLD_TILES, GroundDisplay } = (window as any).minimapEdges;
    const big = new terrain.constructor(9480, [
      { col: -364, row: 0, tileId: WORLD_TILES.WOODFLOOR }, { col: -363, row: 0, tileId: WORLD_TILES.WOODFLOOR },
    ], 1);
    const visual = await big.createVisual('/dst/data');
    const display = new GroundDisplay(big, '/dst/data');
    await display.prepare();
    const element = new (customElements.get('dst-minimap')!)() as any;
    document.body.append(element);
    element.bind({ ...map.options, terrain: big });
    await element.prepareTerrain();
    element.setOpen(true);
    element.setView({ x: -363 * 12, z: 6, zoom: 1 });
    const { sampleMapTerrain } = await import('./minimap-terrain-samples.ts');
    const points = [{ x: -363.5 * 12, z: 6 }, { x: -362.5 * 12, z: 6 }, { x: -358 * 12, z: 6 }];
    const before = sampleMapTerrain(element, points, { ocean: false });
    const renderer = element.renderer.terrain, chunks = [...renderer.chunks.values()];
    big.setTile(-364, 0, 4);
    const dirty = chunks.filter((chunk: any) => chunk.dirty).length;
    const after = sampleMapTerrain(element, points, { ocean: false });
    const ready = (await element.inspect()).ready;
    element.dispose();
    big.setTile(-363, 0, 4);
    const released = renderer.renderer === undefined && !renderer.canvas.isConnected && renderer.chunks.size === 0;
    const preserved = visual.parent === null && display.root.children.some((mesh: any) => mesh.geometry?.getAttribute('position')?.count > 0);
    display.dispose(); big.dispose();
    return { chunks: chunks.length, dirty, before, after, ready, released, preserved };
  });
  // 790 cells per side in 32-cell chunks from col -395: cell -364's one-cell halo reaches the chunk starting at -363.
  expect(result.chunks).toBe(625);
  expect(result.dirty).toBe(2);
  expect(result.before[0][3]).toBeGreaterThan(0); expect(result.before[1][3]).toBeGreaterThan(0);
  expect(result.before[2][3]).toBe(0);
  expect(result.after[0]).not.toEqual(result.before[0]);
  expect(result.after[2][3]).toBe(0);
  expect(result).toMatchObject({ ready: true, released: true, preserved: true });
});

test('uses world ground artwork, keeps ocean composition, and preserves shared world resources after updates', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/minimap-edges.html');
  await page.waitForFunction(() => Boolean((window as any).minimapEdges));
  const before = await page.evaluate(async () => {
    const { map, visual, ground, scene, renderer, groundDisplay } = (window as any).minimapEdges;
    const { sampleMapTerrain } = await import('./minimap-terrain-samples.ts');
    const points = [{ x: 6, z: 6 }, { x: -6, z: -6 }, { x: 30, z: 6 }];
    (window as any).worldMapPoints = points;
    const materials = [...new Set(groundDisplay.root.children.filter((mesh: any) => mesh.material?.name.startsWith('DST ground:')).map((mesh: any) => mesh.material))];
    (window as any).worldMapDisposals = 0;
    for (const material of materials) material.addEventListener('dispose', () => { (window as any).worldMapDisposals++; });
    const size = [renderer.domElement.width, renderer.domElement.height];
    map.setView({ zoom: 20, x: 0, z: 0 });
    return { samples: sampleMapTerrain(map, points, { ocean: false }), withOcean: sampleMapTerrain(map, points),
      parentsPreserved: ground.parent === scene && visual.parent === scene,
      materials: materials.map((material: any) => material.name), rendererSize: size };
  });
  expect(before.parentsPreserved).toBe(true);
  expect(before.materials).toContain('DST ground:WOODFLOOR');
  // Land is opaque; open ocean is the pre-rendered plate drawn beneath the land layers.
  expect(before.samples[0][3]).toBe(255); expect(before.samples[1][3]).toBe(255);
  expect(before.samples[0]).not.toEqual(before.samples[1]);
  expect(before.samples[2][3]).toBe(0);
  expect(before.withOcean[2][3]).toBe(255);
  expect(before.withOcean[0]).toEqual(before.samples[0]);
  await page.screenshot({ path: testInfo.outputPath('world-ground-map.png') });
  const after = await page.evaluate(async () => {
    const { map, terrain, renderer, scene, visual, ground } = (window as any).minimapEdges;
    const { sampleMapTerrain } = await import('./minimap-terrain-samples.ts');
    terrain.dig({ x: 6, z: 6 });
    return { samples: sampleMapTerrain(map, (window as any).worldMapPoints, { ocean: false }),
      parentsPreserved: ground.parent === scene && visual.parent === scene,
      disposed: (window as any).worldMapDisposals,
      rendererSize: [renderer.domElement.width, renderer.domElement.height] };
  });
  expect(after.samples[0]).not.toEqual(before.samples[0]);
  expect(after.samples[2]).toEqual(before.samples[2]);
  expect(after.parentsPreserved).toBe(true); expect(after.disposed).toBe(0);
  expect(after.rendererSize).toEqual(before.rendererSize);
  expect(errors).toEqual([]);
});

test('the fullscreen map opens, pauses the game, zooms, pans, follows terrain changes and closes', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const paths = Object.fromEntries(['main', 'building', 'autopause'].map(name =>
    [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  await page.goto('/tests/dst-lighting.html?save=initial-world.json');
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
  await expect(inspectImage).toHaveAttribute('src', /self_inspect_wortox\.tex\.png$/);
  await expect.poll(() => inspectImage.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(98);

  await page.evaluate(() => {
    const backpack = document.querySelector('dst-backpack-panel') as any;
    if (!backpack.slotContainer) backpack.open({ containerId: 'map-layout:backpack', slotCount: 8, title: '背包' });
    (window as any).mapGame.backpack = backpack.slotContainer;
  });
  const coveredByMap = (selector: string) => page.locator(selector).evaluate(element => {
    const rect = element.getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.tagName === 'DST-MINIMAP';
  });
  const inventorySelector = 'dst-inventory-bar .inventory-bar';
  const backpackSelector = 'dst-backpack-panel .chest-panel__slots';

  await page.locator('dst-map-controls').getByRole('button', { name: '打开地图' }).click();
  await expect(section).toBeVisible();
  const inventoryBar = page.locator(inventorySelector);
  const pauseButton = page.locator('dst-map-controls .map-controls__pause');
  expect(await coveredByMap(inventorySelector)).toBe(true);
  expect(await coveredByMap(backpackSelector)).toBe(true);
  await expect(pauseButton).toBeHidden();
  expect(await page.evaluate(() => (window as any).mapGame.IsAutopaused())).toBe(true);
  expect(await page.evaluate(async playerPath => {
    const { player, playerInstance } = await import(playerPath);
    const icon = playerInstance.minimap.peek();
    return { icon: icon.icon, priority: icon.priority, canUseCache: icon.canUseCache,
      drawOverFogOfWar: icon.drawOverFogOfWar, ownsPosition: playerInstance.position === player.position };
  }, PLAYER_PATH)).toEqual({ icon: 'wortox.png', priority: 10, canUseCache: false, drawOverFogOfWar: true, ownsPosition: true });
  await expect.poll(() => map.evaluate(async (element: any) => (await element.inspect()).icons.includes('wortox.png'))).toBe(true);

  await page.evaluate(() => {
    const original = document.elementFromPoint;
    (window as any).mapGame.hitTests = 0;
    document.elementFromPoint = function (x, y) {
      (window as any).mapGame.hitTests++;
      return original.call(this, x, y);
    };
    (window as any).mapGame.restoreHitTest = () => { document.elementFromPoint = original; };
  });

  const viewport = map.locator('.minimap__viewport');
  // Read the drawn terrain at the player's position, independently of icons.
  await expect.poll(() => map.evaluate(async (element: any) => {
    const { sampleMapTerrain } = await import('./minimap-terrain-samples.ts');
    const [centre] = sampleMapTerrain(element, [{ x: element.view.centerX, z: element.view.centerZ }], { ocean: false });
    return centre[3] > 0;
  })).toBe(true);

  const box = (await viewport.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -600);
  await expect.poll(() => map.evaluate((element: any) => element.view.zoom)).toBeLessThan(3);
  const startX = await map.evaluate((element: any) => element.view.centerX);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => map.evaluate((element: any) => element.view.centerX)).toBeLessThan(startX);

  // Terrain drawing updates independently of the player icon and camera rotation.
  await map.getByRole('button', { name: '定位玩家' }).click();
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -3000); await page.waitForTimeout(150); }
  await expect.poll(() => map.evaluate((element: any) => element.view.zoom)).toBeLessThan(1.1);
  const sample = () => page.evaluate(async playerPath => {
    const { turfMap } = (window as any).mapGame;
    const element = document.querySelector('dst-minimap') as any;
    const { player } = await import(playerPath);
    const centre = turfMap.tileCenter({ x: player.position.x, z: player.position.z });
    const { sampleMapTerrain } = await import('./minimap-terrain-samples.ts');
    const pixels = sampleMapTerrain(element, [[0, 0], [-1, -1], [1, 1]].map(([dx, dz]) => ({ x: centre.x + dx, z: centre.z + dz })));
    return pixels.map((pixel: number[]) => pixel.slice(0, 3));
  }, PLAYER_PATH);
  const before = await sample();
  await page.evaluate(async playerPath => {
    const { player } = await import(playerPath);
    (window as any).mapGame.turfMap.dig({ x: player.position.x, z: player.position.z });
  }, PLAYER_PATH);
  await expect.poll(() => map.evaluate(async (element: any) => (await element.inspect()).ready), { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => (await sample()).filter((colour, i) =>
    colour.reduce((sum, v, c) => sum + Math.abs(v - before[i][c]), 0) > 12).length).toBeGreaterThanOrEqual(2);

  await expect(page.locator('.cursor-label-ui')).toBeHidden();
  expect(await page.evaluate(() => (window as any).mapGame.hitTests)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(section).toBeHidden();
  await expect(inventoryBar).toBeVisible();
  await expect(pauseButton).toBeVisible();
  expect(await coveredByMap(inventorySelector)).toBe(false);
  expect(await coveredByMap(backpackSelector)).toBe(false);
  expect(await page.evaluate(() => (document.querySelector('dst-backpack-panel') as any).slotContainer === (window as any).mapGame.backpack)).toBe(true);
  await page.mouse.move(cx, cy);
  await expect.poll(() => page.evaluate(() => (window as any).mapGame.hitTests)).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).mapGame.restoreHitTest());
  expect(await page.evaluate(() => (window as any).mapGame.IsAutopaused())).toBe(false);
  expect(await page.locator('dst-map-controls').getByRole('button', { name: '打开地图' }).getAttribute('aria-pressed')).toBe('false');
  await page.keyboard.press('m');
  expect(await coveredByMap(inventorySelector)).toBe(true);
  expect(await coveredByMap(backpackSelector)).toBe(true);
  await expect(pauseButton).toBeHidden();
  await page.locator('dst-map-controls').getByRole('button', { name: '关闭地图' }).click();
  await expect(inventoryBar).toBeVisible();
  await expect(pauseButton).toBeVisible();
  expect(errors).toEqual([]);
});
