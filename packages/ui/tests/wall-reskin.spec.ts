import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

test('a c_spawn wall accepts sweeper right-click, retains identity and saves its world skin', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const save = structuredClone(initialWorld) as any;
  save.world.entities = {};
  save.world.map.generator.options.size = 96;
  save.world.map.generator.options.moonTreeCount = 0;
  delete save.world.map.tiles;
  save.players.local.transform.position = [0, 0, 0];
  save.players.local.stats = { health: 150, hunger: 150, sanity: 200 };
  for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
  await page.route('**/saves/initial-world.json', (route) => route.fulfill({ json: save }));
  await page.goto('/tests/dst-lighting.html');
  const urls = Object.fromEntries(['main', 'player', 'universal', 'view'].map((name) =>
    [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  await page.evaluate(async (urls) => {
    const main = await import(urls.main);
    const player = await import(urls.player);
    const { scene } = await import(urls.universal);
    const { view } = await import(urls.view);
    (window as any).wallGame = { main, ...player, scene, view };
    for (const command of ['c_give("reskin_tool")', 'c_spawn("wall_stone_item")']) {
      document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', { detail: { command } }));
    }
  }, urls);
  await expect.poll(() => page.evaluate(() => {
    const game = (window as any).wallGame;
    game.target = game.scene.children.find((model: any) => model.name === 'WallStone');
    return !!game.target;
  })).toBe(true);
  const point = await page.evaluate(async (url) => {
    const { equipmentSlotAddress, inventorySlotAddress } = await import(url);
    const game = (window as any).wallGame;
    const store = game.main.inventory;
    const source = store.exportState().slots.find((entry: any) => entry.item?.itemId === 'reskin_tool');
    if (!store.applySlotChanges([
      { slot: inventorySlotAddress(Number(source.address.slotKey)), itemId: 'reskin_tool', delta: -1 },
      { slot: equipmentSlotAddress('hand'), itemId: 'reskin_tool', delta: 1 },
    ])) throw new Error('Unable to equip sweeper');
    await game.player.userData.animationController.setCarryItem('reskin_tool');
    game.entityId = game.target.userData.entityId;
    game.position = game.target.position.toArray();
    await new Promise(requestAnimationFrame);
    const mesh = game.target.children[0].children[0];
    mesh.geometry.computeBoundingBox();
    const ndc = mesh.geometry.boundingBox.getCenter(game.target.position.clone()).applyMatrix4(mesh.matrixWorld).project(game.view.camera);
    const bounds = game.view.renderer.domElement.getBoundingClientRect();
    return { x: bounds.left + (ndc.x + 1) * bounds.width / 2, y: bounds.top + (1 - ndc.y) * bounds.height / 2 };
  }, `/@fs${fileURLToPath(new URL('../../inventory/src/index.ts', import.meta.url))}`);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).wallGame.target.userData.skinId)).toBe('wall_stone_an');
  const live = await page.evaluate(() => {
    const game = (window as any).wallGame;
    return { sameEntity: game.target.userData.entityId === game.entityId,
      sameXZ: game.target.position.x === game.position[0] && game.target.position.z === game.position[2] };
  });
  expect(live).toEqual({ sameEntity: true, sameXZ: true });
  const download = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command: 'c_save()' } })));
  const stream = await (await download).createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const saved = JSON.parse(Buffer.concat(chunks).toString());
  const { id, x, z } = await page.evaluate(() => {
    const game = (window as any).wallGame;
    return { id: game.entityId, x: game.target.position.x, z: game.target.position.z };
  });
  expect(saved.world.entities.wall_stone).toEqual([{
    id, transform: { position: [x, 0, z], rotationY: 0 }, components: { wall: { skinId: 'wall_stone_an' } },
  }]);
  await page.screenshot({ path: '/tmp/wall-stone-reskin.png' });
  expect(errors).toEqual([]);
});
