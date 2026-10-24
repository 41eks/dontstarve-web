import { readSaveDownload } from './save-download';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const url = (name: string) => `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`;

test('empty-inventory right clicks soul-hop, show Soul Echo, preserve counters on save/reload, and reject cave void', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const messages: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'info') messages.push(message.text());
    if (message.type() === 'error' || message.type() === 'warning' && message.text().startsWith('Unable to prepare')) errors.push(message.text());
  });
  const source = JSON.parse(await readFile(new URL('../../../public/saves/Cluster_1/Caves.json', import.meta.url), 'utf8'));
  source.world.entities = {}; source.world.elapsedSeconds = 0;
  source.world.map.tiles = [];
  for (let row = -3; row <= 3; row++) for (let col = -3; col <= 3; col++) source.world.map.tiles.push({ col, row, tileId: 3 });
  source.players.local.transform.position = [6, 0, 6];
  for (const container of Object.values(source.players.local.inventory.containers) as any[]) container.slots = [];
  source.players.local.inventory.bufferedBuilds = [];
  delete source.players.local.wortox;
  let loaded = source;
  await page.route('**/saves/Cluster_1/Caves.json', route => route.fulfill({ json: loaded }));
  const prepare = () => page.evaluate(async urls => {
    const main = await import(urls.main); await main.gameReady;
    const { player, playerBody } = await import(urls.player), { view } = await import(urls.view);
    const { playerStats } = await import(urls.playerStats);
    (window as any).soulHop = { player, playerBody, view, stats: playerStats };
  }, Object.fromEntries(['main', 'player', 'view', 'playerStats'].map(name => [name, url(name)])));
  const moveTo = async (x: number, z: number) => {
    const point = await page.evaluate(([x, z]) => {
      const { player, view } = (window as any).soulHop;
      const ndc = player.position.clone().set(x, 0, z).project(view.camera);
      const rect = view.renderer.domElement.getBoundingClientRect();
      return { x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height };
    }, [x, z]);
    await page.mouse.move(point.x, point.y);
  };
  const snapshot = () => page.evaluate(() => {
    const { player, playerBody, stats, view } = (window as any).soulHop;
    return { x: player.position.x, z: player.position.z, state: player.userData.stategraph.stateName,
      freehops: player.userData.wortox.freeHops.peek(), timer: player.userData.wortox.echoTimer.peek().status,
      invincible: stats.health.invincible, mask: playerBody.collisionFilterMask,
      action: view.mouseActions.getMouseActions().right?.action };
  });
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const save = async () => {
    const download = page.waitForEvent('download'); await submit('c_save()');
    return JSON.parse(await readSaveDownload((await (await download).path())!));
  };

  await page.goto('/tests/dst-lighting.html?save=Cluster_1/Caves.json'); await prepare();
  const initial = await snapshot();
  await moveTo(30, 6);
  await expect.poll(() => page.evaluate(() => (window as any).soulHop.view.mouseActions.getMouseActions().right?.modifier)).toBe('SOUL');
  await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
  await expect.poll(async () => (await snapshot()).x, { timeout: 15_000 }).toBeCloseTo(30, 0);
  await expect.poll(async () => (await snapshot()).state).toBe('idle');
  expect(await snapshot()).toMatchObject({ freehops: 1, invincible: false, mask: initial.mask });
  await moveTo(6, 30);
  await expect.poll(() => page.evaluate(() => (window as any).soulHop.view.mouseActions.getMouseActions().right?.modifier)).toBe('FREESOUL');
  await page.screenshot({ path: testInfo.outputPath('wortox-soul-echo.png') });

  // Both source FX can be debug-spawned; they are transient and must not become saved entities.
  await submit('c_spawn("wortox_portal_jumpin_fx")');
  await expect.poll(() => messages).toContain('已生成 wortox_portal_jumpin_fx');
  const saved = await save();
  expect(saved.players.local.wortox).toEqual({ freehops: 1, soulhopcost: 0 });
  expect(Object.keys(saved.world.entities)).not.toContain('wortox_portal_jumpin_fx');
  expect(Object.values(saved.players.local.inventory.containers).every((container: any) => container.slots.length === 0)).toBe(true);
  loaded = saved;
  await page.reload(); await prepare();
  expect(await snapshot()).toMatchObject({ freehops: 1, timer: 'stopped' });
  await moveTo(6, 30); await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
  await expect.poll(async () => (await snapshot()).z, { timeout: 15_000 }).toBeCloseTo(30, 0);
  await expect.poll(async () => (await snapshot()).state).toBe('idle');
  expect(await snapshot()).toMatchObject({ freehops: 0, invincible: false, mask: initial.mask });
  await submit('c_spawn("wortox_portal_jumpout_fx")');
  await expect.poll(() => messages).toContain('已生成 wortox_portal_jumpout_fx');
  expect(Object.keys((await save()).world.entities)).not.toContain('wortox_portal_jumpout_fx');
  await moveTo(90, 6);
  await expect.poll(async () => (await snapshot()).action).toBeUndefined();
  await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
  expect(await snapshot()).toMatchObject({ freehops: 0 });
  expect((await snapshot()).z).toBeCloseTo(30, 0);
  expect(errors).toEqual([]);
});
