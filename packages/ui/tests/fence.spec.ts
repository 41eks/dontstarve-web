import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

test('fence_item previews against the camera, places by click, rotates with the camera and saves with c_spawn/c_give variants', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const save = structuredClone(initialWorld) as any;
  save.world.entities = {};
  save.world.map.generator.options.size = 96;
  save.world.map.generator.options.moonTreeCount = 0;
  delete save.world.map.tiles;
  save.players.local.transform.position = [0, 0, 0];
  for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
  let currentSave = save;
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: currentSave }));
  await page.goto('/tests/dst-lighting.html?save=initial-world.json');
  const urls = Object.fromEntries(['main', 'player', 'universal', 'view'].map(name =>
    [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  await page.evaluate(async urls => {
    const main = await import(urls.main), player = await import(urls.player);
    const { scene } = await import(urls.universal), { view } = await import(urls.view);
    (window as any).fenceGame = { main, ...player, scene, view };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const fences = () => page.evaluate(() => (window as any).fenceGame.scene.children
    .filter((model: any) => model.name === 'fence').map((model: any) => ({
      x: model.position.x, z: model.position.z, rotation: model.userData.fenceRotation, visible: model.visible,
      placed: !!model.userData.actionEntity })));
  const ground = (x: number, z: number) => page.evaluate(([x, z]) => {
    const { view, player } = (window as any).fenceGame;
    const point = player.position.clone().set(x, 0, z).project(view.camera), rect = view.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  }, [x, z]);

  await submit('c_give("fence_item", 3)');
  const slot = page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="fence_item"]');
  await expect(slot).toBeVisible();
  await slot.click();
  const target = await ground(12, 12);
  await page.mouse.move(target.x, target.y);
  await expect.poll(async () => (await fences()).length).toBe(1);
  const preview = (await fences())[0];
  // The placer rotates against the camera: heading 45 gives -45 (an odd enum, the wide bank).
  expect(preview).toMatchObject({ rotation: -45, visible: true, placed: false });
  await page.mouse.click(target.x, target.y);
  await expect.poll(async () => (await fences()).filter(fence => fence.placed).length).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).fenceGame.main.inventory.count('fence_item'))).toBe(2);
  const [placed] = (await fences()).filter(fence => fence.placed);
  expect(placed.rotation).toBe(-45);

  // Orbiting the camera re-faces the fence without changing its saved rotation.
  await page.keyboard.press('KeyQ');
  await page.waitForTimeout(600);
  expect((await fences()).filter(fence => fence.placed)[0].rotation).toBe(-45);

  // c_spawn("fence") places a world fence (rotation 0); c_spawn("fence_item") drops an ordinary item.
  await submit('c_spawn("fence"); c_spawn("fence_item")');
  await expect.poll(async () => (await fences()).filter(fence => fence.placed).length).toBe(2);
  const download = page.waitForEvent('download');
  await submit('c_save()');
  const saved = JSON.parse(await readSaveDownload(await (await download).path(), 'Master'));
  expect(saved.world.entities.fence.map((fence: any) => fence.components.fence)).toEqual([{ rot: 7 }, {}]);
  expect(saved.world.entities.ground_item.map((item: any) => item.components.stack)).toEqual([{ itemId: 'fence_item', count: 1 }]);
  const held = Object.values(saved.players.local.inventory.containers).flatMap((container: any) => container.slots)
    .find((slot: any) => slot.item?.itemId === 'fence_item');
  expect(held.item.count).toBe(2);
  currentSave = saved;
  await page.reload();
  await page.evaluate(async urls => {
    const main = await import(urls.main), player = await import(urls.player);
    const { scene } = await import(urls.universal), { view } = await import(urls.view);
    (window as any).fenceGame = { main, ...player, scene, view };
  }, urls);
  const restored = await page.evaluate(() => (window as any).fenceGame.scene.children
    .filter((model: any) => model.userData.actionEntity?.prefab === 'fence').map((model: any) => ({
      id: model.userData.entityId, position: model.position.toArray(), rot: ((Math.floor(model.userData.fenceRotation / 45) % 8) + 8) % 8,
    })));
  expect(restored).toEqual(saved.world.entities.fence.map((fence: any) => ({
    id: fence.id, position: fence.transform.position, rot: fence.components.fence.rot ?? 0,
  })));
  expect(errors).toEqual([]);
});
