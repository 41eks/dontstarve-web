import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('animation decoder worker shares assets and retries failed skin loads', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const requests: string[] = [];
  context.on('request', (request) => requests.push(request.url()));
  let skinAttempts = 0;
  await context.route('**/anim/dynamic/treasurechest_ancient.zip', (route) => {
    if (++skinAttempts === 1) return route.fulfill({ status: 503, body: 'retry' });
    return route.continue();
  });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async (url) => {
    const assets = await import(url);
    const [first, second] = await Promise.all([
      assets.loadAnimationArchive('treasure_chest.zip', '/dst/data/anim'),
      assets.loadAnimationArchive('treasure_chest.zip', '/dst/data/anim/'),
    ]);
    const firstMaterials = assets.createMaterials(first.buildPackage);
    const secondMaterials = assets.createMaterials(second.buildPackage);
    let failed = false;
    try { await assets.loadSpriteSkinArchive('dynamic/treasurechest_ancient.zip', '/dst/data/anim'); }
    catch { failed = true; }
    const skin = await assets.loadSpriteSkinArchive('dynamic/treasurechest_ancient.zip', '/dst/data/anim');
    const result = {
      sameBuild: first.buildPackage === second.buildPackage,
      sameAnimation: first.animations === second.animations,
      pixels: first.buildPackage.atlases[0].pixels.byteLength,
      symbolsAreMap: first.buildPackage.build.symbols instanceof Map,
      independentTextures: firstMaterials[0].map !== secondMaterials[0].map,
      failed, skinPixels: skin.buildPackage.atlases[0].pixels.byteLength,
    };
    for (const material of [...firstMaterials, ...secondMaterials]) { material.map.dispose(); material.dispose(); }
    return result;
  }, `/@fs${fileURLToPath(new URL('../../animation/src/animationAssets.ts', import.meta.url))}`);
  expect(result.sameBuild && result.sameAnimation && result.symbolsAreMap && result.independentTextures && result.failed).toBe(true);
  expect(result.pixels).toBeGreaterThan(0);
  expect(result.skinPixels).toBeGreaterThan(0);
  expect(page.workers().some((worker) => worker.url().includes('animationArchive.worker'))).toBe(true);
  expect(requests.filter((url) => url.endsWith('/anim/treasure_chest.zip'))).toHaveLength(1);
  expect(skinAttempts).toBe(2);
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
    const position = box.getCenter(target.position.clone()).applyMatrix4(mesh.matrixWorld);
    const ndc = position.project(game.view.camera);
    const bounds = game.view.renderer.domElement.getBoundingClientRect();
    return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2 };
  }, `/@fs${fileURLToPath(new URL('../../inventory/src/index.ts', import.meta.url))}`);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).reskinGame.target.userData.skinId)).toBe('treasurechest_ancient');
  await expect.poll(() => page.evaluate(() => (window as any).reskinGame.player.userData.animationController.isReskinning)).toBe(false);
  await page.evaluate(async () => {
    const game = (window as any).reskinGame;
    // c_spawn places the chest 10 units away; opening requires being within 9.
    const radius = game.playerBody.shapes[0].radius;
    game.playerBody.position.set(game.target.position.x + 3, radius, game.target.position.z);
    game.player.position.set(game.target.position.x + 3, 0, game.target.position.z);
    await new Promise(requestAnimationFrame);
    const mesh = game.target.children[0].children[0];
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    const position = box.getCenter(game.target.position.clone()).applyMatrix4(mesh.matrixWorld);
    const ndc = position.project(game.view.camera);
    const bounds = game.view.renderer.domElement.getBoundingClientRect();
    game.view.renderer.domElement.dispatchEvent(new PointerEvent('pointerdown', {
      button: 0, clientX: bounds.left + (ndc.x + 1) * bounds.width / 2,
      clientY: bounds.top + (1 - ndc.y) * bounds.height / 2,
    }));
    game.containerId = `world:treasurechest:${game.entityId}`;
  });
  // Container slots are registered when the opening animation completes.
  await expect.poll(() => page.evaluate(() => {
    const game = (window as any).reskinGame;
    return game.main.inventory.addresses().some((slot: any) => slot.containerId === game.containerId);
  })).toBe(true);
  const storedItem = await page.evaluate(() => {
    const game = (window as any).reskinGame;
    if (!game.main.inventory.applySlotChanges([
      { slot: { containerId: game.containerId, slotKey: '8' }, itemId: 'log', delta: 2 },
    ])) throw new Error('Unable to fill reskinned chest');
    return game.main.inventory.getEntity({ containerId: game.containerId, slotKey: '8' }).snapshot();
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
    { slotKey: '8', item: storedItem },
  ] });
  expect(Object.keys(save.world.entities).some((prefab) => prefab.includes('reskin') || prefab.includes('explode'))).toBe(false);
  expect(errors).toEqual([]);
});
