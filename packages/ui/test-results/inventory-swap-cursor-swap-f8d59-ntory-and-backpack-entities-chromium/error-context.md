# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: inventory-swap.spec.ts >> cursor swaps, rejected placement and save reload preserve inventory and backpack entities
- Location: tests/inventory-swap.spec.ts:4:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('dst-inventory-bar').locator('.inventory-bar__items [data-slot-key="2"]')
Expected: "torch"
Received: "wortox_souljar"
Timeout:  5000ms

Call log:
  - Expect "toHaveAttribute" locator('dst-inventory-bar').locator('.inventory-bar__items [data-slot-key="2"]') with timeout 5000ms
  - waiting for locator('dst-inventory-bar').locator('.inventory-bar__items [data-slot-key="2"]')

```

```yaml
- button "灵魂罐，数量 1"
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | import { fileURLToPath } from 'node:url';
  3   | 
  4   | test('cursor swaps, rejected placement and save reload preserve inventory and backpack entities', async ({ page }) => {
  5   |   test.setTimeout(120_000);
  6   |   const errors: string[] = [];
  7   |   page.on('pageerror', error => errors.push(error.message));
  8   |   await page.route('**/saves/initial-world.json', async route => {
  9   |     const response = await route.fetch(), save = await response.json();
  10  |     for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
  11  |     save.players.local.inventory.containers['player:inventory'].slots = [
  12  |       { slotKey: '2', item: { itemId: 'torch', count: 1 } },
  13  |       { slotKey: '4', item: { itemId: 'log', count: 8 } },
  14  |     ];
  15  |     await route.fulfill({ response, json: save });
  16  |   });
  17  |   await page.goto('/tests/dst-lighting.html');
  18  |   const urls = Object.fromEntries(['main', 'save/deserialize', 'save/catalog'].map(name =>
  19  |     [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  20  |   const original = await page.evaluate(async url => {
  21  |     const { inventory } = await import(url);
  22  |     inventory.setRemainingFuel({ containerId: 'player:inventory', slotKey: '2' }, 23.125);
  23  |     (window as any).swapInventory = inventory;
  24  |     return {
  25  |       torch: inventory.getEntity({ containerId: 'player:inventory', slotKey: '2' })!.snapshot(),
  26  |       logs: inventory.getEntity({ containerId: 'player:inventory', slotKey: '4' })!.snapshot(),
  27  |     };
  28  |   }, urls.main);
  29  |   const bar = page.locator('dst-inventory-bar');
  30  |   const first = bar.locator('.inventory-bar__items [data-slot-key="2"]');
  31  |   const second = bar.locator('.inventory-bar__items [data-slot-key="4"]');
  32  |   const preview = page.locator('.slot-drag-preview');
> 33  |   await expect(first).toHaveAttribute('data-item-id', 'torch');
      |                       ^ Error: expect(locator).toHaveAttribute(expected) failed
  34  |   await first.click();
  35  |   await expect(preview).toHaveAttribute('data-item-id', 'torch');
  36  |   await expect(first).toHaveAttribute('data-item-id', '');
  37  |   await expect(preview.locator('.slot-drag-preview__percent')).toHaveText('31%');
  38  |   await second.hover();
  39  |   await expect(second).toHaveClass(/is-drop-target/);
  40  |   await second.click();
  41  |   await expect(preview).toHaveAttribute('data-item-id', 'log');
  42  |   await page.keyboard.press('Escape');
  43  |   await expect(preview).toHaveCount(0);
  44  |   await expect(first).toHaveAttribute('data-item-id', 'log');
  45  |   await expect(second).toHaveAttribute('data-item-id', 'torch');
  46  |   await expect(second.locator('.inventory-slot__percent')).toHaveText('31%');
  47  | 
  48  |   await first.click();
  49  |   await bar.locator('[data-slot-key="hand"]').click();
  50  |   await expect(preview).toHaveAttribute('data-item-id', 'log');
  51  |   await expect(first).toHaveAttribute('data-item-id', '');
  52  |   await page.keyboard.press('Escape');
  53  |   await expect(preview).toHaveCount(0);
  54  | 
  55  |   await page.evaluate(() => {
  56  |     const inventory = (window as any).swapInventory;
  57  |     if (!inventory.add('backpack', 1)) throw new Error('Unable to give backpack');
  58  |     const source = inventory.addresses().find((address: any) => address.containerId === 'player:inventory'
  59  |       && inventory.get(address)?.itemId === 'backpack');
  60  |     if (!inventory.transfer(source, { containerId: 'player:equipment', slotKey: 'body' }, 1)) throw new Error('Unable to equip backpack');
  61  |     const bag = inventory.getEntity({ containerId: 'player:equipment', slotKey: 'body' });
  62  |     if (!inventory.transfer({ containerId: 'player:inventory', slotKey: '2' },
  63  |       { containerId: `item:backpack:${bag.id}`, slotKey: '0' }, 8)) throw new Error('Unable to prepare backpack');
  64  |   });
  65  |   const packSlot = page.locator('dst-backpack-panel [data-slot-key="0"]');
  66  |   await expect(packSlot).toHaveAttribute('data-item-id', 'log');
  67  |   await second.click();
  68  |   await packSlot.click();
  69  |   await expect(preview).toHaveAttribute('data-item-id', 'log');
  70  |   await page.keyboard.press('Escape');
  71  |   await expect(preview).toHaveCount(0);
  72  |   await expect(packSlot).toHaveAttribute('data-item-id', 'torch');
  73  |   await expect(packSlot.locator('.inventory-slot__percent')).toHaveText('31%');
  74  |   await expect(second).toHaveAttribute('data-item-id', 'log');
  75  |   await second.click();
  76  |   await first.click();
  77  |   await expect(first).toHaveAttribute('data-item-id', 'log');
  78  |   await expect(second).toHaveAttribute('data-item-id', '');
  79  | 
  80  |   await packSlot.click();
  81  |   await expect(preview).toHaveAttribute('data-item-id', 'torch');
  82  |   await expect(packSlot).toHaveAttribute('data-item-id', '');
  83  | 
  84  |   const download = page.waitForEvent('download');
  85  |   await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(
  86  |     new CustomEvent('game:debug-command', { detail: { command: 'c_save()' } })));
  87  |   const stream = await (await download).createReadStream();
  88  |   const chunks = [];
  89  |   for await (const chunk of stream!) chunks.push(chunk);
  90  |   const json = Buffer.concat(chunks).toString();
  91  |   const saved = await page.evaluate(async ({ json, urls }) => {
  92  |     const { deserializeSave } = await import(urls['save/deserialize']);
  93  |     const { SAVE_CATALOG } = await import(urls['save/catalog']);
  94  |     return deserializeSave(json, SAVE_CATALOG);
  95  |   }, { json, urls });
  96  |   const containers = saved.players.local.inventory.containers;
  97  |   expect(containers['player:inventory'].slots.find(slot => slot.slotKey === '2')!.item).toEqual(original.logs);
  98  |   const bag = containers['player:equipment'].slots.find(slot => slot.slotKey === 'body')!.item;
  99  |   expect(bag.container!.slots).toEqual([]);
  100 |   expect(containers['player:cursor'].slots[0].item).toEqual(original.torch);
  101 |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  102 |   await page.reload();
  103 |   expect(await page.evaluate(async url => {
  104 |     const { inventory } = await import(url);
  105 |     return inventory.getEntity({ containerId: 'player:cursor', slotKey: '0' })?.snapshot();
  106 |   }, urls.main)).toEqual(original.torch);
  107 |   await page.mouse.move(300, 300);
  108 |   await expect(preview.locator('.slot-drag-preview__percent')).toHaveText('31%');
  109 |   await page.keyboard.press('Escape');
  110 |   await expect(preview).toHaveCount(0);
  111 |   expect(errors).toEqual([]);
  112 | });
  113 | 
```