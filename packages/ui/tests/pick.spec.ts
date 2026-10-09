import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('c_spawn lamp plants use shared PICK input and c_save preserves the harvest and plant state', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/dst-lighting.html');
  const urls = Object.fromEntries(['main', 'universal', 'view', 'save/deserialize', 'save/catalog',
    'save/inventoryState'].map(name =>
    [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  urls.bulbPlant = `/@fs${fileURLToPath(new URL('../../prefab/src/bulb_plant.ts', import.meta.url))}`;
  const before = await page.evaluate(async urls => {
    const { inventory } = await import(urls.main);
    const { scene } = await import(urls.universal);
    const { view } = await import(urls.view);
    const console = document.querySelector('dst-debug-console')!;
    const existing = new Set(scene.children);
    const count = inventory.count('lightbulb');
    console.dispatchEvent(new CustomEvent('game:debug-command', {
      detail: { command: 'c_spawn("flower_cave_double")' },
    }));
    let plant;
    for (let i = 0; i < 300; i++) {
      await new Promise(requestAnimationFrame);
      plant = scene.children.find((object: any) => !existing.has(object)
        && object.userData.prefab === 'flower_cave_double');
      if (plant) break;
    }
    if (!plant) throw new Error('c_spawn did not create the plant');
    // Put the target away from the player's billboard and saved scenery.
    plant.position.copy(view.player.position).add({ x: 12, y: 0, z: 12 });
    plant.position.y = 0;
    await new Promise(requestAnimationFrame);
    (window as any).pickGame = { inventory, scene, view, plant };
    return { count, id: plant.userData.entityId, position: plant.position.toArray() };
  }, urls);
  const point = await page.evaluate(() => {
    const { plant, view } = (window as any).pickGame;
    const mesh = plant.children[0].children[0];
    mesh.updateWorldMatrix(true, false);
    // Active frame vertices only: unused animation-buffer capacity is not artwork.
    const vertices = mesh.geometry.getAttribute('position');
    const points = [];
    for (let i = 0; i < mesh.geometry.drawRange.count / 6 * 4; i++) {
      const vector = plant.position.clone().fromBufferAttribute(vertices, i);
      points.push(mesh.localToWorld(vector));
    }
    const center = points[0].clone().set(0, 0, 0);
    points.forEach(point => center.add(point));
    center.divideScalar(points.length).project(view.camera);
    const bounds = view.renderer.domElement.getBoundingClientRect();
    return { x: bounds.left + (center.x + 1) * bounds.width / 2,
      y: bounds.top + (1 - center.y) * bounds.height / 2 };
  });
  await page.mouse.move(point.x, point.y);
  expect(await page.evaluate(() => (window as any).pickGame.view.mouseActions.getMouseActions().left?.action)).toBe('PICK');
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => page.evaluate(() => (window as any).pickGame.inventory.count('lightbulb'))).toBe(before.count + 2);
  expect(await page.evaluate(() => (window as any).pickGame.plant.userData.tags)).toEqual(['plant']);

  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', {
    detail: { command: 'c_save()' },
  })));
  const download = await downloadPromise;
  const json = await readFile((await download.path())!, 'utf8');
  const restored = await page.evaluate(async ({ json, urls, id }) => {
    const { deserializeSave } = await import(urls['save/deserialize']);
    const { SAVE_CATALOG } = await import(urls['save/catalog']);
    const { inventoryStateFromSave } = await import(urls['save/inventoryState']);
    const saved = deserializeSave(json, SAVE_CATALOG);
    const { inventory, scene, view, plant } = (window as any).pickGame;
    const { BulbPlantManager } = await import(urls.bulbPlant);
    const record = saved.world.entities.flower_cave_double.find((entity: any) => entity.id === id);
    const manager = new BulbPlantManager(scene, '/dst/data/anim', { getLightLevel: () => 1 });
    // Remove the live target to let the restored entity occupy its original position.
    plant.removeFromParent();
    const model = await manager.spawn('flower_cave_double', plant.position, record);
    const liveItemIds = inventory.exportState().slots.filter((slot: any) => slot.itemId === 'lightbulb')
      .map((slot: any) => slot.entityId);
    inventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
    const result = { record, tags: model.userData.tags, canPick: model.userData.components.pickable.canBePicked,
      count: inventory.count('lightbulb'), itemIds: inventory.exportState().slots.filter((slot: any) => slot.itemId === 'lightbulb')
        .map((slot: any) => slot.entityId),
      liveItemIds };
    manager.dispose();
    return result;
  }, { json, urls, id: before.id });
  expect(restored.record.id).toBe(before.id);
  expect(restored.record.transform.position).toEqual(before.position);
  expect(restored.record.components.bulbPlant).toMatchObject({ variant: 'double', picked: true });
  expect(restored.record.components.bulbPlant.regrowSeconds).toBeGreaterThan(2150);
  expect(restored.tags).toEqual(['plant']);
  expect(restored.canPick).toBe(false);
  expect(restored.count).toBe(before.count + 2);
  expect(restored.itemIds).toEqual(restored.liveItemIds);
  expect(errors).toEqual([]);
});
