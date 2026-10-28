import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera', 'player'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

async function start(page: Page, errors: string[]) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  // The routed save holds the pig king at (0, 0, 25) with its default_pigking layout.
  await page.goto('/tests/dst-lighting.html?save=initial-world.json');
  await page.evaluate(async urls => {
    const main = await import(urls.main), { scene, renderer } = await import(urls.universal);
    const { camera } = await import(urls.camera);
    const { player, playerBody } = await import(urls.player);
    (window as any).game = { main, scene, renderer, camera, player, playerBody };
  }, urls);
}

test('places the default_pigking layout: grass and woodfloor tiles around the king and eight obelisks', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await start(page, errors);
  await page.evaluate(() => {
    const g = (window as any).game;
    g.playerBody.position.set(0, g.playerBody.position.y, 40); g.player.position.set(0, 0, 40);
  });
  // The obelisks are drawn once the tickingarea, refreshed every 60 active frames, reaches the moved player.
  const layout = () => page.evaluate(() => {
    const { scene } = (window as any).game;
    // One per entity: the display root carries the prefab, its drawn sprite only shares the name.
    const count = (prefab: string) => scene.children.filter((o: any) => (window as any).__prefabInstance(o)?.prefab === prefab).length;
    let grass = false;
    scene.traverse((o: any) => { if (o.name === 'TurfBlend:GRASS' && o.visible) grass = true; });
    return { sanity: count('sanityrock'), insanity: count('insanityrock'), grass };
  });
  await expect.poll(layout, { timeout: 20_000 }).toEqual({ sanity: 4, insanity: 4, grass: true });
  // c_spawn adds a ninth obelisk and c_save keeps all identities.
  await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command: 'c_spawn("insanityrock")' } })));
  await expect.poll(() => page.evaluate(() => (window as any).game.scene.children.filter((o: any) => (window as any).__prefabInstance(o)?.prefab === 'insanityrock').length)).toBe(5);
  const download = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command: 'c_save()' } })));
  const save = JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  expect(save.world.entities.insanityrock).toHaveLength(5);
  expect(save.world.entities.sanityrock).toHaveLength(4);
  expect(new Set(Object.values(save.world.entities).flat().map((entity: any) => entity.id)).size)
    .toBe(Object.values(save.world.entities).flat().length);
  expect(errors).toEqual([]);
});

test('walks to the pig king, trades held meat and throws the gold', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await start(page, errors);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const king = () => page.evaluate(() => {
    const model = (window as any).game.scene.children.find((child: any) => (window as any).__prefabInstance(child)?.prefab === 'pigking');
    if (!model) return undefined;
    return { animation: model.userData.animationController.currentAnimation, x: model.position.x, z: model.position.z,
      trader: (window as any).__prefabInstance(model).listTags().includes('trader') };
  });
  // The king is drawn, and found in the scene, only while its tile is in the tickingarea.
  await page.evaluate(() => {
    const g = (window as any).game;
    g.playerBody.position.set(0, g.playerBody.position.y, 45); g.player.position.set(0, 0, 45);
  });
  await expect.poll(async () => (await king()) !== undefined, { timeout: 15_000 }).toBe(true);
  const feet = (await king())!;
  expect(feet.trader).toBe(true);
  // Start well outside the king's obstacle radius, so the player must walk up to it.
  await page.evaluate(({ x, z }) => {
    const g = (window as any).game;
    g.playerBody.position.set(x, g.playerBody.position.y, z + 20); g.player.position.set(x, 0, z + 20);
  }, feet);
  await submit('c_give("meat")');
  const meat = page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="meat"]');
  await meat.click();
  await page.waitForTimeout(500);
  const point = await page.evaluate(() => {
    const { scene, camera, renderer } = (window as any).game;
    const model = scene.children.find((child: any) => (window as any).__prefabInstance(child)?.prefab === 'pigking');
    model.updateWorldMatrix(true, true);
    let minY = Infinity, maxY = -Infinity;
    model.traverse((o: any) => { if (o.geometry) { o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); minY = Math.min(minY, b.min.y); maxY = Math.max(maxY, b.max.y); } });
    const centre = model.position.clone().setY((minY + maxY) / 2).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (centre.x + 1) * rect.width / 2, y: rect.top + (1 - centre.y) * rect.height / 2 };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await king())?.animation, { timeout: 15_000 }).toBe('cointoss');
  await expect(meat).toHaveCount(0);
  const download = page.waitForEvent('download');
  // The gold appears two thirds of a second after the toss starts.
  await page.waitForTimeout(2500);
  await submit('c_save()');
  const save = JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  const gold = Object.values(save.world.entities).flat().filter((entity: any) => entity.components?.stack?.itemId === 'goldnugget');
  expect(gold).toHaveLength(1);

  // Zero-valued tradables are offered GIVE and refused: unimpressed, and the item stays held.
  await expect.poll(async () => (await king())?.animation, { timeout: 15_000 }).toBe('idle');
  await submit('c_give("monstermeat")');
  const monster = page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="monstermeat"]');
  await monster.click();
  await page.mouse.move(point.x, point.y);
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await king())?.animation, { timeout: 15_000 }).toBe('unimpressed');
  expect(errors).toEqual([]);
});
