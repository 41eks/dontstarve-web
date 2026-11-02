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
