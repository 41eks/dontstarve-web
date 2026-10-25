# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pitchfork.spec.ts >> source ground atlases blend edges in WebGL and leave terrain centres and neighbouring cells intact
- Location: tests/pitchfork.spec.ts:6:1

# Error details

```
Error: expect(received).toMatchObject(expected)

- Expected  - 1
+ Received  + 1

  Object {
    "centerUnchanged": true,
    "edgeChanged": true,
-   "outsideUnchanged": true,
+   "outsideUnchanged": false,
  }
```

# Test source

```ts
  1   | import { fileURLToPath } from 'node:url';
  2   | import { expect, test } from '@playwright/test';
  3   | 
  4   | const moduleUrl = (path: string) => `/@fs${fileURLToPath(new URL(path, import.meta.url))}`;
  5   | 
  6   | test('source ground atlases blend edges in WebGL and leave terrain centres and neighbouring cells intact', async ({ page }, testInfo) => {
  7   |   const errors: string[] = [];
  8   |   page.on('pageerror', (error) => errors.push(error.message));
  9   |   page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  10  |   await page.goto('/tests/dst-lighting.html');
  11  |   const result = await page.evaluate(async (url) => (await import(url)).checkTurfBlending(), moduleUrl('./turf-blending-fixture.ts'));
> 12  |   expect(result).toMatchObject({ centerUnchanged: true, edgeChanged: true, outsideUnchanged: true });
      |                  ^ Error: expect(received).toMatchObject(expected)
  13  |   expect(result.changedPixels).toBeGreaterThan(100);
  14  |   expect(result.brick).toMatchObject({ centerUnchanged: true, outsideChangedPixels: 0, reloadPreservesPixels: true });
  15  |   expect(result.brick.inwardChangedPixels).toBeGreaterThan(100);
  16  |   expect(errors).toEqual([]);
  17  |   const screenshotPath = testInfo.outputPath('terrain-boundaries.png');
  18  |   await page.screenshot({ path: screenshotPath });
  19  |   await testInfo.attach('terrain-boundaries', { path: screenshotPath, contentType: 'image/png' });
  20  | });
  21  | 
  22  | test('pitchfork digs terrain, cursor-held turf deploys on dirt and saves and reloads both terrain and the remaining stack', async ({ page }) => {
  23  |   test.setTimeout(120_000);
  24  |   const errors: string[] = [];
  25  |   page.on('pageerror', (error) => errors.push(error.message));
  26  |   await page.route('**/saves/initial-world.json', async route => {
  27  |     const response = await route.fetch(), save = await response.json();
  28  |     for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
  29  |     await route.fulfill({ response, json: save });
  30  |   });
  31  |   await page.goto('/tests/dst-lighting.html');
  32  |   const urls = { ...Object.fromEntries(['main', 'player', 'view', 'building'].map((name) => [name, moduleUrl(`../../../src/${name}.ts`)])),
  33  |     inventory: moduleUrl('../../ui/src/index.ts') };
  34  |   await page.evaluate(async (urls) => {
  35  |     const main = await import(urls.main);
  36  |     await main.gameReady;
  37  |     const { player, playerBody } = await import(urls.player);
  38  |     const { view } = await import(urls.view);
  39  |     const { turfMap } = await import(urls.building);
  40  |     const { equipmentSlotAddress } = await import(urls.inventory);
  41  |     // A local initial save can already have a tool in hand; start with an empty slot.
  42  |     const handAddress = equipmentSlotAddress('hand');
  43  |     const held = main.inventory.get(handAddress);
  44  |     if (held) main.inventory.applySlotChanges([{ slot: handAddress, itemId: held.itemId,
  45  |       skinId: held.skinId, delta: -held.count }]);
  46  |     playerBody.position.set(-138, playerBody.shapes[0].radius, -135);
  47  |     playerBody.velocity.set(0, 0, 0);
  48  |     player.position.set(-138, 0, -135);
  49  |     if (!main.inventory.add('pitchfork', 1)) throw new Error('No room for pitchfork');
  50  |     (window as any).pitchforkGame = { ...main, player, view, turfMap };
  51  |   }, urls);
  52  |   const bar = page.locator('dst-inventory-bar');
  53  |   const slot = bar.locator('.inventory-bar__items .inventory-slot[data-item-id="pitchfork"]').first();
  54  |   await expect(slot).toBeVisible();
  55  |   await expect(slot.locator('.inventory-slot__icon[data-loaded="true"]')).toBeVisible();
  56  |   const hand = bar.locator('.inventory-bar__equipment .inventory-slot').first();
  57  |   await slot.dragTo(hand);
  58  |   await expect(hand).toHaveAttribute('data-item-id', 'pitchfork');
  59  |   await expect.poll(() => page.evaluate(() => {
  60  |     const { player } = (window as any).pitchforkGame;
  61  |     return player.getObjectByProperty('isMesh', true).material.some((material: any) => material.name === 'ground:swap_pitchfork');
  62  |   })).toBe(true);
  63  |   const point = async (x: number, z: number) => page.evaluate(async ({ x, z }) => {
  64  |     await new Promise(requestAnimationFrame);
  65  |     const { view, player } = (window as any).pitchforkGame;
  66  |     const ndc = player.position.clone().set(x, 0, z).project(view.camera);
  67  |     const bounds = view.renderer.domElement.getBoundingClientRect();
  68  |     return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2 };
  69  |   }, { x, z });
  70  |   const first = await point(-138, -138);
  71  |   await page.mouse.click(first.x, first.y, { button: 'right' });
  72  |   await expect.poll(() => page.evaluate(() => (window as any).pitchforkGame.turfMap.getTileAtWorld({ x: -138, z: -138 }))).toBe(4);
  73  |   await expect.poll(() => page.evaluate(() => (window as any).pitchforkGame.player.userData.animationController.isDigging)).toBe(false);
  74  |   const cancelled = await point(-126, -138);
  75  |   await page.mouse.click(cancelled.x, cancelled.y, { button: 'right' });
  76  |   await page.keyboard.press('Escape');
  77  |   await page.waitForTimeout(1100);
  78  |   expect(await page.evaluate(() => (window as any).pitchforkGame.turfMap.getTileAtWorld({ x: -126, z: -138 }))).toBe(30);
  79  |   await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', {
  80  |     detail: { command: 'c_give("turf_cotl_brick", 3)' },
  81  |   })));
  82  |   const turfSlot = bar.locator('.inventory-bar__items .inventory-slot[data-item-id="turf_cotl_brick"]').first();
  83  |   await expect(turfSlot).toBeVisible();
  84  |   await turfSlot.click();
  85  |   const cursor = page.locator('.slot-drag-preview');
  86  |   await expect(cursor).toHaveAttribute('data-item-id', 'turf_cotl_brick');
  87  |   await expect(cursor.locator('.slot-drag-preview__count')).toHaveText('3');
  88  |   // Covered terrain refuses deployment and leaves the held stack intact.
  89  |   await page.mouse.click(cancelled.x, cancelled.y, { button: 'right' });
  90  |   await expect(cursor.locator('.slot-drag-preview__count')).toHaveText('3');
  91  |   const empty = await point(-138, -138);
  92  |   await page.mouse.click(empty.x, empty.y, { button: 'right' });
  93  |   await expect.poll(() => page.evaluate(() => (window as any).pitchforkGame.turfMap.getTileAtWorld({ x: -138, z: -138 }))).toBe(256);
  94  |   await expect(cursor.locator('.slot-drag-preview__count')).toHaveText('2');
  95  |   const downloadPromise = page.waitForEvent('download');
  96  |   await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', {
  97  |     detail: { command: 'c_save()' },
  98  |   })));
  99  |   const download = await downloadPromise;
  100 |   const stream = await download.createReadStream();
  101 |   const chunks: Buffer[] = [];
  102 |   for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  103 |   const save = JSON.parse(Buffer.concat(chunks).toString());
  104 |   expect(save.world.map.tiles).toContainEqual({ col: -12, row: -12, tileId: 256 });
  105 |   expect(save.world.map.tiles).not.toContainEqual({ col: -11, row: -12, tileId: 4 });
  106 |   const held = save.players.local.inventory.containers['player:cursor'].slots[0].item;
  107 |   expect(held).toMatchObject({ itemId: 'turf_cotl_brick', count: 2 });
  108 |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: save }));
  109 |   await page.reload();
  110 |   const restored = await page.evaluate(async urls => {
  111 |     const main = await import(urls.main);
  112 |     await main.gameReady;
```