import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera', 'player', 'scene', 'building'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('loads whitelisted cave entities, stops keyboard movement at the void and reloads an exported cave', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const imported = JSON.parse(await readFile(new URL('../../../public/saves/Cluster_1/Caves.json', import.meta.url), 'utf8'));
  page.on('pageerror', error => errors.push(error.message));
  const prepare = () => page.evaluate(async urls => {
    await import(urls.main);
    const modules = Object.fromEntries(await Promise.all(Object.entries(urls).filter(([name]) => name !== 'main')
      .map(async ([name, url]) => [name, await import(url)])));
    (window as any).caveGame = modules;
  }, urls);
  await page.goto('/tests/dst-lighting.html?save=Cluster_1/Caves.json');
  await prepare();
  await expect(page.locator('canvas[data-game-canvas]')).toHaveAttribute('data-loaded', 'true');
  // Sample the two native rendering paths: animated buildings and archive props.
  const samples = ['pighead', 'archive_moon_statue'].map(prefab => imported.world.entities[prefab][0]);
  const rendered = await page.evaluate(samples => {
    const { universal: { scene } } = (window as any).caveGame;
    return samples.map((record: any) => {
      const model = scene.children.find((child: any) => child.userData.entityId === record.id);
      let vertices = 0;
      model?.traverse((child: any) => { vertices += child.geometry?.getAttribute('position')?.count ?? 0; });
      return { id: model?.userData.entityId, vertices };
    });
  }, samples);
  expect(rendered.map(record => record.id)).toEqual(samples.map(record => record.id));
  expect(rendered.every(record => record.vertices > 0)).toBe(true);
  await page.evaluate(heads => {
    const { camera: { followCamera }, player: { player, playerBody } } = (window as any).caveGame;
    const cx = heads.reduce((sum: number, record: any) => sum + record.transform.position[0], 0) / heads.length;
    const cz = heads.reduce((sum: number, record: any) => sum + record.transform.position[2], 0) / heads.length;
    player.position.set(cx + 18, 0, cz + 18);
    playerBody.position.set(player.position.x, playerBody.shapes[0].radius, player.position.z);
    playerBody.velocity.setZero();
    followCamera.snap();
  }, imported.world.entities.pighead);
  await page.screenshot({ path: '/tmp/dst-cave-pighead-alignment.png' });
  const boundary = await page.evaluate(() => {
    const { building: { turfMap, ground }, universal: { scene }, camera: { followCamera }, player: { player, playerBody } } = (window as any).caveGame;
    // Set a cardinal camera so W is an actual negative-X movement request.
    followCamera.setHeadingTarget(0);
    const cell = turfMap.exportTiles().find((tile: any) => tile.tileId === 14 && turfMap.isVoidAtCell(tile.col - 1, tile.row));
    const edge = cell.col * 12, radius = playerBody.shapes[0].radius;
    player.position.set(edge + radius + .2, 0, (cell.row + .5) * 12);
    playerBody.position.set(player.position.x, radius, player.position.z);
    playerBody.velocity.setZero();
    followCamera.snap();
    return { edge, start: player.position.x, groundVisible: ground.material.visible, background: scene.background.getHex() };
  });
  expect(boundary.groundVisible).toBe(false);
  expect(boundary.background).toBe(0);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyW');
  const position = await page.evaluate(() => {
    const { player: { player }, building: { turfMap } } = (window as any).caveGame;
    return { x: player.position.x, passable: turfMap.isPassableAtPoint(player.position) };
  });
  expect(position.passable).toBe(true);
  expect(position.x).toBeGreaterThan(boundary.edge);
  expect(position.x).toBeLessThanOrEqual(boundary.start + .01);
  await page.keyboard.press('KeyM');
  await expect(page.locator('dst-minimap canvas')).toBeVisible();
  await page.keyboard.press('KeyM');
  const download = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', {
    detail: { command: 'c_save()' },
  })));
  const saved = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(saved.world.prefab).toBe('cave');
  expect(saved.world.map.defaultTileId).toBe(1);
  expect(saved.world.map.tiles).toHaveLength(4309);
  for (const prefab of ['pighead', 'archive_moon_statue']) {
    expect(saved.world.entities[prefab]).toEqual(imported.world.entities[prefab]);
  }
  await page.route('**/saves/Cluster_1/Caves.json', route => route.fulfill({ json: saved }));
  await page.reload();
  await prepare();
  await expect(page.locator('canvas[data-game-canvas]')).toHaveAttribute('data-loaded', 'true');
  const restored = await page.evaluate(() => {
    const { building: { turfMap, ground }, player: { player } } = (window as any).caveGame;
    return { tiles: turfMap.exportTiles(), position: player.position.toArray(), groundVisible: ground.material.visible };
  });
  expect(restored.tiles).toEqual(saved.world.map.tiles);
  expect(restored.position[0]).toBeCloseTo(saved.players.local.transform.position[0], 3);
  expect(restored.position[2]).toBeCloseTo(saved.players.local.transform.position[2], 3);
  expect(restored.groundVisible).toBe(false);
  const secondDownload = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', {
    detail: { command: 'c_save()' },
  })));
  const reexported = JSON.parse(await readFile((await (await secondDownload).path())!, 'utf8'));
  for (const prefab of ['pighead', 'archive_moon_statue']) {
    expect(reexported.world.entities[prefab]).toEqual(saved.world.entities[prefab]);
  }
  expect(errors).toEqual([]);
});
