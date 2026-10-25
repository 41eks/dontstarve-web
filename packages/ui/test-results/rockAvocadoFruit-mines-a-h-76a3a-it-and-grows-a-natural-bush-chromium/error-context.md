# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: rockAvocadoFruit.spec.ts >> mines a hard stone fruit with a pickaxe, plants its sprout, saves it and grows a natural bush
- Location: tests/rockAvocadoFruit.spec.ts:5:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('dst-inventory-bar .inventory-bar__items').locator('[data-item-id="pickaxe"] .inventory-slot__icon[data-loaded="true"]')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('dst-inventory-bar .inventory-bar__items').locator('[data-item-id="pickaxe"] .inventory-slot__icon[data-loaded="true"]') with timeout 5000ms
  - waiting for locator('dst-inventory-bar .inventory-bar__items').locator('[data-item-id="pickaxe"] .inventory-slot__icon[data-loaded="true"]')

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
  5   | test('mines a hard stone fruit with a pickaxe, plants its sprout, saves it and grows a natural bush', async ({ page }) => {
  6   |   test.setTimeout(150_000);
  7   |   const errors: string[] = [];
  8   |   page.on('pageerror', error => errors.push(error.message));
  9   |   await page.route('**/saves/initial-world.json', async route => {
  10  |     const response = await route.fetch(), save = await response.json();
  11  |     save.world.entities = {}; save.world.elapsedSeconds = 0;
  12  |     save.players.local.transform.position = [0, 0, 0];
  13  |     for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
  14  |     save.players.local.inventory.bufferedBuilds = [];
  15  |     await route.fulfill({ response, json: save });
  16  |   });
  17  |   const urls = Object.fromEntries(['main', 'universal', 'view', 'building', 'player'].map(name =>
  18  |     [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  19  |   const prepare = () => expect(async () => page.evaluate(async urls => {
  20  |     const { inventory, gameReady } = await import(urls.main); await gameReady;
  21  |     const { scene } = await import(urls.universal), { view } = await import(urls.view);
  22  |     const { turfMap } = await import(urls.building), { player, playerBody } = await import(urls.player);
  23  |     // Both target tiles are valid soil, independently of the generator's initial terrain.
  24  |     for (let col = -2; col <= 0; col++) for (let row = -1; row <= 0; row++) turfMap.setTile(col, row, 4);
  25  |     playerBody.position.set(-3, playerBody.shapes[0].radius, 0); playerBody.velocity.set(0, 0, 0); player.position.set(-3, 0, 0);
  26  |     (window as any).rockFruitGame = { inventory, scene, view, player, playerBody };
  27  |   }, urls)).toPass({ timeout: 30000 });
  28  |   const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
  29  |     new CustomEvent('game:debug-command', { detail: { command } })), command);
  30  |   const screenPoint = (prefab: string) => page.evaluate(prefab => {
  31  |     const { scene, view } = (window as any).rockFruitGame;
  32  |     const model = scene.children.find((model: any) => model.userData.itemId === prefab || model.userData.instance?.prefab === prefab);
  33  |     if (!model) throw new Error('No rock_avocado_bush target');
  34  |     scene.updateMatrixWorld(true);
  35  |     const mesh = model.children[0].children[0], geometry = mesh.geometry;
  36  |     const positions = geometry.getAttribute('position'), indices = geometry.getIndex();
  37  |     let largest = -1, point = model.position.clone();
  38  |     for (let i = 0; i < geometry.drawRange.count; i += 3) {
  39  |       const a = model.position.clone().fromBufferAttribute(positions, indices.getX(i));
  40  |       const b = model.position.clone().fromBufferAttribute(positions, indices.getX(i + 1));
  41  |       const c = model.position.clone().fromBufferAttribute(positions, indices.getX(i + 2));
  42  |       const area = b.clone().sub(a).cross(c.clone().sub(a)).lengthSq();
  43  |       if (area > largest) { largest = area; point.copy(a).add(b).add(c).multiplyScalar(1 / 3); }
  44  |     }
  45  |     mesh.localToWorld(point).project(view.camera);
  46  |     const rect = view.renderer.domElement.getBoundingClientRect();
  47  |     return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  48  |   }, prefab);
  49  |   const count = (id: string) => page.evaluate(id => (window as any).rockFruitGame.inventory.count(id), id);
  50  |   const bar = page.locator('dst-inventory-bar .inventory-bar__items');
  51  | 
  52  |   await page.goto('/tests/dst-lighting.html'); await prepare();
  53  |   await submit('c_give("pickaxe");c_spawn("rock_avocado_fruit")');
  54  |   const hand = page.locator('dst-inventory-bar .inventory-bar__equipment .inventory-slot').first();
> 55  |   await expect(bar.locator('[data-item-id="pickaxe"] .inventory-slot__icon[data-loaded="true"]')).toBeVisible();
      |                                                                                                   ^ Error: expect(locator).toBeVisible() failed
  56  |   await bar.locator('[data-item-id="pickaxe"]').dragTo(hand);
  57  |   await expect.poll(() => page.evaluate(() => (window as any).rockFruitGame.scene.children.some((m: any) => m.userData.itemId === 'rock_avocado_fruit'))).toBe(true);
  58  |   const hard = await screenPoint('rock_avocado_fruit');
  59  |   await page.mouse.move(hard.x, hard.y);
  60  |   await expect.poll(() => page.evaluate(() => (window as any).rockFruitGame.view.mouseActions.getMouseActions().right?.action)).toBe('MINE');
  61  |   // Fix the loot roll for this input flow; probability boundaries belong to the domain test.
  62  |   await page.evaluate(() => { (window as any).originalFruitRandom = Math.random; Math.random = () => .655; });
  63  |   await page.mouse.click(hard.x, hard.y, { button: 'right' });
  64  |   await expect.poll(() => page.evaluate(() => (window as any).rockFruitGame.scene.children.some((m: any) => m.userData.itemId === 'rock_avocado_fruit_sprout'))).toBe(true);
  65  |   await page.evaluate(() => { Math.random = (window as any).originalFruitRandom; });
  66  |   // Wait for the actual source launch to settle before targeting the seed sprite.
  67  |   await expect.poll(() => page.evaluate(() => (window as any).rockFruitGame.player.userData.animationController.stategraph.stateName)).toBe('idle');
  68  |   const seed = await screenPoint('rock_avocado_fruit_sprout');
  69  |   await page.mouse.click(seed.x, seed.y);
  70  |   await expect(bar.locator('[data-item-id="rock_avocado_fruit_sprout"] .inventory-slot__icon[data-loaded="true"]')).toBeVisible();
  71  |   await bar.locator('[data-item-id="rock_avocado_fruit_sprout"]').click();
  72  |   const planting = await page.evaluate(() => {
  73  |     const { view, player } = (window as any).rockFruitGame;
  74  |     const point = player.position.clone().set(6, 0, 6).project(view.camera), rect = view.renderer.domElement.getBoundingClientRect();
  75  |     return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  76  |   });
  77  |   await page.mouse.move(planting.x, planting.y);
  78  |   await expect.poll(() => page.evaluate(() => (window as any).rockFruitGame.view.mouseActions.getMouseActions().right?.action)).toBe('DEPLOY');
  79  |   await page.mouse.click(planting.x, planting.y, { button: 'right' });
  80  |   await expect.poll(() => page.evaluate(() => (window as any).rockFruitGame.scene.children.some((m: any) => m.userData.instance?.prefab === 'rock_avocado_fruit_sprout_sapling'))).toBe(true);
  81  |   expect(await count('rock_avocado_fruit_sprout')).toBe(0);
  82  |   const download = page.waitForEvent('download'); await submit('c_save()');
  83  |   const saved = JSON.parse(await readSaveDownload((await (await download).path())!));
  84  |   const record = saved.world.entities.rock_avocado_fruit_sprout_sapling[0];
  85  |   expect(record.components.saplingTimer.timers.grow.timeleft).toBeGreaterThan(1400);
  86  |   expect(JSON.stringify(saved.players.local.inventory)).toContain('pickaxe');
  87  |   await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  88  |   await page.reload(); await prepare();
  89  |   await expect.poll(() => page.evaluate(id => {
  90  |     const model = (window as any).rockFruitGame.scene.children.find((m: any) => m.userData.instance?.entityId === id);
  91  |     return model && { position: model.position.toArray(), timer: model.userData.components.timer.snapshot('grow').peek().status };
  92  |   }, record.id)).toEqual({ position: record.transform.position, timer: 'scheduled' });
  93  |   // Restore a scene near the deadline to exercise the real growth animation without waiting 1500 seconds.
  94  |   record.components.saplingTimer.timers.grow.timeleft = .5;
  95  |   await page.reload(); await prepare();
  96  |   await expect.poll(() => page.evaluate(() => (window as any).rockFruitGame.scene.children.some((m: any) => m.userData.instance?.prefab === 'rock_avocado_bush')),
  97  |     { timeout: 15000 }).toBe(true);
  98  |   expect(await page.evaluate(() => {
  99  |     const bush = (window as any).rockFruitGame.scene.children.find((m: any) => m.userData.instance?.prefab === 'rock_avocado_bush');
  100 |     return { position: bush.position.toArray(), transplanted: bush.userData.components.pickable.exportState().transplanted ?? false };
  101 |   })).toEqual({ position: record.transform.position, transplanted: false });
  102 |   expect(errors).toEqual([]);
  103 | });
  104 | 
  105 | 
```