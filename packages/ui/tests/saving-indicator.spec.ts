import { readSaveDownload } from './save-download';
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test('c_save downloads a cluster ZIP before and after a portal spawn, plays the saving clips and restores its active shard', async ({ page }) => {
  // The full imported forest is loaded twice, with ZIP generation between the two starts.
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.text().startsWith('保存失败')) errors.push(message.text());
  });
  await page.goto('/tests/dst-lighting.html');
  await page.evaluate(async (url) => { await import(url); },
    `/@fs${fileURLToPath(new URL('../../../src/main.ts', import.meta.url))}`);
  const indicator = page.locator('dst-saving-indicator');
  await expect(indicator.locator('canvas')).toHaveAttribute('data-loaded', 'true');
  await indicator.evaluate((host) => {
    const canvas = host.shadowRoot!.querySelector('canvas')!;
    (window as any).savingClips = [];
    new MutationObserver(() => {
      const clips = (window as any).savingClips;
      if (canvas.dataset.animation && clips.at(-1) !== canvas.dataset.animation) clips.push(canvas.dataset.animation);
    }).observe(canvas, { attributes: true, attributeFilter: ['data-animation'] });
  });
  await page.keyboard.press('Backquote');
  await page.locator('dst-debug-console input').fill('c_save()');
  const download = page.waitForEvent('download');
  await page.locator('dst-debug-console input').press('Enter');
  const firstDownload = await download;
  expect(firstDownload.suggestedFilename()).toBe('Cluster_1.zip');
  const firstSave = JSON.parse(await readSaveDownload(await firstDownload.path(), 'Master'));
  await expect.poll(() => page.evaluate(() => (window as any).savingClips), { timeout: 10_000 })
    .toEqual(['save_pre', 'save_loop', 'save_post']);
  await expect(indicator.locator('.saving-indicator')).toBeHidden({ timeout: 10_000 });
  const command = async (text: string) => {
    await page.keyboard.press('Backquote');
    await page.locator('dst-debug-console input').fill(text);
    await page.locator('dst-debug-console input').press('Enter');
  };
  await command('c_spawn("multiplayer_portal_moonrock")');
  const sceneUrl = `/@fs${fileURLToPath(new URL('../../../src/universal.ts', import.meta.url))}`;
  await expect.poll(() => page.evaluate(async (url) => {
    const { scene } = await import(url);
    return scene.children.filter((model: any) => model.userData.instance?.prefab === 'multiplayer_portal_moonrock').length;
  }, sceneUrl)).toBe(1);
  const portalDownload = page.waitForEvent('download');
  await command('c_save()');
  const json = await readSaveDownload((await (await portalDownload).path())!, 'Master');
  const saved = JSON.parse(json);
  expect(saved.snapshot.parentId).toBe(firstSave.snapshot.id);
  const portal = saved.world.entities.multiplayer_portal_moonrock[0];
  const naturalFlower = saved.world.entities.flower[0];
  expect(naturalFlower.components.flower.planted).toBeUndefined();
  // Serve the actual downloaded document through the game's normal startup loader.
  await page.route('**/saves/Cluster_1/Master.json', (route) => route.fulfill({ contentType: 'application/json', body: json }));
  await page.reload();
  await page.evaluate(async (url) => { await import(url); },
    `/@fs${fileURLToPath(new URL('../../../src/main.ts', import.meta.url))}`);
  expect(await page.evaluate(async ({ url, id }) => {
    const { scene } = await import(url);
    const model = scene.children.find((model: any) => model.userData.instance?.entityId === id);
    return { prefab: model?.userData.instance?.prefab, position: model?.position.toArray() };
  }, { url: sceneUrl, id: portal.id })).toEqual({ prefab: 'multiplayer_portal_moonrock', position: portal.transform.position });
  expect(await page.evaluate(async ({ url, id }) => {
    const { scene } = await import(url);
    const flower = scene.children.find((model: any) => model.userData.instance?.entityId === id);
    return { planted: flower?.userData.planted, animation: flower?.userData.flowerAnimation,
      position: flower?.position.toArray() };
  }, { url: sceneUrl, id: naturalFlower.id })).toEqual({ planted: false,
    animation: naturalFlower.components.flower.animation, position: naturalFlower.transform.position });
  expect(errors).toEqual([]);
});
