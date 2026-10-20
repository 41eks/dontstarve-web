import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera', 'player', 'view'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('spawned moonbutterfly glows, flies away on its own and survives save and load', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.entities = {};
    save.players.local.transform.position = [0, 0, 0];
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  const prepare = () => page.evaluate(async urls => {
    const main = await import(urls.main), { scene, renderer } = await import(urls.universal);
    const { camera } = await import(urls.camera);
    const { player } = await import(urls.player);
    (window as any).mothGame = { main, scene, renderer, camera, player };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const moth = () => page.evaluate(() => {
    const model = (window as any).mothGame.scene.children.find((child: any) => child.name === 'GroundItem:moonbutterfly');
    return model ? { x: model.position.x, z: model.position.z, state: model.userData.butterflyController.state,
      light: model.userData.dstPrefabLocalLight?.intensity ?? null, tags: model.userData.tags } : null;
  });
  const saveGame = async () => {
    const download = page.waitForEvent('download', { timeout: 15_000 }); await submit('c_save()');
    return JSON.parse(await readSaveDownload((await (await download).path())!));
  };

  await page.goto('/tests/dst-lighting.html'); await prepare();
  await submit('c_spawn("moonbutterfly")');
  await expect.poll(moth).not.toBeNull();
  const first = (await moth())!;
  expect(first.tags).toContain('lunar_aligned');
  expect(first.light).toBeGreaterThan(.45);
  // Its brain wakes after the priority-node scatter and wander wait, then it flies.
  await expect.poll(async () => { const now = (await moth())!; return Math.hypot(now.x - first.x, now.z - first.z); },
    { timeout: 20_000 }).toBeGreaterThan(1);
  const saved = await saveGame();
  expect(saved.world.entities.ground_item.map((record: any) => record.components.stack.itemId)).toContain('moonbutterfly');
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload(); await prepare();
  await expect.poll(moth).not.toBeNull();
  expect(errors).toEqual([]);
});

test('plants a captured moonbutterfly, saves seedlings and tree commands, and grows the planted seedling after reload', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.entities = {};
    save.world.map.generator.options.size = 96;
    delete save.world.map.tiles;
    save.players.local.transform.position = [0, 0, 0];
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  const prepare = () => page.evaluate(async paths => {
    const main = await import(paths.main), { scene, renderer } = await import(paths.universal);
    const { camera } = await import(paths.camera), { player } = await import(paths.player), { view } = await import(paths.view);
    (window as any).mothGame = { main, scene, renderer, camera, player, view };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const saveGame = async () => {
    const download = page.waitForEvent('download', { timeout: 15_000 }); await submit('c_save()');
    return JSON.parse(await readSaveDownload((await (await download).path())!));
  };
  const preview = () => page.evaluate(() => (window as any).mothGame.scene.children.some((model: any) => model.name === 'PlantPlacer'));
  await page.goto('/tests/dst-lighting.html'); await prepare();
  await submit('c_give("moonbutterfly", 2)');
  const slot = page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="moonbutterfly"]');
  await expect(slot).toHaveCount(1);
  await slot.click({ button: 'right' }); await expect.poll(preview).toBe(true);
  await page.keyboard.press('Escape'); await expect.poll(preview).toBe(false);
  expect((await saveGame()).players.local.inventory.containers['player:inventory'].slots[0].item.count).toBe(2);
  await slot.click({ button: 'right' }); await expect.poll(preview).toBe(true);
  const point = await page.evaluate(() => {
    const { player, camera, renderer } = (window as any).mothGame;
    const ndc = player.position.clone().set(6, 0, -6).project(camera), bounds = renderer.domElement.getBoundingClientRect();
    return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2 };
  });
  await page.mouse.move(point.x, point.y);
  await expect.poll(() => page.evaluate(() => (window as any).mothGame.view.mouseActions.getMouseActions().right?.action)).toBe('DEPLOY');
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).mothGame.scene.children.find((model: any) => model.name === 'MoonTreeForest')
    .children.filter((model: any) => model.userData.prefab === 'moonbutterfly_sapling').length)).toBe(1);
  await expect(page.locator('.slot-drag-preview')).toHaveAttribute('data-item-id', 'moonbutterfly');
  await page.keyboard.press('Escape');
  await expect.poll(preview).toBe(false);
  const planted = await saveGame();
  const seed = planted.world.entities.moonbutterfly_sapling[0];
  expect(seed.transform.position[0]).toBeCloseTo(6);
  expect(seed.transform.position[1]).toBe(0);
  expect(seed.transform.position[2]).toBeCloseTo(-6);
  expect(planted.players.local.inventory.containers['player:inventory'].slots[0].item).toMatchObject({ itemId: 'moonbutterfly', count: 1 });
  await submit('c_spawn("moon_tree_normal")'); await submit('c_spawn("moonbutterfly_sapling")');
  const saved = await saveGame();
  expect(saved.world.entities.moon_tree[0].components).toMatchObject({ moonTree: { size: 'normal' }, growable: { stage: 2 } });
  expect(saved.world.entities.moonbutterfly_sapling).toHaveLength(2);
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload(); await prepare();
  const restored = await saveGame();
  expect(restored.world.entities.moonbutterfly_sapling.map((record: any) => ({ id: record.id, transform: record.transform })))
    .toEqual(saved.world.entities.moonbutterfly_sapling.map((record: any) => ({ id: record.id, transform: record.transform })));
  expect(restored.world.entities.moon_tree[0].id).toBe(saved.world.entities.moon_tree[0].id);
  // A near-deadline save exercises the actual scheduler without waiting several game minutes.
  restored.world.entities.moonbutterfly_sapling.find((record: any) => record.id === seed.id).components.saplingTimer.timers.grow.timeleft = .1;
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: restored }));
  await page.reload(); await prepare();
  await expect.poll(async () => (await saveGame()).world.entities.moon_tree.length, { timeout: 20_000 }).toBe(2);
  const grown = await saveGame();
  expect(grown.world.entities.moonbutterfly_sapling.map((record: any) => record.id)).not.toContain(seed.id);
  const short = grown.world.entities.moon_tree.find((record: any) => record.components.moonTree.size === 'short');
  expect(short.transform).toEqual(seed.transform);
  expect(short.components.growable.stage).toBe(1);
  expect(errors).toEqual([]);
});
