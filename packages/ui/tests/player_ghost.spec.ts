import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'player', 'playerStats'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('death leaves a skeleton, becomes a ghost, and a saved ghost resumes without a second skeleton', async ({ page }) => {
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
    const main = await import(urls.main), { scene } = await import(urls.universal);
    const { player } = await import(urls.player), stats = await import(urls.playerStats);
    (window as any).ghostGame = { main, scene, player, stats };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const saveGame = async () => {
    const download = page.waitForEvent('download'); await submit('c_save()');
    return JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  };
  const player = () => page.evaluate(() => {
    const { player, stats } = (window as any).ghostGame, controller = player.userData.animationController;
    return { ghost: controller.isGhost, state: controller.stategraph.stateName, ghostMode: stats.playerGhostMode.peek(),
      health: stats.playerStats.health.peek(), tagged: player.userData.tags.includes('playerghost') };
  });
  const skeletons = () => page.evaluate(() => (window as any).ghostGame.scene.children
    .filter((model: any) => model.userData.prefab === 'skeleton_player').map((model: any) => ({ id: model.userData.entityId, ...model.userData.skeleton })));

  await page.goto('/tests/dst-lighting.html?save=initial-world.json'); await prepare();
  expect(await player()).toMatchObject({ ghost: false, ghostMode: false, tagged: false });
  await page.evaluate(() => (window as any).ghostGame.stats.playerStats.health.set(0));
  await expect.poll(async () => (await player()).state).toBe('death');
  // The death clip ends, then OnMakePlayerGhost swaps in the ghost and leaves the skeleton where the player fell.
  await expect.poll(async () => (await player()).ghost, { timeout: 30_000 }).toBe(true);
  expect(await player()).toMatchObject({ ghostMode: true, health: 50, tagged: true });
  await expect.poll(async () => (await skeletons()).length).toBe(1);
  expect((await skeletons())[0]).toMatchObject({ char: 'wortox', cause: 'unknown' });
  await expect.poll(async () => (await player()).state, { timeout: 15_000 }).toBe('idle');

  const saved = await saveGame();
  expect(saved.players.local.ghost).toBe(true);
  expect(saved.players.local.stats.health).toBe(50);
  expect(saved.world.entities.skeleton_player).toHaveLength(1);

  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload({ waitUntil: 'load' }); await prepare();
  await expect.poll(async () => (await player()).ghost, { timeout: 30_000 }).toBe(true);
  // loading_ghost skips the appear animation and the skeleton/die_fx.
  expect(await player()).toMatchObject({ ghostMode: true, health: 50, state: 'idle' });
  await page.waitForTimeout(500);
  expect(await skeletons()).toHaveLength(1);
  expect((await saveGame()).world.entities.skeleton_player).toEqual(saved.world.entities.skeleton_player);
  expect(errors).toEqual([]);
});

test('a ghost that haunts the multiplayer portal is resurrected there with a health penalty', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.entities = { multiplayer_portal_moonrock: [{ id: 'portal-1', transform: { position: [12, 0, 0], rotationY: 0 }, components: {} }] };
    save.world.elapsedSeconds = 0;
    save.players.local.transform.position = [0, 0, 0];
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  const urlOf = (path: string) => `/@fs${fileURLToPath(new URL(`../../../${path}`, import.meta.url))}`;
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const player = () => page.evaluate(() => {
    const { player, stats } = (window as any).ghostGame, controller = player.userData.animationController;
    const portal = (window as any).ghostGame.scene.children.find((model: any) => model.userData.prefab === 'multiplayer_portal_moonrock');
    return { ghost: controller.isGhost, state: controller.stategraph.stateName, ghostMode: stats.playerGhostMode.peek(),
      health: stats.playerStats.health.peek(), penalty: stats.playerStats.health.penalty, invincible: stats.playerStats.health.invincible,
      visible: player.visible && player.children.every((child: any) => child.visible), x: Math.round(player.position.x * 10) / 10,
      slippery: !!player.userData.slipperyfeet, tags: player.userData.tags, portalTags: portal.userData.tags, hauntable: !!portal.userData.components.hauntable };
  });

  await page.goto('/tests/dst-lighting.html?save=initial-world.json');
  await page.evaluate(async urls => {
    const main = await import(urls.main), { scene } = await import(urls.universal);
    const { player } = await import(urls.player), stats = await import(urls.playerStats);
    const { BufferedAction } = await import(urls.bufferedaction);
    (window as any).ghostGame = { main, scene, player, stats, BufferedAction };
  }, { main: urlOf('src/main.ts'), universal: urlOf('src/universal.ts'), player: urlOf('src/player.ts'), playerStats: urlOf('src/playerStats.ts'),
    bufferedaction: urlOf('packages/stategraphs/src/bufferedaction.ts') });
  // portal_rez setting on: the portal is hauntable and a resurrector.
  expect(await player()).toMatchObject({ ghost: false, hauntable: true, slippery: true });
  expect((await player()).portalTags).toEqual(expect.arrayContaining(['multiplayer_portal', 'resurrector']));
  await page.evaluate(() => (window as any).ghostGame.stats.playerStats.health.set(0));
  await expect.poll(async () => (await player()).ghost, { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => (await player()).state, { timeout: 15_000 }).toBe('idle');
  // The slipperyfeet component follows health and ghost mode: gone while a ghost.
  expect(await player()).toMatchObject({ slippery: false });

  // A real left click on the portal: the death state disabled the controller and OnMakePlayerGhost enables it again.
  // Aim at a solid pixel left of the portal's transparent centre.
  const click = await page.evaluate(async url => {
    const { view } = await import(url), { scene } = (window as any).ghostGame;
    const portal = scene.children.find((model: any) => model.userData.prefab === 'multiplayer_portal_moonrock');
    const at = portal.position.clone(); at.y = 1.5;
    const ndc = at.project(view.camera), rect = view.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (ndc.x + 1) / 2 * rect.width - 60, y: rect.top + (1 - ndc.y) / 2 * rect.height };
  }, urlOf('src/view.ts'));
  await page.mouse.move(click.x, click.y);
  await expect.poll(() => page.evaluate(async url => (await import(url)).view.mouseActions.getMouseActions().left?.action, urlOf('src/view.ts'))).toBe('HAUNT');
  await page.mouse.click(click.x, click.y);
  await expect.poll(async () => (await player()).state).toBe('haunt_pre');
  // The portal is now haunted (no second haunt), and the player is hidden and moved to it.
  await expect.poll(async () => (await player()).portalTags).toContain('haunted');
  await expect.poll(async () => (await player()).x, { timeout: 10_000 }).toBeGreaterThan(8);
  await expect.poll(async () => (await player()).state, { timeout: 15_000 }).toBe('portal_rez');
  expect(await player()).toMatchObject({ ghost: false, ghostMode: false, penalty: .25, invincible: true });
  await expect.poll(async () => (await player()).state, { timeout: 15_000 }).toBe('idle');
  expect(await player()).toMatchObject({ ghost: false, invincible: false, visible: true, health: 50, slippery: true });
  expect((await player()).tags).not.toContain('playerghost');
  // The haunt cooldown (HAUNT_COOLDOWN_MEDIUM) lapses on the game clock.
  await expect.poll(async () => (await player()).portalTags, { timeout: 15_000 }).not.toContain('haunted');

  const download = page.waitForEvent('download'); await submit('c_save()');
  const saved = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(saved.players.local.ghost).toBeFalsy();
  expect(saved.players.local.stats).toMatchObject({ health: 50, penalty: .25 });
  expect(errors).toEqual([]);
});
