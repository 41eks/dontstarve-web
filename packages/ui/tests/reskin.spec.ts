import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('animation decoder worker shares assets and retries failed skin loads', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const requests: string[] = [];
  context.on('request', (request) => requests.push(request.url()));
  let skinAttempts = 0;
  await context.route('**/anim/dynamic/treasurechest_ancient.zip', (route) => {
    if (++skinAttempts === 1) return route.fulfill({ status: 503, body: 'retry' });
    return route.continue();
  });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async (url) => {
    const assets = await import(url);
    const [first, second] = await Promise.all([
      assets.loadAnimationArchive('treasure_chest.zip', '/dst/data/anim'),
      assets.loadAnimationArchive('treasure_chest.zip', '/dst/data/anim/'),
    ]);
    const firstMaterials = assets.createMaterials(first.buildPackage);
    const secondMaterials = assets.createMaterials(second.buildPackage);
    let failed = false;
    try { await assets.loadSpriteSkinArchive('dynamic/treasurechest_ancient.zip', '/dst/data/anim'); }
    catch { failed = true; }
    const skin = await assets.loadSpriteSkinArchive('dynamic/treasurechest_ancient.zip', '/dst/data/anim');
    const result = {
      sameBuild: first.buildPackage === second.buildPackage,
      sameAnimation: first.animations === second.animations,
      pixels: first.buildPackage.atlases[0].pixels.byteLength,
      symbolsAreMap: first.buildPackage.build.symbols instanceof Map,
      independentTextures: firstMaterials[0].map !== secondMaterials[0].map,
      failed, skinPixels: skin.buildPackage.atlases[0].pixels.byteLength,
    };
    for (const material of [...firstMaterials, ...secondMaterials]) { material.map.dispose(); material.dispose(); }
    return result;
  }, `/@fs${fileURLToPath(new URL('../../animation/src/animationAssets.ts', import.meta.url))}`);
  expect(result.sameBuild && result.sameAnimation && result.symbolsAreMap && result.independentTextures && result.failed).toBe(true);
  expect(result.pixels).toBeGreaterThan(0);
  expect(result.skinPixels).toBeGreaterThan(0);
  expect(page.workers().some((worker) => worker.url().includes('animationArchive.worker'))).toBe(true);
  expect(requests.filter((url) => url.endsWith('/anim/treasure_chest.zip'))).toHaveLength(1);
  expect(skinAttempts).toBe(2);
  expect(errors).toEqual([]);
});
