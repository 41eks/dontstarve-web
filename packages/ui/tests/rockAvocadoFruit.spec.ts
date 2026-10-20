import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('mines a hard stone fruit with a pickaxe, plants its sprout, saves it and grows a natural bush', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.entities = {}; save.world.elapsedSeconds = 0;
    save.players.local.transform.position = [0, 0, 0];
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  const urls = Object.fromEntries(['main', 'universal', 'view', 'building', 'player'].map(name =>
    [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  const prepare = () => expect(async () => page.evaluate(async urls => {
    const { inventory, gameReady } = await import(urls.main); await gameReady;
    const { scene } = await import(urls.universal), { view } = await import(urls.view);
    const { turfMap } = await import(urls.building), { player, playerBody } = await import(urls.player);
    // Both target tiles are valid soil, independently of the generator's initial terrain.
    for (let col = -2; col <= 0; col++) for (let row = -1; row <= 0; row++) turfMap.setTile(col, row, 4);
    playerBody.position.set(-3, playerBody.shapes[0].radius, 0); playerBody.velocity.set(0, 0, 0); player.position.set(-3, 0, 0);
    (window as any).rockFruitGame = { inventory, scene, view, player, playerBody };
  }, urls)).toPass({ timeout: 30000 });
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const screenPoint = (prefab: string) => page.evaluate(prefab => {
    const { scene, view } = (window as any).rockFruitGame;
    const model = scene.children.find((model: any) => model.userData.itemId === prefab || model.userData.prefab === prefab);
    if (!model) throw new Error('No rock_avocado_bush target');
    scene.updateMatrixWorld(true);
    const mesh = model.children[0].children[0], geometry = mesh.geometry;
    const positions = geometry.getAttribute('position'), indices = geometry.getIndex();
    let largest = -1, point = model.position.clone();
    for (let i = 0; i < geometry.drawRange.count; i += 3) {
      const a = model.position.clone().fromBufferAttribute(positions, indices.getX(i));
      const b = model.position.clone().fromBufferAttribute(positions, indices.getX(i + 1));
      const c = model.position.clone().fromBufferAttribute(positions, indices.getX(i + 2));
      const area = b.clone().sub(a).cross(c.clone().sub(a)).lengthSq();
      if (area > largest) { largest = area; point.copy(a).add(b).add(c).multiplyScalar(1 / 3); }
    }
    mesh.localToWorld(point).project(view.camera);
    const rect = view.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  }, prefab);
  const count = (id: string) => page.evaluate(id => (window as any).rockFruitGame.inventory.count(id), id);
  const bar = page.locator('dst-inventory-bar .inventory-bar__items');

  await page.goto('/tests/dst-lighting.html'); await prepare();
  await submit('c_give("pickaxe");c_spawn("rock_avocado_fruit")');
  const hand = page.locator('dst-inventory-bar .inventory-bar__equipment .inventory-slot').first();
  await expect(bar.locator('[data-item-id="pickaxe"] .inventory-slot__icon[data-loaded="true"]')).toBeVisible();
  await bar.locator('[data-item-id="pickaxe"]').dragTo(hand);
  await expect.poll(() => page.evaluate(() => (window as any).rockFruitGame.scene.children.some((m: any) => m.userData.itemId === 'rock_avocado_fruit'))).toBe(true);
  const hard = await screenPoint('rock_avocado_fruit');
  await page.mouse.move(hard.x, hard.y);
  await expect.poll(() => page.evaluate(() => (window as any).rockFruitGame.view.mouseActions.getMouseActions().right?.action)).toBe('MINE');
  // Fix the loot roll for this input flow; probability boundaries belong to the domain test.
  await page.evaluate(() => { (window as any).originalFruitRandom = Math.random; Math.random = () => .655; });
  await page.mouse.click(hard.x, hard.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).rockFruitGame.scene.children.some((m: any) => m.userData.itemId === 'rock_avocado_fruit_sprout'))).toBe(true);
  await page.evaluate(() => { Math.random = (window as any).originalFruitRandom; });
  // Wait for the actual source launch to settle before targeting the seed sprite.
  await expect.poll(() => page.evaluate(() => (window as any).rockFruitGame.player.userData.animationController.stategraph.stateName)).toBe('idle');
  const seed = await screenPoint('rock_avocado_fruit_sprout');
  await page.mouse.click(seed.x, seed.y);
  await expect(bar.locator('[data-item-id="rock_avocado_fruit_sprout"] .inventory-slot__icon[data-loaded="true"]')).toBeVisible();
  await bar.locator('[data-item-id="rock_avocado_fruit_sprout"]').click();
  const planting = await page.evaluate(() => {
    const { view, player } = (window as any).rockFruitGame;
    const point = player.position.clone().set(6, 0, 6).project(view.camera), rect = view.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  });
  await page.mouse.move(planting.x, planting.y);
  await expect.poll(() => page.evaluate(() => (window as any).rockFruitGame.view.mouseActions.getMouseActions().right?.action)).toBe('DEPLOY');
  await page.mouse.click(planting.x, planting.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).rockFruitGame.scene.children.some((m: any) => m.userData.prefab === 'rock_avocado_fruit_sprout_sapling'))).toBe(true);
  expect(await count('rock_avocado_fruit_sprout')).toBe(0);
  const download = page.waitForEvent('download'); await submit('c_save()');
  const saved = JSON.parse(await readSaveDownload((await (await download).path())!));
  const record = saved.world.entities.rock_avocado_fruit_sprout_sapling[0];
  expect(record.components.saplingTimer.timers.grow.timeleft).toBeGreaterThan(1400);
  expect(JSON.stringify(saved.players.local.inventory)).toContain('pickaxe');
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload(); await prepare();
  await expect.poll(() => page.evaluate(id => {
    const model = (window as any).rockFruitGame.scene.children.find((m: any) => m.userData.entityId === id);
    return model && { position: model.position.toArray(), timer: model.userData.components.timer.snapshot('grow').peek().status };
  }, record.id)).toEqual({ position: record.transform.position, timer: 'scheduled' });
  // Restore a scene near the deadline to exercise the real growth animation without waiting 1500 seconds.
  record.components.saplingTimer.timers.grow.timeleft = .5;
  await page.reload(); await prepare();
  await expect.poll(() => page.evaluate(() => (window as any).rockFruitGame.scene.children.some((m: any) => m.userData.prefab === 'rock_avocado_bush')),
    { timeout: 15000 }).toBe(true);
  expect(await page.evaluate(() => {
    const bush = (window as any).rockFruitGame.scene.children.find((m: any) => m.userData.prefab === 'rock_avocado_bush');
    return { position: bush.position.toArray(), transplanted: bush.userData.components.pickable.exportState().transplanted ?? false };
  })).toEqual({ position: record.transform.position, transplanted: false });
  expect(errors).toEqual([]);
});

