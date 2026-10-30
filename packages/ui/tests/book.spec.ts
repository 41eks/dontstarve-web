import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const modules = Object.fromEntries(['main', 'player', 'universal', 'playerStats', 'scene'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('right-click reads book_silviculture with the source states, sounds and growth, and saves the book', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // Record which decoded WAV each started buffer source plays.
  await page.addInitScript(() => {
    const urls = new WeakMap<object, string>();
    const started: string[] = [];
    (window as any).startedSounds = started;
    const fetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await fetch(...args);
      const url = String(args[0]);
      if (!url.includes('/sound/')) return response;
      const arrayBuffer = response.arrayBuffer.bind(response);
      response.arrayBuffer = async () => { const data = await arrayBuffer(); urls.set(data, url); return data; };
      return response;
    };
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = async function (data: ArrayBuffer) {
      const url = urls.get(data);
      const buffer = await decode.call(this, data);
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
    await route.fulfill({ response, json: save });
  });
  const prepare = () => page.evaluate(async paths => {
    const main = await import(paths.main), { player } = await import(paths.player);
    const { scene } = await import(paths.universal);
    const stats = await import(paths.playerStats);
    (window as any).bookGame = { main, player, scene, stats };
  }, modules);
  await page.goto('/tests/dst-lighting.html?save=initial-world.json'); await prepare();
  await page.evaluate(() => {
    const { main, scene } = (window as any).bookGame;
    main.inventory.applySlotChanges(main.inventory.exportState().slots.filter((slot: any) => slot.item)
      .map((slot: any) => ({ slot: slot.address, ...slot.item, delta: -slot.item.count })));
    (window as any).existingIds = scene.children.map((model: any) => (window as any).__prefabInstance(model)?.entityId);
  });
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const newModel = (prefab: string) => page.evaluate(prefab => (window as any).__prefabInstance((window as any).bookGame.scene.children.find((model: any) =>
    (((window as any).__findActionEntity(model)?.prefab ?? (window as any).__prefabInstance(model)?.prefab) ?? (window as any).__prefabInstance(model)?.prefab) === prefab
    && !(window as any).existingIds.includes((window as any).__prefabInstance(model)?.entityId)))?.entityId ?? null, prefab);
  const stateName = () => page.evaluate(() => (window as any).__prefabInstance((window as any).bookGame.player).animationController.stategraph.stateName);
  const sanity = page.locator('dst-status-hud .survival-meter--sanity output');

  await submit('c_spawn("grass")');
  await expect.poll(() => newModel('grass')).not.toBeNull();
  const grassId = await newModel('grass');
  const pickGrass = () => page.evaluate(id => {
    const model = (window as any).bookGame.scene.children.find((model: any) => (window as any).__prefabInstance(model)?.entityId === id);
    return ((window as any).__findActionEntity(model)?.components ?? (window as any).__prefabInstance(model)!.components).pickable.pick({ giveItem: () => true });
  }, grassId);
  const grassReady = () => page.evaluate(id => ((window as any).__findActionEntity((window as any).bookGame.scene.children
    .find((model: any) => (window as any).__prefabInstance(model)?.entityId === id))?.components ?? (window as any).__prefabInstance((window as any).bookGame.scene.children
    .find((model: any) => (window as any).__prefabInstance(model)?.entityId === id))!.components).pickable.canBePicked, grassId);
  expect(await pickGrass()).toBe(true);
  expect(await grassReady()).toBe(false);

  await submit('c_give("book_silviculture")');
  const book = page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="book_silviculture"]');
  await expect(book).toBeVisible();
  await book.click({ button: 'right' });
  await expect.poll(stateName).toBe('book2');
  await page.waitForTimeout(600); // Reach the open book and both FX before the frame-50 commit.
  await page.screenshot({ path: test.info().outputPath('reading.png') });
  await expect.poll(stateName, { timeout: 10_000 }).toBe('idle');
  expect(await grassReady()).toBe(true);
  await expect(sanity).toHaveText('67');
  const uses = () => page.evaluate(() => (window as any).bookGame.main.inventory.exportState().slots
    .find((slot: any) => slot.item?.itemId === 'book_silviculture')?.item.remainingUses);
  expect(await uses()).toBe(4);
  const started = () => page.evaluate(() => [...(window as any).startedSounds] as string[]);
  const readSounds = await started();
  for (const pattern of [/^together\.fsb-48[1-4]\.wav$/, /^wickerbottom_rework\.fsb-13\.wav$/, /^wickerbottom_rework\.fsb-20\.wav$/,
    /^common\.fsb-148\.wav$/, /^sfx\.fsb-(347|348|349|350)\.wav$/]) {
    expect(readSounds.some(file => pattern.test(file)), String(pattern)).toBe(true);
  }

  // No picked silviculture plant in range: book_fx fails and nothing is spent.
  await book.click({ button: 'right' });
  await expect.poll(stateName).toBe('book2');
  await expect.poll(stateName, { timeout: 10_000 }).toBe('idle');
  expect((await started()).includes('wickerbottom_rework.fsb-3.wav')).toBe(true);
  expect(await uses()).toBe(4);
  await expect(sanity).toHaveText('67');

  await submit('c_spawn("book_silviculture")');
  await expect.poll(() => newModel('book_silviculture')).not.toBeNull();
  const groundId = await newModel('book_silviculture');
  const savedBook = await page.evaluate(() => (window as any).bookGame.main.inventory.exportState().slots
    .find((slot: any) => slot.item?.itemId === 'book_silviculture').item);
  const download = page.waitForEvent('download'); await submit('c_save()');
  const save = JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  const ground = save.world.entities.ground_item.find((entity: any) => entity.id === groundId);
  expect(ground).toBeDefined();
  expect(ground.components.stack).toMatchObject({ itemId: 'book_silviculture', count: 1 });
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: save }));
  await page.reload(); await prepare();
  await expect(sanity).toHaveText('67');
  expect(await page.evaluate(() => (window as any).bookGame.main.inventory.exportState().slots
    .find((slot: any) => slot.item?.itemId === 'book_silviculture').item)).toEqual(savedBook);
  expect(savedBook.remainingUses).toBe(4);
  expect(await page.evaluate(id => {
    const { main, scene } = (window as any).bookGame;
    const model = scene.children.find((model: any) => (window as any).__prefabInstance(model)?.entityId === id);
    const entity = main.inventory.entities.get(id);
    return { itemId: entity.prefab, count: entity.components.stackable.count, position: model.position.toArray(),
      book: entity.hasTag('book') };
  }, groundId)).toEqual({ itemId: 'book_silviculture', count: 1, position: ground.transform.position, book: true });
  expect(errors).toEqual([]);
});

