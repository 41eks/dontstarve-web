import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const url = (path: string) => `/@fs${fileURLToPath(new URL(path, import.meta.url))}`;

test('farm plow supports seed planting and ordinary/golden hoe tilling on its farming tile', async ({ page }) => {
  test.setTimeout(180_000);
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
    const occupied = new Set<string>();
    const key = (position: number[]) => `${Math.floor(position[0] / 12)},${Math.floor(position[2] / 12)}`;
    for (const tree of moonTreeForest.entities) occupied.add(key(tree.position.toArray()));
    for (const records of Object.values(initialSave.world.entities) as any[]) {
      for (const record of records) occupied.add(key(record.transform.position));
    }
    let center: any;
    for (let col = -17; col < -5 && !center; col++) {
      for (let row = -17; row < -5 && !center; row++) {
        const point = { x: col * 12 + 6, z: row * 12 + 6 };
        if (!occupied.has(`${col},${row}`) && turfMap.canPlow(point)) center = point;
      }
    }
    if (!center) throw new Error('No free farm tile');
    const radius = playerBody.shapes[0].radius;
    playerBody.position.set(center.x, radius, center.z + 3);
    playerBody.velocity.set(0, 0, 0);
    player.position.set(center.x, 0, center.z + 3);
    (window as any).farmGame = { main, player, scene, view, turfMap, center };
  }, Object.fromEntries(['main', 'player', 'universal', 'view', 'building', 'save/initialSave'].map((name) =>
    [name === 'save/initialSave' ? 'initialSave' : name, url(`../../../src/${name}.ts`)])));
  const submit = async (command: string) => page.evaluate((command) => {
    document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', { detail: { command } }));
  }, command);
  await submit('c_give("farm_plow_item")');
  const item = page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="farm_plow_item"]');
  await expect(item).toHaveCount(1);
  await expect(item.locator('.inventory-slot__icon[data-loaded="true"]')).toBeVisible();
  await item.click();
  await expect.poll(() => page.evaluate(() => (window as any).farmGame.scene.children
    .some((model: any) => model.name === 'FarmPlowPlacer'))).toBe(true);
  const point = await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    const { view, player, center } = (window as any).farmGame;
    const ndc = player.position.clone().set(center.x, 0, center.z).project(view.camera);
    const bounds = view.renderer.domElement.getBoundingClientRect();
    return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2 };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).farmGame.scene.children
    .filter((model: any) => model.userData.prefab === 'farm_plow').length)).toBe(1);
  await expect(item).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).farmGame.scene.children
    .find((model: any) => model.userData.prefab === 'farm_plow')?.userData.animationController.currentAnimation)).toBe('drill_loop');
  await page.screenshot({ path: '/tmp/dontstarve-farm-plow-drilling.png' });
  const duringDownload = page.waitForEvent('download');
  await submit('c_save()');
  const drillingSave = JSON.parse(await readFile((await (await duringDownload).path())!, 'utf8'));
  expect(drillingSave.world.entities.farm_plow[0].components.farmPlow).toMatchObject({ phase: 'drill_loop', returnUses: 3 });
  expect(drillingSave.world.entities.farm_plow[0].components.farmPlow.remainingSeconds).toBeLessThan(15);
  await expect.poll(() => page.evaluate(() => {
    const { turfMap, center } = (window as any).farmGame; return turfMap.getTileAtWorld(center);
  }), { timeout: 25_000 }).toBe(47);
  await expect.poll(() => page.evaluate(() => (window as any).farmGame.scene.children
    .some((model: any) => model.name === 'GroundItem:farm_plow_item')), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).farmGame.scene.children
    .some((model: any) => model.userData.prefab === 'farm_plow'))).toBe(false);
  await page.screenshot({ path: '/tmp/dontstarve-farm-plow-finished.png' });
  // Aim inside a rendered triangle; merged bounds can span gaps between parts.
  const spritePoint = async (prefab: string, name?: string) => page.evaluate(({ prefab, name }) => {
    const { scene, view, player } = (window as any).farmGame;
    const model = scene.children.filter((model: any) => name ? model.name === name : model.userData.prefab === prefab
      && model.userData.animationController.currentAnimation === 'till_idle')
      .sort((a: any, b: any) => a.position.distanceToSquared(player.position) - b.position.distanceToSquared(player.position))[0];
    if (!model) throw new Error(`No clickable ${prefab}`);
    const mesh = model.children[0].children[0]; mesh.updateWorldMatrix(true, false);
    const positions = mesh.geometry.getAttribute('position'), indices = mesh.geometry.index;
    const point = model.position.clone().set(0, 0, 0), vertex = point.clone();
    for (let i = 0; i < 3; i++) {
      vertex.fromBufferAttribute(positions, indices.getX(i)); mesh.localToWorld(vertex); point.add(vertex);
    }
    const ndc = point.multiplyScalar(1 / 3).project(view.camera);
    const bounds = view.renderer.domElement.getBoundingClientRect();
    return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2,
      id: model.userData.entityId, position: model.position.toArray() };
  }, { prefab, name });
  const pickupPoint = await spritePoint('farm_plow_item', 'GroundItem:farm_plow_item');
  await page.mouse.click(pickupPoint.x, pickupPoint.y);
  await expect(item).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).farmGame.main.inventory.exportState().slots
    .find((slot: any) => slot.item?.itemId === 'farm_plow_item').item.remainingUses)).toBe(3);
  const afterDownload = page.waitForEvent('download');
  await submit('c_save()');
  const finishedSave = JSON.parse(await readFile((await (await afterDownload).path())!, 'utf8'));
  expect(finishedSave.world.entities.farm_plow).toEqual([]);
  expect(finishedSave.world.entities.farm_soil_debris.length).toBeGreaterThan(0);
  expect(finishedSave.world.map.tiles.some((tile: any) => tile.tileId === 47)).toBe(true);
  await page.evaluate(() => {
    const { inventory } = (window as any).farmGame.main;
    inventory.applySlotChanges(inventory.exportState().slots.filter((slot: any) => slot.item?.itemId === 'seeds')
      .map((slot: any) => ({ slot: slot.address, itemId: 'seeds', delta: -slot.item.count })));
  });
  await submit('c_give("seeds", 3)');
  const seeds = page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="seeds"]');
  await expect(seeds).toHaveCount(1);
  await expect(seeds.locator('.inventory-slot__icon[data-loaded="true"]')).toBeVisible();
  await seeds.click({ button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).farmGame.main.inventory.exportState().slots
    .find((slot: any) => slot.item?.itemId === 'seeds')?.item.count)).toBe(2);
  await expect.poll(() => page.evaluate(() => (window as any).farmGame.player.userData.animationController.stategraph.stateName)).toBe('idle');
  await seeds.click({ button: 'right', modifiers: ['Shift'] });
  await expect.poll(() => page.evaluate(() => (window as any).farmGame.scene.children
    .some((model: any) => model.name === 'GroundItem:seeds'))).toBe(true);
  const seedPoint = await spritePoint('seeds', 'GroundItem:seeds');
  await page.mouse.click(seedPoint.x, seedPoint.y);
  await expect.poll(() => page.evaluate(() => (window as any).farmGame.main.inventory.exportState().slots
    .find((slot: any) => slot.item?.itemId === 'seeds')?.item.count)).toBe(2);
  const hole = await spritePoint('farm_soil');
  await seeds.click();
  const cursorSeed = page.locator('.slot-drag-preview[data-selection="true"][data-item-id="seeds"]');
  await expect(cursorSeed.locator('.slot-drag-preview__icon[data-loaded="true"]')).toBeVisible();
  await expect(cursorSeed.locator('.slot-drag-preview__count')).toHaveText('2');
  await page.mouse.move(hole.x, hole.y);
  await expect.poll(() => cursorSeed.evaluate((element) => parseFloat((element as HTMLElement).style.left))).toBeCloseTo(hole.x, 2);
  // Selection claims the click before transfer pickup; cancel without spending.
  await page.keyboard.press('Escape');
  await expect(cursorSeed).toHaveCount(0);
  await seeds.click();
  await page.mouse.click(hole.x, hole.y);
  await expect.poll(() => page.evaluate(() => (window as any).farmGame.scene.children
    .filter((model: any) => model.userData.prefab === 'farm_plant_randomseed').length), { timeout: 15_000 }).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).farmGame.scene.children
    .find((model: any) => model.userData.prefab === 'farm_plant_randomseed')?.userData.animationController.currentAnimation)).toBe('sow_idle');
  await expect(cursorSeed.locator('.slot-drag-preview__count')).toHaveText('');
  const plantedDownload = page.waitForEvent('download');
  await submit('c_save()');
  const plantedSave = JSON.parse(await readFile((await (await plantedDownload).path())!, 'utf8'));
  expect(plantedSave.world.entities.farm_soil.some((record: any) => record.id === hole.id)).toBe(false);
  expect(plantedSave.world.entities.farm_plant_randomseed[0].transform.position).toEqual(hole.position);
  expect(plantedSave.players.local.inventory.containers['player:inventory'].slots
    .find((slot: any) => slot.item?.itemId === 'seeds').item.count).toBe(1);
  expect(plantedSave.players.local.stats.hunger).toBe(109.6875);
  await page.evaluate(async ({ paths, save }) => {
    const { deserializeSave } = await import(paths.deserialize);
    const { SAVE_CATALOG } = await import(paths.catalog);
    deserializeSave(JSON.stringify(save), SAVE_CATALOG);
  }, { paths: { deserialize: url('../../../src/save/deserialize.ts'), catalog: url('../../../src/save/catalog.ts') }, save: plantedSave });
  await page.screenshot({ path: '/tmp/dontstarve-seeds-planted.png' });
  // Use the same plowed tile for both tool forms; preserve the planted seed.
  await submit('c_give("farm_hoe")');
  const bar = page.locator('dst-inventory-bar');
  const hand = bar.locator('.inventory-bar__equipment .inventory-slot').first();
  const unequipHand = async () => {
    if (await hand.getAttribute('data-item-id')) {
      await hand.dragTo(bar.locator('.inventory-bar__items .inventory-slot[data-item-id=""]').first());
      await expect(hand).toHaveAttribute('data-item-id', '');
    }
  };
  await unequipHand();
  await bar.locator('.inventory-bar__items [data-item-id="farm_hoe"]').dragTo(hand);
  await expect(hand).toHaveAttribute('data-item-id', 'farm_hoe');
  await expect.poll(() => page.evaluate(() => (window as any).farmGame.player.children[0].children[0].material
    .some((material: any) => material.name === 'ground:quagmire_hoe'))).toBe(true);
  const tillPoint = await page.evaluate(() => {
    const { scene, view, player, center } = (window as any).farmGame;
    const blocked = scene.children.filter((model: any) => ['farm_soil_debris', 'farm_plant_randomseed'].includes(model.userData.prefab));
    let point: any;
    for (let dx = -5; dx <= 5 && !point; dx += 1) for (let dz = -5; dz <= 5 && !point; dz += 1) {
      const candidate = player.position.clone().set(center.x + dx, 0, center.z + dz);
      if (blocked.every((model: any) => model.position.distanceToSquared(candidate) >= 3.75 ** 2)) point = candidate;
    }
    if (!point) throw new Error('No clear till point on completed farm tile');
    const ndc = point.clone().project(view.camera), bounds = view.renderer.domElement.getBoundingClientRect();
    return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2,
      position: point.toArray() };
  });
  await page.mouse.click(tillPoint.x, tillPoint.y, { button: 'right' });
  await expect.poll(() => page.evaluate((position) => (window as any).farmGame.scene.children
    .some((model: any) => model.userData.prefab === 'farm_soil'
      && model.position.distanceToSquared((window as any).farmGame.player.position.clone().fromArray(position)) < 0.001), tillPoint.position),
  { timeout: 15_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).farmGame.player.userData.animationController.isTilling)).toBe(false);
  await submit('c_give("golden_farm_hoe")');
  await unequipHand();
  await bar.locator('.inventory-bar__items [data-item-id="golden_farm_hoe"]').dragTo(hand);
  await expect(hand).toHaveAttribute('data-item-id', 'golden_farm_hoe');
  await expect.poll(() => page.evaluate(() => (window as any).farmGame.player.children[0].children[0].material
    .some((material: any) => material.name === 'ground:swap_goldenhoe'))).toBe(true);
  const retill = await page.evaluate((position) => {
    const { scene, view, player } = (window as any).farmGame;
    const point = player.position.clone().fromArray(position);
    const previous = scene.children.find((model: any) => model.userData.prefab === 'farm_soil' && model.position.distanceToSquared(point) < 0.001);
    const ndc = point.project(view.camera), bounds = view.renderer.domElement.getBoundingClientRect();
    return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2,
      oldId: previous.userData.entityId };
  }, tillPoint.position);
  await page.mouse.click(retill.x, retill.y, { button: 'right' });
  await expect.poll(() => page.evaluate((oldId) => (window as any).farmGame.scene.children
    .some((model: any) => model.userData.entityId === oldId), retill.oldId)).toBe(false);
  await expect.poll(() => page.evaluate(() => (window as any).farmGame.player.userData.animationController.isTilling)).toBe(false);
  // Ground reskin -> pickup -> equipment must preserve the golden tool's skin.
  const beforeCancel = await page.evaluate((position) => {
    const { scene, player } = (window as any).farmGame;
    return scene.children.find((model: any) => model.userData.prefab === 'farm_soil'
      && model.position.distanceToSquared(player.position.clone().fromArray(position)) < 0.001).userData.entityId;
  }, tillPoint.position);
  await page.mouse.click(retill.x, retill.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).farmGame.player.userData.animationController.isTilling)).toBe(true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  expect(await page.evaluate((id) => (window as any).farmGame.scene.children
    .some((model: any) => model.userData.entityId === id), beforeCancel)).toBe(true);
  await hand.click({ button: 'right', modifiers: ['Shift'] });
  await expect.poll(() => page.evaluate(() => (window as any).farmGame.scene.children
    .some((model: any) => model.name === 'GroundItem:golden_farm_hoe'))).toBe(true);
  await bar.locator('.inventory-bar__items [data-item-id="reskin_tool"]').first().dragTo(hand);
  await expect.poll(() => page.evaluate(() => (window as any).farmGame.player.children[0].children[0].material
    .some((material: any) => material.name === 'ground:swap_reskin_tool'))).toBe(true);
  const goldPoint = await spritePoint('golden_farm_hoe', 'GroundItem:golden_farm_hoe');
  await page.mouse.click(goldPoint.x, goldPoint.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).farmGame.scene.children
    .find((model: any) => model.name === 'GroundItem:golden_farm_hoe')?.userData.skinId)).toBe('golden_farmhoe_garden');
  const skinnedPoint = await spritePoint('golden_farm_hoe', 'GroundItem:golden_farm_hoe');
  await page.mouse.click(skinnedPoint.x, skinnedPoint.y);
  await unequipHand();
  await bar.locator('.inventory-bar__items [data-item-id="golden_farm_hoe"]').dragTo(hand);
  await expect(hand).toHaveAttribute('data-item-id', 'golden_farm_hoe');
  await submit('c_spawn("farm_hoe")');
  await submit('c_spawn("golden_farm_hoe")');
  await expect.poll(() => page.evaluate(() => (window as any).farmGame.scene.children
    .filter((model: any) => ['GroundItem:farm_hoe', 'GroundItem:golden_farm_hoe'].includes(model.name)).length)).toBe(2);
  const hoeDownload = page.waitForEvent('download');
  await submit('c_save()');
  const hoeSave = JSON.parse(await readFile((await (await hoeDownload).path())!, 'utf8'));
  expect(hoeSave.world.entities.farm_plant_randomseed).toEqual(plantedSave.world.entities.farm_plant_randomseed);
  expect(hoeSave.players.local.inventory.containers['player:equipment'].slots
    .find((slot: any) => slot.slotKey === 'hand').item.skinId).toBe('golden_farmhoe_garden');
  expect(hoeSave.world.entities.farm_soil.some((record: any) => record.components.farmSoil.broken === false
    && record.transform.position.every((value: number, index: number) => Math.abs(value - tillPoint.position[index]) < 0.001))).toBe(true);
  await page.screenshot({ path: '/tmp/dontstarve-farm-hoe-tilled.png' });
  const groundTools = hoeSave.world.entities.ground_item.filter((record: any) => ['farm_hoe', 'golden_farm_hoe'].includes(record.components.stack.itemId));
  expect(groundTools).toHaveLength(2);
  await page.route('**/saves/initial-world.json', (route) => route.fulfill({ json: hoeSave }));
  await page.reload();
  const restored = await page.evaluate(async (paths) => {
    const main = await import(paths.main);
    const { scene } = await import(paths.universal);
    const { player } = await import(paths.player);
    const { turfMap } = await import(paths.building);
    const { equipmentSlotAddress } = await import(paths.inventory);
    const tools = scene.children.filter((model: any) => ['farm_hoe', 'golden_farm_hoe'].includes(model.userData.itemId));
    const holes = scene.children.filter((model: any) => model.userData.prefab === 'farm_soil');
    return { tools: tools.map((model: any) => ({ id: model.userData.entityId, position: model.position.toArray(), count: model.userData.count })),
      holes: holes.map((model: any) => ({ id: model.userData.entityId, position: model.position.toArray(),
        animation: model.userData.animationController.currentAnimation })),
      hand: main.inventory.get(equipmentSlotAddress('hand')), ordinaryCount: main.inventory.count('farm_hoe'),
      heldSkin: player.children[0].children[0].material.some((material: any) => material.name === 'ground:golden_farmhoe_garden'),
      tile: turfMap.getTileAtWorld(holes[0].position) };
  }, { ...Object.fromEntries(['main', 'universal', 'player', 'building'].map((name) => [name, url(`../../../src/${name}.ts`)])),
    inventory: url('../../ui/src/index.ts') });
  expect(restored.tools).toEqual(groundTools.map((record: any) => ({ id: record.id, position: record.transform.position, count: record.components.stack.count })));
  expect(restored.hand).toMatchObject({ itemId: 'golden_farm_hoe', count: 1, skinId: 'golden_farmhoe_garden' });
  expect(restored.ordinaryCount).toBe(1);
  expect(restored.heldSkin).toBe(true);
  expect(restored.holes).toEqual(hoeSave.world.entities.farm_soil.map((record: any) => ({ id: record.id, position: record.transform.position,
    animation: record.components.farmSoil.broken ? 'collapse_idle' : 'till_idle' })));
  expect(restored.tile).toBe(47);
  expect(errors).toEqual([]);
});
