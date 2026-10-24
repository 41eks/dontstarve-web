import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera', 'player'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('spawns the static archive props and keeps their identities, positions and poses through c_save and reload', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.entities = {}; save.world.elapsedSeconds = 0;
    save.players.local.transform.position = [0, 0, 0];
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  const prepare = () => page.evaluate(async urls => {
    const main = await import(urls.main), { scene, renderer } = await import(urls.universal);
    const { camera } = await import(urls.camera), { player, playerBody } = await import(urls.player);
    (window as any).archiveGame = { main, scene, renderer, camera, player, playerBody };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const saveGame = async () => {
    const download = page.waitForEvent('download'); await submit('c_save()');
    return JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  };
  const place = (x: number, z: number) => page.evaluate(([x, z]) => {
    const { player, playerBody } = (window as any).archiveGame;
    playerBody.position.set(x, playerBody.shapes[0].radius, z); player.position.set(x, 0, z);
  }, [x, z]).then(() => page.waitForTimeout(300));
  const props = () => page.evaluate(() => (window as any).archiveGame.scene.children
    .filter((model: any) => model.userData.prefab?.startsWith('archive_')).map((model: any) => ({
      prefab: model.userData.prefab, id: model.userData.entityId, x: model.position.x, z: model.position.z })));
  await page.goto('/tests/dst-lighting.html?save=initial-world.json'); await prepare();
  const layout: [string, number, number][] = [['archive_moon_statue', -14, 0], ['archive_rune_statue', -7, 0], ['archive_portal', 0, -24],
    ['archive_switch_base', 22, -24], ['archive_ambient_sfx', 12, 0], ['archive_switch_pad', 30, -24], ['rubble1', 30, 0]];
  for (const [prefab, x, z] of layout) { await place(x, z); await submit(`c_spawn("${prefab}")`); }
  await place(0, 6);
  // The pad persists = false and rubble removes itself, so five props remain (and the pad is on the scene until reload).
  await expect.poll(async () => (await props()).filter(prop => prop.prefab !== 'archive_switch_pad').length).toBe(5);
  const saved = await saveGame();
  expect(Object.keys(saved.world.entities).filter(id => id.startsWith('archive_') || id.startsWith('rubble'))
    .map(id => [id, saved.world.entities[id].length]).filter(([, count]) => count)).toEqual([
    ['archive_moon_statue', 1], ['archive_rune_statue', 1], ['archive_portal', 1], ['archive_switch_base', 1], ['archive_ambient_sfx', 1]]);
  const statue = saved.world.entities.archive_moon_statue[0];
  expect(statue.components.archiveProp.anim).toBeGreaterThanOrEqual(1);

  // Reload from the exported save: identity, position and pose come back.
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload({ waitUntil: 'load' }); await prepare();
  await expect.poll(async () => (await props()).length).toBe(5);
  const restored = await saveGame();
  for (const id of ['archive_moon_statue', 'archive_rune_statue', 'archive_portal', 'archive_switch_base', 'archive_ambient_sfx']) {
    expect(restored.world.entities[id]).toEqual(saved.world.entities[id]);
  }

  expect(errors).toEqual([]);
});
