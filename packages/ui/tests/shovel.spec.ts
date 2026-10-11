import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const url = (path: string) => `/@fs${fileURLToPath(new URL(path, import.meta.url))}`;
const modules = { ...Object.fromEntries(['main', 'player', 'universal', 'view', 'building', 'save/initialSave'].map((name) =>
  [name === 'save/initialSave' ? 'initialSave' : name, url(`../../../src/${name}.ts`)])), inventory: url('../../ui/src/index.ts') };

test('shovels equip, clear farm-plow debris, reskin and preserve command-created tools through a real save reload', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tests/dst-lighting.html');
  await page.evaluate(async (paths) => {
    const main = await import(paths.main);
    const { player, playerBody } = await import(paths.player);
    const { scene } = await import(paths.universal);
    const { view } = await import(paths.view);
    const { turfMap, moonTreeForest } = await import(paths.building);
    const { initialSave } = await import(paths.initialSave);
    main.inventory.applySlotChanges(main.inventory.exportState().slots.filter((slot: any) => slot.item)
      .map((slot: any) => ({ slot: slot.address, itemId: slot.item.itemId, skinId: slot.item.skinId, delta: -slot.item.count })));
    const key = (position: number[]) => `${Math.floor(position[0] / 12)},${Math.floor(position[2] / 12)}`;
    const occupied = new Set(moonTreeForest.entities.map((tree: any) => key(tree.position.toArray())));
    for (const records of Object.values(initialSave.world.entities) as any[]) for (const record of records) occupied.add(key(record.transform.position));
    let center: any;
    for (let col = -17; col < -5 && !center; col++) for (let row = -17; row < -5 && !center; row++) {
      const point = { x: col * 12 + 6, z: row * 12 + 6 };
      if (!occupied.has(`${col},${row}`) && turfMap.canPlow(point)) center = point;
    }
    if (!center) throw new Error('No free farm tile');
    playerBody.position.set(center.x, playerBody.shapes[0].radius, center.z + 3); playerBody.velocity.set(0, 0, 0);
    player.position.set(center.x, 0, center.z + 3);
    (window as any).shovelGame = { main, player, scene, view, turfMap, center };
  }, modules);
  const submit = async (command: string) => page.evaluate((command) => document.querySelector('dst-debug-console')!
    .dispatchEvent(new CustomEvent('game:debug-command', { detail: { command } })), command);
  const spritePoint = async (prefab: string, groundItem = false) => page.evaluate(async ({ prefab, groundItem }) => {
    await new Promise(requestAnimationFrame);
    const { scene, player, view } = (window as any).shovelGame;
    const model = scene.children.filter((model: any) => groundItem ? model.name === `GroundItem:${prefab}` : model.userData.prefab === prefab)
      .sort((a: any, b: any) => a.position.distanceToSquared(player.position) - b.position.distanceToSquared(player.position))[0];
    if (!model) throw new Error(`Missing ${prefab}`);
    const mesh = model.children[0].children[0]; mesh.updateWorldMatrix(true, false);
    const positions = mesh.geometry.getAttribute('position'), indices = mesh.geometry.index;
    const point = model.position.clone().set(0, 0, 0), vertex = point.clone();
    for (let i = 0; i < 3; i++) { vertex.fromBufferAttribute(positions, indices.getX(i)); mesh.localToWorld(vertex); point.add(vertex); }
    const ndc = point.multiplyScalar(1 / 3).project(view.camera), bounds = view.renderer.domElement.getBoundingClientRect();
    return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2, id: model.userData.entityId };
  }, { prefab, groundItem });
  const bar = page.locator('dst-inventory-bar');
  const hand = bar.locator('.inventory-bar__equipment .inventory-slot').first();
  const equip = async (id: string, material: string) => {
    if (await hand.getAttribute('data-item-id')) await hand.dragTo(bar.locator('.inventory-bar__items .inventory-slot[data-item-id=""]').first());
    const slot = bar.locator(`.inventory-bar__items [data-item-id="${id}"]`).first();
    await expect(slot.locator('.inventory-slot__icon[data-loaded="true"]')).toBeVisible();
    await slot.dragTo(hand);
    await expect(hand).toHaveAttribute('data-item-id', id);
    await expect.poll(() => page.evaluate((name) => (window as any).shovelGame.player.children[0].children[0].material
      .some((material: any) => material.name === name), material)).toBe(true);
  };
  await submit('c_give("farm_plow_item")');
  await bar.locator('.inventory-bar__items [data-item-id="farm_plow_item"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).shovelGame.scene.children.some((model: any) => model.name === 'FarmPlowPlacer'))).toBe(true);
  const tilePoint = await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    const { player, view, center } = (window as any).shovelGame;
    const ndc = player.position.clone().set(center.x, 0, center.z).project(view.camera), bounds = view.renderer.domElement.getBoundingClientRect();
    return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2 };
  });
  await page.mouse.click(tilePoint.x, tilePoint.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => {
    const { turfMap, center } = (window as any).shovelGame; return turfMap.getTileAtWorld(center);
  }), { timeout: 30_000 }).toBe(47);
  await expect.poll(() => page.evaluate(() => (window as any).shovelGame.scene.children.some((model: any) => model.userData.prefab === 'farm_soil_debris'))).toBe(true);
  await submit('c_give("shovel")'); await submit('c_give("goldenshovel")'); await submit('c_give("reskin_tool")');
  await equip('shovel', 'ground:swap_shovel');
  let debris = await spritePoint('farm_soil_debris');
  await page.mouse.click(debris.x, debris.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).shovelGame.player.userData.animationController.isShoveling)).toBe(true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1100);
  expect(await page.evaluate((id) => (window as any).shovelGame.scene.children.some((model: any) => model.userData.entityId === id), debris.id)).toBe(true);
  debris = await spritePoint('farm_soil_debris');
  await page.mouse.click(debris.x, debris.y, { button: 'right' });
  await expect.poll(() => page.evaluate((id) => (window as any).shovelGame.scene.children.some((model: any) => model.userData.entityId === id), debris.id),
    { timeout: 15_000 }).toBe(false);
  const removedIds = [debris.id];
  // Exercise the existing reskin workflow on one representative visible skin.
  await hand.click({ button: 'right', modifiers: ['Shift'] });
  await expect.poll(() => page.evaluate(() => (window as any).shovelGame.scene.children.some((model: any) => model.name === 'GroundItem:shovel'))).toBe(true);
  await equip('reskin_tool', 'ground:swap_reskin_tool');
  const dropped = await spritePoint('shovel', true);
  await page.mouse.click(dropped.x, dropped.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).shovelGame.scene.children.find((model: any) => model.name === 'GroundItem:shovel')?.userData.skinId)).toBe('shovel_feathered');
  const skinned = await spritePoint('shovel', true);
  expect(skinned.id).toBe(dropped.id);
  await page.mouse.click(skinned.x, skinned.y);
  await expect(bar.locator('.inventory-bar__items [data-item-id="shovel"][data-skin-id="shovel_feathered"]')).toHaveCount(1);
  await equip('shovel', 'ground:shovel_feathered');
  await equip('goldenshovel', 'ground:swap_goldenshovel');
  const nearbyDebris = await page.evaluate(() => {
    const { scene, player } = (window as any).shovelGame;
    return scene.children.some((model: any) => model.userData.prefab === 'farm_soil_debris' && model.position.distanceToSquared(player.position) < 200);
  });
  if (!nearbyDebris) await submit('c_spawn("farm_soil_debris")');
  debris = await spritePoint('farm_soil_debris');
  await page.mouse.click(debris.x, debris.y, { button: 'right' });
  await expect.poll(() => page.evaluate((id) => (window as any).shovelGame.scene.children.some((model: any) => model.userData.entityId === id), debris.id),
    { timeout: 15_000 }).toBe(false);
  removedIds.push(debris.id);
  await submit('c_spawn("shovel")'); await submit('c_spawn("goldenshovel")');
  await expect.poll(() => page.evaluate(() => (window as any).shovelGame.scene.children
    .filter((model: any) => ['GroundItem:shovel', 'GroundItem:goldenshovel'].includes(model.name)).length)).toBe(2);
  const download = page.waitForEvent('download'); await submit('c_save()');
  const save = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(save.world.entities.farm_soil_debris.every((record: any) => !removedIds.includes(record.id))).toBe(true);
  expect(save.world.map.tiles.some((tile: any) => tile.tileId === 47)).toBe(true);
  await page.screenshot({ path: '/tmp/dontstarve-shovel-farm-debris.png' });
  await page.route('**/saves/initial-world.json', (route) => route.fulfill({ json: save }));
  await page.reload();
  const restored = await page.evaluate(async (paths) => {
    const main = await import(paths.main);
    const { scene } = await import(paths.universal);
    const { player } = await import(paths.player);
    const { equipmentSlotAddress } = await import(paths.inventory);
    return { tools: scene.children.filter((model: any) => ['shovel', 'goldenshovel'].includes(model.userData.itemId))
      .map((model: any) => ({ id: model.userData.entityId, position: model.position.toArray(), count: model.userData.count })),
      debris: scene.children.filter((model: any) => model.userData.prefab === 'farm_soil_debris')
        .map((model: any) => ({ id: model.userData.entityId, position: model.position.toArray(), animation: model.userData.animationController.currentAnimation })),
      hand: main.inventory.get(equipmentSlotAddress('hand')),
      regular: main.inventory.exportState().slots.find((slot: any) => slot.item?.itemId === 'shovel')?.item,
      held: player.children[0].children[0].material.some((material: any) => material.name === 'ground:swap_goldenshovel') };
  }, modules);
  const toolRecords = save.world.entities.ground_item.filter((record: any) => ['shovel', 'goldenshovel'].includes(record.components.stack.itemId));
  expect(restored.tools).toEqual(toolRecords.map((record: any) => ({ id: record.id, position: record.transform.position, count: record.components.stack.count })));
  expect(restored.debris).toEqual(save.world.entities.farm_soil_debris.map((record: any) => ({ id: record.id, position: record.transform.position,
    animation: record.components.farmDebris.animation })));
  expect(restored.hand).toMatchObject({ itemId: 'goldenshovel', count: 1 });
  expect(restored.regular).toMatchObject({ itemId: 'shovel', count: 1, skinId: 'shovel_feathered' });
  expect(restored.held).toBe(true);
  expect(errors).toEqual([]);
});