test('right-click reads book_rain: its fx and sounds play, moisture starts the rain, and a second read stops it', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const sounds: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (request.url().endsWith('.wav')) sounds.push(new URL(request.url()).pathname.split('/').pop()!); });
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.players.local.stats = { health: 150, hunger: 150, sanity: 100 };
    await route.fulfill({ response, json: save });
  });
  await page.goto('/tests/dst-lighting.html?save=initial-world.json');
  await page.evaluate(async paths => {
    const main = await import(paths.main), { player } = await import(paths.player);
    const { scene } = await import(paths.universal);
    const { worldState } = await import(paths.scene);
    (window as any).rainGame = { main, player, scene, weather: worldState.weather };
    main.inventory.applySlotChanges(main.inventory.exportState().slots.filter((slot: any) => slot.item)
      .map((slot: any) => ({ slot: slot.address, ...slot.item, delta: -slot.item.count })));
  }, modules);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const stateName = () => page.evaluate(() => (window as any).__prefabInstance((window as any).rainGame.player).animationController.stategraph.stateName);
  const weather = () => page.evaluate(() => {
    const { weather } = (window as any).rainGame;
    return { type: weather.preciptype.peek(), moisture: weather.moisture.peek(), ceil: weather.moistureceil.peek(),
      floor: weather.moisturefloor.peek(), rate: weather.rainRate.peek() };
  });
  const rainQuads = () => page.evaluate(() => ((window as any).rainGame.scene.getObjectByName('rain')?.getObjectByProperty('isMesh', true)?.geometry.drawRange.count ?? 0) / 6);
  const fxCount = () => page.evaluate(() => (window as any).rainGame.scene.children.filter((model: any) => (window as any).__prefabInstance(model)?.prefab === 'fx_book_rain').length);
  expect((await weather()).type).toBe('none');
  expect(await rainQuads()).toBe(0);

  await submit('c_give("book_rain")');
  const book = page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="book_rain"]');
  await expect(book).toBeVisible();
  await book.click({ button: 'right' });
  await expect.poll(stateName).toBe('book2');
  // The fx.lua effect appears at the reader at the frame-50 commit, which also moves moisture to its ceiling.
  await expect.poll(fxCount, { timeout: 30_000 }).toBe(1);
  expect(sounds).toEqual(expect.arrayContaining(['wickerbottom_rework.fsb-10.wav', 'wickerbottom_rework.fsb-11.wav']));
  await expect.poll(async () => (await weather()).type, { timeout: 60_000 }).toBe('rain');
  const raining = await weather();
  expect(raining.rate).toBeGreaterThan(0);
  expect(raining.moisture).toBeLessThanOrEqual(raining.ceil);
  await expect.poll(rainQuads, { timeout: 20_000 }).toBeGreaterThan(0);
  expect(sounds).toEqual(expect.arrayContaining(['forest_stream.fsb-74.wav', 'forest_stream.fsb-75.wav', 'forest_stream.fsb-76.wav']));
  await expect.poll(stateName, { timeout: 20_000 }).toBe('idle');
  expect(await page.evaluate(() => (window as any).rainGame.main.inventory.exportState().slots
    .find((slot: any) => slot.item?.itemId === 'book_rain').item.remainingUses)).toBe(4);

  // Reading during rain forces the moisture floor, which stops precipitation and removes the particles.
  await book.click({ button: 'right' });
  await expect.poll(async () => (await weather()).type, { timeout: 90_000 }).toBe('none');
  await expect.poll(rainQuads, { timeout: 20_000 }).toBe(0);
  expect(errors).toEqual([]);
});

