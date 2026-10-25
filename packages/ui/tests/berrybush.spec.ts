import { hoverSprite } from './sprite-input';
import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('reskins and digs berrybush, replants the skinned root and restores its fertilized state from a save', async ({ page }) => {
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
  urls.physics = `/@fs${fileURLToPath(new URL('../../../src/physics.ts', import.meta.url))}`;
  const prepare = () => page.evaluate(async urls => {
    const { worldState } = await import(urls.physics); worldState.season.set({ season: 'winter', progress: .5 });
    const { inventory, gameReady } = await import(urls.main); await gameReady;
    const { scene } = await import(urls.universal), { view } = await import(urls.view);
    const { turfMap } = await import(urls.building), { player, playerBody } = await import(urls.player);
    // Both target tiles are valid soil, independently of the generator's initial terrain.
    turfMap.setTile(0, 0, 4);
    playerBody.position.set(0, playerBody.shapes[0].radius, 0); playerBody.velocity.set(0, 0, 0); player.position.set(0, 0, 0);
    (window as any).berrybushGame = { inventory, scene, view, player, playerBody };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const screenPoint = (planted: boolean | 'dug') => page.evaluate(async ({ planted, moduleUrl }) => {
    const { scene, view } = (window as any).berrybushGame;
    const model = scene.children.find((model: any) => planted === 'dug' ? model.userData.itemId === 'dug_berrybush'
      : model.userData.instance?.prefab === 'berrybush' && !!model.userData.components.pickable.exportState().transplanted === planted);
    if (!model) throw new Error('No berrybush target');
    scene.updateMatrixWorld(true);
    const { spriteScreenPoint } = await import(moduleUrl);
    return spriteScreenPoint(model, view.camera, view.renderer);
  }, { planted, moduleUrl: `/@fs${fileURLToPath(new URL('./sprite-screen-point.ts', import.meta.url))}` });
  const hover = (target: Parameters<typeof screenPoint>[0], button: 'left' | 'right', action: string) =>
    hoverSprite(page, () => screenPoint(target), 'berrybushGame', button, action);
  const count = (id: string) => page.evaluate(id => (window as any).berrybushGame.inventory.count(id), id);
  const bar = page.locator('dst-inventory-bar .inventory-bar__items');

  await page.goto('/tests/dst-lighting.html?save=initial-world.json'); await prepare();
  await submit('c_spawn("berrybush");c_give("shovel");c_give("poop",2);c_give("reskin_tool")');
  await expect(bar.locator('[data-item-id="reskin_tool"] .inventory-slot__icon[data-loaded="true"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).berrybushGame.scene.children.filter((model: any) => model.userData.instance?.prefab === 'berrybush').length)).toBe(1);
  const hand = page.locator('dst-inventory-bar .inventory-bar__equipment .inventory-slot').first();
  await bar.locator('[data-item-id="reskin_tool"]').dragTo(hand);
  let wild = await hover(false, 'right', 'CASTSPELL');
  await page.mouse.click(wild.x, wild.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).berrybushGame.scene.children.find((model: any) => model.userData.instance?.prefab === 'berrybush')?.userData.instance?.skinId)).toBe('berrybush_cawnival');
  wild = await hover(false, 'left', 'PICK');
  await page.mouse.click(wild.x, wild.y);
  await expect.poll(() => count('berries')).toBe(1);

  await hand.dragTo(bar.locator('.inventory-slot[data-item-id=""]').first());
  await bar.locator('[data-item-id="shovel"]').dragTo(hand);
  wild = await hover(false, 'right', 'DIG');
  await page.mouse.click(wild.x, wild.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).berrybushGame.scene.children.some((model: any) => model.userData.itemId === 'dug_berrybush'))).toBe(true);
  const dug = await hover('dug', 'left', 'PICKUP');
  await page.mouse.click(dug.x, dug.y);
  await expect(bar.locator('[data-item-id="dug_berrybush"] .inventory-slot__icon[data-loaded="true"]')).toBeVisible();
  await bar.locator('[data-item-id="dug_berrybush"]').click();
  const plantingPoint = await page.evaluate(() => {
    const { player, view } = (window as any).berrybushGame;
    const point = player.position.clone().set(6, 0, 6).project(view.camera), rect = view.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  });
  await page.mouse.move(plantingPoint.x, plantingPoint.y);
  await expect.poll(() => page.evaluate(() => (window as any).berrybushGame.view.mouseActions.getMouseActions().right?.action)).toBe('DEPLOY');
  await page.mouse.click(plantingPoint.x, plantingPoint.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).berrybushGame.scene.children.filter((model: any) => model.userData.instance?.prefab === 'berrybush').length)).toBe(1);
  await expect.poll(() => count('dug_berrybush')).toBe(0);
  const root = await page.evaluate(() => {
    const model = (window as any).berrybushGame.scene.children.find((model: any) => model.userData.components?.pickable?.exportState().transplanted);
    return { id: model.userData.instance?.entityId, position: model.position.toArray(), skinId: model.userData.instance?.skinId, state: model.userData.components.pickable.exportState() };
  });
  expect(root.skinId).toBe('berrybush_cawnival');
  expect(root.state).toMatchObject({ picked: true, transplanted: true, cyclesLeft: 0 });
  await bar.locator('[data-item-id="poop"]').click();
  const dead = await hover(true, 'left', 'FERTILIZE');
  await page.mouse.click(dead.x, dead.y);
  await expect.poll(() => count('poop')).toBe(1);
  await expect.poll(() => page.evaluate(id => {
    const model = (window as any).berrybushGame.scene.children.find((model: any) => model.userData.instance?.entityId === id);
    return model.userData.components.pickable.state.timer.peek().status;
  }, root.id)).toBe('stopped'); // Initial world is winter: fertilizer cannot bypass the winter pause.

  const download = page.waitForEvent('download'); await submit('c_save()');
  const saved = JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  const plant = saved.world.entities.berrybush.find((record: any) => record.id === root.id);
  expect(plant.transform.position).toEqual(root.position);
  expect(plant.components.pickable).toMatchObject({ picked: true, transplanted: true, paused: true });
  expect(plant.components.plant.skinId).toBe('berrybush_cawnival');
  expect(plant.components.pickable.cyclesLeft).toBeGreaterThanOrEqual(4);
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload(); await prepare();
  await expect.poll(() => page.evaluate(id => {
    const model = (window as any).berrybushGame.scene.children.find((model: any) => model.userData.instance?.entityId === id);
    return model?.userData.components.pickable.exportState();
  }, root.id)).toEqual(plant.components.pickable);
  await expect.poll(() => count('dug_berrybush')).toBe(0);
  expect(errors).toEqual([]);
});
