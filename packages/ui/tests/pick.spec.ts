import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { useInteractionSave } from './interactionSave';

for (const harvest of [
  { prefab: 'flower_cave_double', item: 'lightbulb', count: 2, regrow: 2160, component: 'bulbPlant',
    tags: ['plant'] },
  { prefab: 'grass', item: 'cutgrass', count: 1, regrow: 1080, component: 'pickable',
    tags: ['plant', 'renewable', 'silviculture', 'lunarplant_target', 'canlight'] },
]) {
  test(`c_spawn ${harvest.prefab} uses shared PICK input and c_save preserves its harvest and regeneration`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await useInteractionSave(page);
    await page.goto('/tests/dst-lighting.html');
    const urls = Object.fromEntries(['main', 'universal', 'view', 'save/deserialize', 'save/catalog',
      'save/inventoryState'].map(name =>
      [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
    urls.bulbPlant = `/@fs${fileURLToPath(new URL('../../prefab/src/bulb_plant.ts', import.meta.url))}`;
    urls.grass = `/@fs${fileURLToPath(new URL('../../prefab/src/grass.ts', import.meta.url))}`;
    urls.groundItems = `/@fs${fileURLToPath(new URL('../../../src/groundItems.ts', import.meta.url))}`;
    const before = await page.evaluate(async ({ urls, harvest }) => {
      const { inventory } = await import(urls.main);
      const { scene } = await import(urls.universal);
      const { view } = await import(urls.view);
      const console = document.querySelector('dst-debug-console')!;
      const existing = new Set(scene.children);
      if (harvest.prefab === 'grass') {
        const initialCount = inventory.count(harvest.item);
        console.dispatchEvent(new CustomEvent('game:debug-command', { detail: { command: 'c_give("cutgrass", 2)' } }));
        if (inventory.count(harvest.item) !== initialCount + 2) throw new Error('c_give did not give cutgrass');
      }
      const count = inventory.count(harvest.item);
      console.dispatchEvent(new CustomEvent('game:debug-command', {
        detail: { command: `c_spawn("${harvest.prefab}")` },
      }));
      let plant;
      for (let i = 0; i < 300; i++) {
        await new Promise(requestAnimationFrame);
        plant = scene.children.find((object: any) => !existing.has(object)
          && object.userData.prefab === harvest.prefab);
        if (plant) break;
      }
      if (!plant) throw new Error('c_spawn did not create the plant');
      // Put the target away from the player's billboard and saved scenery.
      plant.position.copy(view.player.position).add({ x: 12, y: 0, z: 12 });
      plant.position.y = 0;
      await new Promise(requestAnimationFrame);
      (window as any).pickGame = { inventory, scene, view, plant };
      return { count, id: plant.userData.entityId, position: plant.position.toArray() };
    }, { urls, harvest });
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
    const hover = await page.evaluate(() => {
      const { plant, view } = (window as any).pickGame;
      const action = view.mouseActions.getMouseActions().left?.action;
      const target = view.mouseActions.targetModel;
      return { action, target: target?.userData.prefab ?? target?.name,
        tags: plant.userData.tags, active: plant.userData.actionEntity?.hasTag('tickingarea'),
        pickable: plant.userData.actionEntity?.hasTag('pickable'),
        canPick: plant.userData.components.pickable.canBePicked };
    });
    expect(hover.action, JSON.stringify(hover)).toBe('PICK');
    await expect.poll(() => page.evaluate(() => (window as any).pickGame.view.player.userData.stategraph.stateName)).toBe('idle');
    await page.mouse.click(point.x, point.y);
    // Walk-to + dolongaction: the harvest must not complete on the click frame.
    await page.evaluate(() => new Promise(requestAnimationFrame));
    expect(await page.evaluate(item => (window as any).pickGame.inventory.count(item), harvest.item)).toBe(before.count);
    await expect.poll(() => page.evaluate(item => (window as any).pickGame.inventory.count(item), harvest.item),
      { timeout: 15_000 }).toBe(before.count + harvest.count);
    expect(new Set(await page.evaluate(() => (window as any).pickGame.plant.userData.tags))).toEqual(new Set([...harvest.tags, 'tickingarea']));

    const downloadPromise = page.waitForEvent('download');
    await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', {
      detail: { command: 'c_save()' },
    })));
    const download = await downloadPromise;
    const json = await readSaveDownload((await download.path())!);
    const restored = await page.evaluate(async ({ json, urls, id, harvest }) => {
      const { deserializeSave } = await import(urls['save/deserialize']);
      const { SAVE_CATALOG } = await import(urls['save/catalog']);
      const { inventoryStateFromSave } = await import(urls['save/inventoryState']);
      const saved = deserializeSave(json, SAVE_CATALOG);
      const { inventory, scene, view, plant } = (window as any).pickGame;
      const { BulbPlantManager } = await import(urls.bulbPlant);
      const record = saved.world.entities[harvest.prefab].find((entity: any) => entity.id === id);
      const { GrassManager } = await import(urls.grass);
      const { GroundItemManager } = await import(urls.groundItems);
      const output = harvest.prefab === 'grass' ? new GroundItemManager(scene, view.camera, view.renderer,
        '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', view.player) : undefined;
      const manager = harvest.prefab === 'grass' ? new GrassManager(scene, '/dst/data/anim', {
        prepareSpawn: (definition: any, fling: boolean) => output!.prepareSpawn(definition, fling),
      })
        : new BulbPlantManager(scene, '/dst/data/anim', { getLightLevel: () => 1 });
      // Remove the live target to let the restored entity occupy its original position.
      plant.removeFromParent();
      const model = await (harvest.prefab === 'grass' ? manager.spawn(plant.position, record)
        : manager.spawn('flower_cave_double', plant.position, record));
      const liveItemIds = inventory.exportState().slots.filter((slot: any) => slot.item?.itemId === harvest.item)
        .map((slot: any) => slot.item.entityId);
      inventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
      const result = { record, tags: model.userData.tags, canPick: model.userData.components.pickable.canBePicked,
        count: inventory.count(harvest.item), itemIds: inventory.exportState().slots.filter((slot: any) => slot.item?.itemId === harvest.item)
          .map((slot: any) => slot.item.entityId),
        liveItemIds };
      manager.dispose();
      output?.dispose();
      return result;
    }, { json, urls, id: before.id, harvest });
    expect(restored.record.id).toBe(before.id);
    expect(restored.record.transform.position).toEqual(before.position);
    expect(restored.record.components[harvest.component]).toMatchObject({ picked: true });
    expect(restored.record.components[harvest.component].regrowSeconds).toBeGreaterThan(harvest.regrow - 20);
    expect(new Set(restored.tags)).toEqual(new Set([...harvest.tags, 'tickingarea']));
    expect(restored.canPick).toBe(false);
    expect(restored.count).toBe(before.count + harvest.count);
    expect(restored.itemIds).toEqual(restored.liveItemIds);
    expect(errors).toEqual([]);
  });

}
