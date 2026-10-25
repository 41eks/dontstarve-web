import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('equipped torch right-click ignites structures and ground materials, closing burnt UI and leaving ash', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/dst-lighting.html');
  await page.evaluate(async paths => {
    const main = await import(paths.main);
    const { player, playerBody } = await import(paths.player);
    const { scene } = await import(paths.universal);
    const { view } = await import(paths.view);
    const { initialSave } = await import(paths.initialSave);
    const { Vector3 } = await import('/node_modules/.vite/deps/three.js');
    const treePositions = (initialSave.world.entities.moon_tree ?? []).map((tree: any) => new Vector3(...tree.transform.position));
    let center: { x: number; z: number } | undefined;
    for (let col = -17; col < -5 && !center; col++) {
      for (let row = -17; row < -5 && !center; row++) {
        const point = new Vector3(col * 12 + 6, 0, row * 12 + 6);
        if (!treePositions.some((position: any) => position.distanceToSquared(point) < 20 ** 2)) center = point;
      }
    }
    if (!center) throw new Error('No free spot for torch ignition');
    const slots = main.inventory.exportState().slots;
    const equipped = slots.find((slot: any) => slot.address.containerId === 'player:equipment' && slot.address.slotKey === 'hand');
    if (equipped?.item) main.inventory.applySlotChanges([{ slot: equipped.address, ...equipped.item, delta: -equipped.item.count }]);
    for (const slot of slots.filter((slot: any) => slot.address.containerId === 'player:inventory').slice(0, 2)) {
      if (slot.item) main.inventory.applySlotChanges([{ slot: slot.address, ...slot.item, delta: -slot.item.count }]);
    }
    playerBody.position.set(center.x, playerBody.shapes[0].radius, center.z);
    playerBody.velocity.set(0, 0, 0); player.position.set(center.x, 0, center.z);
    (window as any).igniteGame = { main, player, playerBody, scene, view, center, targets: new Map() };
  }, Object.fromEntries(['main', 'player', 'universal', 'view', 'save/initialSave'].map(name =>
    [name === 'save/initialSave' ? 'initialSave' : name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`])));

  const submit = async (command: string) => {
    await page.keyboard.press('Backquote');
    const input = page.locator('dst-debug-console input');
    await input.fill(command); await input.press('Enter');
  };
  await submit('c_give("torch");c_spawn("treasurechest");');
  const bar = page.locator('dst-inventory-bar');
  const torch = bar.locator('.inventory-bar__items [data-item-id="torch"]').first();
  await expect(torch.locator('.inventory-slot__icon[data-loaded="true"]')).toBeVisible();
  const hand = bar.locator('.inventory-bar__equipment .inventory-slot').first();
  await torch.dragTo(hand); await expect(hand).toHaveAttribute('data-item-id', 'torch');
  await expect.poll(() => page.evaluate(() => (window as any).igniteGame.scene.children.some((model: any) =>
    model.userData.actionEntity?.prefab === 'treasurechest' && !model.userData.instance?.saveRecord))).toBe(true);

  const point = async (prefab: string) => page.evaluate(async prefab => {
    const game = (window as any).igniteGame;
    const model = game.scene.children.find((model: any) => model.userData.actionEntity?.prefab === prefab && !model.userData.instance?.saveRecord);
    if (!model) throw new Error(`Missing spawned ${prefab}`);
    game.targets.set(prefab, model);
    const foot = model.userData.getGroundPosition();
    game.playerBody.position.set(foot.x + 3, game.playerBody.shapes[0].radius, foot.z);
    game.playerBody.velocity.set(0, 0, 0); game.player.position.set(foot.x + 3, 0, foot.z);
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    const mesh = model.children[0].children[0]; mesh.updateWorldMatrix(true, false);
    const positions = mesh.geometry.getAttribute('position');
    const vertex = model.position.clone(), min = vertex.clone().set(Infinity, Infinity, Infinity), max = vertex.clone().set(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < mesh.geometry.drawRange.count / 6 * 4; i++) {
      vertex.fromBufferAttribute(positions, i); mesh.localToWorld(vertex); min.min(vertex); max.max(vertex);
    }
    const ndc = min.add(max).multiplyScalar(.5).project(game.view.camera), bounds = game.view.renderer.domElement.getBoundingClientRect();
    return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2 };
  }, prefab);
  let chestPoint = await point('treasurechest');
  await page.mouse.click(chestPoint.x, chestPoint.y);
  await expect(page.locator('dst-chest-panel .chest-panel')).toBeVisible();
  chestPoint = await point('treasurechest');
  await page.mouse.move(chestPoint.x, chestPoint.y);
  await expect.poll(() => page.evaluate(() => (window as any).igniteGame.view.mouseActions.getMouseActions().right?.action)).toBe('LIGHT');
  await page.mouse.click(chestPoint.x, chestPoint.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).igniteGame.targets.get('treasurechest').userData.burningSignal.peek())).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).igniteGame.targets.get('treasurechest').userData.burntSignal.peek()), { timeout: 15_000 }).toBe(true);
  await expect(page.locator('dst-chest-panel .chest-panel')).toBeHidden();

  await page.evaluate(() => {
    const game = (window as any).igniteGame;
    game.playerBody.position.x += 40; game.player.position.x += 40;
    game.playerBody.velocity.set(0, 0, 0);
  });
  await submit('c_spawn("cookpot")');
  await expect.poll(() => page.evaluate(() => (window as any).igniteGame.scene.children.some((model: any) =>
    model.userData.actionEntity?.prefab === 'cookpot' && !model.userData.instance?.saveRecord))).toBe(true);
  const potPoint = await point('cookpot');
  await page.mouse.click(potPoint.x, potPoint.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).igniteGame.targets.get('cookpot').userData.burningSignal.peek())).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).igniteGame.targets.get('cookpot').userData.burntSignal.peek()), { timeout: 25_000 }).toBe(true);
  await expect(hand).toHaveAttribute('data-item-id', 'torch');
  for (const prefab of ['cutgrass', 'log']) {
    await page.evaluate(() => {
      const game = (window as any).igniteGame;
      game.playerBody.position.x += 40; game.player.position.x += 40;
      game.playerBody.velocity.set(0, 0, 0);
    });
    await submit(`c_spawn("${prefab}")`);
    await expect.poll(() => page.evaluate(prefab => (window as any).igniteGame.scene.children.some((model: any) =>
      model.userData.actionEntity?.prefab === prefab && model.userData.burningSignal), prefab)).toBe(true);
    const materialPoint = await point(prefab);
    await page.mouse.move(materialPoint.x, materialPoint.y);
    await expect.poll(() => page.evaluate(() => (window as any).igniteGame.view.mouseActions.getMouseActions().right?.action)).toBe('LIGHT');
    await page.mouse.click(materialPoint.x, materialPoint.y, { button: 'right' });
    await expect.poll(() => page.evaluate(prefab => (window as any).igniteGame.targets.get(prefab).userData.burningSignal.peek(), prefab)).toBe(true);
    await expect.poll(() => page.evaluate(prefab => (window as any).igniteGame.targets.get(prefab).userData.burntSignal.peek(), prefab), { timeout: 20_000 }).toBe(true);
    expect(await page.evaluate(prefab => (window as any).igniteGame.targets.get(prefab).parent === null, prefab)).toBe(true);
    await expect.poll(() => page.evaluate(prefab => {
      const game = (window as any).igniteGame, target = game.targets.get(prefab);
      const position = target.userData.getGroundPosition();
      return game.scene.children.some((model: any) => model.userData.itemId === 'ash' && model.userData.components?.stackable?.count === 1
        && model.position.distanceToSquared(position) < .001);
    }, prefab)).toBe(true);
  }
  const downloadPromise = page.waitForEvent('download');
  await submit('c_save()');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Cluster_1.zip');
  expect(errors).toEqual([]);
});
