import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('console greenstaff reskins, deconstructs opalstaff by right-click and reloads the exported save', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const urls = {
    ...Object.fromEntries(['main', 'player', 'universal', 'view'].map(name =>
      [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`])),
    inventory: `/@fs${fileURLToPath(new URL('../../inventory/src/index.ts', import.meta.url))}`,
  };
  const init = async () => page.evaluate(async urls => {
    const main = await import(urls.main), { player } = await import(urls.player);
    const { scene } = await import(urls.universal), { view } = await import(urls.view);
    const addresses = await import(urls.inventory);
    (window as any).greenGame = { main, player, scene, view, ...addresses };
  }, urls);
  await page.goto('/tests/dst-lighting.html');
  await init();
  await page.evaluate(() => {
    const { main, inventorySlotAddress, equipmentSlotAddress } = (window as any).greenGame;
    for (const slot of [inventorySlotAddress(0), equipmentSlotAddress('hand')]) {
      const item = main.inventory.get(slot);
      if (item) main.inventory.applySlotChanges([{ slot, ...item, delta: -item.count }]);
    }
  });
  const command = async (text: string) => {
    await page.keyboard.press('Backquote');
    const input = page.locator('dst-debug-console input');
    await input.fill(text); await input.press('Enter');
  };
  await command('c_spawn("greenstaff"); c_spawn("opalstaff"); c_spawn("opalpreciousgem"); c_give("greenstaff")');
  const bar = page.locator('dst-inventory-bar');
  const staff = bar.locator('.inventory-bar__items .inventory-slot[data-item-id="greenstaff"]').first();
  await expect(staff.locator('.inventory-slot__icon[data-loaded="true"]')).toBeVisible();
  const hand = bar.locator('.inventory-bar__equipment .inventory-slot').first();
  await staff.dragTo(hand);
  await expect(hand).toHaveAttribute('data-item-id', 'greenstaff');
  await expect.poll(() => page.evaluate(() => {
    const { player } = (window as any).greenGame;
    return player.getObjectByProperty('isMesh', true).material.some((material: any) => material.name === 'ground:swap_staffs');
  })).toBe(true);
  // Prepare one source skin on the actual equipped entity; the existing equipment binding presents it.
  await page.evaluate(() => {
    const { main, equipmentSlotAddress, scene, player } = (window as any).greenGame;
    const slot = equipmentSlotAddress('hand'), entity = main.inventory.getEntity(slot);
    const snapshot = entity.snapshot();
    (window as any).greenGame.staffId = entity.id;
    main.inventory.applySlotChanges([{ slot, ...snapshot, delta: -1 },
      { slot, ...snapshot, skinId: 'greenstaff_clockwork', delta: 1 }]);
    const ground = scene.children.filter((model: any) => model.userData.itemId === 'opalstaff');
    const target = ground.at(-1), opal = main.inventory.entities.get((window as any).__prefabInstance(target)?.entityId);
    opal.transform.position.set(player.position.x + 12, 0, player.position.z);
    (window as any).greenGame.opalId = opal.id;
    // Move the other command-spawned objects aside so only opalstaff is under the pointer.
    for (const model of scene.children.filter((model: any) => ['greenstaff', 'opalpreciousgem'].includes(model.userData.itemId))) {
      const item = main.inventory.entities.get((window as any).__prefabInstance(model)?.entityId);
      item.transform.position.set(player.position.x - 24, 0, player.position.z + 12);
    }
  });
  await expect.poll(() => page.evaluate(() => {
    const { player } = (window as any).greenGame;
    return player.getObjectByProperty('isMesh', true).material.some((material: any) => material.name.includes('greenstaff_clockwork'));
  })).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).greenGame.player.userData.animationController.stategraph.isOneShot)).toBe(false);
  const point = await page.evaluate(() => {
    const { scene, view, opalId } = (window as any).greenGame;
    const model = scene.children.find((model: any) => (window as any).__prefabInstance(model)?.entityId === opalId);
    model.updateMatrixWorld(true);
    const position = model.position.clone(); position.y += 1;
    const ndc = position.project(view.camera), bounds = view.renderer.domElement.getBoundingClientRect();
    return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2 };
  });
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).greenGame.player.userData.animationController.isCasting)).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => (window as any).greenGame.player.userData.animationController.isCasting)).toBe(false);
  expect(await page.evaluate(() => {
    const game = (window as any).greenGame;
    return [!!game.main.inventory.entities.get(game.opalId), game.main.inventory.entities.get(game.staffId).components.finiteuses.percent.peek()];
  })).toEqual([true, 1]);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).greenGame.player.userData.animationController.isCasting)).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const game = (window as any).greenGame;
    return !!game.main.inventory.entities.get(game.opalId);
  })).toBe(false);
  await expect.poll(() => page.evaluate(() => {
    const game = (window as any).greenGame;
    return game.main.inventory.entities.get(game.staffId)?.components.finiteuses.remaining;
  })).toBe(4);
  await expect.poll(() => page.evaluate(() => (window as any).greenGame.player.userData.animationController.stategraph.isOneShot)).toBe(false);
  const download = page.waitForEvent('download');
  await command('c_save()');
  const file = await download, savedText = await readSaveDownload((await file.path())!);
  const saved = JSON.parse(savedText), records = saved.world.entities.ground_item;
  const loot = records.filter((record: any) => ['nightmarefuel', 'livinglog', 'opalpreciousgem'].includes(record.components.stack.itemId));
  expect(loot.filter((record: any) => record.components.stack.itemId === 'nightmarefuel')).toHaveLength(4);
  expect(loot.filter((record: any) => record.components.stack.itemId === 'livinglog')).toHaveLength(2);
  expect(loot.filter((record: any) => record.components.stack.itemId === 'opalpreciousgem')).toHaveLength(2);
  const opalId = await page.evaluate(() => (window as any).greenGame.opalId);
  expect(records.some((record: any) => record.id === opalId)).toBe(false);
  const staffSave = saved.players.local.inventory.containers['player:equipment'].slots.find((slot: any) => slot.slotKey === 'hand').item;
  expect(staffSave).toMatchObject({ itemId: 'greenstaff', skinId: 'greenstaff_clockwork', remainingUses: 4 });
  await page.route('**/saves/initial-world.json', route => route.fulfill({ contentType: 'application/json', body: savedText }));
  await page.reload(); await init();
  await expect(hand).toHaveAttribute('data-item-id', 'greenstaff');
  const restored = await page.evaluate(() => {
    const { main, equipmentSlotAddress } = (window as any).greenGame;
    return { staff: main.inventory.getEntity(equipmentSlotAddress('hand')).snapshot(),
      ground: main.inventory.entities.values().filter((entity: any) => !entity.components.inventoryitem.owner)
        .map((entity: any) => ({ id: entity.id, ...entity.snapshot(), position: entity.transform.position })) };
  });
  expect(restored.staff).toEqual(staffSave);
  for (const record of loot) expect(restored.ground).toContainEqual(expect.objectContaining({
    id: record.id, itemId: record.components.stack.itemId, count: record.components.stack.count, position: record.transform.position,
  }));
  expect(errors).toEqual([]);
});
