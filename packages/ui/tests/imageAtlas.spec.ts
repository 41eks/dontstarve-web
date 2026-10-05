import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const moduleUrl = `/@fs${fileURLToPath(new URL('../../animation/src/imageAtlas.ts', import.meta.url))}`;
const imageModuleUrl = `/@fs${fileURLToPath(new URL('../../animation/src/atlasImage.ts', import.meta.url))}`;
const parserModuleUrl = `/@fs${fileURLToPath(new URL('../../animation/src/imageAtlasParser.ts', import.meta.url))}`;

test('shares CSS atlas images across slots and preserves source crop coordinates and aspect ratios', async ({ page }) => {
  await page.goto('/tests/fixture.html');
  const result = await page.evaluate(async ({ moduleUrl, imageModuleUrl }) => {
    const { loadImageAtlas } = await import(moduleUrl) as typeof import('../../animation/src/imageAtlas');
    const { createAtlasImage, getAtlasImage } = await import(imageModuleUrl) as typeof import('../../animation/src/atlasImage');
    const archive = '/dst/data/databundles/images.zip';
    const regions = await Promise.all(['slot_bg.tex', 'slot_frame.tex', 'pinslot_bg.tex'].map((name) =>
      getAtlasImage('images/crafting_menu.xml', name)));
    const atlas = await loadImageAtlas(archive, 'images/crafting_menu.xml');
    const image = new Image();
    image.src = regions[0].imageUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const matchingPixels = regions.every((region, index) => {
      const reference = atlas.require(['slot_bg.tex', 'slot_frame.tex', 'pinslot_bg.tex'][index]);
      const pixels = context.getImageData(region.x, region.y, region.width, region.height).data;
      // PNG conversion premultiplies RGB; transparent and nearly transparent RGB can round.
      return region.width === reference.width && region.height === reference.height
        && pixels.every((value, offset) => offset % 4 === 3
          ? value === reference.pixels[offset]
          : pixels[offset - offset % 4 + 3] < 128 || Math.abs(value - reference.pixels[offset]) <= 2);
    });
    const first = createAtlasImage('test-atlas-image', 'images/crafting_menu.xml', 'pinslot_bg.tex');
    const second = createAtlasImage('test-atlas-image', 'images/crafting_menu.xml', 'pinslot_bg');
    for (const element of [first, second]) {
      Object.assign(element.style, { width: '120px', height: '60px' });
      document.body.append(element);
    }
    await Promise.all([first.ready, second.ready]);
    const sprite = first.shadowRoot!.querySelector('.sprite')!.getBoundingClientRect();
    return {
      matchingPixels,
      sharedPage: regions.every(({ imageUrl }) => imageUrl === regions[0].imageUrl),
      sharedImage: first.dataset.image === second.dataset.image,
      separateElements: first !== second && first.isConnected && second.isConnected,
      sameRegion: regions[2] === await getAtlasImage('IMAGES/CRAFTING_MENU.XML', 'pinslot_bg'),
      spriteSize: [sprite.width, sprite.height],
      slotCanvasCount: document.querySelector('dst-crafting-ui')!.shadowRoot!.querySelectorAll('canvas').length,
    };
  }, { moduleUrl, imageModuleUrl });
  expect(result).toEqual({ matchingPixels: true, sharedPage: true, sharedImage: true,
    separateElements: true, sameRegion: true, spriteSize: [60, 60], slotCanvasCount: 0 });
});

test('batch registers lazy atlases, reuses texture pages and retries failed registrations', async ({ page }) => {
  await page.goto('/tests/fixture.html');
  const result = await page.evaluate(async ({ imageModuleUrl, parserModuleUrl }) => {
    const { createAtlasImage, getAtlasImage, registerImageAtlases, disposeAtlasImages } = await import(imageModuleUrl) as typeof import('../../animation/src/atlasImage');
    const { DecodedImageAtlas } = await import(parserModuleUrl) as typeof import('../../animation/src/imageAtlasParser');
    const pixels = new Uint8Array(4 * 4 * 4);
    for (let offset = 0; offset < pixels.length; offset += 4) {
      pixels[offset] = offset < 32 ? 255 : 0;
      pixels[offset + 2] = offset < 32 ? 0 : 255;
      pixels[offset + 3] = 255;
    }
    const atlas = new DecodedImageAtlas([{
      path: 'test/page.xml', texture: 'page.tex', texturePath: 'test/page.tex',
      decodedTexture: { width: 4, height: 4, pixels },
      elements: new Map([
        ['wide.tex', { name: 'wide.tex', u1: 0, u2: 0.999, v1: 0.625, v2: 0.875 }],
        ['bottom.tex', { name: 'bottom.tex', u1: 0.625, u2: 0.875, v1: 0.125, v2: 0.375 }],
      ]),
    }]);
    let attempts = 0;
    registerImageAtlases({
      'test/first.xml': async () => { attempts++; if (attempts === 1) throw new Error('Temporary atlas failure'); return atlas; },
      'test/alias.xml': atlas,
    });
    const lazyAttempts = attempts;
    const failed = createAtlasImage('test-image', 'test/first.xml', 'wide');
    document.body.append(failed);
    await failed.ready.catch(() => undefined);
    const [wide, duplicate, bottom] = await Promise.all([
      getAtlasImage('test/first.xml', 'wide'), getAtlasImage('test/first.xml', 'wide.tex'),
      getAtlasImage('test/alias.xml', 'bottom'),
    ]);
    const icon = createAtlasImage('test-image', 'test/first.xml', 'wide');
    Object.assign(icon.style, { width: '60px', height: '60px' });
    document.body.append(icon);
    await icon.ready;
    const rect = icon.shadowRoot!.querySelector('.sprite')!.getBoundingClientRect();
    const source = new Image();
    source.src = bottom.imageUrl;
    await source.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 4; canvas.height = 4;
    const context = canvas.getContext('2d')!;
    context.drawImage(source, 0, 0);
    const pixel = [...context.getImageData(bottom.x, bottom.y, 1, 1).data];
    disposeAtlasImages();
    const revoked = new Image();
    revoked.src = bottom.imageUrl;
    const oldUrlRevoked = await revoked.decode().then(() => false, () => true);
    registerImageAtlases({ 'test/first.xml': atlas });
    const renewed = await getAtlasImage('test/first.xml', 'wide');
    return { lazyAttempts, attempts, failure: failed.dataset.error, sameEntry: wide === duplicate,
      sharedTexture: wide.imageUrl === bottom.imageUrl, size: [rect.width, rect.height],
      bottom: [bottom.x, bottom.y, bottom.width, bottom.height],
      pixel, oldUrlRevoked, freshUrl: renewed.imageUrl !== wide.imageUrl };
  }, { imageModuleUrl, parserModuleUrl });
  expect(result).toEqual({ lazyAttempts: 0, attempts: 2, failure: 'Temporary atlas failure',
    sameEntry: true, sharedTexture: true, size: [60, 30], bottom: [2, 2, 2, 2], pixel: [0, 0, 255, 255],
    oldUrlRevoked: true, freshUrl: true });
});

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
