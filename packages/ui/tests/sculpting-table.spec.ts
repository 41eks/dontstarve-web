import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera', 'player'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('gives marble from the cursor, takes it back with PICK and keeps it across save and load', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || (message.type() === 'warning' && /Unable to (prepare|play)/.test(message.text()))) {
      errors.push(message.text());
    }
  });
  await page.addInitScript(() => {
    const samples: { duration: number; channels: number; loop: boolean; state: string }[] = [];
    (window as any).tableAudioSamples = samples;
    const original = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = original.call(this), start = source.start.bind(source), context = this;
      source.start = (...args: Parameters<typeof start>) => {
        if (source.buffer) samples.push({ duration: source.buffer.duration, channels: source.buffer.numberOfChannels,
          loop: source.loop, state: context.state });
        start(...args);
      };
      return source;
    };
  });
  const clearSamples = () => page.evaluate(() => { (window as any).tableAudioSamples.length = 0; });
  const checkItemSound = async (unlocked = false) => {
    const samples = (await page.evaluate(() => (window as any).tableAudioSamples as {
      duration: number; channels: number; loop: boolean; state: string;
    }[])).filter(sample => !sample.loop); // PICK also plays the character's looping action sounds.
    expect(samples).toHaveLength(2);
    expect(samples[0]).toMatchObject({ channels: 1, loop: false });
    expect(samples[0].duration).toBeCloseTo(11517 / 44100, 5);
    expect(samples[1]).toMatchObject({ channels: 1, loop: false });
    expect(samples[1].duration).toBeGreaterThan(.15);
    expect(samples[1].duration).toBeLessThan(.49);
    if (unlocked) expect(samples.every(sample => sample.state === 'running')).toBe(true);
  };
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.entities = {};
    save.players.local.transform.position = [0, 0, 0];
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  const prepare = () => page.evaluate(async urls => {
    const main = await import(urls.main), { scene, renderer } = await import(urls.universal);
    const { camera } = await import(urls.camera);
    const { player } = await import(urls.player);
    (window as any).tableGame = { main, scene, renderer, camera, player };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const held = () => page.evaluate(() => {
    const table = (window as any).tableGame.scene.children.find((model: any) => model.name === 'SculptingTable');
    const pickable = ((window as any).__findActionEntity(table)?.components ?? (window as any).__prefabInstance(table)!.components).pickable;
    return pickable?.canInteractWith ? pickable.product : null;
  });
  const saveGame = async () => {
    const download = page.waitForEvent('download'); await submit('c_save()');
    return JSON.parse(await readSaveDownload((await (await download).path())!));
  };
  const clickTable = async () => {
    const point = await page.evaluate(() => {
      const { scene, camera, renderer } = (window as any).tableGame;
      const table = scene.children.find((model: any) => model.name === 'SculptingTable');
      const mesh = table.children[0].children[0];
      mesh.geometry.computeBoundingBox();
      const centre = mesh.geometry.boundingBox.getCenter(table.position.clone());
      mesh.localToWorld(centre).project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return { x: rect.left + (centre.x + 1) * rect.width / 2, y: rect.top + (1 - centre.y) * rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
  };
  const marble = page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="marble"]');

  await page.goto('/tests/dst-lighting.html'); await prepare();
  await submit('c_spawn("sculptingtable")');
  await expect.poll(() => page.evaluate(() => (window as any).tableGame.scene.children.some((model: any) => model.name === 'SculptingTable'))).toBe(true);
  await submit('c_give("marble")');
  await submit('c_give("log", 1)');
  await page.keyboard.down('w');
  await expect.poll(() => page.evaluate(() => {
    const { scene, player } = (window as any).tableGame;
    const table = scene.children.find((model: any) => model.name === 'SculptingTable');
    return Math.hypot(table.position.x - player.position.x, table.position.z - player.position.z);
  })).toBeLessThan(8);
  await page.keyboard.up('w');

  // A log is refused and stays on the cursor.
  await page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="log"]').click();
  await clickTable();
  expect(await held()).toBeNull();
  await expect(page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="log"]')).toHaveCount(0);

  await marble.click();
  await clearSamples();
  await clickTable();
  await expect.poll(held).toBe('marble');
  await checkItemSound(true);
  const saved = await saveGame();
  expect(saved.world.entities.sculptingtable[0].components.sculptingtable).toEqual({ itemname: 'marble' });
  // The single marble left the cursor and the inventory; only the table holds it.
  expect(JSON.stringify(saved.players.local.inventory)).not.toContain('marble');

  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload(); await prepare();
  await expect.poll(held).toBe('marble');
  await checkItemSound();
  expect((await saveGame()).world.entities.sculptingtable[0]).toEqual(saved.world.entities.sculptingtable[0]);

  // PICK returns the block to the inventory and empties the table.
  await clearSamples();
  await clickTable();
  await expect.poll(held).toBeNull();
  await checkItemSound(true);
  const taken = await saveGame();
  expect(taken.world.entities.sculptingtable[0].components.sculptingtable).toBeUndefined();
  expect(JSON.stringify(taken.players.local.inventory)).toContain('"itemId":"marble"');
  expect(errors).toEqual([]);
});
