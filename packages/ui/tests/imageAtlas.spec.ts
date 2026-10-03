import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const moduleUrl = `/@fs${fileURLToPath(new URL('../../animation/src/imageAtlas.ts', import.meta.url))}`;

test('decodes HUD and inventory atlases in one worker and shares cached results', async ({ page }) => {
  const workers: string[] = [];
  let archiveDownloads = 0;
  page.on('worker', (worker) => workers.push(worker.url()));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/dst/data/databundles/images.zip') archiveDownloads++;
  });
  await page.goto('/tests/fixture.html');

  const result = await page.evaluate(async (moduleUrl) => {
    const { loadImageAtlas } = await import(moduleUrl) as typeof import('../../animation/src/imageAtlas');
    const archive = '/dst/data/databundles/images.zip';
    const first = loadImageAtlas(archive, 'images/hud.xml');
    const second = loadImageAtlas(new URL(archive, location.href), 'images/hud.xml');
    const [hud, inventory] = await Promise.all([first, loadImageAtlas(archive)]);
    const hand = hud.require('clock_hand');
    const torch = inventory.require('torch');
    return {
      sameRequest: first === second,
      sameAtlas: hud === await loadImageAtlas(archive, 'images/hud.xml'),
      sameSprite: hand === hud.require('clock_hand.tex'),
      hand: [hand.width, hand.height],
      handHasPixels: hand.pixels.some((value, index) => index % 4 === 3 && value > 0),
      torchHasPixels: torch.pixels.some((value, index) => index % 4 === 3 && value > 0),
      typedPixels: hand.pixels instanceof Uint8Array && torch.pixels instanceof Uint8Array,
      hasElementMap: hud.pages[0].elements instanceof Map,
      inventoryPages: inventory.pages.length,
    };
  }, moduleUrl);

  expect(workers).toHaveLength(1);
  expect(workers[0]).toContain('imageAtlas.worker.ts');
  expect(archiveDownloads).toBe(1);
  expect(result).toMatchObject({
    sameRequest: true,
    sameAtlas: true,
    sameSprite: true,
    hand: [224, 224],
    handHasPixels: true,
    torchHasPixels: true,
    typedPixels: true,
    hasElementMap: true,
  });
  expect(result.inventoryPages).toBeGreaterThan(1);
  await expect(page.locator('dst-status-hud .world-clock__hand')).toHaveAttribute('data-loaded', 'true');
});

test('retries failed worker downloads and keeps processing after an atlas parse error', async ({ page, context }) => {
  let attempts = 0;
  await context.route('**/databundles/images.zip?worker-retry', async (route) => {
    attempts++;
    if (attempts === 1) await route.fulfill({ status: 503, body: 'Unavailable' });
    else await route.continue();
  });
  await page.goto('/tests/fixture.html');

  const result = await page.evaluate(async (moduleUrl) => {
    const { loadImageAtlas } = await import(moduleUrl) as typeof import('../../animation/src/imageAtlas');
    const archive = '/dst/data/databundles/images.zip?worker-retry';
    let downloadError = '';
    try {
      await loadImageAtlas(archive, 'images/hud.xml');
    } catch (error) {
      downloadError = (error as Error).message;
    }
    let parseError = '';
    try {
      await loadImageAtlas(archive, 'images/worker-missing.xml');
    } catch (error) {
      parseError = (error as Error).message;
    }
    const atlas = await loadImageAtlas(archive, 'images/hud.xml');
    return { downloadError, parseError, rimWidth: atlas.require('clock_rim').width };
  }, moduleUrl);

  expect(attempts).toBe(2);
  expect(result.downloadError).toContain('HTTP 503');
  expect(result.parseError).toBe('ZIP archive does not contain images/worker-missing.xml');
  expect(result.rimWidth).toBe(216);
});
