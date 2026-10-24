import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('picks rock avocado, clears overripe fruit, digs and replants a root, fertilizes and reloads the saved growth state', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.entities = { rock_avocado_bush: [
      { id: 'rock-avocado:mature', transform: { position: [0, 0, 0], rotationY: 0 },
        components: { pickable: { maxCycles: 3, cyclesLeft: 3 }, growable: { stage: 3, time: 900 } } },
      { id: 'rock-avocado:overripe', transform: { position: [-6, 0, 0], rotationY: 0 },
        components: { pickable: { maxCycles: 3, cyclesLeft: 3 }, growable: { stage: 4, time: 300 } } },
    ] }; save.world.elapsedSeconds = 0;
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
    for (let col = -2; col <= 0; col++) for (let row = -1; row <= 0; row++) turfMap.setTile(col, row, 4);
    playerBody.position.set(-3, playerBody.shapes[0].radius, 0); playerBody.velocity.set(0, 0, 0); player.position.set(-3, 0, 0);
    (window as any).rock_avocado_bushGame = { inventory, scene, view, player, playerBody };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const screenPoint = (planted: boolean | 'dug' | 'overripe') => page.evaluate(planted => {
    const { scene, view } = (window as any).rock_avocado_bushGame;
    const model = scene.children.find((model: any) => planted === 'dug' ? model.userData.itemId === 'dug_rock_avocado_bush'
      : planted === 'overripe' ? model.userData.entityId === 'rock-avocado:overripe'
      : model.userData.entityId !== 'rock-avocado:overripe' && model.userData.prefab === 'rock_avocado_bush' && !!model.userData.components.pickable.exportState().transplanted === planted);
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
  }, planted);
  const count = (id: string) => page.evaluate(id => (window as any).rock_avocado_bushGame.inventory.count(id), id);
  const bar = page.locator('dst-inventory-bar .inventory-bar__items');

  await page.goto('/tests/dst-lighting.html'); await prepare();
  await submit('c_give("shovel");c_give("poop",2)');
  await expect(bar.locator('[data-item-id="shovel"] .inventory-slot__icon[data-loaded="true"]')).toBeVisible();
  const hand = page.locator('dst-inventory-bar .inventory-bar__equipment .inventory-slot').first();
  const overripe = await screenPoint('overripe');
  await page.mouse.move(overripe.x, overripe.y);
  await expect.poll(() => page.evaluate(() => (window as any).rock_avocado_bushGame.view.mouseActions.getMouseActions().left?.action)).toBe('PICK');
  await page.mouse.click(overripe.x, overripe.y);
  await expect.poll(() => page.evaluate(() => (window as any).rock_avocado_bushGame.scene.children.find((m: any) => m.userData.entityId === 'rock-avocado:overripe').userData.components.growable.GetStage())).toBe(1);
  expect(await count('rock_avocado_fruit')).toBe(0);
  let wild = await screenPoint(false);
  await page.mouse.move(wild.x, wild.y);
  await expect.poll(() => page.evaluate(() => (window as any).rock_avocado_bushGame.view.mouseActions.getMouseActions().left?.action)).toBe('PICK');
  await page.mouse.click(wild.x, wild.y);
  await expect.poll(() => count('rock_avocado_fruit')).toBe(3);

  await bar.locator('[data-item-id="shovel"]').dragTo(hand);
  wild = await screenPoint(false);
  await page.mouse.move(wild.x, wild.y);
  await expect.poll(() => page.evaluate(() => (window as any).rock_avocado_bushGame.view.mouseActions.getMouseActions().right?.action)).toBe('DIG');
  await page.mouse.click(wild.x, wild.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).rock_avocado_bushGame.scene.children.some((model: any) => model.userData.itemId === 'dug_rock_avocado_bush'))).toBe(true);
  const dug = await screenPoint('dug');
  await page.mouse.move(dug.x, dug.y);
  await page.mouse.click(dug.x, dug.y);
  await expect(bar.locator('[data-item-id="dug_rock_avocado_bush"] .inventory-slot__icon[data-loaded="true"]')).toBeVisible();
  await bar.locator('[data-item-id="dug_rock_avocado_bush"]').click();
  const plantingPoint = await page.evaluate(() => {
    const { player, view } = (window as any).rock_avocado_bushGame;
    const point = player.position.clone().set(6, 0, 6).project(view.camera), rect = view.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  });
  await page.mouse.move(plantingPoint.x, plantingPoint.y);
  await expect.poll(() => page.evaluate(() => (window as any).rock_avocado_bushGame.view.mouseActions.getMouseActions().right?.action)).toBe('DEPLOY');
  await page.mouse.click(plantingPoint.x, plantingPoint.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).rock_avocado_bushGame.scene.children.filter((model: any) => model.userData.prefab === 'rock_avocado_bush').length)).toBe(2);
  await expect.poll(() => count('dug_rock_avocado_bush')).toBe(0);
  const root = await page.evaluate(() => {
    const model = (window as any).rock_avocado_bushGame.scene.children.find((model: any) => model.userData.components?.pickable?.exportState().transplanted);
    return { id: model.userData.entityId, position: model.position.toArray(), skinId: model.userData.skinId, state: model.userData.components.pickable.exportState() };
  });
  expect(root.state).toMatchObject({ picked: true, transplanted: true, cyclesLeft: 0 });
  await bar.locator('[data-item-id="poop"]').click();
  const dead = await screenPoint(true);
  await page.mouse.move(dead.x, dead.y);
  await expect.poll(() => page.evaluate(() => (window as any).rock_avocado_bushGame.view.mouseActions.getMouseActions().left?.action)).toBe('FERTILIZE');
  await page.mouse.click(dead.x, dead.y);
  await expect.poll(() => count('poop')).toBe(1);
  await expect.poll(() => page.evaluate(id => {
    const model = (window as any).rock_avocado_bushGame.scene.children.find((model: any) => model.userData.entityId === id);
    return model.userData.components.growable.state.timer.peek().status;
  }, root.id)).toBe('scheduled'); // Rock avocado keeps growing during winter.

  const download = page.waitForEvent('download'); await submit('c_save()');
  const saved = JSON.parse(await readSaveDownload((await (await download).path())!));
  const plant = saved.world.entities.rock_avocado_bush.find((record: any) => record.id === root.id);
  expect(plant.transform.position).toEqual(root.position);
  expect(plant.components.pickable).toMatchObject({ picked: true, transplanted: true, cyclesLeft: 3 });
  expect(plant.components.growable.stage).toBe(1);
  expect(plant.components.growable.time).toBeGreaterThan(500);
  expect(plant.components.pickable.cyclesLeft).toBe(3);
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload(); await prepare();
  await expect.poll(() => page.evaluate(id => {
    const model = (window as any).rock_avocado_bushGame.scene.children.find((model: any) => model.userData.entityId === id);
    return model?.userData.components.pickable.exportState();
  }, root.id)).toEqual(plant.components.pickable);
  await expect.poll(() => count('dug_rock_avocado_bush')).toBe(0);
  expect(errors).toEqual([]);
});
