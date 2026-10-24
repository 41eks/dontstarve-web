import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera', 'player'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('cooks, reloads and harvests food with player input, preserving the empty pot and product', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.entities = {};
    save.players.local.transform.position = [0, 0, 0];
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  const prepare = () => page.evaluate(async urls => {
    const main = await import(urls.main), { scene, renderer } = await import(urls.universal);
    const { camera } = await import(urls.camera);
    const { player } = await import(urls.player);
    (window as any).potGame = { main, scene, renderer, camera, player };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const state = () => page.evaluate(() => {
    const pot = (window as any).potGame.scene.children.find((model: any) => model.name === 'CookPot');
    return pot ? { id: pot.userData.entityId, stewer: pot.userData.stewer ?? null,
      animation: pot.userData.animationController.currentAnimation } : null;
  });
  const saveGame = async () => {
    const download = page.waitForEvent('download'); await submit('c_save()');
    return JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  };
  await page.goto('/tests/dst-lighting.html'); await prepare();
  await submit('c_spawn("cookpot")');
  await expect.poll(state).not.toBeNull();
  await submit('c_give("twigs", 1)');
  await submit('c_give("red_cap", 3)');
  await page.keyboard.down('w');
  await expect.poll(() => page.evaluate(() => {
    const { scene, player } = (window as any).potGame;
    const pot = scene.children.find((model: any) => model.name === 'CookPot');
    return Math.hypot(pot.position.x - player.position.x, pot.position.z - player.position.z);
  })).toBeLessThan(8);
  await page.keyboard.up('w');
  // Click the actual world sprite, using its current camera projection.
  const potPoint = () => page.evaluate(() => {
    const { scene, camera, renderer } = (window as any).potGame;
    const pot = scene.children.find((model: any) => model.name === 'CookPot');
    const mesh = pot.children[0].children[0];
    mesh.geometry.computeBoundingBox();
    const centre = mesh.geometry.boundingBox.getCenter(pot.position.clone());
    mesh.localToWorld(centre).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (centre.x + 1) * rect.width / 2, y: rect.top + (1 - centre.y) * rect.height / 2 };
  });
  const point = await potPoint();
  await page.mouse.click(point.x, point.y);
  const panel = page.locator('dst-cook-pot-panel');
  const button = panel.getByRole('button', { name: '烹饪', exact: true });
  await expect(button).toBeVisible();
  await expect(button).toBeDisabled();
  for (const [index, itemId] of ['twigs', 'red_cap', 'red_cap', 'red_cap'].entries()) {
    // Picking up a stack moves it into the authoritative cursor; subsequent
    // single-item placements use its remaining contents without picking up again.
    if (index < 2) await page.locator(`dst-inventory-bar .inventory-bar__items [data-item-id="${itemId}"]`).click();
    await panel.locator(`[data-slot-key="${index}"]`).click();
    await expect(panel.locator(`[data-slot-key="${index}"]`)).toHaveAttribute('data-item-id', itemId);
    if (index < 3) await expect(button).toBeDisabled();
  }
  await expect(button).toBeEnabled();
  await button.click();
  await expect(panel.locator('.inventory-slot')).toHaveCount(0);
  await expect.poll(async () => (await state())?.animation).toBe('cooking_loop');
  const cooking = await saveGame();
  const record = cooking.world.entities.cookpot[0];
  expect(record.components.stewer).toMatchObject({ product: 'beefalofeed', phase: 'cooking' });
  expect(record.components.stewer.remainingSeconds).toBeGreaterThan(0);
  expect(record.components.container.slots).toEqual([]);
  expect(cooking.players.local.inventory.containers['player:inventory'].slots).toEqual([]);
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: cooking }));
  await page.reload(); await prepare();
  expect((await state())?.id).toBe(record.id);
  await expect.poll(async () => (await state())?.animation, { timeout: 25_000 }).toBe('idle_full');
  const finished = await saveGame();
  expect(finished.world.entities.cookpot[0]).toEqual({ ...record, components: { ...record.components,
    stewer: { ...record.components.stewer, phase: 'done', remainingSeconds: 0 } } });
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: finished }));
  await page.reload(); await prepare();
  expect(await state()).toEqual({ id: record.id, animation: 'idle_full',
    stewer: { ...record.components.stewer, phase: 'done', remainingSeconds: 0 } });
  const playerState = () => page.evaluate(() => (window as any).potGame.player.userData.animationController.stategraph.stateName);
  const clickPot = async () => { const point = await potPoint(); await page.mouse.click(point.x, point.y); };
  await clickPot();
  await expect.poll(playerState).toBe('dolongaction');
  await page.keyboard.press('Escape');
  await expect.poll(playerState).toBe('idle');
  expect((await state())?.stewer?.phase).toBe('done');
  await clickPot();
  await expect.poll(async () => (await state())?.animation).toBe('idle_empty');
  await expect(page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="beefalofeed"]')).toBeVisible();
  const harvested = await saveGame();
  const emptyPot = harvested.world.entities.cookpot[0];
  expect(emptyPot.id).toBe(record.id);
  expect(emptyPot.transform).toEqual(record.transform);
  expect(emptyPot.components.stewer).toBeUndefined();
  const product = harvested.players.local.inventory.containers['player:inventory'].slots[0].item;
  expect(product).toMatchObject({ itemId: 'beefalofeed', count: 1 });
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: harvested }));
  await page.reload(); await prepare();
  expect((await state())?.stewer).toBeNull();
  const reloaded = await saveGame();
  expect(reloaded.world.entities.cookpot[0]).toEqual(emptyPot);
  expect(reloaded.players.local.inventory.containers['player:inventory'].slots[0].item).toEqual(product);
  await clickPot();
  await expect(button).toBeVisible();
  await expect(button).toBeDisabled();

  // Reload the same finished pot with a full inventory; GiveItem must keep
  // the output in the world, and the immediate save must already contain it.
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: finished }));
  await page.reload(); await prepare();
  await submit('c_give("log", 300)');
  await expect(page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="log"]')).toHaveCount(15);
  await clickPot();
  await expect.poll(async () => (await state())?.animation).toBe('idle_empty');
  const overflow = await saveGame();
  expect(overflow.world.entities.ground_item).toHaveLength(1);
  const dropped = overflow.world.entities.ground_item[0];
  expect(dropped.components.stack).toMatchObject({ itemId: 'beefalofeed', count: 1 });
  expect(Math.hypot(dropped.transform.position[0] - overflow.players.local.transform.position[0],
    dropped.transform.position[2] - overflow.players.local.transform.position[2])).toBeLessThan(.1);
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: overflow }));
  await page.reload(); await prepare();
  expect((await saveGame()).world.entities.ground_item[0]).toEqual(dropped);
  expect(errors).toEqual([]);
});
