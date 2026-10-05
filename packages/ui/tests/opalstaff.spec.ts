import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('game console gives opalstaff and equipped right-click summons a saved polar light', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/dst-lighting.html');
  await page.evaluate(async (urls) => {
    const main = await import(urls.main);
    const { player } = await import(urls.player);
    const { scene } = await import(urls.universal);
    const { view } = await import(urls.view);
    const { inventorySlotAddress, equipmentSlotAddress } = await import(urls.inventory);
    // Ensure space and an empty hand regardless of the local saved inventory.
    for (const slot of [inventorySlotAddress(0), equipmentSlotAddress('hand')]) {
      const item = main.inventory.get(slot);
      if (item) main.inventory.applySlotChanges([{ slot, ...item, delta: -item.count }]);
    }
    (window as any).opalGame = { main, player, scene, view };
  }, {
    ...Object.fromEntries(['main', 'player', 'universal', 'view'].map((name) =>
      [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`])),
    inventory: `/@fs${fileURLToPath(new URL('../../inventory/src/index.ts', import.meta.url))}`,
  });
  const command = async (text: string) => {
    await page.keyboard.press('Backquote');
    const input = page.locator('dst-debug-console input');
    await input.fill(text);
    await input.press('Enter');
  };
  await command('c_give("opalstaff")');
  const bar = page.locator('dst-inventory-bar');
  const staff = bar.locator('.inventory-bar__items .inventory-slot[data-item-id="opalstaff"]').first();
  await expect(staff).toBeVisible();
  await expect(staff.locator('.inventory-slot__icon[data-loaded="true"]')).toBeVisible();
  const hand = bar.locator('.inventory-bar__equipment .inventory-slot').first();
  await staff.dragTo(hand);
  await expect(hand).toHaveAttribute('data-item-id', 'opalstaff');
  await expect.poll(() => page.evaluate(() => (window as any).opalGame.player.children[0].children[0].material
    .some((material: any) => material.name === 'ground:swap_staffs'))).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).opalGame.player.userData.animationController.stategraph.isOneShot)).toBe(false);
  const point = await page.evaluate(() => {
    const { player, view } = (window as any).opalGame;
    const position = player.position.clone();
    position.x += 12;
    position.y = 0;
    (window as any).opalGame.target = [position.x, 0, position.z];
    const ndc = position.project(view.camera);
    const bounds = view.renderer.domElement.getBoundingClientRect();
    return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2 };
  });
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).opalGame.player.userData.animationController.isCasting)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).opalGame.scene.children
    .filter((model: any) => model.name === 'staffcoldlight').length)).toBe(1);
  const download = page.waitForEvent('download');
  await command('c_save()');
  const save = await download;
  const path = await save.path();
  expect(path).not.toBeNull();
  const document = JSON.parse(await readFile(path!, 'utf8'));
  const lights = document.world.entities.staffcoldlight;
  expect(lights).toHaveLength(1);
  expect(lights[0].components.timer.remainingSeconds).toBeGreaterThan(950);
  expect(lights[0].components.timer.remainingSeconds).toBeLessThanOrEqual(960);
  const target = await page.evaluate(() => (window as any).opalGame.target);
  expect(lights[0].transform.position[0]).toBeCloseTo(target[0], 3);
  expect(lights[0].transform.position[2]).toBeCloseTo(target[2], 3);
  expect(document.players.local.inventory.containers['player:equipment'].slots)
    .toContainEqual({ slotKey: 'hand', item: { itemId: 'opalstaff', count: 1 } });
  expect(errors).toEqual([]);
});
