import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

/** Load the cluster's shard with a single entrance 9 units from the player. */
async function openGame(page: import('@playwright/test').Page, prefab: 'cave_entrance' | 'cave_entrance_open' | 'cave_exit') {
  const shard = prefab === 'cave_exit' ? 'Caves' : 'Master';
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route(`**/saves/Cluster_1/${shard}.json`, async route => {
    const response = await route.fetch(), save = await response.json();
    const [x, y, z] = save.players.local.transform.position;
    delete save.world.entities.cave_entrance; delete save.world.entities.cave_entrance_open; delete save.world.entities.cave_exit;
    save.world.entities[prefab] = [{ id: 'entrance', transform: { position: [x, y, z - 9], rotationY: 0 }, components: {} }];
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  await page.goto(`/tests/dst-lighting.html?save=Cluster_1/${shard}.json`);
  await page.evaluate(async urls => {
    await import(urls.main);
    const { scene, renderer } = await import(urls.universal), { camera } = await import(urls.camera);
    (window as any).caveGame = { scene, renderer, camera };
  }, urls);
  await expect(page.locator('canvas[data-game-canvas]')).toHaveAttribute('data-loaded', 'true');
  return errors;
}

/** Screen position of the entrance's ground point, raised by `height` for upright art. */
const entrancePoint = (page: import('@playwright/test').Page, height: number) => page.evaluate(height => {
  const { scene, renderer, camera } = (window as any).caveGame;
  const entrance = scene.children.find((model: any) => (window as any).__prefabInstance(model)?.entityId === 'entrance');
  const ndc = entrance.position.clone().setY(height).project(camera), rect = renderer.domElement.getBoundingClientRect();
  return { x: rect.left + (ndc.x + 1) * rect.width / 2, y: rect.top + (1 - ndc.y) * rect.height / 2 };
}, height);

test('right-clicking a closed cave entrance with a pickaxe walks up to it and mines it open', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await openGame(page, 'cave_entrance');
  await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command: 'c_give("pickaxe")' } })));
  const bar = page.locator('dst-inventory-bar'), hand = bar.locator('.inventory-bar__equipment .inventory-slot').first();
  await bar.locator('.inventory-bar__items [data-item-id="pickaxe"]').dragTo(hand);
  await expect(hand).toHaveAttribute('data-item-id', 'pickaxe');
  const workLeft = () => page.evaluate(() => ((window as any).__findActionEntity((window as any).caveGame.scene.children
    .find((model: any) => (window as any).__prefabInstance(model)?.entityId === 'entrance'))?.components ?? (window as any).__prefabInstance((window as any).caveGame.scene.children
    .find((model: any) => (window as any).__prefabInstance(model)?.entityId === 'entrance'))!.components).workable?.GetWorkLeft() ?? 0);
  for (let hit = 0; hit < 6; hit++) {
    const point = await entrancePoint(page, 3);
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await expect.poll(workLeft, { timeout: 10_000 }).toBe(5 - hit);
    if (hit < 5) await page.waitForTimeout(1500);
  }
  await expect.poll(() => page.evaluate(() => (window as any).caveGame.scene.children
    .some((model: any) => (window as any).__prefabInstance(model)?.prefab === 'cave_entrance_open'))).toBe(true);
  expect(errors).toEqual([]);
});

test('clicking an open cave entrance walks up to it and loads the Caves shard', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await openGame(page, 'cave_entrance_open');
  const point = await entrancePoint(page, 0);
  await page.mouse.click(point.x, point.y);
  await page.waitForURL(/save=Cluster_1%2FCaves\.json|save=Cluster_1\/Caves\.json/, { timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('clicking a cave exit walks up to it and loads the Master shard', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await openGame(page, 'cave_exit');
  const point = await entrancePoint(page, 0);
  await page.mouse.click(point.x, point.y);
  await page.waitForURL(/save=Cluster_1%2FMaster\.json|save=Cluster_1\/Master\.json/, { timeout: 15_000 });
  expect(errors).toEqual([]);
});
