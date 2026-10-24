import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { useInteractionSave } from './interactionSave';

test('right-click shovels and lights grass, and c_save preserves dug items, tool uses and ash', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await useInteractionSave(page);
  await page.goto('/tests/dst-lighting.html');
  const urls = Object.fromEntries(['main', 'player', 'camera', 'universal', 'view', 'building', 'save/deserialize', 'save/catalog',
    'save/inventoryState', 'groundItems'].map(name =>
    [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  await page.evaluate(async urls => {
    const { inventory } = await import(urls.main);
    const { player, playerBody } = await import(urls.player);
    const { followCamera } = await import(urls.camera);
    const { scene } = await import(urls.universal);
    const { view } = await import(urls.view);
    const { moonTreeForest } = await import(urls.building);
    let origin;
    for (let col = -3; col < 0 && !origin; col++) {
      for (let row = -3; row < 0 && !origin; row++) {
        const point = { x: col * 12 + 6, z: row * 12 + 6 };
        if (!moonTreeForest.entities.some((tree: any) => Math.hypot(tree.position.x - point.x, tree.position.z - point.z) < 20)) origin = point;
      }
    }
    if (!origin) throw new Error('No free grass interaction location');
    const slots = inventory.exportState().slots;
    for (const slot of slots.filter((slot: any) => slot.address.containerId === 'player:inventory').slice(0, 4)) {
      if (slot.item) inventory.applySlotChanges([{ slot: slot.address, ...slot.item, delta: -slot.item.count }]);
    }
    const hand = slots.find((slot: any) => slot.address.containerId === 'player:equipment' && slot.address.slotKey === 'hand');
    if (hand?.item) inventory.applySlotChanges([{ slot: hand.address, ...hand.item, delta: -hand.item.count }]);
    playerBody.position.set(origin.x, playerBody.shapes[0].radius, origin.z);
    playerBody.velocity.set(0, 0, 0); player.position.set(origin.x, 0, origin.z);
    followCamera.snap();
    (window as any).grassGame = { inventory, player, playerBody, followCamera, scene, view, initial: new Set(scene.children), targets: [] };
  }, urls);
  const submit = async (command: string) => {
    await page.keyboard.press('Backquote');
    const input = page.locator('dst-debug-console input');
    await input.fill(command); await input.press('Enter');
  };
  await submit('c_give("shovel");c_give("torch");c_give("dug_grass",2);c_spawn("grass")');
  const bar = page.locator('dst-inventory-bar');
  const hand = bar.locator('.inventory-bar__equipment .inventory-slot').first();
  const shovel = bar.locator('.inventory-bar__items [data-item-id="shovel"]').first();
  await expect(shovel.locator('.inventory-slot__icon[data-loaded="true"]')).toBeVisible();
  await shovel.dragTo(hand);
  await expect(hand).toHaveAttribute('data-item-id', 'shovel');
  await expect.poll(() => page.evaluate(() => {
    const game = (window as any).grassGame;
    return game.scene.children.some((model: any) => !game.initial.has(model) && model.userData.prefab === 'grass'
      && model.userData.pickablePlantState?.phase.peek() === 'ready');
  })).toBe(true);
  const point = async () => page.evaluate(async () => {
    const game = (window as any).grassGame;
    const model = game.scene.children.find((model: any) => !game.initial.has(model) && model.userData.prefab === 'grass'
      && model.userData.pickablePlantState?.phase.peek() === 'ready');
    if (!model) throw new Error('No spawned grass');
    game.targets.push(model);
    const foot = model.position;
    game.playerBody.position.set(foot.x + 3, game.playerBody.shapes[0].radius, foot.z);
    game.playerBody.velocity.set(0, 0, 0); game.player.position.set(foot.x + 3, 0, foot.z);
    game.followCamera.snap();
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    const mesh = model.children[0].children[0]; mesh.updateWorldMatrix(true, false);
    const vertices = mesh.geometry.getAttribute('position');
    const vertex = model.position.clone(), min = vertex.clone().set(Infinity, Infinity, Infinity), max = vertex.clone().set(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < mesh.geometry.drawRange.count / 6 * 4; i++) {
      vertex.fromBufferAttribute(vertices, i); mesh.localToWorld(vertex); min.min(vertex); max.max(vertex);
    }
    const ndc = min.add(max).multiplyScalar(.5).project(game.view.camera), bounds = game.view.renderer.domElement.getBoundingClientRect();
    return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2 };
  });
  const digPoint = await point();
  await page.mouse.move(digPoint.x, digPoint.y);
  await expect.poll(() => page.evaluate(() => (window as any).grassGame.view.mouseActions.getMouseActions().right?.action)).toBe('DIG');
  await expect.poll(() => page.evaluate(() => (window as any).grassGame.player.userData.stategraph.stateName)).toBe('idle');
  await page.mouse.click(digPoint.x, digPoint.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).grassGame.targets[0].userData.pickablePlantState.phase.peek())).toBe('removed');
  const dug = await page.evaluate(() => {
    const game = (window as any).grassGame;
    const items = game.scene.children.filter((model: any) => !game.initial.has(model)
      && ['cutgrass', 'dug_grass'].includes(model.userData.actionEntity?.prefab));
    return { itemIds: items.map((model: any) => model.userData.entityId),
      shovelId: game.inventory.GetEquippedItem('hand').id };
  });
  expect(dug.itemIds).toHaveLength(2);
  // Keep the burning plant well away from the first plant's combustible loot.
  await page.evaluate(() => {
    const game = (window as any).grassGame;
    game.playerBody.position.x += 40; game.player.position.x += 40;
    game.playerBody.velocity.set(0, 0, 0);
  });
  const torch = bar.locator('.inventory-bar__items [data-item-id="torch"]').first();
  await expect(torch.locator('.inventory-slot__icon[data-loaded="true"]')).toBeVisible();
  await hand.dragTo(bar.locator('.inventory-bar__items .inventory-slot[data-item-id=""]').first());
  await expect(hand).toHaveAttribute('data-item-id', '');
  await torch.dragTo(hand);
  await expect(hand).toHaveAttribute('data-item-id', 'torch');
  await submit('c_spawn("grass")');
  await expect.poll(() => page.evaluate(() => (window as any).grassGame.scene.children.some((model: any) =>
    !(window as any).grassGame.initial.has(model) && model.userData.prefab === 'grass'
      && model.userData.pickablePlantState?.phase.peek() === 'ready'))).toBe(true);
  const firePoint = await point();
  await page.mouse.move(firePoint.x, firePoint.y);
  await expect.poll(() => page.evaluate(() => {
    const game = (window as any).grassGame;
    const action = game.view.mouseActions.getMouseActions().right;
    return JSON.stringify({ action: action?.action, target: game.view.mouseActions.targetModel?.userData.prefab,
      active: game.targets[1].userData.actionEntity?.hasTag('tickingarea'),
      hand: game.inventory.GetEquippedItem('hand')?.prefab,
      position: game.targets[1].position.toArray(), player: game.player.position.toArray() });
  })).toContain('"action":"LIGHT"');
  await expect.poll(() => page.evaluate(() => (window as any).grassGame.player.userData.stategraph.stateName)).toBe('idle');
  await page.mouse.click(firePoint.x, firePoint.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).grassGame.targets[1].userData.pickablePlantState.burning.peek())).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).grassGame.targets[1].userData.pickablePlantState.phase.peek()),
    { timeout: 35_000 }).toBe('removed');
  const downloadPromise = page.waitForEvent('download');
  await submit('c_save()');
  const json = await readSaveDownload((await (await downloadPromise).path())!);
  const restored = await page.evaluate(async ({ urls, json }) => {
    const { deserializeSave } = await import(urls['save/deserialize']);
    const { SAVE_CATALOG } = await import(urls['save/catalog']);
    const { inventoryStateFromSave } = await import(urls['save/inventoryState']);
    const { GroundItemManager } = await import(urls.groundItems);
    const game = (window as any).grassGame, saved = deserializeSave(json, SAVE_CATALOG);
    game.inventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
    const ids = game.targets.map((model: any) => model.userData.entityId);
    const shovel = game.inventory.exportState().slots.find((slot: any) => slot.item?.itemId === 'shovel')?.item;
    const records = saved.world.entities.ground_item.filter((record: any) =>
      ['cutgrass', 'dug_grass', 'ash'].includes(record.components.stack.itemId));
    const ground = new GroundItemManager(game.scene, game.view.camera, game.view.renderer,
      '/dst/data/databundles/images.zip', game.inventory, '/dst/data/anim', game.player);
    for (const record of records) {
      const stack = record.components.stack;
      await ground.spawnFromSave(record.id, { ...SAVE_CATALOG.items[stack.itemId], ...stack }, game.player.position.clone().fromArray(record.transform.position));
    }
    const result = { shovel, grassIds: saved.world.entities.grass.map((record: any) => record.id), ids,
      dugCount: game.inventory.count('dug_grass'), records, reloaded: ground.exportRecords() };
    ground.dispose();
    return result;
  }, { urls, json });
  expect(restored.shovel.entityId).toBe(dug.shovelId);
  expect(restored.shovel.remainingUses).toBe(24);
  expect(restored.dugCount).toBe(2);
  expect(restored.grassIds).not.toContain(restored.ids[0]);
  expect(restored.grassIds).not.toContain(restored.ids[1]);
  expect(restored.records.filter((record: any) => dug.itemIds.includes(record.id))).toHaveLength(2);
  expect(restored.records.some((record: any) => record.components.stack.itemId === 'ash' && record.components.stack.count === 1)).toBe(true);
  expect(restored.reloaded).toEqual(restored.records);
  expect(errors).toEqual([]);
});
