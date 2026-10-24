import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera', 'player'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('chops a moon tree, reloads its stump, and digs it with a shovel, preserving loot and removal through saves', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.entities = { moon_tree: [{ id: 'chop_tree', transform: { position: [0, 0, -6], rotationY: 0 }, components: {} }] };
    save.players.local.transform.position = [0, 0, 0];
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  const prepare = () => page.evaluate(async urls => {
    const main = await import(urls.main), { scene, renderer } = await import(urls.universal);
    const { camera } = await import(urls.camera);
    const { player } = await import(urls.player);
    (window as any).chopGame = { main, scene, renderer, camera, player };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const saveGame = async () => {
    const download = page.waitForEvent('download'); await submit('c_save()');
    return JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  };
  const treeAnimation = () => page.evaluate(() => {
    const tree = (window as any).chopGame.scene.children.find((model: any) => model.userData.prefab === 'moon_tree');
    return tree?.userData.animationController.currentAnimation ?? null;
  });
  const clickTree = async () => {
    const point = await page.evaluate(async () => {
      const { scene, camera, renderer } = (window as any).chopGame;
      const tree = scene.children.find((model: any) => model.userData.prefab === 'moon_tree');
      let mesh: any; tree.traverse((object: any) => { if (!mesh && object.isMesh && object.geometry.index) mesh = object; });
      mesh.updateWorldMatrix(true, false);
      const { Raycaster, Vector2, Vector3 } = await import('/node_modules/.vite/deps/three.js');
      const positions = mesh.geometry.getAttribute('position'), bounds = renderer.domElement.getBoundingClientRect();
      const raycaster = new Raycaster(), pointer = new Vector2();
      const point = new Vector3(), origin = new Vector3(), across = new Vector3(), down = new Vector3();
      // Sample opaque art through the actual sprite raycast, including the shorter stump pose.
      const count = Number.isFinite(mesh.geometry.drawRange.count) ? mesh.geometry.drawRange.count : mesh.geometry.index.count;
      for (let quad = count / 6 - 1; quad >= 0; quad--) {
        origin.fromBufferAttribute(positions, quad * 4);
        across.fromBufferAttribute(positions, quad * 4 + 1).sub(origin);
        down.fromBufferAttribute(positions, quad * 4 + 3).sub(origin);
        for (const v of [.3, .5, .7]) for (const u of [.5, .3, .7]) {
          point.copy(origin).addScaledVector(across, u).addScaledVector(down, v);
          mesh.localToWorld(point); point.project(camera);
          if (Math.abs(point.x) >= .95 || Math.abs(point.y) >= .9) continue;
          pointer.set(point.x, point.y); raycaster.setFromCamera(pointer, camera);
          if (!raycaster.intersectObject(mesh).length) continue;
          return { x: bounds.left + (point.x + 1) * bounds.width / 2, y: bounds.top + (1 - point.y) * bounds.height / 2 };
        }
      }
      throw new Error('No opaque tree pixel is visible');
    });
    await page.mouse.click(point.x, point.y, { button: 'right' });
  };

  await page.goto('/tests/dst-lighting.html?save=initial-world.json'); await prepare();
  await submit('c_give("axe")');
  const bar = page.locator('dst-inventory-bar');
  const hand = bar.locator('.inventory-bar__equipment .inventory-slot').first();
  await bar.locator('.inventory-bar__items [data-item-id="axe"]').dragTo(hand);
  await expect(hand).toHaveAttribute('data-item-id', 'axe');
  await expect.poll(treeAnimation).toBe('sway1_loop_tall');

  // The player walks to the tree; the first strike wears the axe but leaves the tree standing.
  const uses = async () => (await saveGame()).players.local.inventory.containers['player:equipment'].slots[0].item.remainingUses ?? 100;
  await clickTree();
  await expect.poll(uses, { timeout: 20_000 }).toBeLessThan(100);
  expect((await saveGame()).world.entities.moon_tree[0].components).toMatchObject({ moonTree: { size: 'tall' }, growable: { stage: 3 } });

  // Sixteen strikes in total; keep clicking while the tree stands.
  for (let attempt = 0; attempt < 40 && !(await treeAnimation())?.match(/^(fall|stump)/); attempt++) {
    await clickTree(); await page.waitForTimeout(700);
  }
  await expect.poll(treeAnimation, { timeout: 20_000 }).toBe('stump_tall');
  const felled = await saveGame();
  expect(felled.world.entities.moon_tree[0].components).toMatchObject({ moonTree: { stump: true, size: 'tall' }, growable: { stage: 3 } });
  const decay = felled.world.entities.moon_tree[0].components.moonTreeTimer.timers.decay;
  expect(decay.timeleft).toBeGreaterThan(0);
  await expect.poll(async () => (await saveGame()).world.entities.ground_item?.length ?? 0).toBeGreaterThanOrEqual(6);
  const loot = (await saveGame()).world.entities.ground_item.map((record: any) => record.components.stack.itemId);
  expect(loot.filter((itemId: string) => itemId === 'log')).toHaveLength(4);
  expect(loot.filter((itemId: string) => itemId === 'moon_tree_blossom')).toHaveLength(2);

  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: felled }));
  await page.reload(); await prepare();
  await expect.poll(treeAnimation).toBe('stump_tall');
  const reloaded = (await saveGame()).world.entities.moon_tree[0];
  expect(reloaded.components).toMatchObject({ moonTree: { stump: true, size: 'tall' }, growable: { stage: 3 } });
  expect(reloaded.components.moonTreeTimer.timers.decay.initial_time).toBe(decay.initial_time);
  expect(reloaded.components.moonTreeTimer.timers.decay.timeleft).toBeLessThanOrEqual(decay.timeleft);

  await hand.dragTo(bar.locator('.inventory-bar__items .inventory-slot[data-item-id=""]').first());
  await submit('c_give("shovel")');
  await bar.locator('.inventory-bar__items [data-item-id="shovel"]').dragTo(hand);
  await expect(hand).toHaveAttribute('data-item-id', 'shovel');
  await clickTree();
  await expect.poll(treeAnimation, { timeout: 20_000 }).toBeNull();
  await expect.poll(async () => ((await saveGame()).world.entities.ground_item ?? [])
    .filter((record: any) => record.components.stack.itemId === 'log')
    .reduce((total: number, record: any) => total + record.components.stack.count, 0)).toBe(6);
  const dug = await saveGame();
  expect(dug.world.entities.moon_tree ?? []).toEqual([]);
  const savedShovel = dug.players.local.inventory.containers['player:equipment'].slots[0].item;
  expect(savedShovel).toMatchObject({ itemId: 'shovel', remainingUses: 24 });
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: dug }));
  await page.reload(); await prepare();
  await expect.poll(treeAnimation).toBeNull();
  const restored = await saveGame();
  expect(restored.world.entities.moon_tree ?? []).toEqual([]);
  expect(restored.players.local.inventory.containers['player:equipment'].slots[0].item).toEqual(savedShovel);
  expect(restored.world.entities.ground_item.filter((record: any) => record.components.stack.itemId === 'log'))
    .toEqual(dug.world.entities.ground_item.filter((record: any) => record.components.stack.itemId === 'log'));
  expect(errors).toEqual([]);
});
