import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const modules = Object.fromEntries(['main', 'player'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('head/body signals restore equipped art and keep the backpack active when a hat is removed', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const prepare = () => page.evaluate(async paths => {
    const main = await import(paths.main), { player } = await import(paths.player);
    (window as any).equipmentGame = { main, player };
  }, modules);
  await page.goto('/tests/dst-lighting.html');
  await prepare();
  await page.evaluate(() => {
    const { main } = (window as any).equipmentGame;
    main.inventory.applySlotChanges(main.inventory.exportState().slots.filter((slot: any) => slot.item)
      .map((slot: any) => ({ slot: slot.address, ...slot.item, delta: -slot.item.count })));
    for (const command of ['c_give("strawhat")', 'c_give("backpack")']) {
      document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', { detail: { command } }));
    }
  });
  const bar = page.locator('dst-inventory-bar');
  const head = bar.locator('[data-slot-key="head"]'), body = bar.locator('[data-slot-key="body"]');
  const items = bar.locator('.inventory-bar__items');
  await items.locator('[data-item-id="strawhat"]').dragTo(head);
  await items.locator('[data-item-id="backpack"]').dragTo(body);
  const hatArt = () => page.evaluate(() => {
    const mesh = (window as any).equipmentGame.player.children[0].children[0];
    return mesh.geometry.groups.some((group: any) => mesh.material[group.materialIndex]?.name.startsWith('hat:'));
  });
  await expect.poll(hatArt).toBe(true);
  await expect(page.locator('dst-backpack-panel .inventory-slot')).toHaveCount(8);

  const download = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command: 'c_save()' } })));
  const save = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  const savedEquipment = save.players.local.inventory.containers['player:equipment'].slots;
  expect(savedEquipment.find((slot: any) => slot.slotKey === 'head').item.itemId).toBe('strawhat');
  expect(savedEquipment.find((slot: any) => slot.slotKey === 'body').item.itemId).toBe('backpack');
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: save }));
  await page.reload(); await prepare();
  await expect(head).toHaveAttribute('data-item-id', 'strawhat');
  await expect(body).toHaveAttribute('data-item-id', 'backpack');
  await expect.poll(hatArt).toBe(true);
  await expect(page.locator('dst-backpack-panel .chest-panel')).toBeVisible();
  await head.dragTo(items.locator('[data-item-id=""]').first());
  await expect(head).toHaveAttribute('data-item-id', '');
  await expect.poll(hatArt).toBe(false);
  await expect(page.locator('dst-backpack-panel .chest-panel')).toBeVisible();
  expect(await page.evaluate(() => {
    const { main } = (window as any).equipmentGame;
    return { head: main.headEquipment.peek(), body: main.bodyEquipment.peek()?.itemId,
      hat: main.inventory.materialSummary().strawhat };
  })).toEqual({ head: null, body: 'backpack', hat: 1 });
  expect(errors).toEqual([]);
});
