import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
urls.minimap = `/@fs${fileURLToPath(new URL('../../map/src/minimapEntities.ts', import.meta.url))}`;

test('pig king and ground backpack icons render, backpack ownership hides them, and saved positions reload', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let saved: any;
  await page.route('**/saves/initial-world.json', async route => {
    if (saved) { await route.fulfill({ json: saved }); return; }
    const response = await route.fetch(), initial = await response.json();
    for (const [prefab, records] of Object.entries(initial.world.entities)) {
      if (prefab !== 'pigking') initial.world.entities[prefab] = [];
      else (records as any[]).forEach(record => { record.transform.position = [0, 0, 36]; });
    }
    for (const container of Object.values(initial.players.local.inventory.containers) as any[]) container.slots = [];
    initial.players.local.transform.position = [0, 0, 0];
    initial.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: initial });
  });
  const start = async () => {
    await page.evaluate(async urls => {
      const main = await import(urls.main), { scene } = await import(urls.universal), { miniMapEntities } = await import(urls.minimap);
      const map = document.querySelector('dst-minimap') as any;
      (window as any).worldIcons = { main, scene, map, entities: () => [...miniMapEntities()].filter(icon => icon.enabled) };
    }, urls);
    await page.keyboard.press('m');
    await expect(page.locator('dst-minimap section.minimap')).toBeVisible();
  };
  await page.goto('/tests/dst-lighting.html?save=initial-world.json');
  await start();
  const command = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  await command('c_spawn("backpack")');
  await expect.poll(() => page.evaluate(() => (window as any).worldIcons.entities().filter((icon: any) => icon.icon === 'backpack.png').length)).toBe(1);
  const identities = await page.evaluate(() => {
    const g = (window as any).worldIcons;
    const model = g.scene.children.find((object: any) => object.userData.itemId === 'backpack');
    g.bag = model.userData.pickupTarget.entity;
    g.bag.transform.position.set(36, 0, -24);
    g.bag.MiniMapEntity.tileTracker.sync();
    g.map.setView({ x: 0, z: 0, zoom: 1 });
    const king = g.scene.children.find((model: any) => (window as any).__prefabInstance(model)?.prefab === 'pigking');
    g.king = (window as any).__prefabInstance(king);
    const pigIcon = g.entities().find((icon: any) => icon.icon === 'pigking.png');
    return { backpackId: g.bag.id, pigKingId: (window as any).__prefabInstance(king)?.entityId, pigPriority: pigIcon.priority };
  });
  expect(identities.pigPriority).toBe(1);
  await expect.poll(() => page.evaluate(async () => {
    const { icons } = await (window as any).worldIcons.map.inspect();
    return icons.includes('pigking.png') && icons.includes('backpack.png');
  })).toBe(true);
  const icons = page.locator('dst-minimap .marker[data-icon="pigking.png"], dst-minimap .marker[data-icon="backpack.png"]');
  await expect(icons).toHaveCount(2);
  await expect.poll(() => icons.evaluateAll(images => images.every(image => !(image as HTMLImageElement).hidden
    && (image as HTMLElement).dataset.loaded === 'true' && Boolean((image as HTMLElement).style.backgroundImage)))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('pigking-backpack-minimap.png') });
  await page.evaluate(() => {
    const g = (window as any).worldIcons;
    g.king.minimap.SetEnabled(false);
    g.bag.MiniMapEntity.SetEnabled(false);
  });
  await expect(icons).toHaveCount(0);
  await page.evaluate(() => {
    const g = (window as any).worldIcons;
    g.king.minimap.SetEnabled(true);
    g.bag.MiniMapEntity.SetEnabled(true);
    if (!g.main.inventory.Equip(g.bag)) throw new Error('Backpack equip failed');
  });
  await expect.poll(() => page.evaluate(() => (window as any).worldIcons.entities().some((icon: any) => icon.icon === 'backpack.png'))).toBe(false);
  expect(await page.evaluate(() => (window as any).worldIcons.bag.MiniMapEntity.enabled)).toBe(false);
  await expect(page.locator('dst-minimap .marker[data-icon="backpack.png"]')).toHaveCount(0);
  await page.evaluate(() => {
    const g = (window as any).worldIcons;
    g.main.inventory.DropItem(g.bag, g.bag.transform.position.clone().set(36, 0, -24));
  });
  await expect.poll(() => page.evaluate(() => (window as any).worldIcons.entities().some((icon: any) => icon.icon === 'backpack.png'))).toBe(true);
  await expect(page.locator('dst-minimap .marker[data-icon="backpack.png"]')).toBeVisible();
  const download = page.waitForEvent('download');
  await command('c_save()');
  saved = JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  const bag = saved.world.entities.ground_item.find((record: any) => record.id === identities.backpackId);
  expect(bag.transform.position).toEqual([36, 0, -24]);
  expect(bag.components.stack).toMatchObject({ itemId: 'backpack', count: 1 });
  expect(saved.world.entities.pigking[0]).toMatchObject({ id: identities.pigKingId, transform: { position: [0, 0, 36] } });
  await page.reload();
  await start();
  await expect.poll(() => page.evaluate(() => {
    const g = (window as any).worldIcons;
    return g.entities().filter((icon: any) => icon.icon === 'pigking.png' || icon.icon === 'backpack.png')
      .map((icon: any) => ({ icon: icon.icon, x: icon.position.x, z: icon.position.z }));
  })).toEqual([{ icon: 'pigking.png', x: 0, z: 36 }, { icon: 'backpack.png', x: 36, z: -24 }]);
  await expect(icons).toHaveCount(2);
  expect(await page.evaluate(() => {
    const g = (window as any).worldIcons;
    return (window as any).__prefabInstance(g.scene.children.find((object: any) => object.userData.itemId === 'backpack'))?.entityId;
  })).toBe(identities.backpackId);
  expect(errors).toEqual([]);
});

