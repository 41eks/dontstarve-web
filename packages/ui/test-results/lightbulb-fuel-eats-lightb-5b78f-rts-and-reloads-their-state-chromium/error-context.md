# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: lightbulb-fuel.spec.ts >> eats lightbulbs and refuels inventory, equipped and ground lanterns, then exports and reloads their state
- Location: tests/lightbulb-fuel.spec.ts:8:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('dst-inventory-bar').locator('.inventory-bar__items').locator('[data-item-id="lightbulb"]').locator('.inventory-slot__freshness')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('dst-inventory-bar').locator('.inventory-bar__items').locator('[data-item-id="lightbulb"]').locator('.inventory-slot__freshness') with timeout 5000ms
  - waiting for locator('dst-inventory-bar').locator('.inventory-bar__items').locator('[data-item-id="lightbulb"]').locator('.inventory-slot__freshness')

```

```yaml
- status "帧率": FPS 7
```

# Test source

```ts
  1   | import { readSaveDownload } from './save-download';
  2   | import { fileURLToPath } from 'node:url';
  3   | import { expect, test } from '@playwright/test';
  4   | 
  5   | const urls = Object.fromEntries(['main', 'universal', 'camera', 'player', 'playerStats'].map(name =>
  6   |   [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  7   | 
  8   | test('eats lightbulbs and refuels inventory, equipped and ground lanterns, then exports and reloads their state', async ({ page }) => {
  9   |   test.setTimeout(150_000);
  10  |   const errors: string[] = [];
  11  |   page.on('pageerror', error => errors.push(error.message));
  12  |   page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  13  |   await page.route('**/saves/initial-world.json', async route => {
  14  |     const response = await route.fetch(), save = await response.json();
  15  |     save.world.entities = {}; save.world.elapsedSeconds = 0;
  16  |     save.players.local.transform.position = [0, 0, 0];
  17  |     save.players.local.stats = { health: 100, hunger: 105, sanity: 100 };
  18  |     for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
  19  |     save.players.local.inventory.bufferedBuilds = [];
  20  |     await route.fulfill({ response, json: save });
  21  |   });
  22  |   const prepare = () => page.evaluate(async urls => {
  23  |     const main = await import(urls.main), { scene, renderer } = await import(urls.universal);
  24  |     const { camera } = await import(urls.camera), { player, playerBody } = await import(urls.player);
  25  |     const { getPlayerStats } = await import(urls.playerStats);
  26  |     (window as any).bulbGame = { main, scene, renderer, camera, player, playerBody, getPlayerStats };
  27  |   }, urls);
  28  |   const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
  29  |     new CustomEvent('game:debug-command', { detail: { command } })), command);
  30  |   const saveGame = async () => {
  31  |     const download = page.waitForEvent('download'); await submit('c_save()');
  32  |     return JSON.parse(await readSaveDownload((await (await download).path())!));
  33  |   };
  34  |   const held = () => page.evaluate(() => (window as any).bulbGame.main.inventory.exportState().slots.filter((slot: any) => slot.item));
  35  |   const state = (slots: any[], id: string) => slots.find(slot => slot.item.itemId === id)?.item;
  36  |   const cursor = page.locator('.slot-drag-preview[data-cursor="true"]');
  37  |   const bar = page.locator('dst-inventory-bar'), bag = bar.locator('.inventory-bar__items');
  38  |   const bulb = bag.locator('[data-item-id="lightbulb"]');
  39  |   const lantern = bag.locator('[data-item-id="lantern"]');
  40  |   await page.goto('/tests/dst-lighting.html'); await prepare();
  41  |   await submit('c_give("lightbulb", 4); c_give("lantern"); c_spawn("lightbulb"); c_spawn("lantern")');
> 42  |   await expect(bulb.locator('.inventory-slot__freshness')).toBeVisible();
      |                                                            ^ Error: expect(locator).toBeVisible() failed
  43  |   await bulb.click({ button: 'right' });
  44  |   await expect.poll(async () => state(await held(), 'lightbulb')?.count).toBe(3);
  45  |   expect(await page.evaluate(() => (window as any).bulbGame.getPlayerStats())).toEqual({ health: 101, hunger: 105, sanity: 100 });
  46  |   const lanternId = state(await held(), 'lantern').entityId;
  47  |   await page.evaluate(() => {
  48  |     const inventory = (window as any).bulbGame.main.inventory;
  49  |     for (const { address, item } of inventory.exportState().slots) {
  50  |       if (item?.itemId === 'lantern') inventory.setRemainingFuel(address, 0);
  51  |       if (item?.itemId === 'lightbulb') inventory.getEntity(address).components.perishable.SetPercent(.625);
  52  |     }
  53  |   });
  54  |   await bulb.click(); await expect(cursor).toHaveAttribute('data-item-id', 'lightbulb');
  55  |   await lantern.click();
  56  |   await expect.poll(async () => state(await held(), 'lantern')?.remainingFuel).toBe(90);
  57  |   expect(state(await held(), 'lantern').entityId).toBe(lanternId);
  58  |   await expect(cursor).toHaveAttribute('data-item-id', 'lightbulb');
  59  |   const cursorCount = () => page.evaluate(() => (window as any).bulbGame.main.inventory.exportState().slots
  60  |     .find((slot: any) => slot.address.containerId === 'player:cursor')?.item?.count);
  61  |   expect(await cursorCount()).toBe(2);
  62  | 
  63  |   // Refilled empty ground lanterns remain switched off, matching ontakefuel's equipped-only branch.
  64  |   const groundId = await page.evaluate(() => {
  65  |     const { scene, camera, renderer, player, playerBody } = (window as any).bulbGame;
  66  |     const model = scene.children.find((model: any) => model.userData.itemId === 'lantern');
  67  |     const entity = model.userData.pickupTarget.entity;
  68  |     entity.setRemainingFuel(0); entity.getComponent('lantern').TurnOff();
  69  |     for (const other of scene.children) if (other.userData.itemId === 'lightbulb') {
  70  |       other.userData.pickupTarget.entity.transform.position.x += 30;
  71  |       other.position.x += 30;
  72  |     }
  73  |     playerBody.position.set(model.position.x + 3, playerBody.shapes[0].radius, model.position.z + 3);
  74  |     player.position.set(model.position.x + 3, 0, model.position.z + 3);
  75  |     return model.userData.instance?.entityId as string;
  76  |   });
  77  |   // The light signal changes immediately; wait for the off pose and camera to render before raycasting it.
  78  |   await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  79  |   const point = await page.evaluate(id => {
  80  |     const { scene, camera, renderer } = (window as any).bulbGame;
  81  |     const model = scene.children.find((model: any) => model.userData.instance?.entityId === id);
  82  |     scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  83  |     const mesh = model.children[0].children[0]; mesh.geometry.computeBoundingBox();
  84  |     const center = mesh.geometry.boundingBox.getCenter(model.position.clone()); mesh.localToWorld(center).project(camera);
  85  |     const rect = renderer.domElement.getBoundingClientRect();
  86  |     return { id: model.userData.instance?.entityId, x: rect.left + (center.x + 1) * rect.width / 2, y: rect.top + (1 - center.y) * rect.height / 2 };
  87  |   }, groundId);
  88  |   await page.mouse.click(point.x, point.y);
  89  |   await expect.poll(cursorCount).toBe(1);
  90  |   await bag.locator('[data-slot-key="2"]').click();
  91  |   await lantern.dragTo(bar.locator('[data-slot-key="hand"]'));
  92  |   await expect(bar.locator('[data-slot-key="hand"]')).toHaveAttribute('data-item-id', 'lantern');
  93  |   await page.evaluate(() => {
  94  |     const inventory = (window as any).bulbGame.main.inventory, entity = inventory.GetEquippedItem('hand');
  95  |     entity.setRemainingFuel(0); entity.getComponent('lantern').TurnOff();
  96  |   });
  97  |   await bulb.click(); await bar.locator('[data-slot-key="hand"]').click();
  98  |   await expect.poll(() => page.evaluate(() => (window as any).bulbGame.main.inventory.GetEquippedItem('hand').getComponent('lantern').isOn)).toBe(true);
  99  |   const saved = await saveGame();
  100 |   const groundLantern = saved.world.entities.ground_item.find((record: any) => record.id === point.id);
  101 |   expect(groundLantern.components).toMatchObject({ stack: { remainingFuel: 90 }, lantern: { ison: false } });
  102 |   const groundBulb = saved.world.entities.ground_item.find((record: any) => record.components.stack.itemId === 'lightbulb');
  103 |   expect(groundBulb.components.stack.freshnessPercent).toBeLessThan(1);
  104 |   expect(groundBulb.components.stack.freshnessPercent).toBeGreaterThan(.95);
  105 |   expect(saved.players.local.inventory.containers['player:equipment'].slots.find((slot: any) => slot.item.entityId === lanternId)
  106 |     .item.remainingFuel).toBeGreaterThan(85);
  107 |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  108 |   await page.reload(); await prepare();
  109 |   const restored = await saveGame();
  110 |   expect(restored.world.entities.ground_item.find((record: any) => record.id === point.id)).toEqual(groundLantern);
  111 |   const restoredBulb = restored.world.entities.ground_item.find((record: any) => record.id === groundBulb.id);
  112 |   expect(restoredBulb.transform).toEqual(groundBulb.transform);
  113 |   expect(restoredBulb.components.stack.count).toBe(1);
  114 |   expect(restoredBulb.components.stack.freshnessPercent).toBeLessThanOrEqual(groundBulb.components.stack.freshnessPercent);
  115 |   expect(restored.players.local.stats).toEqual(saved.players.local.stats);
  116 |   expect(state(await held(), 'lantern').entityId).toBe(lanternId);
  117 |   expect(errors).toEqual([]);
  118 | });
  119 | 
```