import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera', 'player'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('turf commands render native art, split stacks and preserve drops and pickups through exported saves', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.entities = {}; save.world.elapsedSeconds = 0;
    save.players.local.transform.position = [0, 0, 0];
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  const prepare = () => page.evaluate(async urls => {
    const main = await import(urls.main), { scene, renderer } = await import(urls.universal);
    const { camera } = await import(urls.camera), { player, playerBody } = await import(urls.player);
    (window as any).turfGame = { main, scene, renderer, camera, player, playerBody };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const saveGame = async () => {
    const download = page.waitForEvent('download'); await submit('c_save()');
    return JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  };
  const ground = () => page.evaluate(() => (window as any).turfGame.scene.children
    .filter((model: any) => model.userData.itemId?.startsWith('turf_')).map((model: any) => ({
      id: model.userData.entityId, itemId: model.userData.itemId,
      vertices: model.children[0].children[0].geometry.drawRange.count,
      materials: model.children[0].children[0].material.map((material: any) => material.name),
    })));
  const items = (save: any) => Object.values(save.players.local.inventory.containers)
    .flatMap((container: any) => container.slots.map((slot: any) => slot.item));

  await page.goto('/tests/dst-lighting.html'); await prepare();
  await submit('c_spawn("turf_underrock"); c_give("turf_cotl_brick", 25)');
  const bag = page.locator('dst-inventory-bar .inventory-bar__items');
  const brick = bag.locator('[data-item-id="turf_cotl_brick"]');
  await expect(brick).toHaveCount(2);
  await expect(brick.first().locator('.inventory-slot__icon[data-loaded="true"]')).toHaveAttribute('data-element', 'turf_cotl_brick.tex');
  await expect.poll(async () => (await ground()).length).toBe(1);
  const spawned = (await ground())[0];
  expect(spawned.vertices).toBeGreaterThan(0);
  expect(spawned.materials).toContain('ground:turf');
  await page.keyboard.down('Shift'); await brick.first().click({ button: 'right' }); await page.keyboard.up('Shift');
  await expect.poll(async () => (await ground()).length).toBe(2);
  expect((await ground()).find(item => item.itemId === 'turf_cotl_brick')!.materials).toContain('ground:turf_cotl');
  const saved = await saveGame();
  expect(saved.world.entities.ground_item.find((record: any) => record.components.stack.itemId === 'turf_cotl_brick')
    .components.stack.count).toBe(1);
  expect(items(saved).filter((item: any) => item.itemId === 'turf_cotl_brick').map((item: any) => item.count)).toEqual([19, 5]);
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload(); await prepare();
  await expect.poll(async () => (await ground()).length).toBe(2);
  expect((await saveGame()).world.entities.ground_item).toEqual(saved.world.entities.ground_item);

  // Move the target away from the other drop so an actual pointer click picks this item.
  const point = await page.evaluate(id => {
    const { scene, camera, renderer, player, playerBody } = (window as any).turfGame;
    const model = scene.children.find((model: any) => model.userData.entityId === id);
    for (const other of scene.children) if (other.userData.itemId === 'turf_cotl_brick') other.position.x += 30;
    playerBody.position.set(model.position.x + 3, playerBody.shapes[0].radius, model.position.z + 3);
    player.position.set(model.position.x + 3, 0, model.position.z + 3);
    scene.updateMatrixWorld(true);
    const mesh = model.children[0].children[0]; mesh.geometry.computeBoundingBox();
    const center = mesh.geometry.boundingBox.getCenter(model.position.clone()); mesh.localToWorld(center).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (center.x + 1) * rect.width / 2, y: rect.top + (1 - center.y) * rect.height / 2 };
  }, spawned.id);
  await page.mouse.click(point.x, point.y);
  await expect(bag.locator('[data-item-id="turf_underrock"]')).toBeVisible();
  const taken = await saveGame();
  expect(items(taken).find((item: any) => item.entityId === spawned.id)).toMatchObject({ itemId: 'turf_underrock', count: 1 });
  expect(taken.world.entities.ground_item.some((record: any) => record.id === spawned.id)).toBe(false);
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: taken }));
  await page.reload(); await prepare();
  expect(items(await saveGame())).toEqual(items(taken));
  await expect(bag.locator('[data-item-id="turf_underrock"] .inventory-slot__icon[data-loaded="true"]')).toHaveAttribute('data-element', 'turf_underrock.tex');
  expect(errors).toEqual([]);
});
