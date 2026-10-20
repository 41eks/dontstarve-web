import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera', 'player'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('right-click mining breaks a moon shell and preserves the orb and mineral drops through c_save and reload', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.entities = { rock_moon_shell: [{ id: 'mine-shell', transform: { position: [0, 0, -6], rotationY: 0 }, components: {} }] };
    save.players.local.transform.position = [0, 0, 0];
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  const prepare = () => page.evaluate(async urls => {
    await import(urls.main);
    const { scene, renderer } = await import(urls.universal), { camera } = await import(urls.camera);
    (window as any).miningGame = { scene, renderer, camera };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const saveGame = async () => {
    const download = page.waitForEvent('download'); await submit('c_save()');
    return JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  };
  const workLeft = () => page.evaluate(() => {
    const shell = (window as any).miningGame.scene.children.find((model: any) => model.userData.entityId === 'mine-shell');
    return shell?.userData.components.workable.GetWorkLeft() ?? 0;
  });
  await page.goto('/tests/dst-lighting.html?save=initial-world.json'); await prepare();
  await expect(page.locator('canvas[data-game-canvas]')).toHaveAttribute('data-loaded', 'true');
  await submit('c_give("pickaxe")');
  const bar = page.locator('dst-inventory-bar'), hand = bar.locator('.inventory-bar__equipment .inventory-slot').first();
  await bar.locator('.inventory-bar__items [data-item-id="pickaxe"]').dragTo(hand);
  await expect(hand).toHaveAttribute('data-item-id', 'pickaxe');
  for (let hit = 0; hit < 6; hit++) {
    const point = await page.evaluate(() => {
      const { scene, renderer, camera } = (window as any).miningGame;
      const shell = scene.children.find((model: any) => model.userData.entityId === 'mine-shell');
      const mesh = shell.children[0].children[0]; mesh.updateWorldMatrix(true, false);
      const positions = mesh.geometry.getAttribute('position'), indices = mesh.geometry.index;
      const point = shell.position.clone().multiplyScalar(0), vertex = point.clone();
      for (let i = 0; i < 3; i++) { vertex.fromBufferAttribute(positions, indices.getX(i)); mesh.localToWorld(vertex); point.add(vertex); }
      const ndc = point.multiplyScalar(1 / 3).project(camera), rect = renderer.domElement.getBoundingClientRect();
      return { x: rect.left + (ndc.x + 1) * rect.width / 2, y: rect.top + (1 - ndc.y) * rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await expect.poll(workLeft, { timeout: 10_000 }).toBe(5 - hit);
    if (hit < 5) await page.waitForTimeout(700);
  }
  const saved = await saveGame();
  expect(saved.world.entities.rock_moon_shell ?? []).toEqual([]);
  expect(saved.world.entities.moonrockseed).toHaveLength(1);
  expect(saved.players.local.inventory.containers['player:equipment'].slots[0].item.remainingUses).toBe(27);
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload(); await prepare();
  await expect(page.locator('canvas[data-game-canvas]')).toHaveAttribute('data-loaded', 'true');
  const restored = await saveGame();
  expect(restored.world.entities.rock_moon_shell ?? []).toEqual([]);
  expect(restored.world.entities.moonrockseed).toEqual(saved.world.entities.moonrockseed);
  expect(restored.world.entities.ground_item).toEqual(saved.world.entities.ground_item);
  expect(errors).toEqual([]);
});
