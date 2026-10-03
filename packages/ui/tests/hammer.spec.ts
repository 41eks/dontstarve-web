import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('hammer equipment, ground art, right-click action and building feedback preserve state', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async (url) => (await import(url)).checkHammer(),
    `/@fs${fileURLToPath(new URL('./hammer-fixture.ts', import.meta.url))}`);
  expect(result.failures).toEqual([]);
  expect(result).toMatchObject({ skins: 5, wornCases: 36, buildingCases: 16, inventoryEquipped: true,
    maxStack: 1, equippable: 'hand', campfireExcluded: true, openingResumed: true, litHit: true,
    ignoredLeft: true, consumedRight: true, manualCancels: true, missedHit: true,
    unequipCancels: true, ignoredUnequipped: true, approaches: true, reachesTarget: true, hoverLabel: true });
  expect(errors).toEqual([]);
});

test('game UI equips, drops and picks up hammer, then right-click hammers a building', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/dst-lighting.html');
  await page.evaluate(async (urls) => {
    const main = await import(urls.main);
    const player = await import(urls.player);
    const { scene } = await import(urls.universal);
    const { view } = await import(urls.view);
    const target = scene.children.find((model: any) => model.name === 'TreasureChest');
    if (!target) throw new Error('Missing saved treasure chest');
    const radius = player.playerBody.shapes[0].radius;
    player.playerBody.position.set(target.position.x, radius, target.position.z + 3);
    player.player.position.set(target.position.x, 0, target.position.z + 3);
    main.inventory.add('hammer', 1);
    (window as any).hammerGame = { main, ...player, scene, view, target };
  }, Object.fromEntries(['main', 'player', 'universal', 'view'].map((name) =>
    [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`])));
  const bar = page.locator('dst-inventory-bar');
  const hammerSlot = bar.locator('.inventory-bar__items .inventory-slot[data-item-id="hammer"]');
  await expect(hammerSlot).toBeVisible();
  await expect(hammerSlot.locator('canvas[data-loaded="true"]')).toBeVisible();
  // Actual Shift + right-click uses the application store and source ground model.
  await page.keyboard.down('Shift');
  await hammerSlot.click({ button: 'right' });
  await page.keyboard.up('Shift');
  await expect.poll(() => page.evaluate(() => (window as any).hammerGame.scene.children.some((model: any) => model.name === 'GroundItem:hammer'))).toBe(true);
  const point = await page.evaluate(() => {
    const { scene, view } = (window as any).hammerGame;
    const dropped = scene.children.find((model: any) => model.name === 'GroundItem:hammer');
    const position = dropped.position.clone();
    dropped.children[0].children[0].geometry.computeBoundingBox();
    const box = dropped.children[0].children[0].geometry.boundingBox;
    position.y += -(box.min.y + box.max.y) * 0.01;
    const ndc = position.project(view.camera);
    const bounds = view.renderer.domElement.getBoundingClientRect();
    return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await expect(hammerSlot).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).hammerGame.scene.children.some((model: any) => model.name === 'GroundItem:hammer'))).toBe(false);
  const hand = bar.locator('.inventory-bar__equipment .inventory-slot').first();
  await hammerSlot.dragTo(hand);
  await expect(hand).toHaveAttribute('data-item-id', 'hammer');
  await expect.poll(() => page.evaluate(() => (window as any).hammerGame.player.children[0].children[0].material
    .some((material: any) => material.name === 'ground:swap_hammer'))).toBe(true);
  const targetPoint = await page.evaluate(async () => {
    const { target, view } = (window as any).hammerGame;
    const before = JSON.stringify(target.userData.saveRecord);
    (window as any).hammerGame.before = before;
    (window as any).hammerGame.hitSeen = false;
    const controller = target.userData.animationController;
    const original = controller.playTransient.bind(controller);
    controller.playTransient = (name: string) => { (window as any).hammerGame.hitSeen = name === 'hit'; original(name); };
    await new Promise(requestAnimationFrame);
    const ndc = target.position.clone().project(view.camera);
    const bounds = view.renderer.domElement.getBoundingClientRect();
    return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2 };
  });
  await page.mouse.click(targetPoint.x, targetPoint.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).hammerGame.hitSeen)).toBe(true);
  expect(await page.evaluate(() => {
    const { target, before } = (window as any).hammerGame;
    return JSON.stringify(target.userData.saveRecord) === before;
  })).toBe(true);
  await expect(page.locator('dst-chest-panel .chest-panel')).toBeHidden();
  expect(errors).toEqual([]);
});
