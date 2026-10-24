import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const PLAYER_PATH = `/@fs${fileURLToPath(new URL('../../../src/player.ts', import.meta.url))}`;

test('captures a large sparse world into one bounded image and replaces it after terrain changes', async ({ page }) => {
  await page.goto('/tests/minimap-edges.html');
  await page.waitForFunction(() => Boolean((window as any).minimapEdges));
  const prepared = await page.evaluate(async () => {
    const { terrain, map, WORLD_TILES } = (window as any).minimapEdges;
    const big = new terrain.constructor(9480, [
      { col: -364, row: 0, tileId: WORLD_TILES.WOODFLOOR }, { col: -363, row: 0, tileId: WORLD_TILES.WOODFLOOR },
    ], 1);
    const visual = await big.createVisual('/dst/data');
    const element = new (customElements.get('dst-minimap')!)() as any;
    document.body.append(element);
    element.bind({ ...map.options, terrain: big });
    await element.prepareTerrain();
    const image = element.shadowRoot.querySelector('.minimap__ground');
    const { sampleDomTerrain } = await import('./minimap-dom-samples.ts');
    const points = [{ x: -363.5 * 12, z: 6 }, { x: -362.5 * 12, z: 6 }, { x: 0, z: 0 }];
    const before = sampleDomTerrain(element, points);
    (window as any).largeMap = { big, visual, element, image, points, before, url: image.src };
    return { ready: (await element.inspect()).ready, images: element.shadowRoot.querySelectorAll('.minimap__terrain img').length,
      width: image.naturalWidth, height: image.naturalHeight, before, parentPreserved: visual.parent === null };
  });
  expect(prepared.ready).toBe(true);
  expect(prepared.images).toBe(1);
  expect(prepared.width).toBeLessThanOrEqual(8192); expect(prepared.width).toBeGreaterThan(4096); expect(prepared.height).toBe(prepared.width);
  expect(prepared.width * prepared.height * 4).toBeLessThanOrEqual(256 * 1024 * 1024);
  expect(prepared.before[0][3]).toBeGreaterThan(0); expect(prepared.before[1][3]).toBeGreaterThan(0);
  expect(prepared.before[2][3]).toBe(0); expect(prepared.parentPreserved).toBe(true);
  const updated = await page.evaluate(async () => {
    const { big, visual, element, image, points, before, url } = (window as any).largeMap;
    const { sampleDomTerrain } = await import('./minimap-dom-samples.ts');
    big.setTile(-364, 0, 4);
    await element.prepareTerrain();
    const after = sampleDomTerrain(element, points);
    const replaced = image.src !== url && image === element.shadowRoot.querySelector('.minimap__ground');
    const pixels = image.naturalWidth * image.naturalHeight;
    const old = element.renderer.terrain;
    element.dispose();
    big.setTile(-363, 0, 4);
    const detached = old.updateTask === undefined && !old.ready && old.image.getAttribute('src') === null;
    const preserved = visual.parent === null && visual.children.some((mesh: any) => mesh.geometry?.getAttribute('position')?.count > 0);
    big.dispose();
    return { before, after, replaced, pixels, detached, preserved };
  });
  expect(updated.after[0]).not.toEqual(updated.before[0]);
  expect(updated.after[2][3]).toBe(0);
  expect(updated).toMatchObject({ replaced: true, pixels: prepared.width * prepared.height, detached: true, preserved: true });
});

