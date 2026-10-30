import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const modules = Object.fromEntries(['main', 'universal', 'player', 'camera'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('ground manure has animated flies and positional looping audio, survives save/reload and stops its sound on pickup', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    const urls = new WeakMap<object, string>();
    const sounds: { url: string; loop: boolean; stopped: boolean }[] = [];
    const playing = new WeakMap<AudioBufferSourceNode, typeof sounds[number]>();
    (window as any).fliesAudio = sounds;
    const fetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await fetch(...args), url = String(args[0]);
      if (url.includes('/sound/')) {
        const arrayBuffer = response.arrayBuffer.bind(response);
        response.arrayBuffer = async () => { const buffer = await arrayBuffer(); urls.set(buffer, url); return buffer; };
      }
      return response;
    };
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = async function (data: ArrayBuffer) {
      const url = urls.get(data), buffer = await decode.call(this, data);
      if (url) urls.set(buffer, url);
      return buffer;
    } as typeof decode;
    const start = AudioBufferSourceNode.prototype.start, stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      const url = this.buffer && urls.get(this.buffer);
      if (url && /common\.fsb-(7[5-9]|8[01])\.wav$/.test(url)) {
        const record = { url, loop: this.loop, stopped: false }; playing.set(this, record); sounds.push(record);
      }
      return start.apply(this, args);
    };
    AudioBufferSourceNode.prototype.stop = function (...args: Parameters<typeof stop>) {
      const record = playing.get(this); if (record) record.stopped = true;
      return stop.apply(this, args);
    };
  });
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.entities = {}; save.world.elapsedSeconds = 0;
    save.players.local.transform.position = [0, 0, 0];
    save.players.local.stats = { health: 150, hunger: 150, sanity: 100 };
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  const prepare = () => page.evaluate(async paths => {
    const main = await import(paths.main), universal = await import(paths.universal);
    const player = await import(paths.player), camera = await import(paths.camera);
    (window as any).poopGame = { main, ...universal, ...player, ...camera };
  }, modules);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const ground = () => page.evaluate(() => {
    const model = (window as any).poopGame.scene.children.find((model: any) => ((window as any).__findActionEntity(model)?.prefab ?? (window as any).__prefabInstance(model)?.prefab) === 'poop');
    if (!model) return null;
    const child = model.userData.flies;
    return { id: (window as any).__prefabInstance(model)?.entityId, position: model.position.toArray(), flies: (window as any).__prefabInstance(child)?.prefab,
      drawCount: child?.children[0].children[0].geometry.drawRange.count ?? 0 };
  });
  const activeSounds = () => page.evaluate(() => (window as any).fliesAudio.filter((entry: any) => !entry.stopped));
  const move = (x: number) => page.evaluate(x => {
    const { player, playerBody } = (window as any).poopGame;
    playerBody.position.set(x, playerBody.shapes[0].radius, 0); playerBody.velocity.set(0, 0, 0);
    player.position.set(x, 0, 0);
  }, x);
  const saveGame = async () => {
    const download = page.waitForEvent('download'); await submit('c_save()');
    return JSON.parse(await readSaveDownload((await (await download).path())!));
  };
  await page.goto('/tests/dst-lighting.html'); await prepare();
  await submit('c_give("poop", 3); c_spawn("poop")');
  await expect.poll(ground).toMatchObject({ flies: 'flies' });
  await move(12); await page.keyboard.press('Shift');
  await expect.poll(async () => (await ground())?.drawCount).toBeGreaterThan(0);
  await expect.poll(async () => (await activeSounds()).length).toBe(1);
  expect((await activeSounds())[0].loop).toBe(true);
  const original = (await ground())!;
  const saved = await saveGame();
  const record = saved.world.entities.ground_item.find((entry: any) => entry.id === original.id);
  expect(record).toMatchObject({ transform: { position: original.position }, components: { stack: { itemId: 'poop', count: 1 } } });
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload(); await prepare(); await page.keyboard.press('Shift');
  await expect.poll(ground).toMatchObject({ id: original.id, position: original.position, flies: 'flies' });
  await expect.poll(async () => (await activeSounds()).length).toBe(1);
  await move(3);
  await expect.poll(async () => (await activeSounds()).length).toBe(0);
  const point = await page.evaluate(() => {
    const { scene, camera, renderer } = (window as any).poopGame;
    const model = scene.children.find((model: any) => ((window as any).__findActionEntity(model)?.prefab ?? (window as any).__prefabInstance(model)?.prefab) === 'poop'), mesh = model.children[0].children[0];
    mesh.geometry.computeBoundingBox();
    const center = mesh.geometry.boundingBox.getCenter(model.position.clone()); mesh.localToWorld(center).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (center.x + 1) * rect.width / 2, y: rect.top + (1 - center.y) * rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await expect.poll(ground).toBeNull();
  const pickedUp = await saveGame();
  const slots = pickedUp.players.local.inventory.containers['player:inventory'].slots;
  expect(slots.filter((slot: any) => slot.item.itemId === 'poop').reduce((count: number, slot: any) => count + slot.item.count, 0)).toBe(4);
  expect(pickedUp.world.entities.ground_item.filter((entry: any) => entry.components.stack.itemId === 'poop')).toEqual([]);
  expect(await activeSounds()).toEqual([]);
  expect(errors).toEqual([]);
});