test('tree icons use native art, survive model unloading and retain identities and positions after saving', async ({ page }) => {
  test.setTimeout(240_000);
  let saved: any;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/saves/initial-world.json', async route => {
    if (saved) { await route.fulfill({ json: saved }); return; }
    const response = await route.fetch(), initial = await response.json();
    initial.world.entities = {};
    initial.players.local.transform.position = [0, 0, 0];
    await route.fulfill({ response, json: initial });
  });
  const command = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const prepare = async () => {
    await page.evaluate(async urls => {
      await import(urls.main);
      const { scene } = await import(urls.universal);
      const { miniMapEntities } = await import(urls.minimap);
      const map = document.querySelector('dst-minimap') as any;
      (window as any).treeMap = { scene, map, icons: () => [...miniMapEntities()].filter(icon => icon.enabled) };
    }, urls);
    await page.keyboard.press('m');
  };
  const treeIcons = ['evergreen.png', 'tree_leaf.png', 'moon_tree.png', 'mushroom_tree_med.png'];
  const checkIcons = async () => {
    for (const icon of treeIcons) {
      const image = page.locator(`dst-minimap .marker[data-icon="${icon}"]`);
      await expect(image).toBeVisible({ timeout: 30_000 });
      await expect(image).toHaveAttribute('data-loaded', 'true');
    }
  };
  await page.goto('/tests/dst-lighting.html?save=initial-world.json');
  await prepare();
  await command('c_spawn("evergreen_normal"); c_spawn("deciduoustree_normal"); c_spawn("moon_tree_normal"); c_spawn("mushtree_medium")');
  await checkIcons();
  expect(await page.evaluate(() => {
    const g = (window as any).treeMap;
    return g.icons().filter((icon: any) => ['evergreen.png', 'tree_leaf.png', 'moon_tree.png'].includes(icon.icon))
      .every((icon: any) => icon.priority === -1);
  })).toBe(true);
  const download = page.waitForEvent('download');
  await command('c_save()');
  saved = JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  const before = ['evergreen', 'deciduoustree', 'moon_tree', 'mushtree_medium'].map(prefab => ({
    prefab, id: saved.world.entities[prefab][0].id, transform: saved.world.entities[prefab][0].transform,
  }));
  // Restore trees outside the world's model load radius while keeping their positions in map view.
  for (const { prefab } of before) saved.world.entities[prefab][0].transform.position = [144, 0, 0];
  await page.reload(); await prepare();
  await page.evaluate(() => (window as any).treeMap.map.setView({ x: 144, z: 0, zoom: 1 }));
  await checkIcons();
  expect(await page.evaluate(() => {
    const { scene } = (window as any).treeMap;
    let count = 0;
    scene.traverse((object: any) => { if (['evergreen', 'deciduoustree', 'moon_tree'].includes((window as any).__prefabInstance(object)?.prefab)) count++; });
    return count;
  })).toBe(0);
  const restoredDownload = page.waitForEvent('download');
  await command('c_save()');
  const restored = JSON.parse(await readSaveDownload((await (await restoredDownload).path())!, 'Master'));
  for (const { prefab, id } of before) {
    expect(restored.world.entities[prefab][0]).toMatchObject({ id, transform: { position: [144, 0, 0] } });
  }
  expect(errors).toEqual([]);
});

test('ground map image retries at a lower density when the browser cannot encode a very large image', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [], warnings: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
    if (message.type() === 'warning' && message.text().startsWith('Unable to build the ground map image')) warnings.push(message.text());
  });
  await page.addInitScript(() => {
    const convert = OffscreenCanvas.prototype.convertToBlob;
    OffscreenCanvas.prototype.convertToBlob = function (this: OffscreenCanvas, ...args) {
      return this.width > 4096 ? Promise.resolve(new Blob([])) : convert.apply(this, args);
    };
  });
  await page.goto('/tests/dst-lighting.html?save=Cluster_1/Master.json');
  const ready = await page.evaluate(async url => {
    await (await import(url)).gameReady;
    return (await (document.querySelector('dst-minimap') as any).inspect()).ready;
  }, urls.main);
  expect(ready).toBe(true);
  expect(warnings.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
