import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const moduleUrl = (path: string) => `/@fs${fileURLToPath(new URL(path, import.meta.url))}`;

test('source ground atlases blend edges in WebGL and leave terrain centres and neighbouring cells intact', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async (url) => (await import(url)).checkTurfBlending(), moduleUrl('./turf-blending-fixture.ts'));
  expect(result).toMatchObject({ centerUnchanged: true, edgeChanged: true, outsideUnchanged: true });
  expect(result.changedPixels).toBeGreaterThan(100);
  expect(result.brick).toMatchObject({ centerUnchanged: true, outsideChangedPixels: 0, reloadPreservesPixels: true });
  expect(result.brick.inwardChangedPixels).toBeGreaterThan(100);
  expect(errors).toEqual([]);
  const screenshotPath = testInfo.outputPath('terrain-boundaries.png');
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach('terrain-boundaries', { path: screenshotPath, contentType: 'image/png' });
});

test('pitchfork digs terrain, cursor-held turf deploys on dirt and saves and reloads both terrain and the remaining stack', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    await route.fulfill({ response, json: save });
  });
  await page.goto('/tests/dst-lighting.html');
  const urls = { ...Object.fromEntries(['main', 'player', 'view', 'building'].map((name) => [name, moduleUrl(`../../../src/${name}.ts`)])),
    inventory: moduleUrl('../../ui/src/index.ts') };
  await page.evaluate(async (urls) => {
    const main = await import(urls.main);
    await main.gameReady;
    const { player, playerBody } = await import(urls.player);
    const { view } = await import(urls.view);
    const { turfMap } = await import(urls.building);
    const { equipmentSlotAddress } = await import(urls.inventory);
    // A local initial save can already have a tool in hand; start with an empty slot.
    const handAddress = equipmentSlotAddress('hand');
    const held = main.inventory.get(handAddress);
    if (held) main.inventory.applySlotChanges([{ slot: handAddress, itemId: held.itemId,
      skinId: held.skinId, delta: -held.count }]);
    playerBody.position.set(-138, playerBody.shapes[0].radius, -135);
    playerBody.velocity.set(0, 0, 0);
    player.position.set(-138, 0, -135);
    if (!main.inventory.add('pitchfork', 1)) throw new Error('No room for pitchfork');
    (window as any).pitchforkGame = { ...main, player, view, turfMap };
  }, urls);
  const bar = page.locator('dst-inventory-bar');
  const slot = bar.locator('.inventory-bar__items .inventory-slot[data-item-id="pitchfork"]').first();
  await expect(slot).toBeVisible();
  await expect(slot.locator('.inventory-slot__icon[data-loaded="true"]')).toBeVisible();
  const hand = bar.locator('.inventory-bar__equipment .inventory-slot').first();
  await slot.dragTo(hand);
  await expect(hand).toHaveAttribute('data-item-id', 'pitchfork');
  await expect.poll(() => page.evaluate(() => {
    const { player } = (window as any).pitchforkGame;
    return player.children[0].children[0].material.some((material: any) => material.name === 'ground:swap_pitchfork');
  })).toBe(true);
  const point = async (x: number, z: number) => page.evaluate(async ({ x, z }) => {
    await new Promise(requestAnimationFrame);
    const { view, player } = (window as any).pitchforkGame;
    const ndc = player.position.clone().set(x, 0, z).project(view.camera);
    const bounds = view.renderer.domElement.getBoundingClientRect();
    return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2 };
  }, { x, z });
  const first = await point(-138, -138);
  await page.mouse.click(first.x, first.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).pitchforkGame.turfMap.getTileAtWorld({ x: -138, z: -138 }))).toBe(4);
  await expect.poll(() => page.evaluate(() => (window as any).pitchforkGame.player.userData.animationController.isDigging)).toBe(false);
  const cancelled = await point(-126, -138);
  await page.mouse.click(cancelled.x, cancelled.y, { button: 'right' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1100);
  expect(await page.evaluate(() => (window as any).pitchforkGame.turfMap.getTileAtWorld({ x: -126, z: -138 }))).toBe(30);
  await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', {
    detail: { command: 'c_give("turf_cotl_brick", 3)' },
  })));
  const turfSlot = bar.locator('.inventory-bar__items .inventory-slot[data-item-id="turf_cotl_brick"]').first();
  await expect(turfSlot).toBeVisible();
  await turfSlot.click();
  const cursor = page.locator('.slot-drag-preview');
  await expect(cursor).toHaveAttribute('data-item-id', 'turf_cotl_brick');
  await expect(cursor.locator('.slot-drag-preview__count')).toHaveText('3');
  // Covered terrain refuses deployment and leaves the held stack intact.
  await page.mouse.click(cancelled.x, cancelled.y, { button: 'right' });
  await expect(cursor.locator('.slot-drag-preview__count')).toHaveText('3');
  const empty = await point(-138, -138);
  await page.mouse.click(empty.x, empty.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).pitchforkGame.turfMap.getTileAtWorld({ x: -138, z: -138 }))).toBe(256);
  await expect(cursor.locator('.slot-drag-preview__count')).toHaveText('2');
  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', {
    detail: { command: 'c_save()' },
  })));
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const save = JSON.parse(Buffer.concat(chunks).toString());
  expect(save.world.map.tiles).toContainEqual({ col: -12, row: -12, tileId: 256 });
  expect(save.world.map.tiles).not.toContainEqual({ col: -11, row: -12, tileId: 4 });
  const held = save.players.local.inventory.containers['player:cursor'].slots[0].item;
  expect(held).toMatchObject({ itemId: 'turf_cotl_brick', count: 2 });
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: save }));
  await page.reload();
  const restored = await page.evaluate(async urls => {
    const main = await import(urls.main);
    await main.gameReady;
    const { turfMap } = await import(urls.building);
    return { tile: turfMap.getTileAtWorld({ x: -138, z: -138 }),
      held: main.inventory.getEntity({ containerId: 'player:cursor', slotKey: '0' })?.snapshot() };
  }, urls);
  expect(restored).toEqual({ tile: 256, held });
  expect(errors).toEqual([]);
});
