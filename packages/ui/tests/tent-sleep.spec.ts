import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const modules = Object.fromEntries(['main', 'player', 'universal', 'camera', 'playerStats'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

// Cycle 12 starts at 5760 s; its night segments begin 420 s in and last 60 s.
const NIGHT = 12 * 480 + 425;
const DAY = 12 * 480 + 100;

async function load(page: Page, elapsedSeconds: number, save?: unknown) {
  // Copied from public/saves/initial-world copy.json; the clock and stats are set for the scenario.
  const world = save ?? JSON.parse(await readFile(new URL('./tent-world.json', import.meta.url), 'utf8'));
  if (!save) {
    world.world.elapsedSeconds = elapsedSeconds;
    world.players.local.stats = { health: 100, hunger: 120, sanity: 100 };
  }
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: world }));
  await page.goto('/tests/dst-lighting.html');
  await page.evaluate(async paths => {
    const main = await import(paths.main), { player } = await import(paths.player);
    const { scene } = await import(paths.universal), { camera } = await import(paths.camera);
    const { playerStats } = await import(paths.playerStats);
    (window as any).tentGame = { main, player, scene, camera, stats: playerStats };
  }, modules);
}

const helpers = (page: Page) => ({
  submit: (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command),
  stateName: () => page.evaluate(() => (window as any).tentGame.player.userData.stategraph.stateName),
  asleep: () => page.evaluate(() => (window as any).tentGame.player.userData.stategraph.hasStateTag('sleeping')),
  tent: () => page.evaluate(() => {
    const { scene } = (window as any).tentGame;
    const model = scene.children.find((model: any) => model.userData.components?.sleepingbag);
    if (!model) return null;
    const { sleepingbag, finiteuses } = model.userData.components;
    return { uses: finiteuses.GetUses(), inUse: sleepingbag.InUse(), animation: model.userData.animationController.currentAnimation,
      persists: model.userData.persists !== false };
  }),
  stats: () => page.evaluate(() => {
    const { stats, player } = (window as any).tentGame;
    return { hunger: stats.hunger.peek(), sanity: stats.sanity.peek(), health: stats.health.peek(), visible: player.visible,
      controller: player.userData.controllerEnabled };
  }),
  clickTent: async () => {
    const point = await page.evaluate(() => {
      const { scene, camera } = (window as any).tentGame;
      const model = scene.children.find((model: any) => model.userData.components?.sleepingbag);
      const ndc = model.position.clone().project(camera);
      return { x: (ndc.x + 1) / 2 * innerWidth, y: (1 - ndc.y) / 2 * innerHeight };
    });
    await page.mouse.click(point.x, point.y);
  },
});

test('click a tent at night: the player walks over, sleeps hidden, recovers per tick and wakes on movement, spending a use', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await load(page, NIGHT);
  const { submit, stateName, asleep, tent, stats, clickTent } = helpers(page);
  await submit('c_spawn("tent")');
  await expect.poll(tent, { timeout: 30_000 }).not.toBeNull();
  expect(await tent()).toMatchObject({ uses: 15, inUse: false, animation: 'idle', persists: true });
  const before = await stats();

  await clickTent();
  await expect.poll(asleep, { timeout: 60_000 }).toBe(true);
  expect(await stateName()).toBe('tent');
  expect(await stats()).toMatchObject({ visible: false, controller: false });
  expect(await tent()).toMatchObject({ inUse: true, animation: 'sleep_loop' });
  // SleepTick every second: -1 hunger, +1 sanity and +2 health for a tent.
  await expect.poll(async () => (await stats()).hunger, { timeout: 60_000 }).toBeLessThanOrEqual(before.hunger - 2);
  const during = await stats();
  expect(during.health - before.health).toBeGreaterThanOrEqual(4);
  expect(during.sanity).toBeGreaterThan(before.sanity);

  // A save while asleep keeps the tent and its unspent uses.
  const download = page.waitForEvent('download');
  await submit('c_save()');
  const saved = JSON.parse(await readSaveDownload(await (await download).path()));
  expect(saved.world.entities.tent?.[0]?.components.finiteuses).toEqual({ uses: 15 });

  await page.keyboard.down('KeyD');
  await expect.poll(stateName, { timeout: 30_000 }).toBe('wakeup');
  await page.keyboard.up('KeyD');
  await expect.poll(stateName, { timeout: 30_000 }).toBe('idle');
  expect(await stats()).toMatchObject({ visible: true, controller: true });
  expect(await tent()).toMatchObject({ uses: 14, inUse: false, animation: 'idle' });
  expect(await page.evaluate(() => (window as any).tentGame.main.inventory !== undefined)).toBe(true);

  // The spent use is saved and restored.
  const spent = page.waitForEvent('download');
  await submit('c_save()');
  const savedSpent = JSON.parse(await readSaveDownload(await (await spent).path()));
  expect(savedSpent.world.entities.tent?.[0]?.components.finiteuses).toEqual({ uses: 14 });
  const reloaded = await browser.newPage();
  reloaded.on('pageerror', error => errors.push(error.message));
  await load(reloaded, NIGHT, savedSpent);
  await expect.poll(helpers(reloaded).tent, { timeout: 30_000 }).toMatchObject({ uses: 14 });

  // The last use destroys the tent after the sleeper wakes.
  await page.evaluate(() => (window as any).tentGame.scene.children
    .find((model: any) => model.userData.components?.sleepingbag).userData.components.finiteuses.OnLoad({ uses: 1 }));
  await clickTent();
  await expect.poll(asleep, { timeout: 60_000 }).toBe(true);
  await page.keyboard.down('KeyD');
  await expect.poll(async () => (await tent())?.animation ?? 'removed', { timeout: 30_000 }).toBe('destroy');
  await page.keyboard.up('KeyD');
  expect((await tent())?.persists).toBe(false);
  await expect.poll(tent, { timeout: 30_000 }).toBeNull();
  expect(errors).toEqual([]);
});

test('a tent refuses sleepers while the sun is up', async ({ page }) => {
  test.setTimeout(120_000);
  const messages: string[] = [];
  page.on('console', message => { if (message.type() === 'info') messages.push(message.text()); });
  await load(page, DAY);
  const { submit, stateName, tent, stats, clickTent } = helpers(page);
  await submit('c_spawn("tent")');
  await expect.poll(tent, { timeout: 30_000 }).not.toBeNull();
  await clickTent();
  await expect.poll(() => messages, { timeout: 60_000 }).toContain('光线太亮了。');
  await expect.poll(stateName, { timeout: 10_000 }).toBe('idle');
  expect(await stats()).toMatchObject({ visible: true, controller: true });
  expect(await tent()).toMatchObject({ uses: 15, inUse: false });
});
