import { readSaveDownload } from './save-download';
import { minimalSave, savePageUrl } from './inline-save';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera', 'player', 'playerStats'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('eats lightbulbs and refuels inventory, equipped and ground lanterns, then exports and reloads their state', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const prepare = () => page.evaluate(async urls => {
    const main = await import(urls.main), { scene, renderer } = await import(urls.universal);
    const { camera } = await import(urls.camera), { player, playerBody } = await import(urls.player);
    const { getPlayerStats } = await import(urls.playerStats);
    (window as any).bulbGame = { main, scene, renderer, camera, player, playerBody, getPlayerStats };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const saveGame = async () => {
    const download = page.waitForEvent('download'); await submit('c_save()');
    return JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  };
  const held = () => page.evaluate(() => (window as any).bulbGame.main.inventory.exportState().slots.filter((slot: any) => slot.item));
  const state = (slots: any[], id: string) => slots.find(slot => slot.item.itemId === id)?.item;
  const cursor = page.locator('.slot-drag-preview[data-cursor="true"]');
  const bar = page.locator('dst-inventory-bar'), bag = bar.locator('.inventory-bar__items');
  const bulb = bag.locator('[data-item-id="lightbulb"]');
  const lantern = bag.locator('[data-item-id="lantern"]');
  await page.goto(savePageUrl(minimalSave({ stats: { health: 100, hunger: 105, sanity: 100 } }))); await prepare();
  await submit('c_give("lightbulb", 4); c_give("lantern"); c_spawn("lightbulb"); c_spawn("lantern")');
  await expect(bulb.locator('.inventory-slot__freshness')).toBeVisible();
  await bulb.click({ button: 'right' });
  await expect.poll(async () => state(await held(), 'lightbulb')?.count).toBe(3);
  expect(await page.evaluate(() => (window as any).bulbGame.getPlayerStats())).toEqual({ health: 101, hunger: 105, sanity: 100 });
  const lanternId = state(await held(), 'lantern').entityId;
  await page.evaluate(() => {
    const inventory = (window as any).bulbGame.main.inventory;
    for (const { address, item } of inventory.exportState().slots) {
      if (item?.itemId === 'lantern') inventory.setRemainingFuel(address, 0);
      if (item?.itemId === 'lightbulb') inventory.getEntity(address).components.perishable.SetPercent(.625);
    }
  });
  await bulb.click(); await expect(cursor).toHaveAttribute('data-item-id', 'lightbulb');
  await lantern.click();
  await expect.poll(async () => state(await held(), 'lantern')?.remainingFuel).toBe(90);
  expect(state(await held(), 'lantern').entityId).toBe(lanternId);
  await expect(cursor).toHaveAttribute('data-item-id', 'lightbulb');
  const cursorCount = () => page.evaluate(() => (window as any).bulbGame.main.inventory.exportState().slots
    .find((slot: any) => slot.address.containerId === 'player:cursor')?.item?.count);
  expect(await cursorCount()).toBe(2);

  // Refilled empty ground lanterns remain switched off, matching ontakefuel's equipped-only branch.
  const groundId = await page.evaluate(() => {
    const { scene, camera, renderer, player, playerBody } = (window as any).bulbGame;
    const model = scene.children.find((model: any) => ((window as any).__findActionEntity(model)?.prefab ?? (window as any).__prefabInstance(model)?.prefab) === 'lantern');
    const entity = (window as any).__findActionEntity(model)?.pickupTarget.entity;
    entity.setRemainingFuel(0); entity.getComponent('lantern').TurnOff();
    for (const other of scene.children) if (((window as any).__findActionEntity(other)?.prefab ?? (window as any).__prefabInstance(other)?.prefab) === 'lightbulb') {
      (window as any).__findActionEntity(other)?.pickupTarget.entity.transform.position.x += 30;
      other.position.x += 30;
    }
    playerBody.position.set(model.position.x + 3, playerBody.shapes[0].radius, model.position.z + 3);
    player.position.set(model.position.x + 3, 0, model.position.z + 3);
    return (window as any).__prefabInstance(model)?.entityId as string;
  });
  // The light signal changes immediately; wait for the off pose and camera to render before raycasting it.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  // The lantern's frame centre can be transparent; aim at artwork the pointer actually picks.
  const point = await page.evaluate(async ({ id, url }) => {
    const { scene, camera, renderer } = (window as any).bulbGame;
    const { spriteScreenPoint } = await import(url);
    const model = scene.children.find((model: any) => (window as any).__prefabInstance(model)?.entityId === id);
    return { id: (window as any).__prefabInstance(model)?.entityId as string, ...spriteScreenPoint(model, camera, renderer) };
  }, { id: groundId, url: `/@fs${fileURLToPath(new URL('./sprite-screen-point.ts', import.meta.url))}` });
  await page.mouse.click(point.x, point.y);
  await expect.poll(cursorCount).toBe(1);
  await bag.locator('[data-slot-key="2"]').click();
  await lantern.dragTo(bar.locator('[data-slot-key="hand"]'));
  await expect(bar.locator('[data-slot-key="hand"]')).toHaveAttribute('data-item-id', 'lantern');
  await page.evaluate(() => {
    const inventory = (window as any).bulbGame.main.inventory, entity = inventory.GetEquippedItem('hand');
    entity.setRemainingFuel(0); entity.getComponent('lantern').TurnOff();
  });
  await bulb.click(); await bar.locator('[data-slot-key="hand"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).bulbGame.main.inventory.GetEquippedItem('hand').getComponent('lantern').isOn)).toBe(true);
  const saved = await saveGame();
  const groundLantern = saved.world.entities.ground_item.find((record: any) => record.id === point.id);
  expect(groundLantern.components).toMatchObject({ stack: { remainingFuel: 90 }, lantern: { ison: false } });
  const groundBulb = saved.world.entities.ground_item.find((record: any) => record.components.stack.itemId === 'lightbulb');
  expect(groundBulb.components.stack.freshnessPercent).toBeLessThan(1);
  expect(groundBulb.components.stack.freshnessPercent).toBeGreaterThan(.95);
  expect(saved.players.local.inventory.containers['player:equipment'].slots.find((slot: any) => slot.item.entityId === lanternId)
    .item.remainingFuel).toBeGreaterThan(85);
  await page.goto(savePageUrl(saved)); await prepare();
  const restored = await saveGame();
  expect(restored.world.entities.ground_item.find((record: any) => record.id === point.id)).toEqual(groundLantern);
  const restoredBulb = restored.world.entities.ground_item.find((record: any) => record.id === groundBulb.id);
  expect(restoredBulb.transform).toEqual(groundBulb.transform);
  expect(restoredBulb.components.stack.count).toBe(1);
  expect(restoredBulb.components.stack.freshnessPercent).toBeLessThanOrEqual(groundBulb.components.stack.freshnessPercent);
  expect(restored.players.local.stats).toEqual(saved.players.local.stats);
  expect(state(await held(), 'lantern').entityId).toBe(lanternId);
  expect(errors).toEqual([]);
});
