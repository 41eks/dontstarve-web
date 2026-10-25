# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: inventory-receive.spec.ts >> pickup receipts reach both inventory and backpack slots and closing the backpack preserves received stacks
- Location: tests/inventory-receive.spec.ts:61:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator:  locator('dst-backpack-panel .inventory-slot').first()
Expected: visible
Received: hidden
Timeout:  5000ms

Call log:
  - Expect "toBeVisible" locator('dst-backpack-panel .inventory-slot').first() with timeout 5000ms
  - waiting for locator('dst-backpack-panel .inventory-slot').first()
    - locator resolved to <button type="button" data-item-id="" data-skin-id="" data-slot-key="0" aria-label="背包 1" aria-selected="false" data-empty-label="背包 1" class="inventory-slot is-empty" data-background-asset="ingredient_slot.tex.png" data-container-id="item:backpack:e_21c9b0f1e5edff1b529582e3b20edcd3">…</button>
    - unexpected value "hidden"

```

# Test source

```ts
  1   | import { fileURLToPath } from 'node:url';
  2   | import { expect, test, type Page } from '@playwright/test';
  3   | 
  4   | const moduleUrl = (path: string) => `/@fs${fileURLToPath(new URL(path, import.meta.url))}`;
  5   | 
  6   | async function setup(page: Page) {
  7   |   await page.addInitScript(() => {
  8   |     const original = Element.prototype.animate;
  9   |     Element.prototype.animate = function (...args: Parameters<Element['animate']>) {
  10  |       const animation = original.apply(this, args);
  11  |       // Keep flight and landing frames deterministic; other game animations run normally.
  12  |       if (this.classList.contains('inventory-receive-flight')
  13  |         || this.classList.contains('inventory-slot__content') || this.classList.contains('inventory-slot__count')) {
  14  |         animation.pause();
  15  |         animation.currentTime = 0;
  16  |       }
  17  |       return animation;
  18  |     };
  19  |   });
  20  |   await page.goto('/tests/dst-lighting.html');
  21  |   await page.evaluate(async (url) => {
  22  |     (window as any).receiveFixture = await (await import(url)).createReceiveFixture();
  23  |   }, moduleUrl('./inventory-receive-fixture.ts'));
  24  | }
  25  | 
  26  | test('captured fireflies fly from their projected foot point into the actual slot with Lua easing and a landing pulse', async ({ page }) => {
  27  |   const errors: string[] = [];
  28  |   page.on('pageerror', (error) => errors.push(error.message));
  29  |   await setup(page);
  30  |   const result = await page.evaluate(() => (window as any).receiveFixture.capture());
  31  |   expect(result).toMatchObject({ ok: true, remaining: 0 });
  32  |   const flight = page.locator('.inventory-receive-flight');
  33  |   await expect(flight).toBeVisible();
  34  |   await expect(flight.locator('.inventory-slot__icon')).toHaveAttribute('data-loaded', 'true');
  35  |   await expect(flight).toHaveAttribute('data-item-id', 'fireflies');
  36  |   const slot = page.locator('dst-inventory-bar .inventory-slot[data-item-id="fireflies"]');
  37  |   await expect(slot.locator('.inventory-slot__content')).toBeHidden();
  38  |   const start = (await flight.boundingBox())!;
  39  |   const destination = await slot.locator('.inventory-slot__content').evaluate((element) => {
  40  |     const rect = element.getBoundingClientRect();
  41  |     return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  42  |   });
  43  |   expect(start.x + start.width / 2).toBeCloseTo(result.source.x, 1);
  44  |   expect(start.y + start.height / 2).toBeCloseTo(result.source.y, 1);
  45  |   expect(await flight.evaluate((element) => element.getAnimations()[0].effect!.getTiming().duration)).toBe(300);
  46  |   await flight.evaluate((element) => { element.getAnimations()[0].currentTime = 150; });
  47  |   const middle = (await flight.boundingBox())!;
  48  |   expect(middle.x + middle.width / 2).toBeCloseTo(result.source.x + (destination.x - result.source.x) * 0.875, 1);
  49  |   expect(middle.y + middle.height / 2).toBeCloseTo(result.source.y + (destination.y - result.source.y) * 0.875, 1);
  50  |   await flight.evaluate((element) => element.getAnimations()[0].finish());
  51  |   await expect(flight).toHaveCount(0);
  52  |   await expect(slot.locator('.inventory-slot__content')).toBeVisible();
  53  |   const landing = await slot.locator('.inventory-slot__content').evaluate((element) => {
  54  |     const animation = element.getAnimations()[0];
  55  |     return { scale: new DOMMatrix(getComputedStyle(element).transform).a, duration: animation.effect!.getTiming().duration };
  56  |   });
  57  |   expect(landing).toEqual({ scale: 2, duration: 250 });
  58  |   expect(errors).toEqual([]);
  59  | });
  60  | 
  61  | test('pickup receipts reach both inventory and backpack slots and closing the backpack preserves received stacks', async ({ page }) => {
  62  |   const errors: string[] = [];
  63  |   page.on('pageerror', error => errors.push(error.message));
  64  |   await setup(page);
  65  |   const { containerId, maxStack } = await page.evaluate(() => (window as any).receiveFixture.equipBackpack());
  66  |   const packSlot = page.locator('dst-backpack-panel .inventory-slot').first();
> 67  |   await expect(packSlot).toBeVisible();
      |                          ^ Error: expect(locator).toBeVisible() failed
  68  |   expect(await page.evaluate(() => (window as any).receiveFixture.give('rocks', 3))).toBe(true);
  69  |   const flights = page.locator('.inventory-receive-flight');
  70  |   await expect(flights).toHaveCount(2);
  71  |   await expect(flights.locator('[data-loaded="true"]')).toHaveCount(2);
  72  |   const mainSlot = page.locator('dst-inventory-bar .inventory-bar__items .inventory-slot').first();
  73  |   await expect(mainSlot.locator('.inventory-slot__count')).toHaveText(String(maxStack - 1));
  74  |   await expect(packSlot.locator('.inventory-slot__content')).toBeHidden();
  75  |   expect(await flights.evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.containerId).sort()))
  76  |     .toEqual([containerId, 'player:inventory'].sort());
  77  |   await expect(flights.first()).toBeVisible();
  78  |   await expect(flights.last()).toBeVisible();
  79  |   await flights.evaluateAll(elements => elements.forEach(element => element.getAnimations()[0].finish()));
  80  |   await expect(flights).toHaveCount(0);
  81  |   await expect(mainSlot.locator('.inventory-slot__count')).toHaveText(String(maxStack));
  82  |   await expect(packSlot.locator('.inventory-slot__count')).toHaveText('2');
  83  | 
  84  |   expect(await page.evaluate(() => (window as any).receiveFixture.give('rocks', 1))).toBe(true);
  85  |   await expect(flights).toHaveCount(1);
  86  |   await expect(flights).toHaveAttribute('data-container-id', containerId);
  87  |   await expect(packSlot.locator('.inventory-slot__count')).toHaveText('2');
  88  |   await page.evaluate(() => (window as any).receiveFixture.backpackPanel.close());
  89  |   await expect(flights).toHaveCount(0);
  90  |   // A receipt without a visible destination must still leave the inventory transaction intact.
  91  |   expect(await page.evaluate(() => (window as any).receiveFixture.give('rocks', 1))).toBe(true);
  92  |   await expect(flights).toHaveCount(0);
  93  |   expect(await page.evaluate(id => (window as any).receiveFixture.inventory.get({ containerId: id, slotKey: '0' }).count, containerId)).toBe(4);
  94  |   expect(errors).toEqual([]);
  95  | });
  96  | 
  97  | test('failed acquisition, removing an item, resizing and disconnecting the UI leave no stale flights', async ({ page }) => {
  98  |   await setup(page);
  99  |   await page.evaluate(() => (window as any).receiveFixture.add('cutgrass', 1));
  100 |   const flight = page.locator('.inventory-receive-flight');
  101 |   await expect(flight).toBeVisible();
  102 |   await page.evaluate(() => (window as any).receiveFixture.remove(0));
  103 |   await expect(flight).toHaveCount(0);
  104 |   const slot = page.locator('dst-inventory-bar .inventory-slot').first();
  105 |   await expect(slot).toHaveAttribute('data-item-id', '');
  106 |   await page.evaluate(() => (window as any).receiveFixture.add('cutgrass', 1));
  107 |   await expect(flight).toBeVisible();
  108 |   await page.setViewportSize({ width: 1000, height: 720 });
  109 |   await expect(flight).toHaveCount(0);
  110 |   await expect(slot.locator('.inventory-slot__content')).toBeVisible();
  111 |   await page.evaluate(() => (window as any).receiveFixture.add('cutgrass', 1));
  112 |   await expect(flight).toBeVisible();
  113 |   await page.evaluate(() => (window as any).receiveFixture.dispose());
  114 |   await expect(flight).toHaveCount(0);
  115 |   const failed = await page.evaluate(() => (window as any).receiveFixture.add('cutgrass', 1000));
  116 |   expect(failed.ok).toBe(false);
  117 |   await expect(flight).toHaveCount(0);
  118 | });
  119 | 
  120 | for (const viewport of [{ width: 375, height: 667 }]) {
  121 | test(`the production crafting event keeps the flying icon in its slot size at ${viewport.width}px`, async ({ page }) => {
  122 |   test.setTimeout(120_000);
  123 |   const errors: string[] = [];
  124 |   page.on('pageerror', (error) => errors.push(error.message));
  125 |   await page.setViewportSize(viewport);
  126 |   await setup(page);
  127 |   await page.evaluate(() => (window as any).receiveFixture.dispose());
  128 |   const result = await page.evaluate(async (urls) => {
  129 |     const { inventory } = await import(urls.main);
  130 |     const { player } = await import(urls.player);
  131 |     const { view } = await import(urls.view);
  132 |     const { projectInventorySource } = await import(urls.receive);
  133 |     const changes = inventory.addresses().filter((slot: any) => slot.containerId === 'player:inventory')
  134 |       .flatMap((slot: any) => {
  135 |         const stack = inventory.get(slot);
  136 |         return stack ? [{ slot, itemId: stack.itemId, skinId: stack.skinId, delta: -stack.count }] : [];
  137 |       });
  138 |     inventory.applySlotChanges(changes);
  139 |     if (!inventory.add('cutgrass', 3)) throw new Error('No room for ingredients');
  140 |     const source = projectInventorySource(player.position, view.camera, view.renderer.domElement);
  141 |     document.querySelector('dst-crafting-ui')!.dispatchEvent(new CustomEvent('game:craft-request', {
  142 |       detail: { recipeId: 'rope' }, bubbles: true, composed: true,
  143 |     }));
  144 |     return { source, count: inventory.count('rope') };
  145 |   }, { main: moduleUrl('../../../src/main.ts'), player: moduleUrl('../../../src/player.ts'),
  146 |     view: moduleUrl('../../../src/view.ts'), receive: moduleUrl('../../../src/inventoryReceive.ts') });
  147 |   expect(result.count).toBe(1);
  148 |   const flight = page.locator('.inventory-receive-flight');
  149 |   await expect(flight).toBeVisible();
  150 |   await expect(flight).toHaveAttribute('data-item-id', 'rope');
  151 |   const rect = (await flight.boundingBox())!;
  152 |   const icon = (await flight.locator('.inventory-slot__icon').boundingBox())!;
  153 |   const slot = page.locator('dst-inventory-bar .inventory-slot[data-item-id="rope"]');
  154 |   const slotRect = (await slot.boundingBox())!;
  155 |   expect(icon.width).toBeCloseTo(rect.width, 1);
  156 |   expect(icon.height).toBeCloseTo(rect.height, 1);
  157 |   expect(icon.width).toBeLessThan(slotRect.width);
  158 |   expect(icon.height).toBeLessThan(slotRect.height);
  159 |   expect(icon.x).toBeGreaterThanOrEqual(0);
  160 |   expect(icon.y).toBeGreaterThanOrEqual(0);
  161 |   expect(icon.x + icon.width).toBeLessThanOrEqual(viewport.width);
  162 |   expect(icon.y + icon.height).toBeLessThanOrEqual(viewport.height);
  163 |   expect(rect.x + rect.width / 2).toBeCloseTo(result.source.x, 1);
  164 |   expect(rect.y + rect.height / 2).toBeCloseTo(result.source.y, 1);
  165 |   expect(icon.x + icon.width / 2).toBeCloseTo(result.source.x, 1);
  166 |   expect(icon.y + icon.height / 2).toBeCloseTo(result.source.y, 1);
  167 |   await flight.evaluate((element) => element.getAnimations()[0].finish());
```