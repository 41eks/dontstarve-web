import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('the game unloads distant cave ferns and restores the same entities when the player approaches', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const save = JSON.parse(await readFile(new URL('../../../public/saves/Cluster_1/Caves.json', import.meta.url), 'utf8'));
  const ground = JSON.parse(await readFile(new URL('../../prefab/src/groundTiles.json', import.meta.url), 'utf8'));
  save.world.elapsedSeconds = 0;
  save.world.map.generator.options.size = 768;
  save.world.map.defaultTileId = 1;
  save.world.map.tiles = [];
  for (const center of [0, 25]) for (let row = center - 3; row <= center + 3; row++) {
    for (let col = center - 3; col <= center + 3; col++) save.world.map.tiles.push({ col, row, tileId: ground.GRASS.tileId });
  }
  save.world.entities = {
    cave_fern: [{ id: 'near-fern', transform: { position: [12, 0, 12], rotationY: 0 }, components: { variant: { anim: 'f3' } } }],
    cave_fern_withered: [{ id: 'far-fern', transform: { position: [306, 0, 306], rotationY: 0 }, components: { variant: { anim: 'f7' } } }],
  };
  save.players.local.transform.position = [6, 0, 6];
  for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
  save.players.local.inventory.bufferedBuilds = [];
  await page.route('**/saves/Cluster_1/Caves.json', route => route.fulfill({ json: save }));
  await page.goto('/tests/dst-lighting.html?save=Cluster_1/Caves.json');
  await page.evaluate(async urls => {
    const { scene } = await import(urls.universal);
    const models = new Map<string, any>(), components = new Map<string, unknown>();
    scene.addEventListener('childadded', ({ child }: any) => {
      if (!['near-fern', 'far-fern'].includes(child.userData.entityId)) return;
      models.set(child.userData.entityId, child);
      if (!components.has(child.userData.entityId)) components.set(child.userData.entityId, child.userData.components);
    });
    const { gameReady } = await import(urls.main);
    await gameReady;
    const { player, playerBody } = await import(urls.player);
    (window as any).fernResidency = { scene, models, components, player, playerBody };
  }, Object.fromEntries(['main', 'universal', 'player'].map(name =>
    [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`])));

  const snapshot = () => page.evaluate(() => {
    const { scene, models, components } = (window as any).fernResidency;
    return ['near-fern', 'far-fern'].map(id => {
      const model = models.get(id);
      return { id: model.userData.entityId, loaded: model.userData.animationController.loaded,
        attached: model.parent === scene, pose: model.userData.animationController.currentAnimation,
        position: model.position.toArray(), sameComponents: model.userData.components === components.get(id) };
    });
  });
  await expect.poll(snapshot).toEqual([
    { id: 'near-fern', loaded: true, attached: true, pose: 'f3', position: [12, 0, 12], sameComponents: true },
    { id: 'far-fern', loaded: false, attached: false, pose: 'f7', position: [306, 0, 306], sameComponents: true },
  ]);
  await page.evaluate(() => {
    const { player, playerBody } = (window as any).fernResidency;
    player.position.set(306, 0, 306);
    playerBody.position.set(306, 0, 306);
  });
  await expect.poll(snapshot, { timeout: 20_000 }).toEqual([
    { id: 'near-fern', loaded: false, attached: false, pose: 'f3', position: [12, 0, 12], sameComponents: true },
    { id: 'far-fern', loaded: true, attached: true, pose: 'f7', position: [306, 0, 306], sameComponents: true },
  ]);
  expect(errors).toEqual([]);
});
