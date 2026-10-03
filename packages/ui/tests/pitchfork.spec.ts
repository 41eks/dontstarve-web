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
  expect(errors).toEqual([]);
  const screenshotPath = testInfo.outputPath('terrain-boundaries.png');
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach('terrain-boundaries', { path: screenshotPath, contentType: 'image/png' });
});

test('equipped pitchfork digs the clicked tile, cancels pending work and saves the changed terrain', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/dst-lighting.html');
  await page.evaluate(async (urls) => {
    const main = await import(urls.main);
    const { player, playerBody } = await import(urls.player);
    const { view } = await import(urls.view);
    const { turfMap } = await import(urls.building);
    const { equipmentSlotAddress } = await import(urls.inventory);
    // A local initial save can already have a tool in hand; start with an empty slot.
    const handAddress = equipmentSlotAddress('hand');
    const held = main.inventory.get(handAddress);
    if (held) main.inventory.applySlotChanges([{ slot: handAddress, itemId: held.itemId,
      skinId: held.skinId, delta: -held.count }]);
    playerBody.position.set(-198, playerBody.shapes[0].radius, -195);
    playerBody.velocity.set(0, 0, 0);
    player.position.set(-198, 0, -195);
    if (!main.inventory.add('pitchfork', 1)) throw new Error('No room for pitchfork');
    (window as any).pitchforkGame = { ...main, player, view, turfMap };
  }, { ...Object.fromEntries(['main', 'player', 'view', 'building'].map((name) => [name, moduleUrl(`../../../src/${name}.ts`)])),
    inventory: moduleUrl('../../ui/src/index.ts') });
  const bar = page.locator('dst-inventory-bar');
  const slot = bar.locator('.inventory-bar__items .inventory-slot[data-item-id="pitchfork"]').first();
  await expect(slot).toBeVisible();
  await expect(slot.locator('canvas[data-loaded="true"]')).toBeVisible();
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
  const first = await point(-198, -198);
  await page.mouse.click(first.x, first.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).pitchforkGame.turfMap.getTileAtWorld({ x: -198, z: -198 }))).toBe(4);
  await expect.poll(() => page.evaluate(() => (window as any).pitchforkGame.player.userData.animationController.isDigging)).toBe(false);
  const cancelled = await point(-186, -198);
  await page.mouse.click(cancelled.x, cancelled.y, { button: 'right' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1100);
  expect(await page.evaluate(() => (window as any).pitchforkGame.turfMap.getTileAtWorld({ x: -186, z: -198 }))).toBe(30);
  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', {
    detail: { command: 'c_save()' },
  })));
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const save = JSON.parse(Buffer.concat(chunks).toString());
  expect(save.world.map.tiles).toContainEqual({ col: -17, row: -17, tileId: 4 });
  expect(save.world.map.tiles).not.toContainEqual({ col: -16, row: -17, tileId: 4 });
  expect(errors).toEqual([]);
});
