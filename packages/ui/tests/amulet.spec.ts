import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const urlOf = (path: string) => `/@fs${fileURLToPath(new URL(`../../../${path}`, import.meta.url))}`;

test('a ghost that haunts a red amulet rises from it in amulet_rebirth, which consumes the amulet', async ({ page }) => {
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
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const saveGame = async () => {
    const download = page.waitForEvent('download'); await submit('c_save()');
    return JSON.parse(await readSaveDownload((await (await download).path())!));
  };
  const amulet = () => page.evaluate(() => {
    const model = (window as any).amuletGame.scene.children.find((model: any) => model.userData.itemId === 'amulet');
    return model ? { resurrector: model.userData.actionEntity?.hasTag('resurrector'), hauntable: !!model.userData.components?.hauntable,
      haunted: model.userData.actionEntity?.hasTag('haunted') } : null;
  });
  const player = () => page.evaluate(() => {
    const { player, stats, main } = (window as any).amuletGame, controller = player.userData.animationController;
    return { ghost: controller.isGhost, state: controller.stategraph.stateName, ghostMode: stats.playerGhostMode.peek(),
      invincible: stats.playerStats.health.invincible, penalty: stats.playerStats.health.penalty,
      body: main.inventory.GetEquippedItem('body')?.prefab ?? null, amulets: main.inventory.count('amulet'),
      tags: player.userData.instance.listTags() };
  });

  await page.goto('/tests/dst-lighting.html');
  await page.evaluate(async urls => {
    const main = await import(urls.main), { scene } = await import(urls.universal);
    const { player } = await import(urls.player), stats = await import(urls.playerStats);
    (window as any).amuletGame = { main, scene, player, stats };
  }, { main: urlOf('src/main.ts'), universal: urlOf('src/universal.ts'), player: urlOf('src/player.ts'), playerStats: urlOf('src/playerStats.ts') });
  await page.evaluate(() => (window as any).amuletGame.stats.playerStats.health.set(0));
  await expect.poll(async () => (await player()).ghost, { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => (await player()).state, { timeout: 15_000 }).toBe('idle');

  await expect(page.locator('dst-inventory-bar')).toHaveCSS('display', 'none');
  await submit('c_spawn("amulet")');
  await expect.poll(amulet).toMatchObject({ hauntable: true, resurrector: true });

  // Move the amulet off the ghost, then a real left click on it: HAUNT for a ghost.
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const model = (window as any).amuletGame.scene.children.find((model: any) => model.userData.itemId === 'amulet');
    model.userData.pickupTarget.entity.transform.position.x = 6; model.position.x = 6;
  });
  await page.waitForTimeout(500);
  const click = await page.evaluate(async url => {
    const { view } = await import(url), { scene } = (window as any).amuletGame;
    const model = scene.children.find((model: any) => model.userData.itemId === 'amulet');
    const at = model.position.clone(); at.y = .15;
    const ndc = at.project(view.camera), rect = view.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (ndc.x + 1) / 2 * rect.width, y: rect.top + (1 - ndc.y) / 2 * rect.height };
  }, urlOf('src/view.ts'));
  await page.mouse.move(click.x, click.y);
  await expect.poll(() => page.evaluate(async url => (await import(url)).view.mouseActions.getMouseActions().left?.action, urlOf('src/view.ts'))).toBe('HAUNT');
  await page.mouse.click(click.x, click.y);
  await expect.poll(async () => (await player()).state).toBe('haunt_pre');
  await expect.poll(async () => (await player()).state, { timeout: 20_000 }).toBe('amulet_rebirth');
  // The amulet was worn for the state, then consumed; the player is alive, invincible and without a portal penalty.
  expect(await player()).toMatchObject({ ghost: false, ghostMode: false, invincible: true, penalty: 0, body: null, amulets: 0 });
  expect(await amulet()).toBeNull();
  await expect.poll(async () => (await player()).state, { timeout: 20_000 }).toBe('idle');
  expect(await player()).toMatchObject({ ghost: false, invincible: false, body: null, amulets: 0 });
  expect((await player()).tags).not.toContain('playerghost');
  await expect(page.locator('dst-inventory-bar')).not.toHaveCSS('display', 'none');

  const saved = await saveGame();
  expect(saved.players.local.ghost).toBeFalsy();
  expect(JSON.stringify(saved)).not.toContain('"itemId":"amulet"');
  expect(errors).toEqual([]);
});
