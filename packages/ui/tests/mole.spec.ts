import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('mole console commands, hammer capture and save export/reload preserve animal identity and inventory', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.entities = {}; save.world.elapsedSeconds = 0; save.players.local.transform.position = [0, 0, 0];
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  const urls = Object.fromEntries(['main', 'universal', 'view', 'building', 'player'].map(name =>
    [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  const prepare = () => page.evaluate(async urls => {
    const { inventory, gameReady } = await import(urls.main); await gameReady;
    const { scene } = await import(urls.universal), { view } = await import(urls.view);
    const { turfMap } = await import(urls.building), { player, playerBody } = await import(urls.player);
    for (let x = -4; x <= 4; x++) for (let y = -4; y <= 4; y++) turfMap.setTile(x, y, 4);
    playerBody.position.set(0, playerBody.shapes[0].radius, 0); playerBody.velocity.set(0, 0, 0); player.position.set(0, 0, 0);
    (window as any).moleGame = { inventory, scene, view, player };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const bar = page.locator('dst-inventory-bar .inventory-bar__items');
  await page.goto('/tests/dst-lighting.html?save=initial-world.json'); await prepare();
  await submit('c_spawn("mole");c_spawn("molehill");c_give("mole",2);c_give("hammer")');
  await expect(bar.locator('[data-item-id="mole"]')).toHaveCount(2);
  await expect(bar.locator('[data-item-id="mole"] .inventory-slot__icon[data-loaded="true"]').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).moleGame.scene.children.filter((model: any) => model.userData.mole).length)).toBeGreaterThan(0);
  const identity = await page.evaluate(() => {
    const { scene } = (window as any).moleGame;
    const model = scene.children.find((m: any) => m.userData.mole), mole = model.userData.mole;
    mole.brain.Stop(); mole.entity.transform.position.set(4, 0, 0); model.userData.instance.physics.Teleport(); mole.setAbove(); mole.sg.goToState('idle');
    (window as any).captureMole = mole.id;
    return mole.id;
  });
  await bar.locator('[data-item-id="hammer"]').dragTo(page.locator('dst-inventory-bar .inventory-bar__equipment .inventory-slot').first());
  await expect(page.locator('dst-inventory-bar .inventory-bar__equipment [data-item-id="hammer"]')).toBeVisible();
  await page.keyboard.down('Control'); await page.keyboard.down('KeyF');
  await expect.poll(() => page.evaluate(() => {
    const { scene } = (window as any).moleGame;
    return scene.children.find((m: any) => m.userData.instance?.entityId === (window as any).captureMole)?.userData.mole.sg.stateName;
  })).toBe('stunned');
  await page.keyboard.up('KeyF'); await page.keyboard.up('Control');
  const point = await page.evaluate(() => {
    const { scene, view } = (window as any).moleGame;
    const model = scene.children.find((m: any) => m.userData.instance?.entityId === (window as any).captureMole);
    scene.updateMatrixWorld(true);
    const mesh = model.getObjectsByProperty('isMesh', true).find((object: any) => object.geometry?.drawRange.count > 0), geometry = mesh.geometry;
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
  });
  await page.mouse.move(point.x, point.y);
  await expect.poll(() => page.evaluate(() => (window as any).moleGame.view.mouseActions.getMouseActions().left?.action)).toBe('PICKUP');
  await page.mouse.click(point.x, point.y);
  await expect(bar.locator('[data-item-id="mole"]')).toHaveCount(3);
  await submit('c_give("rocks",2)');
  const capturedSlot = await page.evaluate(id => (window as any).moleGame.inventory.exportState().slots.find((s: any) => s.item?.entityId === id).address.slotKey, identity);
  await bar.locator('[data-item-id="rocks"]').click();
  await bar.locator(`[data-slot-key="${capturedSlot}"]`).click();
  await expect.poll(() => page.evaluate(id => (window as any).moleGame.inventory.entities.get(id)?.snapshot().mole.health, identity)).toBe(23);
  const download = page.waitForEvent('download'); await submit('c_save()');
  const saved = JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  const moles = saved.players.local.inventory.containers['player:inventory'].slots.filter((s: any) => s.item.itemId === 'mole');
  expect(moles).toHaveLength(3);
  expect(moles.find((s: any) => s.item.entityId === identity).item.mole.health).toBe(23);
  expect(saved.world.entities.molehill).toHaveLength(1);
  const hillId = saved.world.entities.molehill[0].id;
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload(); await prepare();
  await expect(bar.locator('[data-item-id="mole"]')).toHaveCount(3);
  await expect.poll(() => page.evaluate(id => (window as any).moleGame.inventory.entities.get(id)?.snapshot().mole.health, identity)).toBe(23);
  await expect.poll(() => page.evaluate(id => (window as any).moleGame.scene.children.some((m: any) => m.userData.instance?.entityId === id && m.userData.instance?.prefab === 'molehill'), hillId)).toBe(true);
  expect(errors).toEqual([]);
});
