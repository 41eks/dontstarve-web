import { readSaveDownload } from './save-download';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const url = (name: string) => `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`;

test('map right clicks teleport across ocean for free, release autopause once and save the destination', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const source = JSON.parse(await readFile(new URL('../../../public/saves/Cluster_1/Master.json', import.meta.url), 'utf8'));
  const ground = JSON.parse(await readFile(new URL('../../prefab/src/groundTiles.json', import.meta.url), 'utf8'));
  source.world.entities = {}; source.world.elapsedSeconds = 0;
  source.world.map.generator.options.size = 768;
  source.world.map.defaultTileId = 1;
  source.world.map.tiles = [];
  for (let row = -32; row < 32; row++) for (let col = -32; col < 32; col++) {
    const land = row >= -1 && row <= 1 && (Math.abs(col) <= 1 || Math.abs(col - 23) <= 1);
    source.world.map.tiles.push({ col, row, tileId: land ? ground.GRASS.tileId : ground.OCEAN_COASTAL.tileId });
  }
  source.players.local.transform.position = [6, 0, 6];
  source.players.local.wortox = { freehops: 1, soulhopcost: 0 };
  for (const container of Object.values(source.players.local.inventory.containers) as any[]) container.slots = [];
  source.players.local.inventory.bufferedBuilds = [];
  let loaded = source;
  await page.route('**/saves/Cluster_1/Master.json', route => route.fulfill({ json: loaded }));
  const prepare = () => page.evaluate(async urls => {
    const main = await import(urls.main); await main.gameReady;
    const { player, playerBody } = await import(urls.player), { followCamera } = await import(urls.camera);
    const { IsAutopaused } = await import(urls.autopause);
    const { playerStats } = await import(urls.playerStats);
    const map = document.querySelector('dst-minimap') as any;
    const probe = (window as any).mapHop = { main, player, playerBody, followCamera, map, IsAutopaused, stats: playerStats,
      consumptions: 0, snaps: [] as number[][] };
    const consume = main.inventory.ConsumeByName;
    main.inventory.ConsumeByName = function (...args: unknown[]) { probe.consumptions++; return consume.apply(this, args); };
    const snap = followCamera.snap;
    followCamera.snap = function () { snap.call(this); probe.snaps.push([player.position.x, player.position.z]); };
  }, Object.fromEntries(['main', 'player', 'camera', 'autopause', 'playerStats'].map(name => [name, url(name)])));
  const snapshot = () => page.evaluate(() => {
    const p = (window as any).mapHop;
    return { x: p.player.position.x, z: p.player.position.z, state: p.player.userData.stategraph.stateName,
      paused: p.IsAutopaused(), open: p.map.isOpen, mask: p.playerBody.collisionFilterMask, invincible: p.stats.health.invincible,
      wortox: p.player.userData.wortox.OnSave(), consumptions: p.consumptions, snaps: p.snaps };
  });
  const open = async () => {
    await page.keyboard.press('m');
    await page.evaluate(() => {
      const p = (window as any).mapHop;
      p.followCamera.setHeadingTarget(-90); p.followCamera.snap(); p.snaps = [];
    });
    await page.waitForTimeout(0);
    await page.evaluate(() => (window as any).mapHop.map.setView({ x: 144, z: 6, zoom: 20 }));
    expect((await snapshot()).paused).toBe(true);
  };
  const clickMap = async (x: number, z: number) => {
    const point = await page.evaluate(([x, z]) => (window as any).mapHop.map.view.worldToScreen(x, z), [x, z]);
    await page.mouse.click(point.x, point.z, { button: 'right' });
  };
  await page.goto('/tests/dst-lighting.html?save=Cluster_1/Master.json'); await prepare();
  const initial = await snapshot();
  await open();
  await clickMap(144, 6);
  expect(await snapshot()).toMatchObject({ x: 6, z: 6, state: 'idle', paused: true, snaps: [] });
  await clickMap(282, 6);
  await expect.poll(async () => (await snapshot()).x, { timeout: 15_000 }).toBeCloseTo(282, 1);
  await expect.poll(async () => (await snapshot()).state).toBe('idle');
  expect(await snapshot()).toMatchObject({ open: true, paused: false, mask: initial.mask, invincible: false,
    wortox: { freehops: 1, soulhopcost: 0 }, consumptions: 0, snaps: [[282, 6]] });
  // A second map action must not release an already released autopause count.
  await page.evaluate(() => (window as any).mapHop.map.setView({ x: 144, z: 6, zoom: 20 }));
  await clickMap(6, 6);
  await expect.poll(async () => (await snapshot()).x).toBeCloseTo(6, 1);
  await expect.poll(async () => (await snapshot()).state).toBe('idle');
  await page.evaluate(() => (window as any).mapHop.map.setView({ x: 144, z: 6, zoom: 20 }));
  await clickMap(282, 6);
  await expect.poll(async () => (await snapshot()).x).toBeCloseTo(282, 1);
  await expect.poll(async () => (await snapshot()).state).toBe('idle');
  await page.keyboard.press('Escape');
  expect(await snapshot()).toMatchObject({ open: false, paused: false, consumptions: 0 });
  await open();
  await page.keyboard.press('Escape');
  expect((await snapshot()).paused).toBe(false);
  const download = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command: 'c_save()' } })));
  loaded = JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  expect(loaded.players.local.transform.position[0]).toBeCloseTo(282, 1);
  expect(loaded.players.local.transform.position[2]).toBeCloseTo(6, 1);
  expect(loaded.players.local.wortox).toEqual({ freehops: 1, soulhopcost: 0 });
  expect(Object.values(loaded.players.local.inventory.containers).every((container: any) => container.slots.length === 0)).toBe(true);
  await page.reload(); await prepare();
  expect(await snapshot()).toMatchObject({ x: 282, z: 6, state: 'idle', wortox: { freehops: 1, soulhopcost: 0 }, consumptions: 0 });
  expect(errors).toEqual([]);
});

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
