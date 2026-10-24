import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test('cursor swaps, rejected placement and save reload preserve inventory and backpack entities', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/dst-lighting.html');
  const urls = Object.fromEntries(['main', 'save/deserialize', 'save/catalog'].map(name =>
    [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  const original = await page.evaluate(async url => {
    const { inventory } = await import(url);
    inventory.setRemainingFuel({ containerId: 'player:inventory', slotKey: '2' }, 23.125);
    (window as any).swapInventory = inventory;
    return {
      torch: inventory.getEntity({ containerId: 'player:inventory', slotKey: '2' })!.snapshot(),
      logs: inventory.getEntity({ containerId: 'player:inventory', slotKey: '4' })!.snapshot(),
    };
  }, urls.main);
  const bar = page.locator('dst-inventory-bar');
  const first = bar.locator('.inventory-bar__items [data-slot-key="2"]');
  const second = bar.locator('.inventory-bar__items [data-slot-key="4"]');
  const preview = page.locator('.slot-drag-preview');
  await expect(first).toHaveAttribute('data-item-id', 'torch');
  await first.click();
  await expect(preview).toHaveAttribute('data-item-id', 'torch');
  await expect(first).toHaveAttribute('data-item-id', '');
  await expect(preview.locator('.slot-drag-preview__percent')).toHaveText('31%');
  await second.hover();
  await expect(second).toHaveClass(/is-drop-target/);
  await second.click();
  await expect(preview).toHaveAttribute('data-item-id', 'log');
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(first).toHaveAttribute('data-item-id', 'log');
  await expect(second).toHaveAttribute('data-item-id', 'torch');
  await expect(second.locator('.inventory-slot__percent')).toHaveText('31%');

  await first.click();
  await bar.locator('[data-slot-key="hand"]').click();
  await expect(preview).toHaveAttribute('data-item-id', 'log');
  await expect(first).toHaveAttribute('data-item-id', '');
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);

  await page.evaluate(() => {
    const inventory = (window as any).swapInventory;
    if (!inventory.add('backpack', 1)) throw new Error('Unable to give backpack');
    const source = inventory.addresses().find((address: any) => address.containerId === 'player:inventory'
      && inventory.get(address)?.itemId === 'backpack');
    if (!inventory.transfer(source, { containerId: 'player:equipment', slotKey: 'body' }, 1)) throw new Error('Unable to equip backpack');
    const bag = inventory.getEntity({ containerId: 'player:equipment', slotKey: 'body' });
    if (!inventory.transfer({ containerId: 'player:inventory', slotKey: '2' },
      { containerId: `item:backpack:${bag.id}`, slotKey: '0' }, 8)) throw new Error('Unable to prepare backpack');
  });
  const packSlot = page.locator('dst-backpack-panel [data-slot-key="0"]');
  await expect(packSlot).toHaveAttribute('data-item-id', 'log');
  await second.click();
  await packSlot.click();
  await expect(preview).toHaveAttribute('data-item-id', 'log');
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(packSlot).toHaveAttribute('data-item-id', 'torch');
  await expect(packSlot.locator('.inventory-slot__percent')).toHaveText('31%');
  await expect(second).toHaveAttribute('data-item-id', 'log');
  await second.click();
  await first.click();
  await expect(first).toHaveAttribute('data-item-id', 'log');
  await expect(second).toHaveAttribute('data-item-id', '');

  await packSlot.click();
  await expect(preview).toHaveAttribute('data-item-id', 'torch');
  await expect(packSlot).toHaveAttribute('data-item-id', '');

  const download = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command: 'c_save()' } })));
  const stream = await (await download).createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const json = Buffer.concat(chunks).toString();
  const saved = await page.evaluate(async ({ json, urls }) => {
    const { deserializeSave } = await import(urls['save/deserialize']);
    const { SAVE_CATALOG } = await import(urls['save/catalog']);
    return deserializeSave(json, SAVE_CATALOG);
  }, { json, urls });
  const containers = saved.players.local.inventory.containers;
  expect(containers['player:inventory'].slots.find(slot => slot.slotKey === '2')!.item).toEqual(original.logs);
  const bag = containers['player:equipment'].slots.find(slot => slot.slotKey === 'body')!.item;
  expect(bag.container!.slots).toEqual([]);
  expect(containers['player:cursor'].slots[0].item).toEqual(original.torch);
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload();
  expect(await page.evaluate(async url => {
    const { inventory } = await import(url);
    return inventory.getEntity({ containerId: 'player:cursor', slotKey: '0' })?.snapshot();
  }, urls.main)).toEqual(original.torch);
  await page.mouse.move(300, 300);
  await expect(preview.locator('.slot-drag-preview__percent')).toHaveText('31%');
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  expect(errors).toEqual([]);
});
