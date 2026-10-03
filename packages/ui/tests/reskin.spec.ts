import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('reskin casting uses source animation timing, five puff builds and decoded sounds', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async (url) => (await import(url)).checkReskinCasting(),
    `/@fs${fileURLToPath(new URL('./reskin-fixture.ts', import.meta.url))}`);
  expect(result.failures).toEqual([]);
  expect(result.cases).toHaveLength(5);
  expect(result.cases.every((sound) => sound.whoosh > 0.2 && sound.whoosh < 0.4)).toBe(true);
  expect(result.groundSkin).toBe('reskin_tool_bouquet');
  expect(errors).toEqual([]);
});

test('game right-click reskins a chest and c_save keeps its skin and container contents', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/dst-lighting.html');
  const urls = Object.fromEntries(['main', 'player', 'universal', 'view'].map((name) =>
    [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  await page.evaluate(async (urls) => {
    const main = await import(urls.main);
    const player = await import(urls.player);
    const { scene } = await import(urls.universal);
    const { view } = await import(urls.view);
    const radius = player.playerBody.shapes[0].radius;
    player.playerBody.position.set(120, radius, 120); player.player.position.set(120, 0, 120);
    const oldRoots = scene.children.filter((object: any) => object.name === 'TreasureChest');
    (window as any).reskinGame = { main, ...player, scene, view, oldRoots };
    for (const command of ['c_give("reskin_tool")', 'c_spawn("treasurechest")']) {
      document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', { detail: { command } }));
    }
  }, urls);
  await expect.poll(() => page.evaluate(() => {
    const game = (window as any).reskinGame;
    return game.scene.children.filter((object: any) => object.name === 'TreasureChest').length - game.oldRoots.length;
  })).toBe(1);
  const point = await page.evaluate(async (inventoryUrl) => {
    const { equipmentSlotAddress, inventorySlotAddress } = await import(inventoryUrl);
    const game = (window as any).reskinGame;
    const store = game.main.inventory;
    const hand = equipmentSlotAddress('hand');
    const oldHand = store.get(hand);
    if (oldHand) store.applySlotChanges([{ slot: hand, itemId: oldHand.itemId, skinId: oldHand.skinId, delta: -oldHand.count }]);
    const source = store.exportState().slots.find((entry: any) => entry.address.containerId === 'player:inventory' && entry.item?.itemId === 'reskin_tool');
    if (!source || !store.applySlotChanges([
      { slot: inventorySlotAddress(Number(source.address.slotKey)), itemId: 'reskin_tool', skinId: source.item.skinId, delta: -1 },
      { slot: hand, itemId: 'reskin_tool', skinId: source.item.skinId, delta: 1 },
    ])) throw new Error('Unable to equip sweeper');
    const animation = game.player.userData.animationController;
    await animation.setCarryItem('reskin_tool', source.item.skinId);
    const target = game.scene.children.find((object: any) => object.name === 'TreasureChest' && !game.oldRoots.includes(object));
    game.target = target;
    game.entityId = target.userData.entityId;
    // Record the stable world identity while requesting an actual pointer action.
    await new Promise(requestAnimationFrame);
    const mesh = target.children[0].children[0];
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    const position = target.position.clone();
    position.y += -(box.min.y + box.max.y) * 0.01;
    const ndc = position.project(game.view.camera);
    const bounds = game.view.renderer.domElement.getBoundingClientRect();
    return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2 };
  }, `/@fs${fileURLToPath(new URL('../../inventory/src/index.ts', import.meta.url))}`);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).reskinGame.target.userData.skinId)).toBe('treasurechest_ancient');
  await expect.poll(() => page.evaluate(() => (window as any).reskinGame.player.userData.animationController.isReskinning)).toBe(false);
  await page.evaluate(async () => {
    const game = (window as any).reskinGame;
    const mesh = game.target.children[0].children[0];
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    const position = game.target.position.clone();
    position.y += -(box.min.y + box.max.y) * 0.01;
    const ndc = position.project(game.view.camera);
    const bounds = game.view.renderer.domElement.getBoundingClientRect();
    game.view.renderer.domElement.dispatchEvent(new PointerEvent('pointerdown', {
      button: 0, clientX: bounds.left + (ndc.x + 1) * bounds.width / 2,
      clientY: bounds.top + (1 - ndc.y) * bounds.height / 2,
    }));
    game.containerId = `world:treasurechest:${game.entityId}`;
    if (!game.main.inventory.applySlotChanges([
      { slot: { containerId: game.containerId, slotKey: '8' }, itemId: 'log', delta: 2 },
    ])) throw new Error('Unable to fill reskinned chest');
  });
  const download = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command: 'c_save()' } })));
  const file = await download;
  const stream = await file.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const save = JSON.parse(Buffer.concat(chunks).toString());
  const id = await page.evaluate(() => (window as any).reskinGame.entityId);
  const chest = save.world.entities.treasurechest.find((entity: any) => entity.id === id);
  expect(chest.components.building).toEqual({ state: 'closed', skinId: 'treasurechest_ancient' });
  expect(chest.components.container).toEqual({ slotCount: 9, slots: [
    { slotKey: '8', item: { itemId: 'log', count: 2 } },
  ] });
  expect(Object.keys(save.world.entities).some((prefab) => prefab.includes('reskin') || prefab.includes('explode'))).toBe(false);
  expect(errors).toEqual([]);
});
