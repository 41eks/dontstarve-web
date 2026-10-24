import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera', 'player'].map(name =>
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
    const download = page.waitForEvent('download'); await submit('c_save()');
    return JSON.parse(await readFile((await (await download).path())!, 'utf8'));
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
