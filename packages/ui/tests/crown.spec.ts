import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('equipped crown follows real sanity at the 85 percent boundary and recomputes activation after save/reload', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.entities = {}; save.world.elapsedSeconds = 0;
    save.players.local.transform.position = [0, 0, 0];
    save.players.local.stats = { health: 150, hunger: 150, sanity: 170 };
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  const paths = Object.fromEntries(['main', 'player', 'playerStats'].map(name =>
    [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  const lightPath = `/@fs${fileURLToPath(new URL('../../prefab/src/localLight.ts', import.meta.url))}`;
  const prepare = () => page.evaluate(async ({ paths, lightPath }) => {
    const main = await import(paths.main), { player } = await import(paths.player);
    const { playerStats } = await import(paths.playerStats), { getPrefabLocalLight } = await import(lightPath);
    (window as any).crownGame = { main, player, playerStats, getPrefabLocalLight };
  }, { paths, lightPath });
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const crown = () => page.evaluate(() => {
    const { player, getPrefabLocalLight } = (window as any).crownGame;
    const lightOwner = player.children.find((child: any) => child.name === 'HatActivationLight');
    const materials = player.getObjectByProperty('isMesh', true).material;
    return { light: lightOwner ? getPrefabLocalLight(lightOwner)?.radius ?? null : null,
      crownLoaded: materials.some((material: any) => material.name === 'hat:hat_alterguardian'),
      fx: materials.some((material: any) => material.name.includes('hat_alterguardian_equipped')) };
  });
  const saveGame = async () => {
    const download = page.waitForEvent('download'); await submit('c_save()');
    return JSON.parse(await readSaveDownload((await (await download).path())!));
  };
  const head = (save: any) => save.players.local.inventory.containers['player:equipment'].slots.find((slot: any) => slot.slotKey === 'head')?.item;
  await page.goto('/tests/dst-lighting.html'); await prepare();
  await submit('c_give("alterguardianhat")');
  const bar = page.locator('dst-inventory-bar');
  await bar.locator('.inventory-bar__items [data-item-id="alterguardianhat"]').dragTo(bar.locator('[data-slot-key="head"]'));
  await expect.poll(crown).toEqual({ light: null, crownLoaded: true, fx: false });
  await submit('c_setsanity(0.855)');
  await expect.poll(crown).toMatchObject({ light: 12, fx: true });
  await submit('c_setsanity(0.85)');
  await expect.poll(crown).toEqual({ light: null, crownLoaded: true, fx: false });
  await submit('c_setsanity(1)');
  await expect.poll(crown).toMatchObject({ light: 12, fx: true });
  const saved = await saveGame(), equipped = head(saved);
  expect(equipped).toMatchObject({ itemId: 'alterguardianhat', count: 1 });
  expect(saved.players.local.stats.sanity).toBe(200);
  saved.players.local.stats.sanity = 170;
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload(); await prepare();
  await expect.poll(crown).toEqual({ light: null, crownLoaded: true, fx: false });
  expect(head(await saveGame())).toEqual(equipped);
  // Direct stat writes use the same subscription as commands and food/equipment effects.
  await page.evaluate(() => (window as any).crownGame.playerStats.sanity.set(171));
  await expect.poll(crown).toMatchObject({ light: 12, fx: true });
  await bar.locator('[data-slot-key="head"]').dragTo(bar.locator('.inventory-bar__items [data-slot-key="0"]'));
  await expect.poll(crown).toEqual({ light: null, crownLoaded: false, fx: false });
  await submit('c_setsanity(1)');
  expect(await crown()).toEqual({ light: null, crownLoaded: false, fx: false });
  expect(errors).toEqual([]);
});

test('Enlightened Crown floats, orbits, skins and illuminates the ground until removed', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async url => {
    const { checkCrown } = await import(url);
    return checkCrown();
  }, `/@fs${fileURLToPath(new URL('./crown-fixture.ts', import.meta.url))}`);
  const screenshot = testInfo.outputPath('crown-activation.png');
  await page.locator('#crown-gallery').screenshot({ path: screenshot });
  await testInfo.attach('crown-activation.png', { path: screenshot, contentType: 'image/png' });
  expect(errors).toEqual([]);
  expect(result.differentFrames).toBe(true);
  expect(result.bloomChangesPixels).toBe(true);
  expect(result.failures).toEqual([]);
  expect(result.groundLight.lit).toBeGreaterThan(result.groundLight.dark + 100);
  expect(result.groundLight.lit).toBeGreaterThan(result.groundLight.far + 100);
  expect(result.groundLight.moved).toBeGreaterThan(result.groundLight.removed + 100);
  expect(result.groundLight.removed).toBeLessThan(30);
  expect(result.removedLight).toBe(true);
});
