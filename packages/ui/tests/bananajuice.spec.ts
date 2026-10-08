import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const modules = Object.fromEntries(['main', 'player', 'universal', 'playerStats'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('drinking banana juice consumes one, updates sanity/HUD/filter and preserves the remaining drink through save/reload', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.players.local.stats = { health: 140, hunger: 90, sanity: 35 };
    await route.fulfill({ response, json: save });
  });
  const prepare = () => page.evaluate(async paths => {
    const main = await import(paths.main), { player } = await import(paths.player);
    const { scene, dstLighting } = await import(paths.universal);
    const stats = await import(paths.playerStats);
    (window as any).juiceGame = { main, player, scene, dstLighting, stats };
  }, modules);
  await page.goto('/tests/dst-lighting.html'); await prepare();
  await page.evaluate(() => {
    const { main, scene } = (window as any).juiceGame;
    main.inventory.applySlotChanges(main.inventory.exportState().slots.filter((slot: any) => slot.item)
      .map((slot: any) => ({ slot: slot.address, ...slot.item, delta: -slot.item.count })));
    (window as any).existingJuiceIds = scene.children.filter((model: any) => model.userData.itemId === 'bananajuice')
      .map((model: any) => model.userData.entityId);
  });
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  await submit('c_give("bananajuice", 2)');
  await submit('c_spawn("bananajuice")');
  await expect.poll(() => page.evaluate(() => (window as any).juiceGame.scene.children.some((model: any) =>
    model.userData.itemId === 'bananajuice' && !(window as any).existingJuiceIds.includes(model.userData.entityId)))).toBe(true);
  const spawnedId = await page.evaluate(() => (window as any).juiceGame.scene.children.find((model: any) =>
    model.userData.itemId === 'bananajuice' && !(window as any).existingJuiceIds.includes(model.userData.entityId)).userData.entityId);
  const bar = page.locator('dst-inventory-bar .inventory-bar__items');
  const juice = bar.locator('[data-item-id="bananajuice"]');
  const sanity = page.locator('dst-status-hud .survival-meter--sanity output');
  const count = () => page.evaluate(() => (window as any).juiceGame.main.inventory.materialSummary().bananajuice ?? 0);
  await expect(juice).toBeVisible();
  await juice.click({ button: 'right' }); await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => (window as any).juiceGame.player.userData.animationController.stategraph.hasStateTag('eating'))).toBe(false);
  expect(await count()).toBe(2);
  await expect(sanity).toHaveText('35');
  await juice.click({ button: 'right' });
  await expect.poll(count).toBe(1);
  await expect(sanity).toHaveText('68');
  expect(await page.evaluate(() => {
    const { stats, dstLighting } = (window as any).juiceGame;
    return { stats: stats.getPlayerStats(), percent: dstLighting.getSanityPercent() };
  })).toEqual({ stats: { health: 148, hunger: 115, sanity: 68 }, percent: 0.34 });

  const download = page.waitForEvent('download'); await submit('c_save()');
  const save = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  const savedJuice = save.players.local.inventory.containers['player:inventory'].slots.find((slot: any) => slot.item.itemId === 'bananajuice').item;
  expect(savedJuice.count).toBe(1);
  expect(save.players.local.stats.sanity).toBe(68);
  const ground = save.world.entities.ground_item.find((entity: any) => entity.id === spawnedId);
  expect(ground.components.stack).toMatchObject({ itemId: 'bananajuice', count: 1 });
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: save }));
  await page.reload(); await prepare();
  await expect(sanity).toHaveText('68');
  expect(await count()).toBe(1);
  expect(await page.evaluate(() => {
    const { main } = (window as any).juiceGame;
    return main.inventory.exportState().slots.find((slot: any) => slot.item?.itemId === 'bananajuice').item.entityId;
  })).toBe(savedJuice.entityId);
  expect(await page.evaluate(id => {
    const { main, scene } = (window as any).juiceGame;
    const model = scene.children.find((model: any) => model.userData.entityId === id);
    const entity = main.inventory.entities.get(id);
    return { id: entity.id, itemId: entity.prefab, count: entity.components.stackable.count,
      skinId: entity.skinId ?? null, position: model.position.toArray() };
  }, spawnedId)).toEqual({ id: spawnedId, itemId: 'bananajuice', count: 1,
    skinId: null, position: ground.transform.position });
  await page.evaluate(() => (window as any).juiceGame.stats.playerStats.sanity.set(190));
  await juice.click({ button: 'right' });
  await expect.poll(count).toBe(0);
  await expect(sanity).toHaveText('200');
  expect(errors).toEqual([]);
});
