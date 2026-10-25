# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: bananajuice.spec.ts >> eating and drinking update the HUD and preserve food and spawned items through save/reload
- Location: tests/bananajuice.spec.ts:8:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  locator('dst-status-hud .survival-meter--sanity output')
Expected: "35"
Received: "199"
Timeout:  5000ms

Call log:
  - Expect "toHaveText" locator('dst-status-hud .survival-meter--sanity output') with timeout 5000ms
  - waiting for locator('dst-status-hud .survival-meter--sanity output')
    12 × locator resolved to <output class="survival-meter__value">199</output>
       - unexpected value "199"

```

```yaml
- status: "199"
```

# Test source

```ts
  1   | import { readSaveDownload } from './save-download';
  2   | import { fileURLToPath } from 'node:url';
  3   | import { expect, test } from '@playwright/test';
  4   | 
  5   | const modules = Object.fromEntries(['main', 'player', 'universal', 'playerStats'].map(name =>
  6   |   [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  7   | 
  8   | test('eating and drinking update the HUD and preserve food and spawned items through save/reload', async ({ page }) => {
  9   |   test.setTimeout(150_000);
  10  |   const errors: string[] = [];
  11  |   page.on('pageerror', error => errors.push(error.message));
  12  |   page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  13  |   await page.route('**/saves/initial-world.json', async route => {
  14  |     const response = await route.fetch(), save = await response.json();
  15  |     save.players.local.stats = { health: 140, hunger: 90, sanity: 35 };
  16  |     await route.fulfill({ response, json: save });
  17  |   });
  18  |   const prepare = () => page.evaluate(async paths => {
  19  |     const main = await import(paths.main), { player } = await import(paths.player);
  20  |     const { scene, dstLighting } = await import(paths.universal);
  21  |     const stats = await import(paths.playerStats);
  22  |     (window as any).juiceGame = { main, player, scene, dstLighting, stats };
  23  |   }, modules);
  24  |   await page.goto('/tests/dst-lighting.html'); await prepare();
  25  |   await page.evaluate(() => {
  26  |     const { main, scene } = (window as any).juiceGame;
  27  |     main.inventory.applySlotChanges(main.inventory.exportState().slots.filter((slot: any) => slot.item)
  28  |       .map((slot: any) => ({ slot: slot.address, ...slot.item, delta: -slot.item.count })));
  29  |     (window as any).existingJuiceIds = scene.children.filter((model: any) => model.userData.itemId === 'bananajuice')
  30  |       .map((model: any) => model.userData.instance?.entityId);
  31  |     (window as any).existingFoodIds = scene.children.map((model: any) => model.userData.instance?.entityId);
  32  |   });
  33  |   const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
  34  |     new CustomEvent('game:debug-command', { detail: { command } })), command);
  35  |   await submit('c_give("bananajuice", 2)');
  36  |   await submit('c_spawn("bananajuice")');
  37  |   await expect.poll(() => page.evaluate(() => (window as any).juiceGame.scene.children.some((model: any) =>
  38  |     model.userData.itemId === 'bananajuice' && !(window as any).existingJuiceIds.includes(model.userData.instance?.entityId)))).toBe(true);
  39  |   const spawnedId = await page.evaluate(() => (window as any).juiceGame.scene.children.find((model: any) =>
  40  |     model.userData.itemId === 'bananajuice' && !(window as any).existingJuiceIds.includes(model.userData.instance?.entityId)).userData.instance?.entityId);
  41  |   const bar = page.locator('dst-inventory-bar .inventory-bar__items');
  42  |   const juice = bar.locator('[data-item-id="bananajuice"]');
  43  |   const sanity = page.locator('dst-status-hud .survival-meter--sanity output');
  44  |   const count = () => page.evaluate(() => (window as any).juiceGame.main.inventory.materialSummary().bananajuice ?? 0);
  45  |   await expect(juice).toBeVisible();
  46  |   await juice.click({ button: 'right' }); await page.keyboard.press('Escape');
  47  |   await expect.poll(() => page.evaluate(() => (window as any).juiceGame.player.userData.animationController.stategraph.hasStateTag('eating'))).toBe(false);
  48  |   expect(await count()).toBe(2);
> 49  |   await expect(sanity).toHaveText('35');
      |                        ^ Error: expect(locator).toHaveText(expected) failed
  50  |   await juice.click({ button: 'right' });
  51  |   await expect.poll(count).toBe(1);
  52  |   await expect(sanity).toHaveText('68');
  53  |   expect(await page.evaluate(() => {
  54  |     const { stats, dstLighting } = (window as any).juiceGame;
  55  |     return { stats: stats.getPlayerStats(), percent: dstLighting.getSanityPercent() };
  56  |   })).toEqual({ stats: { health: 148, hunger: 115, sanity: 68 }, percent: 0.34 });
  57  | 
  58  |   for (const itemId of ['meatballs', 'green_cap_cooked']) {
  59  |     await submit(`c_give("${itemId}", 2)`);
  60  |     await expect.poll(() => page.evaluate(() => (window as any).juiceGame.player.userData.animationController.stategraph.hasStateTag('eating'))).toBe(false);
  61  |     const item = bar.locator(`[data-item-id="${itemId}"]`);
  62  |     await expect(item).toBeVisible();
  63  |     await item.click({ button: 'right' });
  64  |     await expect.poll(() => page.evaluate(id => (window as any).juiceGame.main.inventory.materialSummary()[id], itemId)).toBe(1);
  65  |   }
  66  |   await expect(page.locator('dst-status-hud .survival-meter--health output')).toHaveText('149');
  67  |   await expect(page.locator('dst-status-hud .survival-meter--hunger output')).toHaveText('150');
  68  |   await expect(sanity).toHaveText('88');
  69  |   const spawnedFood: { itemId: string; id: string }[] = [];
  70  |   for (const itemId of ['meatballs', 'blue_cap']) {
  71  |     await submit(`c_spawn("${itemId}")`);
  72  |     await expect.poll(() => page.evaluate(id => (window as any).juiceGame.scene.children.some((model: any) =>
  73  |       model.userData.itemId === id && !(window as any).existingFoodIds.includes(model.userData.instance?.entityId)), itemId)).toBe(true);
  74  |     const id = await page.evaluate(id => (window as any).juiceGame.scene.children.find((model: any) =>
  75  |       model.userData.itemId === id && !(window as any).existingFoodIds.includes(model.userData.instance?.entityId)).userData.instance?.entityId, itemId);
  76  |     spawnedFood.push({ itemId, id });
  77  |   }
  78  | 
  79  |   const download = page.waitForEvent('download'); await submit('c_save()');
  80  |   const save = JSON.parse(await readSaveDownload((await (await download).path())!));
  81  |   const savedJuice = save.players.local.inventory.containers['player:inventory'].slots.find((slot: any) => slot.item.itemId === 'bananajuice').item;
  82  |   expect(savedJuice.count).toBe(1);
  83  |   expect(save.players.local.stats).toEqual({ health: 149, hunger: 150, sanity: 88 });
  84  |   const ground = save.world.entities.ground_item.find((entity: any) => entity.id === spawnedId);
  85  |   expect(ground.components.stack).toMatchObject({ itemId: 'bananajuice', count: 1 });
  86  |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: save }));
  87  |   await page.reload(); await prepare();
  88  |   await expect(sanity).toHaveText('88');
  89  |   expect(await count()).toBe(1);
  90  |   expect(await page.evaluate(() => {
  91  |     const { main } = (window as any).juiceGame;
  92  |     return main.inventory.exportState().slots.find((slot: any) => slot.item?.itemId === 'bananajuice').item.entityId;
  93  |   })).toBe(savedJuice.entityId);
  94  |   expect(await page.evaluate(id => {
  95  |     const { main, scene } = (window as any).juiceGame;
  96  |     const model = scene.children.find((model: any) => model.userData.instance?.entityId === id);
  97  |     const entity = main.inventory.entities.get(id);
  98  |     return { id: entity.id, itemId: entity.prefab, count: entity.components.stackable.count,
  99  |       skinId: entity.skinId ?? null, position: model.position.toArray() };
  100 |   }, spawnedId)).toEqual({ id: spawnedId, itemId: 'bananajuice', count: 1,
  101 |     skinId: null, position: ground.transform.position });
  102 |   for (const itemId of ['meatballs', 'green_cap_cooked']) {
  103 |     const savedItem = save.players.local.inventory.containers['player:inventory'].slots
  104 |       .find((slot: any) => slot.item.itemId === itemId).item;
  105 |     expect(savedItem.count).toBe(1);
  106 |     expect(await page.evaluate(id => (window as any).juiceGame.main.inventory.exportState().slots
  107 |       .find((slot: any) => slot.item?.itemId === id).item, itemId)).toEqual(savedItem);
  108 |   }
  109 |   for (const { itemId, id } of spawnedFood) {
  110 |     const savedGround = save.world.entities.ground_item.find((entity: any) => entity.id === id);
  111 |     expect(savedGround.components.stack).toMatchObject({ itemId, count: 1 });
  112 |     expect(await page.evaluate(id => {
  113 |       const { main, scene } = (window as any).juiceGame;
  114 |       const model = scene.children.find((model: any) => model.userData.instance?.entityId === id);
  115 |       const entity = main.inventory.entities.get(id);
  116 |       return { id: entity.id, itemId: entity.prefab, count: entity.components.stackable.count,
  117 |         skinId: entity.skinId ?? null, position: model.position.toArray() };
  118 |     }, id)).toEqual({ id, itemId, count: 1, skinId: null, position: savedGround.transform.position });
  119 |   }
  120 |   await page.evaluate(() => (window as any).juiceGame.stats.playerStats.sanity.set(190));
  121 |   await juice.click({ button: 'right' });
  122 |   await expect.poll(count).toBe(0);
  123 |   await expect(sanity).toHaveText('200');
  124 |   expect(errors).toEqual([]);
  125 | });
  126 | 
```