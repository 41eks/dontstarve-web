import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera', 'player'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('spawns a tall deciduous tree, restores growth, chops it and digs the restored stump, preserving loot and removal through saves', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.entities = {};
    save.world.systems.worldtemperature.season = 'summer';
    save.world.systems.worldtemperature.seasontemperature = 70;
    save.players.local.transform.position = [0, 0, 0];
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  const prepare = () => page.evaluate(async urls => {
    const main = await import(urls.main), { scene, renderer } = await import(urls.universal);
    await main.gameReady;
    const { camera } = await import(urls.camera), { player } = await import(urls.player);
    (window as any).deciduoustreeGame = { main, scene, renderer, camera, player };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const saveGame = async () => {
    const download = page.waitForEvent('download', { timeout: 15_000 }); await submit('c_save()');
    return JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  };
  const treeAnimation = () => page.evaluate(() => (window as any).deciduoustreeGame.scene.children
    .find((model: any) => model.name === 'DeciduousForest')?.children.find((model: any) => model.userData.prefab === 'deciduoustree')
    ?.userData.animationController.currentAnimation ?? null);
  const clickTree = async () => {
    const point = await page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      const { scene, camera, renderer } = (window as any).deciduoustreeGame;
      const tree = scene.children.find((model: any) => model.name === 'DeciduousForest').children.find((model: any) => model.userData.prefab === 'deciduoustree');
      const mesh = tree.children[0].children[0].children[0]; mesh.updateWorldMatrix(true, false);
      const { Raycaster, Vector2, Vector3 } = await import('/node_modules/.vite/deps/three.js');
      const positions = mesh.geometry.getAttribute('position'), bounds = renderer.domElement.getBoundingClientRect();
      const raycaster = new Raycaster(), pointer = new Vector2();
      const point = new Vector3(), origin = new Vector3(), across = new Vector3(), down = new Vector3();
      // Shared quads retain transparent margins. Choose an opaque canopy point through the real sprite raycast.
      for (let quad = mesh.geometry.drawRange.count / 6 - 1; quad >= 0; quad--) {
        origin.fromBufferAttribute(positions, quad * 4);
        across.fromBufferAttribute(positions, quad * 4 + 1).sub(origin);
        down.fromBufferAttribute(positions, quad * 4 + 3).sub(origin);
        for (const u of [.5, .3, .7]) for (const v of [.5, .3, .7]) {
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
  const lootCount = (save: any, itemId: string) => save.world.entities.ground_item
    .filter((record: any) => record.components.stack.itemId === itemId)
    .reduce((sum: number, record: any) => sum + record.components.stack.count, 0);
  await page.goto('/tests/dst-lighting.html?save=initial-world.json'); await prepare();
  await submit('c_spawn("deciduoustree_tall"); c_give("axe"); c_give("shovel"); c_give("acorn", 3); c_spawn("acorn")');
  await expect.poll(treeAnimation).toBe('sway1_loop_tall');
  const standing = await saveGame();
  const tree = standing.world.entities.deciduoustree[0];
  expect(tree.components.deciduoustree.leaf_state).toBe('normal');
  expect(tree.transform.position[1]).toBe(0);
  expect(tree.components.growable).toMatchObject({ stage: 3 });
  expect(tree.components.growable.time).toBeGreaterThan(0);
  expect(lootCount(standing, 'acorn')).toBe(1);
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: standing }));
  await page.reload(); await prepare();
  await expect.poll(treeAnimation).toBe('sway1_loop_tall');
  const reloaded = await saveGame();
  expect(reloaded.world.entities.deciduoustree[0]).toMatchObject({ id: tree.id, transform: tree.transform, components: { growable: { stage: 3 } } });
  const bar = page.locator('dst-inventory-bar'), hand = bar.locator('.inventory-bar__equipment .inventory-slot').first();
  await bar.locator('.inventory-bar__items [data-item-id="axe"]').dragTo(hand);
  await expect(hand).toHaveAttribute('data-item-id', 'axe');
  for (let attempt = 0; attempt < 40 && !(await treeAnimation())?.match(/^(fall|stump)/); attempt++) {
    await clickTree(); await page.waitForTimeout(750);
  }
  await expect.poll(treeAnimation, { timeout: 20_000 }).toBe('stump_tall');
  await expect.poll(async () => lootCount(await saveGame(), 'log')).toBe(3);
  const felled = await saveGame();
  expect(felled.world.entities.deciduoustree[0]).toEqual({ ...tree,
    components: { deciduoustree: { ...tree.components.deciduoustree, stump: true }, growable: { stage: 3 } } });
  expect(lootCount(felled, 'acorn')).toBe(2);
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: felled }));
  await page.reload(); await prepare(); await expect.poll(treeAnimation).toBe('stump_tall');
  await hand.dragTo(bar.locator('.inventory-bar__items .inventory-slot[data-item-id=""]').first());
  await bar.locator('.inventory-bar__items [data-item-id="shovel"]').dragTo(hand);
  await expect(hand).toHaveAttribute('data-item-id', 'shovel');
  await clickTree(); await expect.poll(treeAnimation, { timeout: 20_000 }).toBeNull();
  await expect.poll(async () => lootCount(await saveGame(), 'log')).toBe(4);
  await submit('c_spawn("evergreen_short")');
  const dug = await saveGame();
  expect(dug.world.entities.evergreen[0].components.growable.stage).toBe(1);
  expect(dug.world.entities.deciduoustree).toEqual([]);
  const shovel = dug.players.local.inventory.containers['player:equipment'].slots[0].item;
  expect(shovel).toMatchObject({ itemId: 'shovel', remainingUses: 24 });
  const acorns = dug.players.local.inventory.containers['player:inventory'].slots.find((slot: any) => slot.item.itemId === 'acorn').item;
  expect(acorns.count).toBe(3);
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: dug }));
  await page.reload(); await prepare();
  expect(await treeAnimation()).toBeNull();
  const restored = await saveGame();
  expect(restored.world.entities.deciduoustree).toEqual([]);
  expect(restored.world.entities.evergreen[0]).toMatchObject({ id: dug.world.entities.evergreen[0].id, components: { growable: { stage: 1 } } });
  expect(restored.world.entities.ground_item).toEqual(dug.world.entities.ground_item);
  expect(restored.players.local.inventory.containers['player:equipment'].slots[0].item).toEqual(shovel);
  expect(restored.players.local.inventory.containers['player:inventory'].slots.find((slot: any) => slot.item.itemId === 'acorn').item).toEqual(acorns);
  expect(errors).toEqual([]);
});
