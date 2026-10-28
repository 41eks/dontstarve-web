import { expect, test } from '@playwright/test';
import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

test('wormhole opens nearby, closes away, accepts sweeper right-click and saves its skin', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const save = structuredClone(initialWorld) as any;
  // Keep this full-game interaction check focused on the wormhole.
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
    (window as any).wormholeGame = { main, ...player, scene, view };
    for (const command of ['c_give("reskin_tool")', 'c_spawn("wormhole")']) {
      document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', { detail: { command } }));
    }
  }, urls);
  await expect.poll(() => page.evaluate(() => {
    const game = (window as any).wormholeGame;
    game.target = game.scene.children.find((model: any) => (window as any).__prefabInstance(model)?.prefab === 'wormhole');
    return game.target?.userData.animationController.currentAnimation;
  })).toBe('open_loop');

  const move = async (distance: number) => page.evaluate((distance) => {
    const game = (window as any).wormholeGame;
    const radius = game.playerBody.shapes[0].radius;
    game.playerBody.position.set(game.target.position.x + distance, radius, game.target.position.z);
    game.player.position.set(game.target.position.x + distance, 0, game.target.position.z);
  }, distance);
  const animation = () => page.evaluate(() => (window as any).wormholeGame.target.userData.animationController.currentAnimation);
  await move(16);
  await expect.poll(animation).toBe('idle_loop');
  await move(11.5);
  await expect.poll(animation).toBe('open_loop');
  await move(13.5);
  await page.waitForTimeout(250);
  expect(await animation()).toBe('open_loop');
  await move(10);

  const point = await page.evaluate(async ({ inventoryUrl, spriteUrl }) => {
    const { equipmentSlotAddress, inventorySlotAddress } = await import(inventoryUrl);
    const { spriteScreenPoint } = await import(spriteUrl);
    const game = (window as any).wormholeGame;
    const store = game.main.inventory;
    const source = store.exportState().slots.find((entry: any) => entry.item?.itemId === 'reskin_tool');
    if (!store.applySlotChanges([
      { slot: inventorySlotAddress(Number(source.address.slotKey)), itemId: 'reskin_tool', delta: -1 },
      { slot: equipmentSlotAddress('hand'), itemId: 'reskin_tool', delta: 1 },
    ])) throw new Error('Unable to equip sweeper');
    await game.player.userData.animationController.setCarryItem('reskin_tool');
    game.entityId = (window as any).__prefabInstance(game.target)?.entityId;
    await new Promise(requestAnimationFrame);
    return spriteScreenPoint(game.target, game.view.camera, game.view.renderer);
  }, {
    inventoryUrl: `/@fs${fileURLToPath(new URL('../../inventory/src/index.ts', import.meta.url))}`,
    spriteUrl: `/@fs${fileURLToPath(new URL('./sprite-screen-point.ts', import.meta.url))}`,
  });
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).__prefabInstance((window as any).wormholeGame.target)?.skinId)).toBe('wormhole_claw');
  expect(await animation()).toBe('open_loop');
  expect(await page.evaluate(() => {
    const game = (window as any).wormholeGame;
    return (window as any).__prefabInstance(game.target)?.entityId === game.entityId && game.target.children[0].children[0].renderOrder === -0.5;
  })).toBe(true);
  const download = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command: 'c_save()' } })));
  const saved = JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  const { id, position } = await page.evaluate(() => {
    const game = (window as any).wormholeGame;
    return { id: game.entityId, position: game.target.position.toArray() };
  });
  expect(saved.world.entities.wormhole).toEqual([{
    id, transform: { position, rotationY: 0 }, components: { wormhole: { skinId: 'wormhole_claw' } },
  }]);
  await page.screenshot({ path: '/tmp/wormhole-open-claw.png' });
  expect(errors).toEqual([]);
});
