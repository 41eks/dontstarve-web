import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const modules = Object.fromEntries(['main', 'player', 'universal'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('right-click plays the panflute: play_flute timing and sound, one use spent, nearby beefalo fall asleep, saved uses reload', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    const urls = new WeakMap<object, string>();
    const started: string[] = [];
    (window as any).startedSounds = started;
    const fetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await fetch(...args), url = String(args[0]);
      if (!url.includes('/sound/')) return response;
      const arrayBuffer = response.arrayBuffer.bind(response);
      response.arrayBuffer = async () => { const data = await arrayBuffer(); urls.set(data, url); return data; };
      return response;
    };
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = async function (data: ArrayBuffer) {
      const url = urls.get(data), buffer = await decode.call(this, data);
      if (url) urls.set(buffer, url.slice(url.lastIndexOf('/') + 1));
      return buffer;
    } as typeof decode;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      started.push(this.buffer ? urls.get(this.buffer) ?? 'unknown' : 'empty');
      return start.apply(this, args);
    };
  });
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.players.local.stats = { health: 150, hunger: 150, sanity: 100 };
    save.world.elapsedSeconds = 0; // morning: the beefalo are awake until the flute
    await route.fulfill({ response, json: save });
  });
  const prepare = () => page.evaluate(async paths => {
    const main = await import(paths.main), { player } = await import(paths.player);
    const { scene } = await import(paths.universal);
    (window as any).fluteGame = { main, player, scene };
  }, modules);
  await page.goto('/tests/dst-lighting.html?save=initial-world.json'); await prepare();
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const stateName = () => page.evaluate(() => (window as any).fluteGame.player.userData.stategraph.stateName);
  const beefaloIds = () => page.evaluate(() => (window as any).fluteGame.scene.children
    .filter((model: any) => model.userData.instance?.prefab === 'beefalo').map((model: any) => model.userData.instance?.entityId as string));
  const beefaloAsleep = (id: string) => page.evaluate(id => (window as any).fluteGame.scene.children
    .find((model: any) => model.userData.instance?.entityId === id).userData.beefaloController.sleeper.IsAsleep() as boolean, id);
  const uses = () => page.evaluate(() => (window as any).fluteGame.main.inventory.exportState().slots
    .find((slot: any) => slot.item?.itemId === 'panflute')?.item.remainingUses);

  const existing = await beefaloIds();
  await submit('c_spawn("beefalo")');
  await expect.poll(async () => (await beefaloIds()).length).toBe(existing.length + 1);
  const spawned = (await beefaloIds()).find(id => !existing.includes(id))!;
  expect(await beefaloAsleep(spawned)).toBe(false);
  await submit('c_give("panflute")');
  const flute = page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="panflute"]');
  await expect(flute).toBeVisible();
  await flute.click({ button: 'right' });
  await expect.poll(stateName).toBe('play_flute');
  await expect.poll(() => beefaloAsleep(spawned), { timeout: 5_000 }).toBe(true);
  expect(await uses()).toBe(9);
  expect(await page.evaluate(() => (window as any).startedSounds as string[]))
    .toEqual(expect.arrayContaining([expect.stringMatching(/^wilson\.fsb-8[1-7]\.wav$/)]));
  await expect.poll(stateName, { timeout: 10_000 }).toBe('idle');

  await submit('c_spawn("panflute")');
  const download = page.waitForEvent('download'); await submit('c_save()');
  const save = JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: save }));
  await page.reload(); await prepare();
  expect(await uses()).toBe(9);
  expect(errors).toEqual([]);
});
