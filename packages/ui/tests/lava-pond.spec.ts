import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera', 'player', 'scene'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
const queryUrl = `/@fs${fileURLToPath(new URL('../../prefab/src/actionEntity.ts', import.meta.url))}`;

test('spawns native lava and independent scorched rocks, restores their layout and heat source, and removes the source completely', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.entities = {}; save.world.elapsedSeconds = 420;
    save.players.local.transform.position = [0, 0, 0];
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  const prepare = () => page.evaluate(async ({ urls, queryUrl }) => {
    await import(urls.main);
    const { scene, renderer, dstLighting } = await import(urls.universal), { camera, followCamera } = await import(urls.camera);
    const { player, playerBody } = await import(urls.player), { world } = await import(urls.scene);
    const { FindEntities } = await import(queryUrl);
    (window as any).lavaGame = { scene, renderer, dstLighting, camera, followCamera, player, playerBody, world, FindEntities };
  }, { urls, queryUrl });
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const saveGame = async () => {
    const download = page.waitForEvent('download'); await submit('c_save()');
    return JSON.parse(await readSaveDownload((await (await download).path())!));
  };
  const movePlayer = (x: number, z: number) => page.evaluate(({ x, z }) => {
    const { player, playerBody } = (window as any).lavaGame;
    playerBody.position.set(x, playerBody.shapes[0].radius, z); playerBody.velocity.set(0, 0, 0); player.position.set(x, 0, z);
  }, { x, z });
  const state = () => page.evaluate(() => {
    const { scene, camera, dstLighting, world, FindEntities } = (window as any).lavaGame;
    const model = scene.children.find((model: any) => model.userData.prefab === 'lava_pond');
    if (!model) return null;
    // A display root holds the drawn sprite (art group, then mesh) beside the child rocks.
    const controller = model.userData.lavaPond, drawn = model.children[0], mesh = drawn.children[0].children[0];
    const childRocks = controller.children.map((rock: any) => ({
      prefab: rock.userData.prefab, foot: rock.getWorldPosition(model.position.clone()).toArray(),
      order: rock.children[0].children[0].renderOrder,
      cameraDepth: rock.getWorldPosition(model.position.clone()).applyMatrix4(camera.matrixWorldInverse).z,
      vertices: rock.children[0].children[0].children[0].geometry.drawRange.count,
      build: rock.children[0].userData.animationController.build.name,
    }));
    const heaters = FindEntities(model.position, 30, ['HASHEATER'], ['INLIMBO']);
    const withoutPool = dstLighting.sampleLightLevel(model.position, model);
    return { id: model.userData.entityId, position: model.position.toArray(), clip: model.userData.animationController.currentAnimation,
      vertices: mesh.geometry.drawRange.count, frameVersion: mesh.geometry.getAttribute('uv').version, build: drawn.userData.animationController.build.name,
      flat: drawn.children[0].rotation.x, poolOrder: mesh.renderOrder, childRocks,
      heat: heaters.find((inst: any) => inst.model === model)?.components.heater?.GetHeat(),
      bodyRegistered: world.bodies.includes(model.userData.instance.physicsBody),
      light: dstLighting.sampleLightLevel(model.position), withoutPool };
  });

  await page.goto('/tests/dst-lighting.html'); await prepare();
  await submit('c_spawn("lava_pond")');
  await expect.poll(async () => (await state())?.childRocks.length).toBeGreaterThanOrEqual(2);
  await movePlayer(16, -10); await submit('c_spawn("lava_pond_rock")');
  await movePlayer(22, -10); await submit('c_spawn("lava_pond_rock6")');
  await expect.poll(() => page.evaluate(() => (window as any).lavaGame.scene.children
    .filter((model: any) => model.userData.prefab?.startsWith('lava_pond_rock')).length)).toBe(2);
  await movePlayer(18, 18);
  const initial = (await state())!;
  expect(initial.clip).toBe('bubble_lava'); expect(initial.vertices).toBeGreaterThan(0);
  expect(initial.build).toBe('lava_tile'); expect(initial.flat).toBeCloseTo(-Math.PI / 2);
  expect(initial.poolOrder).toBeLessThan(0); expect(initial.bodyRegistered).toBe(true); expect(initial.heat).toBe(500);
  expect(initial.light).toBeGreaterThan(initial.withoutPool);
  await expect.poll(async () => (await state())?.frameVersion).toBeGreaterThan(initial.frameVersion);
  const sorted = (await state())!.childRocks.sort((a: any, b: any) => a.cameraDepth - b.cameraDepth);
  expect(sorted.every((rock: any) => rock.vertices > 0 && rock.build === 'scorched_rock')).toBe(true);
  for (let i = 1; i < sorted.length; i++) expect(sorted[i].order).toBeGreaterThan(sorted[i - 1].order);
  // Focus the visual review on the pool after checking the normal player camera's sorting.
  await page.evaluate(() => {
    const { scene, followCamera } = (window as any).lavaGame;
    followCamera.setTarget(scene.children.find((model: any) => model.userData.prefab === 'lava_pond')); followCamera.snap();
  });
  await page.screenshot({ path: '/tmp/lava-pond.png' });
  await page.evaluate(() => { const { followCamera, player } = (window as any).lavaGame; followCamera.setTarget(player); followCamera.snap(); });

  const saved = await saveGame();
  expect(saved.world.entities.lava_pond).toHaveLength(1);
  const savedPool = saved.world.entities.lava_pond[0];
  expect(savedPool.id).toBe(initial.id); expect(savedPool.transform.position).toEqual(initial.position);
  expect(savedPool.components.lavaPond.rocks).toHaveLength(initial.childRocks.length);
  expect(Object.keys(savedPool.components)).toEqual(['lavaPond']);
  const baseRock = saved.world.entities.lava_pond_rock[0], numberedRock = saved.world.entities.lava_pond_rock6[0];
  expect(baseRock.transform.position).toEqual([16, 0, -10]); expect(numberedRock.transform.position).toEqual([22, 0, -10]);
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload(); await prepare();
  await expect.poll(async () => (await state())?.childRocks.length).toBe(initial.childRocks.length);
  const restored = await state();
  expect(restored!.id).toBe(initial.id); expect(restored!.heat).toBe(500);
  expect(restored!.childRocks.map((rock: any) => [rock.prefab, rock.foot])).toEqual(initial.childRocks.map(rock => [rock.prefab, rock.foot]));
  const reSaved = await saveGame();
  expect(reSaved.world.entities.lava_pond).toEqual(saved.world.entities.lava_pond);
  expect(reSaved.world.entities.lava_pond_rock).toEqual([baseRock]);
  expect(reSaved.world.entities.lava_pond_rock6).toEqual([numberedRock]);

  expect(await page.evaluate(() => {
    const { scene, world, FindEntities, dstLighting } = (window as any).lavaGame;
    const model = scene.children.find((model: any) => model.userData.prefab === 'lava_pond');
    const body = model.userData.instance.physicsBody, position = model.position.clone();
    const blocked = world.bodies.includes(body);
    model.userData.remove();
    return { blocked, heaters: FindEntities(position, 30, ['HASHEATER']).length,
      body: world.bodies.includes(body), children: model.userData.lavaPond.children.length,
      localLight: dstLighting.sampleLightLevel(position) };
  })).toMatchObject({ blocked: true, heaters: 0, body: false, children: 0 });
  const removed = await saveGame();
  expect(removed.world.entities.lava_pond).toEqual([]);
  expect(removed.world.entities.lava_pond_rock).toEqual([baseRock]);
  expect(removed.world.entities.lava_pond_rock6).toEqual([numberedRock]);
  expect(errors).toEqual([]);
});
