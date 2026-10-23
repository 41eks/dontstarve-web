import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera', 'player', 'view', 'playerStats'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('plants butterflies and saplings, picks the restored flower and saves its petals and removal', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.entities = {};
    save.world.map.generator.options.size = 96;
    delete save.world.map.tiles;
    save.players.local.transform.position = [0, 0, 0];
    save.players.local.stats = { health: 150, hunger: 150, sanity: 100 };
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  const prepare = () => page.evaluate(async paths => {
    const { inventory } = await import(paths.main), { scene, renderer } = await import(paths.universal);
    const { camera } = await import(paths.camera), { player } = await import(paths.player), { view } = await import(paths.view);
    const { playerStats } = await import(paths.playerStats);
    (window as any).plantGame = { inventory, scene, renderer, camera, player, view, playerStats };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const saveGame = async () => {
    const download = page.waitForEvent('download'); await submit('c_save()');
    return JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  };
  await page.goto('/tests/dst-lighting.html?save=initial-world.json'); await prepare();
  await submit('c_give("butterfly",2);c_give("dug_sapling",2)');
  for (const [itemId, prefab, x] of [['butterfly', 'flower', 3], ['dug_sapling', 'sapling', -3]] as const) {
    const slot = page.locator(`dst-inventory-bar .inventory-bar__items [data-item-id="${itemId}"]`).first();
    await expect(slot).toBeVisible(); await slot.click({ button: 'right' });
    await expect(page.locator('.slot-drag-preview')).toHaveAttribute('data-item-id', itemId);
    const point = await page.evaluate(x => {
      const { player, camera, renderer } = (window as any).plantGame;
      const ndc = player.position.clone().set(x, 0, -3).project(camera), bounds = renderer.domElement.getBoundingClientRect();
      return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2 };
    }, x);
    await page.mouse.move(point.x, point.y);
    await expect.poll(() => page.evaluate(() => (window as any).plantGame.view.mouseActions.getMouseActions().right?.action)).toBe('DEPLOY');
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await expect.poll(() => page.evaluate(prefab => (window as any).plantGame.scene.children.filter((model: any) => model.userData.prefab === prefab).length, prefab)).toBe(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.slot-drag-preview')).toHaveCount(0);
  }
  const saved = await saveGame();
  expect(saved.world.entities.flower).toHaveLength(1);
  expect(saved.world.entities.sapling[0].components.pickable).toMatchObject({ picked: true, transplanted: true });
  const flower = saved.world.entities.flower[0], sapling = saved.world.entities.sapling[0];
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload(); await prepare();
  const restored = await saveGame();
  expect(restored.world.entities.flower).toEqual([flower]);
  expect(restored.world.entities.sapling[0]).toMatchObject({ id: sapling.id, transform: sapling.transform });
  const slots = restored.players.local.inventory.containers['player:inventory'].slots;
  expect(slots.map((slot: any) => [slot.item.itemId, slot.item.count])).toEqual([['butterfly', 1], ['dug_sapling', 1]]);
  expect(slots[0].item.freshnessPercent).toBeGreaterThan(.9);
  const pickPoint = await page.evaluate(() => {
    const { scene, view, playerStats } = (window as any).plantGame;
    const flower = scene.children.find((model: any) => model.userData.prefab === 'flower');
    let mesh: any;
    flower.traverse((object: any) => { if (object.isMesh && !mesh) mesh = object; });
    mesh.updateWorldMatrix(true, false);
    const vertices = mesh.geometry.getAttribute('position'), center = flower.position.clone().set(0, 0, 0);
    const count = mesh.geometry.drawRange.count / 6 * 4;
    for (let i = 0; i < count; i++) center.add(mesh.localToWorld(flower.position.clone().fromBufferAttribute(vertices, i)));
    center.divideScalar(count).project(view.camera);
    const bounds = view.renderer.domElement.getBoundingClientRect();
    return { x: bounds.left + (center.x + 1) * bounds.width / 2, y: bounds.top + (1 - center.y) * bounds.height / 2,
      sanity: playerStats.sanity.peek() };
  });
  await page.mouse.move(pickPoint.x, pickPoint.y);
  await expect.poll(() => page.evaluate(() => (window as any).plantGame.view.mouseActions.getMouseActions().left?.action)).toBe('PICK');
  await page.mouse.click(pickPoint.x, pickPoint.y);
  await expect.poll(() => page.evaluate(() => (window as any).plantGame.inventory.count('petals'))).toBe(1);
  const picked = await saveGame();
  expect(picked.world.entities.flower).toEqual([]);
  const petals = picked.players.local.inventory.containers['player:inventory'].slots.find((slot: any) => slot.item.itemId === 'petals').item;
  expect(petals.freshnessPercent).toBeGreaterThan(.9);
  expect(picked.players.local.stats.sanity).toBe(pickPoint.sanity + 5);
  expect(picked.players.local.stats.health).toBe(restored.players.local.stats.health - (flower.components.flower.animation === 'rose' ? 1 : 0));
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: picked }));
  await page.reload(); await prepare();
  expect(await page.evaluate(() => (window as any).plantGame.scene.children.filter((model: any) => model.userData.prefab === 'flower').length)).toBe(0);
  expect(await page.evaluate(() => (window as any).plantGame.inventory.count('petals'))).toBe(1);
  expect(await page.evaluate(() => {
    const { inventory } = (window as any).plantGame;
    const slot = inventory.addresses().find((address: any) => inventory.get(address)?.itemId === 'petals');
    return inventory.get(slot).freshnessPercent;
  })).toBeGreaterThan(.9);
  expect(errors).toEqual([]);
});