test('raining weather is exported by c_save and restored with its rain on reload', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const load = async (target: typeof page) => {
    await target.goto('/tests/dst-lighting.html?save=initial-world.json');
    await target.evaluate(async paths => {
      const main = await import(paths.main); const { scene } = await import(paths.universal);
      const { worldState } = await import(paths.scene);
      (window as any).rainGame = { main, scene, weather: worldState.weather };
    }, modules);
  };
  const weather = (target: typeof page) => target.evaluate(() => {
    const { weather, scene } = (window as any).rainGame;
    return { type: weather.preciptype.peek(), moisture: weather.moisture.peek(), floor: weather.moisturefloor.peek(),
      ceil: weather.moistureceil.peek(), peak: weather.peakprecipitationrate.peek(), rate: weather.rainRate.peek(),
      quads: (scene.getObjectByName('rain')?.getObjectByProperty('isMesh', true)?.geometry.drawRange.count ?? 0) / 6 };
  });
  await load(page);
  expect((await weather(page)).type).toBe('none');
  await page.evaluate(() => (window as any).rainGame.weather.ForcePrecipitation());
  await expect.poll(async () => (await weather(page)).type, { timeout: 90_000 }).toBe('rain');
  const download = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command: 'c_save()' } })));
  const saved = JSON.parse(await readSaveDownload(await (await download).path(), 'Master'));
  expect(saved.world.systems.weather).toMatchObject({ preciptype: 'rain' });
  const exported = saved.world.systems.weather;
  expect(exported.moisture).toBeGreaterThan(exported.moisturefloor);
  expect(exported.moisture).toBeLessThanOrEqual(exported.moistureceil);

  const reloaded = await browser.newPage();
  reloaded.on('pageerror', error => errors.push(error.message));
  await reloaded.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await load(reloaded);
  // The loaded rain is already falling: rain.lua's PostInit fills the screen before the first frame.
  expect(await weather(reloaded)).toMatchObject({ type: 'rain', moisture: exported.moisture, floor: exported.moisturefloor,
    ceil: exported.moistureceil, peak: exported.peakprecipitationrate });
  await expect.poll(async () => (await weather(reloaded)).quads, { timeout: 60_000 }).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});
