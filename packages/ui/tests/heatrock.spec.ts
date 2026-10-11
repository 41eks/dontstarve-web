import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera', 'player'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('spawns and gives neutral thermal stones, reskins and transfers one, then saves and reloads their identities and fuel', async ({ page }) => {
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
    (window as any).heatRockGame = { main, scene, renderer, camera, player, playerBody };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const saveGame = async () => {
    const download = page.waitForEvent('download'); await submit('c_save()');
    return JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  };
  const ground = () => page.evaluate(() => (window as any).heatRockGame.scene.children
    .filter((model: any) => model.userData.itemId === 'heatrock').map((model: any) => ({
      id: model.userData.entityId, skin: model.userData.skinId,
      vertices: model.children[0].children[0].geometry.drawRange.count,
      materials: model.children[0].children[0].material.map((material: any) => material.name),
    })));
  const clickStone = async (id: string, button: 'left' | 'right') => {
    const point = await page.evaluate(id => {
      const { scene, camera, renderer } = (window as any).heatRockGame;
      const model = scene.children.find((model: any) => model.userData.entityId === id), mesh = model.children[0].children[0];
      mesh.geometry.computeBoundingBox();
      const center = mesh.geometry.boundingBox.getCenter(model.position.clone()); mesh.localToWorld(center).project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return { x: rect.left + (center.x + 1) * rect.width / 2, y: rect.top + (1 - center.y) * rect.height / 2 };
    }, id);
    await page.mouse.click(point.x, point.y, { button });
  };
  const slots = (save: any) => Object.values(save.players.local.inventory.containers).flatMap((container: any) => container.slots) as any[];
  const stones = (save: any) => slots(save).filter(slot => slot.item.itemId === 'heatrock').map(slot => slot.item);

  await page.goto('/tests/dst-lighting.html'); await prepare();
  await submit('c_give("heatrock", 2); c_give("reskin_tool"); c_spawn("heatrock")');
  const bar = page.locator('dst-inventory-bar'), bag = bar.locator('.inventory-bar__items');
  await expect(bag.locator('[data-item-id="heatrock"]')).toHaveCount(2);
  await expect(bag.locator('[data-item-id="heatrock"]').first().locator('.inventory-slot__icon')).toHaveAttribute('data-element', 'heat_rock3.tex');
  await expect.poll(async () => (await ground()).length).toBe(1);
  const spawned = (await ground())[0];
  expect(spawned.vertices).toBeGreaterThan(0); expect(spawned.materials).toContain('ground:heat_rock');
  await page.evaluate(id => {
    const game = (window as any).heatRockGame;
    game.scene.children.find((model: any) => model.userData.entityId === id).userData.components.fueled.remaining = 75;
    game.playerBody.position.set(3, game.playerBody.shapes[0].radius, 3); game.player.position.set(3, 0, 3);
  }, spawned.id);
  await bag.locator('[data-item-id="reskin_tool"]').dragTo(bar.locator('[data-slot-key="hand"]'));
  await clickStone(spawned.id, 'right');
  await expect.poll(async () => (await ground())[0]?.skin, { timeout: 20_000 }).toBe('heatrock_fantasy');
  expect((await ground())[0].materials).toContain('ground:heatrock_fantasy');
  const groundSave = await saveGame();
  const savedStone = groundSave.world.entities.ground_item.find((record: any) => record.id === spawned.id);
  expect(savedStone.components.stack).toMatchObject({ itemId: 'heatrock', count: 1, skinId: 'heatrock_fantasy', remainingFuel: 75 });
  expect(stones(groundSave)).toHaveLength(2);

  await clickStone(spawned.id, 'left');
  const skinned = bag.locator('[data-item-id="heatrock"][data-skin-id="heatrock_fantasy"]');
  await expect(skinned).toBeVisible();
  await expect(skinned.locator('.inventory-slot__icon')).toHaveAttribute('data-element', 'heatrock_fantasy3.tex');
  await page.keyboard.down('Shift'); await skinned.click({ button: 'right' }); await page.keyboard.up('Shift');
  await expect.poll(async () => (await ground()).some(stone => stone.id === spawned.id && stone.skin === 'heatrock_fantasy')).toBe(true);
  const dropped = await saveGame();
  expect(dropped.world.entities.ground_item.find((record: any) => record.id === spawned.id).components.stack).toEqual(savedStone.components.stack);
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: dropped }));
  await page.reload(); await prepare();
  await expect.poll(async () => (await ground())[0]?.skin).toBe('heatrock_fantasy');
  const restored = await saveGame();
  expect(restored.world.entities.ground_item).toEqual(dropped.world.entities.ground_item);
  expect(stones(restored)).toEqual(stones(dropped));
  await clickStone(spawned.id, 'left'); await expect(skinned).toBeVisible();
  const taken = await saveGame();
  expect(stones(taken).find(item => item.entityId === spawned.id)).toEqual({ entityId: spawned.id, ...savedStone.components.stack });
  expect(taken.world.entities.ground_item ?? []).toEqual([]);
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: taken }));
  await page.reload(); await prepare();
  expect(stones(await saveGame())).toEqual(stones(taken));
  await expect(skinned.locator('.inventory-slot__icon')).toHaveAttribute('data-element', 'heatrock_fantasy3.tex');
  expect(errors).toEqual([]);
});
