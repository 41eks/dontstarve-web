import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const url = (path: string) => `/@fs${fileURLToPath(new URL(path, import.meta.url))}`;

test('inventory farm plow deploys despite its own preview, drills, saves and returns with one use spent', async ({ page }) => {
  test.setTimeout(120_000);
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
  const pickupPoint = await page.evaluate(() => {
    const { scene, view } = (window as any).farmGame;
    const model = scene.children.find((model: any) => model.name === 'GroundItem:farm_plow_item');
    // Compute bounds from used vertices, avoiding spare geometry capacity.
    const mesh = model.children[0].children[0]; mesh.updateWorldMatrix(true, false);
    const positions = mesh.geometry.getAttribute('position');
    const first = model.position.clone().set(0, 0, 0);
    const min = first.clone().set(Infinity, Infinity, Infinity), max = first.clone().set(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < mesh.geometry.drawRange.count / 6 * 4; i++) {
      first.fromBufferAttribute(positions, i); mesh.localToWorld(first); min.min(first); max.max(first);
    }
    const ndc = min.add(max).multiplyScalar(0.5).project(view.camera);
    const bounds = view.renderer.domElement.getBoundingClientRect();
    return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2 };
  });
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
  expect(errors).toEqual([]);
});
