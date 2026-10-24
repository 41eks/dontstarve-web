import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

test('c_save downloads before and after a portal spawn, plays the saving clips and restores the downloaded world', async ({ page }) => {
  test.setTimeout(120_000);
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
  expect((await download).suggestedFilename()).toBe('initial-world.json');
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
    return scene.children.filter((model: any) => model.userData.prefab === 'multiplayer_portal_moonrock').length;
  }, sceneUrl)).toBe(1);
  const portalDownload = page.waitForEvent('download');
  await command('c_save()');
  const json = await readFile((await (await portalDownload).path())!, 'utf8');
  const saved = JSON.parse(json);
  const portal = saved.world.entities.multiplayer_portal_moonrock[0];
  // Serve the actual downloaded document through the game's normal startup loader.
  await page.route('**/saves/initial-world.json', (route) => route.fulfill({ contentType: 'application/json', body: json }));
  await page.reload();
  await page.evaluate(async (url) => { await import(url); },
    `/@fs${fileURLToPath(new URL('../../../src/main.ts', import.meta.url))}`);
  expect(await page.evaluate(async ({ url, id }) => {
    const { scene } = await import(url);
    const model = scene.children.find((model: any) => model.userData.entityId === id);
    return model?.userData.prefab;
  }, { url: sceneUrl, id: portal.id })).toBe('multiplayer_portal_moonrock');
  expect(errors).toEqual([]);
});
