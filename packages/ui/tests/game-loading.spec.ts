import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { parseKtex } from '../../animation/src/parseKtex';

const bootstrapUrl = `/@fs${fileURLToPath(new URL('../../../src/bootstrap.tsx', import.meta.url))}`;
const sceneUrl = `/@fs${fileURLToPath(new URL('../../../src/scene.ts', import.meta.url))}`;
const lightingUrl = `/@fs${fileURLToPath(new URL('../../../src/dstLighting.ts', import.meta.url))}`;
const textureLoaderUrl = `/@fs${fileURLToPath(new URL('../../animation/src/textureLoader.ts', import.meta.url))}`;

function pixelHash(pixels: Uint8Array): number {
  let hash = 2166136261;
  for (const value of pixels) hash = Math.imul(hash ^ value, 16777619);
  return hash >>> 0;
}

async function openGame(page: Page): Promise<void> {
  await page.goto('/tests/dst-lighting.html');
  await page.evaluate(url => {
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
    void import(url);
  }, bootstrapUrl);
}

test('keeps world generation visible until the complete game renders and preserves its UI', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    (window as any).textureRequests = [];
    const postMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (...args: Parameters<typeof postMessage>) {
      const request = args[0];
      if (request && typeof request.url === 'string') (window as any).textureRequests.push(request.url);
      return postMessage.apply(this, args);
    };
  });
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch();
    const save = await response.json();
    save.world.entities = {};
    await route.fulfill({ response, json: save });
  });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let waiting = false;
  await page.route('**/dst/data/anim/vig.zip', async route => {
    waiting = true;
    await pending;
    await route.continue();
  });
  await openGame(page);
  const generatingPage = page.getByRole('main', { name: '世界生成中' });
  const canvas = page.locator('canvas[data-game-canvas]');
  await expect(generatingPage).toBeVisible();
  await expect.poll(() => waiting, { timeout: 90_000 }).toBe(true);
  await expect(canvas).toHaveAttribute('data-loaded', 'false');
  const clock = await page.evaluate(async ({ sceneUrl, lightingUrl }) => {
    const { world, worldState } = await import(sceneUrl);
    const { DstLightingRenderer } = await import(lightingUrl);
    (window as any).loadingWorld = worldState;
    (window as any).loadingSteps = 0;
    (window as any).loadingDraws = 0;
    const step = world.step;
    world.step = (...args: any[]) => { (window as any).loadingSteps++; return step.apply(world, args); };
    const render = DstLightingRenderer.prototype.render;
    DstLightingRenderer.prototype.render = function (...args: any[]) {
      (window as any).loadingDraws++;
      return render.apply(this, args);
    };
    const observer = new MutationObserver(() => {
      if (document.querySelector('canvas[data-game-canvas][data-loaded="true"]')) {
        (window as any).drawsAtReady = (window as any).loadingDraws;
        observer.disconnect();
      }
    });
    observer.observe(document.querySelector('canvas[data-game-canvas]')!, { attributes: true });
    return worldState.clock.peek();
  }, { sceneUrl, lightingUrl });
  // Waiting longer than the former five-second delay must not reveal the game.
  await page.waitForTimeout(5_500);
  await expect(generatingPage).toBeVisible();
  await expect(generatingPage).toHaveCSS('pointer-events', 'auto');
  expect(await page.evaluate(() => ({ steps: (window as any).loadingSteps, draws: (window as any).loadingDraws,
    clock: (window as any).loadingWorld.clock.peek() }))).toEqual({ steps: 0, draws: 0, clock });
  release();
  await expect(canvas).toHaveAttribute('data-loaded', 'true', { timeout: 30_000 });
  await expect(generatingPage).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).drawsAtReady)).toBe(1);
  await expect(page.locator('#app > dst-crafting-ui')).toHaveCount(1);
  await page.keyboard.press('Backquote');
  await expect(page.locator('dst-debug-console input')).toBeFocused();
  const source = parseKtex(await readFile(new URL('../../../public/dst/data/levels/tiles/deciduous.tex', import.meta.url)));
  const decoded = await page.evaluate(async textureLoaderUrl => {
    const { loadKtexTexture } = await import(textureLoaderUrl);
    const texture = await loadKtexTexture('/dst/data/levels/tiles/deciduous.tex');
    let hash = 2166136261;
    for (const value of texture.pixels) hash = Math.imul(hash ^ value, 16777619);
    return { width: texture.width, height: texture.height, hash: hash >>> 0,
      requests: (window as any).textureRequests.filter((url: string) => url.endsWith('/levels/tiles/deciduous.tex')).length };
  }, textureLoaderUrl);
  expect(decoded).toEqual({ width: source.width, height: source.height, hash: pixelHash(source.pixels), requests: 1 });
  expect(errors).toEqual([]);
});

test('keeps the generating page and reports a failed game load', async ({ page }) => {
  await page.route('**/saves/initial-world.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await openGame(page);
  const generatingPage = page.getByRole('main', { name: '世界生成中' });
  await expect(generatingPage.getByText('游戏载入失败', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(generatingPage.getByText('游戏载入失败，请刷新页面后重试。', { exact: true })).toBeVisible();
  await expect(generatingPage).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('canvas[data-game-canvas][data-loaded="true"]')).toHaveCount(0);
});