test('the native DOM player icon follows its live transform above cached terrain and disappears when disabled', async ({ page }, testInfo) => {
  await page.goto('/tests/minimap-edges.html');
  await page.waitForFunction(() => Boolean((window as any).minimapEdges));
  await expect.poll(() => page.evaluate(async () => {
    const map = (window as any).minimapEdges?.map;
    if (!map) return false;
    const { ready, icons } = await map.inspect();
    return ready && icons.includes('willow.png');
  })).toBe(true);
  const map = page.locator('dst-minimap');
  const icon = map.locator('img[data-icon="willow.png"]');
  await expect(icon).toBeVisible();
  await expect.poll(() => icon.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(map.locator('canvas')).toHaveCount(0);
  const terrain = await map.locator('.minimap__terrain img').evaluateAll(images => images.map(image => (image as HTMLImageElement).src));
  await page.evaluate(() => (window as any).minimapEdges.playerIcon.SetEnabled(false));
  await expect(icon).toHaveCount(0);
  await page.evaluate(() => (window as any).minimapEdges.playerIcon.SetEnabled(true));
  await expect(icon).toBeVisible();
  await expect(icon).toHaveCSS('left', '6px');
  await page.screenshot({ path: testInfo.outputPath('player-minimap-icon.png') });
  await page.evaluate(() => (window as any).minimapEdges.playerIcon.position.set(-18, 0, 18));
  await expect(icon).toHaveCSS('left', '-18px');
  await expect(icon).toHaveCSS('top', '18px');
  const alignment = await icon.evaluate(image => {
    const { map, playerIcon } = (window as any).minimapEdges;
    const expected = map.view.worldToScreen(playerIcon.position.x, playerIcon.position.z);
    const bounds = image.getBoundingClientRect();
    return { x: (bounds.left + bounds.right) / 2 - expected.x, y: (bounds.top + bounds.bottom) / 2 - expected.z, width: bounds.width };
  });
  expect(Math.abs(alignment.x)).toBeLessThan(.02);
  expect(Math.abs(alignment.y)).toBeLessThan(.02);
  expect(alignment.width).toBeCloseTo(32);
  expect(await map.locator('.minimap__terrain img').evaluateAll(images => images.map(image => (image as HTMLImageElement).src))).toEqual(terrain);
  await page.evaluate(() => (window as any).minimapEdges.playerIcon.dispose());
  await expect(icon).toHaveCount(0);
});

test('DOM views preserve fixed-size icons at high DPI and release resources on rebind or interrupted preparation', async ({ browser }) => {
  const page = await browser.newPage({ baseURL: 'http://127.0.0.1:4175', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  try {
    const workers: string[] = [], errors: string[] = [];
    page.on('worker', worker => workers.push(worker.url()));
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      (window as any).revokedMapUrls = new Set();
      const revoke = URL.revokeObjectURL;
      URL.revokeObjectURL = url => { (window as any).revokedMapUrls.add(url); revoke(url); };
    });
    await page.goto('/tests/minimap-edges.html');
    await page.waitForFunction(() => Boolean((window as any).minimapEdges));
    const icon = page.locator('dst-minimap img[data-icon="willow.png"]');
    await expect(icon).toBeVisible();
    await expect.poll(() => icon.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    const view = await page.evaluate(async () => {
      const { map, heading, playerIcon } = (window as any).minimapEdges;
      const marker = map.renderer.dom.icons.querySelector('img');
      let writes = 0;
      const observer = new MutationObserver(records => { writes += records.length; });
      observer.observe(marker, { attributes: true });
      let positionError = 0, sizeError = 0;
      for (const [angle, zoom] of [[-90, 1], [45, 8], [135, 20]]) {
        heading.set(angle);
        await new Promise(resolve => setTimeout(resolve, 0));
        map.setView({ x: 6, z: 6, zoom });
        const bounds = marker.getBoundingClientRect(), expected = map.view.worldToScreen(playerIcon.position.x, playerIcon.position.z);
        positionError = Math.max(positionError, Math.abs((bounds.left + bounds.right) / 2 - expected.x), Math.abs((bounds.top + bounds.bottom) / 2 - expected.z));
        sizeError = Math.max(sizeError, Math.abs(bounds.width - 32));
      }
      await new Promise(resolve => setTimeout(resolve, 0));
      observer.disconnect();
      const renderer = map.renderer;
      map.setOpen(false);
      const stopped = map.sampleTimer === undefined && map.zoomFrame === undefined;
      map.setOpen(true);
      return { writes, positionError, sizeError, stopped, reused: marker === renderer.dom.icons.querySelector('img'), width: map.view.width };
    });
    expect(view).toMatchObject({ writes: 0, stopped: true, reused: true, width: 1280 });
    expect(view.positionError).toBeLessThan(.02);
    expect(view.sizeError).toBeLessThan(.02);
    await expect(page.locator('dst-minimap .minimap__boundary')).toHaveCount(0);
    await page.evaluate(() => (window as any).minimapEdges.map.setView({ zoom: 20 }));
    await page.setViewportSize({ width: 900, height: 1400 });
    await expect.poll(() => page.evaluate(() => {
      const { map } = (window as any).minimapEdges;
      const matrix = new DOMMatrix(map.shadowRoot.querySelector('.minimap__world').style.transform);
      return Math.round(Math.hypot(matrix.a, matrix.b) * map.view.boundsSize);
    })).toBe(2100);
    await page.evaluate(async () => {
      const { map, heading } = (window as any).minimapEdges;
      heading.set(-90);
      await new Promise(resolve => setTimeout(resolve, 0));
      map.setView({ x: 0, z: 0, zoom: 20 });
    });
    await page.mouse.move(450, 700);
    await page.mouse.down();
    await page.mouse.move(10, 50, { steps: 5 });
    await page.mouse.up();
    await page.mouse.wheel(0, 1000);
    await expect.poll(() => page.evaluate(() => (window as any).minimapEdges.map.zoomFrame === undefined)).toBe(true);
    const bounds = await page.evaluate(() => {
      const { map } = (window as any).minimapEdges;
      const inverse = new DOMMatrix(map.shadowRoot.querySelector('.minimap__world').style.transform).inverse();
      const corners = [[0, 0], [900, 0], [900, 1400], [0, 1400]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(inverse));
      const half = map.view.boundsSize / 2;
      return { zoom: map.view.zoom, overflow: Math.max(...corners.flatMap(point => [Math.abs(point.x) - half, Math.abs(point.y) - half])) };
    });
    expect(bounds.zoom).toBe(20);
    expect(bounds.overflow).toBeCloseTo(0, 2); // Actual drag reaches the boundary; no corner can pass it.
    const lifecycle = await page.evaluate(async () => {
      const { map, terrain } = (window as any).minimapEdges;
      const old = map.renderer, urls = [...old.urls];
      const terrainUrl = old.terrain.image.src;
      map.bind(map.options);
      await map.prepareTerrain();
      const rebound = old.urls.size === 0 && urls.every(url => (window as any).revokedMapUrls.has(url)) && (window as any).revokedMapUrls.has(terrainUrl) && old.terrain.image.getAttribute('src') === null;
      const current = map.renderer;
      terrain.setTile(0, 0, 4);
      const pending = map.prepareTerrain();
      map.dispose();
      await pending;
      await new Promise(resolve => setTimeout(resolve, 0));
      return { rebound, urls: current.urls.size, nodes: map.shadowRoot.querySelectorAll('.minimap__viewport').length,
        stopped: map.sampleTimer === undefined && map.zoomFrame === undefined };
    });
    expect(lifecycle).toEqual({ rebound: true, urls: 0, nodes: 0, stopped: true });
    expect(workers.some(url => /minimap\.worker/.test(url))).toBe(false);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

test('wheel zoom stays monotonic around the cursor during repeated input and slow frames, and stops on close', async ({ page }) => {
  await page.goto('/tests/minimap-edges.html');
  await page.waitForFunction(() => Boolean((window as any).minimapEdges));
  // Keep the cursor anchor within the 96-unit fixture throughout both directions.
  const cursor = { x: 648, y: 352 };
  await page.mouse.move(cursor.x, cursor.y);
  await page.evaluate(cursor => {
    const { map } = (window as any).minimapEdges;
    const dom = map.renderer.dom, update = dom.update;
    (window as any).wheelProbe = { samples: [], cursor, anchor: undefined, busy: 0 };
    dom.update = function (view: any) {
      update.call(this, view);
      const probe = (window as any).wheelProbe;
      if (!probe.anchor) return;
      const matrix = new DOMMatrix(this.root.querySelector('.minimap__world').style.transform);
      const point = new DOMPoint(probe.anchor.x, probe.anchor.z).matrixTransform(matrix);
      probe.samples.push({ zoom: view.zoom, error: Math.max(Math.abs(point.x - cursor.x), Math.abs(point.y - cursor.y)) });
    };
  }, cursor);
  for (const busy of [0, 30]) {
    await page.evaluate(busy => {
      const { map } = (window as any).minimapEdges, probe = (window as any).wheelProbe;
      probe.anchor = undefined;
      map.setView({ x: 6, z: 6, zoom: 3 });
      probe.anchor = map.view.screenToWorld(probe.cursor.x, probe.cursor.y);
      probe.busy = busy;
      if (busy) {
        const load = () => {
          if (!probe.busy) return;
          const end = performance.now() + probe.busy;
          while (performance.now() < end) { /* Simulate the game's busy main-thread frame. */ }
          requestAnimationFrame(load);
        };
        requestAnimationFrame(load);
      }
    }, busy);
    for (const deltaY of [-100, 100]) {
      const initial = await page.evaluate(() => {
        (window as any).wheelProbe.samples = [];
        return (window as any).minimapEdges.map.view.zoom;
      });
      for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, deltaY); await page.waitForTimeout(20); }
      await expect.poll(() => page.evaluate(() => (window as any).minimapEdges.map.zoomFrame === undefined)).toBe(true);
      const samples = await page.evaluate(() => (window as any).wheelProbe.samples) as { zoom: number; error: number }[];
      expect(samples.length).toBeGreaterThan(1);
      let previous = initial;
      for (const sample of samples) {
        expect(deltaY < 0 ? previous - sample.zoom : sample.zoom - previous).toBeGreaterThanOrEqual(-1e-9);
        expect(sample.error).toBeLessThan(.02);
        previous = sample.zoom;
      }
      expect(deltaY < 0 ? previous < initial : previous > initial).toBe(true);
    }
    await page.evaluate(() => { (window as any).wheelProbe.busy = 0; });
  }
  await page.mouse.wheel(0, -100);
  await page.keyboard.press('Escape');
  const closedZoom = await page.evaluate(() => (window as any).minimapEdges.map.view.zoom);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => {
    const { map } = (window as any).minimapEdges;
    return { zoom: map.view.zoom, stopped: map.zoomFrame === undefined, open: map.isOpen };
  })).toEqual({ zoom: closedZoom, stopped: true, open: false });
});

test('uses world ground artwork, keeps ocean composition, and preserves shared world resources after updates', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/minimap-edges.html');
  await page.waitForFunction(() => Boolean((window as any).minimapEdges));
  const before = await page.evaluate(async () => {
    const { map, visual, ground, scene, renderer } = (window as any).minimapEdges;
    const { sampleDomTerrain } = await import('./minimap-dom-samples.ts');
    const points = [{ x: 6, z: 6 }, { x: -6, z: -6 }, { x: 30, z: 30 }];
    (window as any).worldMapPoints = points;
    const materials = visual.children.filter((mesh: any) => mesh.material?.name.startsWith('DST ground:')).map((mesh: any) => mesh.material);
    (window as any).worldMapDisposals = 0;
    for (const material of materials) material.addEventListener('dispose', () => { (window as any).worldMapDisposals++; });
    const size = [renderer.domElement.width, renderer.domElement.height];
    const image = map.shadowRoot.querySelector('.minimap__ground');
    map.setView({ zoom: 20, x: 0, z: 0 });
    return { samples: sampleDomTerrain(map, points), url: image.src, width: image.naturalWidth,
      parentsPreserved: ground.parent === scene && visual.parent === scene,
      materials: materials.map((material: any) => material.name), rendererSize: size };
  });
  expect(before.parentsPreserved).toBe(true);
  expect(before.materials).toContain('DST ground:WOODFLOOR');
  // Land is opaque; open ocean is left to the pre-rendered plate beneath the ground image.
  expect(before.samples[0][3]).toBe(255); expect(before.samples[1][3]).toBe(255);
  expect(before.samples[0]).not.toEqual(before.samples[1]);
  expect(before.samples[2][3]).toBe(0);
  expect(await page.evaluate(() => getComputedStyle((window as any).minimapEdges.map.shadowRoot.querySelector('.minimap__ocean')).backgroundImage)).toContain('minimap/ocean.png');
  await page.screenshot({ path: testInfo.outputPath('world-ground-map.png') });
  const after = await page.evaluate(async () => {
    const { map, terrain, renderer, scene, visual, ground } = (window as any).minimapEdges;
    const { sampleDomTerrain } = await import('./minimap-dom-samples.ts');
    terrain.dig({ x: 6, z: 6 });
    await map.prepareTerrain();
    const image = map.shadowRoot.querySelector('.minimap__ground');
    return { samples: sampleDomTerrain(map, (window as any).worldMapPoints), url: image.src,
      width: image.naturalWidth, parentsPreserved: ground.parent === scene && visual.parent === scene,
      disposed: (window as any).worldMapDisposals,
      rendererSize: [renderer.domElement.width, renderer.domElement.height] };
  });
  expect(after.url).not.toBe(before.url); expect(after.width).toBe(before.width);
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

  await page.locator('dst-map-controls').getByRole('button', { name: '打开地图' }).click();
  await expect(section).toBeVisible();
  expect(await page.evaluate(() => (window as any).mapGame.IsAutopaused())).toBe(true);
  expect(await page.evaluate(async playerPath => {
    const { player } = await import(playerPath);
    const icon = player.MiniMapEntity;
    return { icon: icon.icon, priority: icon.priority, canUseCache: icon.canUseCache,
      drawOverFogOfWar: icon.drawOverFogOfWar, ownsPosition: icon.position === player.position };
  }, PLAYER_PATH)).toEqual({ icon: 'wortox.png', priority: 10, canUseCache: false, drawOverFogOfWar: true, ownsPosition: true });
  await expect.poll(() => map.evaluate(async (element: any) => (await element.inspect()).icons.includes('wortox.png'))).toBe(true);

  const viewport = map.locator('.minimap__viewport');
  // Read the mounted terrain image at the player's position, independently of icons.
  await expect.poll(() => map.evaluate(async (element: any) => {
    const { sampleDomTerrain } = await import('./minimap-dom-samples.ts');
    const [centre] = sampleDomTerrain(element, [{ x: element.view.centerX, z: element.view.centerZ }]);
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

  // Terrain images update independently of the player icon and camera rotation.
  await map.getByRole('button', { name: '定位玩家' }).click();
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -3000); await page.waitForTimeout(150); }
  await expect.poll(() => map.evaluate((element: any) => element.view.zoom)).toBeLessThan(1.1);
  const sample = () => page.evaluate(async playerPath => {
    const { turfMap } = (window as any).mapGame;
    const element = document.querySelector('dst-minimap') as any;
    const { player } = await import(playerPath);
    const centre = turfMap.tileCenter({ x: player.position.x, z: player.position.z });
    const { sampleDomTerrain } = await import('./minimap-dom-samples.ts');
    const pixels = sampleDomTerrain(element, [[0, 0], [-1, -1], [1, 1]].map(([dx, dz]) => ({ x: centre.x + dx, z: centre.z + dz })));
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

  await page.keyboard.press('Escape');
  await expect(section).toBeHidden();
  expect(await page.evaluate(() => (window as any).mapGame.IsAutopaused())).toBe(false);
  expect(await page.locator('dst-map-controls').getByRole('button', { name: '打开地图' }).getAttribute('aria-pressed')).toBe('false');
  expect(errors).toEqual([]);
});
