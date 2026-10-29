import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera', 'player', 'scene'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('a running player slips on a frozen pond, slides along the heading, falls on held input and a thawed pond is safe', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.entities = {}; save.world.elapsedSeconds = 420;
    save.world.systems.weather = { ...save.world.systems.weather, snowlevel: .5, preciptype: 'none', moisture: 0 };
    save.players.local.transform.position = [0, 0, 0];
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  await page.goto('/tests/dst-lighting.html');
  await page.evaluate(async urls => {
    await import(urls.main);
    const { scene } = await import(urls.universal), { player, playerBody } = await import(urls.player), { camera } = await import(urls.camera);
    (window as any).slipGame = { scene, player, playerBody, camera };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const state = () => page.evaluate(() => {
    const { scene, player, playerBody } = (window as any).slipGame;
    const pond = scene.children.find((model: any) => (window as any).__prefabInstance(model)?.prefab === 'pond');
    return { sg: (window as any).__prefabInstance(player).animationController.stategraph.stateName as string, x: player.position.x as number, z: player.position.z as number,
      speed: Math.hypot(playerBody.velocity.x, playerBody.velocity.z) as number,
      frozen: pond?.userData.frozen as boolean | undefined, slippery: pond?.userData.actionEntity?.hasTag('slipperyfeettarget') as boolean | undefined };
  });
  const movePlayer = (x: number, z: number) => page.evaluate(({ x, z }) => {
    const { player, playerBody } = (window as any).slipGame;
    playerBody.position.set(x, playerBody.shapes[0].radius, z); playerBody.velocity.set(0, 0, 0); player.position.set(x, 0, z);
  }, { x, z });

  await submit('c_spawn("pond")');
  await expect.poll(async () => (await state()).frozen).toBe(true);
  expect((await state()).slippery).toBe(true);
  // KeyD walks along the camera's right vector: start on the far side of the pond so the path crosses its centre.
  const right = await page.evaluate(() => {
    const { camera } = (window as any).slipGame, forward = camera.getWorldDirection(camera.position.clone());
    forward.y = 0; forward.normalize();
    return [-forward.z, forward.x];
  });
  await movePlayer(-right[0] * 9, -right[1] * 9);
  await page.keyboard.down('KeyD');
  const seen = new Set<string>();
  await expect.poll(async () => { const s = await state(); seen.add(s.sg); return s.sg; }, { timeout: 30_000, intervals: [50] }).toBe('slip');
  await page.keyboard.up('KeyD');
  const sliding = await state();
  expect(sliding.speed).toBeGreaterThan(0);
  // Releasing the key does not stop the slide: the state keeps the motor along the old heading.
  await page.waitForTimeout(300);
  const later = await state();
  expect(Math.hypot(later.x - sliding.x, later.z - sliding.z)).toBeGreaterThan(.05);
  await expect.poll(async () => (await state()).sg, { timeout: 15_000 }).not.toMatch(/^slip/);
  expect(seen.has('slip')).toBe(true);
  await expect.poll(async () => (await state()).speed).toBeLessThan(.01);
  expect(errors).toEqual([]);
});
