import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test('drops source backpack ground art, reskins with a sweeper, picks up and equips the same skin, and saves it', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tests/dst-lighting.html');
  await page.evaluate(async (urls) => {
    const main = await import(urls.main);
    const player = await import(urls.player);
    const { scene } = await import(urls.universal);
    const { view } = await import(urls.view);
    for (const kind of ['body', 'hand']) {
      const slot = { containerId: 'player:equipment', slotKey: kind };
      const item = main.inventory.get(slot);
      if (item) main.inventory.applySlotChanges([{ slot, ...item, delta: -item.count }]);
    }
    main.inventory.add('backpack', 1); main.inventory.add('reskin_tool', 1); main.inventory.add('cutgrass', 3);
    const backpackSlot = main.inventory.addresses().find((address: any) =>
      address.containerId === 'player:inventory' && main.inventory.get(address)?.itemId === 'backpack');
    const backpackId = main.inventory.getEntity(backpackSlot)!.id;
    const radius = player.playerBody.shapes[0].radius;
    player.playerBody.position.set(120, radius, 120); player.player.position.set(120, 0, 120);
    (window as any).backpackSkinGame = { main, ...player, scene, view, backpackId };
    (window as any).backpackGroundPoint = async () => {
      await new Promise(requestAnimationFrame);
      const target = scene.children.find((object: any) => object.userData.entityId === (window as any).backpackSkinGame.backpackId);
      const mesh = target.children[0].children[0];
      mesh.geometry.computeBoundingBox();
      const point = mesh.geometry.boundingBox.getCenter(target.position.clone()).applyMatrix4(mesh.matrixWorld).project(view.camera);
      const rect = view.renderer.domElement.getBoundingClientRect();
      return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
    };
  }, Object.fromEntries(['main', 'player', 'universal', 'view'].map((name) =>
    [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`])));
  const backpackId = await page.evaluate(() => (window as any).backpackSkinGame.backpackId);
  const bar = page.locator('dst-inventory-bar');
  const body = bar.locator('[data-slot-key="body"]');
  await bar.locator('.inventory-bar__items [data-item-id="backpack"]').first().dragTo(body);
  await expect(body).toHaveAttribute('data-item-id', 'backpack');
  const stored = page.locator('dst-backpack-panel [data-slot-key="7"]');
  await bar.locator('.inventory-bar__items [data-item-id="cutgrass"]').first().dragTo(stored);
  await expect(stored).toHaveAttribute('data-item-id', 'cutgrass');
  const container = await page.evaluate(() => (window as any).backpackSkinGame.main.inventory
    .getEntity({ containerId: 'player:equipment', slotKey: 'body' }).snapshot().container);
  await page.keyboard.down('Shift');
  await body.click({ button: 'right' });
  await page.keyboard.up('Shift');
  await expect.poll(() => page.evaluate(() => {
    const game = (window as any).backpackSkinGame;
    const target = game.scene.children.find((object: any) => object.userData.entityId === (window as any).backpackSkinGame.backpackId);
    const mesh = target?.children[0].children[0];
    return Boolean(mesh?.isMesh && mesh.geometry.drawRange.count > 0
      && mesh.material.some((material: any) => material.name === 'ground:swap_backpack'));
  })).toBe(true);
  const hand = bar.locator('[data-slot-key="hand"]');
  await bar.locator('.inventory-bar__items [data-item-id="reskin_tool"]').first().dragTo(hand);
  await expect.poll(() => page.evaluate(() => (window as any).backpackSkinGame.player.children[0].children[0].material
    .some((material: any) => material.name === 'ground:swap_reskin_tool'))).toBe(true);
  const point = await page.evaluate(() => (window as any).backpackGroundPoint());
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).backpackSkinGame.scene.children
    .find((object: any) => object.userData.entityId === (window as any).backpackSkinGame.backpackId)?.userData.skinId)).toBe('backpack_babybeef');
  await expect.poll(() => page.evaluate(() => (window as any).backpackSkinGame.player.userData.animationController.isReskinning)).toBe(false);
  const groundDownload = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command: 'c_save()' } })));
  const groundStream = await (await groundDownload).createReadStream();
  const groundChunks = [];
  for await (const chunk of groundStream!) groundChunks.push(chunk);
  const groundSave = JSON.parse(Buffer.concat(groundChunks).toString());
  const groundBag = groundSave.world.entities.ground_item.find((entity: any) => entity.id === backpackId);
  expect(groundBag.components.stack).toMatchObject({ itemId: 'backpack', skinId: 'backpack_babybeef', container });
  const pickupPoint = await page.evaluate(() => (window as any).backpackGroundPoint());
  await page.mouse.click(pickupPoint.x, pickupPoint.y);
  const pickedUp = bar.locator('.inventory-bar__items [data-item-id="backpack"][data-skin-id="backpack_babybeef"]');
  await expect(pickedUp).toBeVisible();
  await expect(pickedUp.locator('.inventory-slot__icon')).toHaveAttribute('data-element', 'backpack_babybeef.tex');
  await pickedUp.dragTo(body);
  await expect(body).toHaveAttribute('data-skin-id', 'backpack_babybeef');
  await expect.poll(() => page.evaluate(() => (window as any).backpackSkinGame.player.children[0].children[0].material
    .some((material: any) => material.name === 'ground:backpack_babybeef'))).toBe(true);
  await expect(page.locator('dst-backpack-panel .inventory-slot')).toHaveCount(8);
  await expect(stored).toHaveAttribute('data-item-id', 'cutgrass');
  const download = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command: 'c_save()' } })));
  const stream = await (await download).createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const save = JSON.parse(Buffer.concat(chunks).toString());
  expect(save.players.local.inventory.containers['player:equipment'].slots.find((slot: any) => slot.slotKey === 'body').item)
    .toEqual({ entityId: backpackId, itemId: 'backpack', skinId: 'backpack_babybeef', count: 1, container });
  const reloaded = await page.evaluate(async ({ groundSave, save, url }) => {
    const { deserializeSave } = await import(url);
    const { SAVE_CATALOG } = await import(url.replace('save/deserialize.ts', 'save/catalog.ts'));
    return [groundSave, save].map(document => deserializeSave(JSON.stringify(document), SAVE_CATALOG));
  }, { groundSave, save, url: `/@fs${fileURLToPath(new URL('../../../src/save/deserialize.ts', import.meta.url))}` });
  expect(reloaded[0].world.entities.ground_item.find((entity: any) => entity.id === backpackId).components.stack.container).toEqual(container);
  expect(reloaded[1].players.local.inventory.containers['player:equipment'].slots.find((slot: any) => slot.slotKey === 'body').item.container).toEqual(container);
  expect(errors).toEqual([]);
});
