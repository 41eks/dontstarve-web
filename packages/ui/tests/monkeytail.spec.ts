import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('picks monkeytail, plants a cursor-held root and fertilizes it through real input, then reloads the save', async ({ page }) => {
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
  const prepare = () => page.evaluate(async urls => {
    const { inventory, gameReady } = await import(urls.main); await gameReady;
    const { scene } = await import(urls.universal), { view } = await import(urls.view);
    const { turfMap } = await import(urls.building), { player, playerBody } = await import(urls.player);
    // Both target tiles are valid soil, independently of the generator's initial terrain.
    turfMap.setTile(0, 0, 4);
    playerBody.position.set(0, playerBody.shapes[0].radius, 0); playerBody.velocity.set(0, 0, 0); player.position.set(0, 0, 0);
    (window as any).monkeytailGame = { inventory, scene, view, player, playerBody };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const screenPoint = (planted: boolean) => page.evaluate(planted => {
    const { scene, view } = (window as any).monkeytailGame;
    const model = scene.children.find((model: any) => model.userData.prefab === 'monkeytail'
      && !!model.userData.components.pickable.exportState().transplanted === planted);
    if (!model) throw new Error('No monkeytail target');
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
  }, planted);
  const count = (id: string) => page.evaluate(id => (window as any).monkeytailGame.inventory.count(id), id);
  const bar = page.locator('dst-inventory-bar .inventory-bar__items');

  await page.goto('/tests/dst-lighting.html'); await prepare();
  await submit('c_spawn("monkeytail");c_give("dug_monkeytail",2);c_give("poop",2)');
  await expect(bar.locator('[data-item-id="dug_monkeytail"] .inventory-slot__icon[data-loaded="true"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).monkeytailGame.scene.children.filter((model: any) => model.userData.prefab === 'monkeytail').length)).toBe(1);
  const wild = await screenPoint(false);
  await page.mouse.move(wild.x, wild.y);
  await expect.poll(() => page.evaluate(() => (window as any).monkeytailGame.view.mouseActions.getMouseActions().left?.action)).toBe('PICK');
  await page.mouse.click(wild.x, wild.y);
  await expect.poll(() => count('cutreeds')).toBe(1);

  await bar.locator('[data-item-id="dug_monkeytail"]').click();
  const plantingPoint = await page.evaluate(() => {
    const { player, view } = (window as any).monkeytailGame;
    const point = player.position.clone().set(6, 0, 6).project(view.camera), rect = view.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  });
  await page.mouse.move(plantingPoint.x, plantingPoint.y);
  await expect.poll(() => page.evaluate(() => (window as any).monkeytailGame.view.mouseActions.getMouseActions().right?.action)).toBe('DEPLOY');
  await page.mouse.click(plantingPoint.x, plantingPoint.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).monkeytailGame.scene.children.filter((model: any) => model.userData.prefab === 'monkeytail').length)).toBe(2);
  await expect.poll(() => count('dug_monkeytail')).toBe(1);
  const root = await page.evaluate(() => {
    const model = (window as any).monkeytailGame.scene.children.find((model: any) => model.userData.components?.pickable?.exportState().transplanted);
    return { id: model.userData.entityId, position: model.position.toArray(), state: model.userData.components.pickable.exportState() };
  });
  expect(root.state).toMatchObject({ picked: true, transplanted: true, cyclesLeft: 0 });
  // Put the remaining root back, then hold manure on the cursor.
  await bar.locator('.inventory-slot[data-item-id=""]').first().click();
  await bar.locator('[data-item-id="poop"]').click();
  const dead = await screenPoint(true);
  await page.mouse.move(dead.x, dead.y);
  await expect.poll(() => page.evaluate(() => (window as any).monkeytailGame.view.mouseActions.getMouseActions().left?.action)).toBe('FERTILIZE');
  await page.mouse.click(dead.x, dead.y);
  await expect.poll(() => count('poop')).toBe(1);
  await expect.poll(() => page.evaluate(id => {
    const model = (window as any).monkeytailGame.scene.children.find((model: any) => model.userData.entityId === id);
    return model.userData.components.pickable.state.timer.peek().status;
  }, root.id)).toBe('stopped'); // Initial world is winter: fertilizer cannot bypass the winter pause.

  const download = page.waitForEvent('download'); await submit('c_save()');
  const saved = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  const plant = saved.world.entities.monkeytail.find((record: any) => record.id === root.id);
  expect(plant.transform.position).toEqual(root.position);
  expect(plant.components.pickable).toMatchObject({ picked: true, transplanted: true, paused: true });
  expect(plant.components.pickable.cyclesLeft).toBeGreaterThanOrEqual(5);
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload(); await prepare();
  await expect.poll(() => page.evaluate(id => {
    const model = (window as any).monkeytailGame.scene.children.find((model: any) => model.userData.entityId === id);
    return model?.userData.components.pickable.exportState();
  }, root.id)).toEqual(plant.components.pickable);
  await expect.poll(() => count('dug_monkeytail')).toBe(1);
  expect(errors).toEqual([]);
});
