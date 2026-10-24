import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera', 'player'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('repairs moonbase with a cursor moonrock, inserts and retrieves a skinned staff, and saves the new material prefab', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || (message.type() === 'warning' && /Unable to (prepare|play)/.test(message.text()))) errors.push(message.text());
  });
  await page.addInitScript(() => {
    (window as any).moonbaseAudio = [];
    const original = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = original.call(this), start = source.start.bind(source);
      source.start = (...args: Parameters<typeof start>) => {
        if (source.buffer) (window as any).moonbaseAudio.push({ duration: source.buffer.duration, loop: source.loop });
        start(...args);
      };
      return source;
    };
  });
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.entities = {}; save.world.elapsedSeconds = 0; save.players.local.transform.position = [0, 0, 0];
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.containers['player:inventory'].slots = [{ slotKey: '0', item: {
      entityId: 'moonbase_browser_staff', itemId: 'yellowstaff', count: 1, skinId: 'starstaff_crystal', remainingUses: 7,
    } }];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  const prepare = () => page.evaluate(async urls => {
    const main = await import(urls.main), { scene, renderer } = await import(urls.universal);
    const { camera } = await import(urls.camera), { player } = await import(urls.player);
    (window as any).moonbaseGame = { main, scene, renderer, camera, player };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const state = () => page.evaluate(() => {
    const model = (window as any).moonbaseGame.scene.children.find((model: any) => model.name === 'MoonBase');
    if (!model) return null;
    return { workleft: model.userData.components.workable.GetWorkLeft(),
      held: model.userData.moonbase.staff.peek()?.snapshot(), animation: model.userData.animationController.currentAnimation };
  });
  const saveGame = async () => {
    const download = page.waitForEvent('download'); await submit('c_save()');
    return JSON.parse(await readSaveDownload((await (await download).path())!));
  };
  const clickMoonbase = async (button: 'left' | 'right' = 'left') => {
    const point = await page.evaluate(() => {
      const { scene, camera, renderer } = (window as any).moonbaseGame;
      const model = scene.children.find((model: any) => model.name === 'MoonBase'), mesh = model.children[0].children[0];
      mesh.geometry.computeBoundingBox();
      const center = mesh.geometry.boundingBox.getCenter(model.position.clone());
      mesh.localToWorld(center).project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return { x: rect.left + (center.x + 1) * rect.width / 2, y: rect.top + (1 - center.y) * rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y, { button });
  };
  const samples = () => page.evaluate(() => ((window as any).moonbaseAudio as { duration: number; loop: boolean }[]).filter(sample => !sample.loop));
  const clearSamples = () => page.evaluate(() => { (window as any).moonbaseAudio.length = 0; });
  const bar = page.locator('dst-inventory-bar .inventory-bar__items');

  await page.goto('/tests/dst-lighting.html'); await prepare();
  await submit('c_spawn("moonbase")');
  await expect.poll(state).toMatchObject({ workleft: 4, animation: 'med' });
  await submit('c_give("moonrocknugget", 2)');
  await bar.locator('[data-item-id="moonrocknugget"]').click();
  await clearSamples();
  await clickMoonbase('right'); // The action walks to range before the long repair action.
  await expect.poll(async () => (await state())?.workleft, { timeout: 30_000 }).toBe(6);
  const repairSamples = await samples();
  expect(repairSamples).toHaveLength(3);
  expect(repairSamples[0].duration).toBeCloseTo(34346 / 44100, 5);
  expect(repairSamples[2].duration).toBeCloseTo(19081 / 44100, 5);
  await expect.poll(async () => (await state())?.animation).toBe('full');

  await bar.locator('[data-item-id="yellowstaff"]').click();
  await clearSamples(); await clickMoonbase();
  await expect.poll(async () => (await state())?.held).toMatchObject({ entityId: 'moonbase_browser_staff', skinId: 'starstaff_crystal', remainingUses: 7 });
  expect(await samples()).toHaveLength(2);
  const saved = await saveGame(), moonbase = saved.world.entities.moonbase[0];
  expect(moonbase.components.workable).toEqual({ maxwork: 6, workleft: 6 });
  expect(JSON.stringify(saved.players.local.inventory)).not.toContain('yellowstaff');
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload(); await prepare();
  await expect.poll(async () => (await state())?.held).toEqual(moonbase.components.moonbase.staff);
  expect((await saveGame()).world.entities.moonbase[0]).toEqual(moonbase);

  await clearSamples(); await clickMoonbase();
  await expect.poll(async () => (await state())?.held).toBeUndefined();
  expect(await samples()).toHaveLength(2);
  await expect(bar.locator('[data-item-id="yellowstaff"]')).toHaveAttribute('data-skin-id', 'starstaff_crystal');
  await submit('c_spawn("moonrocknugget")');
  await expect.poll(() => page.evaluate(() => (window as any).moonbaseGame.scene.children
    .some((model: any) => model.userData.itemId === 'moonrocknugget'))).toBe(true);
  const taken = await saveGame();
  expect(taken.world.entities.moonbase[0].components.moonbase).toBeUndefined();
  const slots = Object.values(taken.players.local.inventory.containers).flatMap((container: any) => container.slots) as any[];
  expect(slots.find(slot => slot.item.itemId === 'yellowstaff').item).toEqual(moonbase.components.moonbase.staff);
  expect(slots.find(slot => slot.item.itemId === 'moonrocknugget').item.count).toBe(1);
  const groundRock = taken.world.entities.ground_item.find((entity: any) => entity.components.stack.itemId === 'moonrocknugget');
  expect(groundRock.components.stack.count).toBe(1);
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: taken }));
  await page.reload(); await prepare();
  const final = await saveGame();
  expect(final.world.entities.ground_item).toEqual(taken.world.entities.ground_item);
  expect(final.players.local.inventory).toEqual(taken.players.local.inventory);
  expect(errors).toEqual([]);
});

test('shows native charge layers, resumes after a downloaded save, and returns the transformed moonstaff', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || (message.type() === 'warning' && /Unable to (prepare|play)/.test(message.text()))) errors.push(message.text());
  });
  await page.addInitScript(() => {
    const sounds: { duration: number; channels: number; loop: boolean; stopped: boolean }[] = [];
    (window as any).chargeAudio = sounds;
    const original = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = original.call(this), start = source.start.bind(source), stop = source.stop.bind(source);
      let sound: typeof sounds[number] | undefined;
      source.start = (...args: Parameters<typeof start>) => {
        if (source.buffer) {
          sound = { duration: source.buffer.duration, channels: source.buffer.numberOfChannels, loop: source.loop, stopped: false };
          sounds.push(sound);
        }
        start(...args);
      };
      source.stop = (...args: Parameters<typeof stop>) => { if (sound) sound.stopped = true; stop(...args); };
      return source;
    };
  });
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.elapsedSeconds = 10 * 480 + 420; // Day 11, beginning of the full-moon night.
    save.world.entities = { moonbase: [{ id: 'browser_charge_base', transform: { position: [0, 0, -10], rotationY: 0 },
      components: { building: { state: 'idle' }, workable: { workleft: 6, maxwork: 6 }, moonbase: {
        staff: { entityId: 'browser_charge_yellow', itemId: 'yellowstaff', count: 1, skinId: 'starstaff_crystal', remainingUses: 7 },
      } } }] };
    save.players.local.transform.position = [0, 0, 0];
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  const prepare = () => page.evaluate(async urls => {
    await import(urls.main);
    const { scene, renderer } = await import(urls.universal), { camera } = await import(urls.camera);
    (window as any).chargeGame = { scene, renderer, camera };
  }, urls);
  const current = () => page.evaluate(() => {
    const { scene } = (window as any).chargeGame, model = scene.children.find((model: any) => model.name === 'MoonBase');
    const state = model.userData.moonbase;
    const order = (name: string) => scene.children.find((model: any) => model.name === name)?.children[0].renderOrder;
    return { phase: state.charge.peek(), staff: state.staff.peek()?.snapshot(),
      orders: [order('positronbeam_back'), model.children[0].renderOrder, order('positronbeam_front'), order('positronpulse')],
      cold: scene.children.some((model: any) => model.name === 'staffcoldlightfx'),
      intense: model.userData.actionEntity.hasTag('intense') };
  });
  const audio = () => page.evaluate(() => (window as any).chargeAudio as {
    duration: number; channels: number; loop: boolean; stopped: boolean;
  }[]);
  const saveGame = async () => {
    const download = page.waitForEvent('download');
    await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(
      new CustomEvent('game:debug-command', { detail: { command: 'c_save()' } })));
    return JSON.parse(await readSaveDownload((await (await download).path())!));
  };
  await page.goto('/tests/dst-lighting.html'); await prepare();
  await page.keyboard.press('Shift'); // Resume Web Audio with an actual user gesture.
  await expect.poll(async () => (await current()).phase, { timeout: 45_000 }).toBe('charging_2');
  const second = await current();
  expect(second.intense).toBe(true);
  expect(second.orders[0]).toBeLessThan(second.orders[1]);
  expect(second.orders[1]).toBeLessThan(second.orders[2]);
  expect(second.orders[2]).toBeLessThan(second.orders[3]);
  const initialSounds = await audio();
  expect(initialSounds.some(sound => sound.loop && Math.abs(sound.duration - 207153 / 32000) < .001)).toBe(true);
  expect(initialSounds.some(sound => sound.loop && sound.channels === 2)).toBe(true);
  await page.screenshot({ path: '/tmp/moonbase-charge-stage2.png' });
  const saved = await saveGame(), savedBase = saved.world.entities.moonbase[0];
  expect(savedBase.components.moonbase.timer.timers).toHaveProperty('mooncharge3');
  expect(savedBase.components.moonbase.timer.timers).not.toHaveProperty('mooncharge2');
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload(); await prepare(); await page.keyboard.press('Shift');
  await expect.poll(async () => (await current()).phase).toBe('charging_2');
  await expect.poll(async () => (await current()).phase, { timeout: 60_000 }).toBe('complete');
  const complete = await current();
  expect(complete.staff).toMatchObject({ itemId: 'opalstaff', count: 1, skinId: 'moonstaff_crystal', remainingUses: 50 });
  expect(complete.staff.entityId).not.toBe(savedBase.components.moonbase.staff.entityId);
  expect(complete.intense).toBe(false); expect(complete.cold).toBe(true);
  const sounds = await audio();
  expect(sounds.some(sound => !sound.loop && Math.abs(sound.duration - 171990 / 44100) < .001)).toBe(true);
  expect(sounds.filter(sound => sound.loop && Math.abs(sound.duration - 207153 / 32000) < .001).every(sound => sound.stopped)).toBe(true);
  await page.screenshot({ path: '/tmp/moonbase-charge-complete.png' });
  const morphed = await saveGame();
  expect(morphed.world.entities.moonbase[0].components.moonbase.staff).toEqual(complete.staff);
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: morphed }));
  await page.reload(); await prepare();
  await expect.poll(async () => (await current()).cold).toBe(true);
  const point = await page.evaluate(() => {
    const { scene, camera, renderer } = (window as any).chargeGame;
    const model = scene.children.find((model: any) => model.name === 'MoonBase'), mesh = model.children[0].children[0];
    mesh.geometry.computeBoundingBox();
    const center = mesh.geometry.boundingBox.getCenter(model.position.clone()); mesh.localToWorld(center).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (center.x + 1) * rect.width / 2, y: rect.top + (1 - center.y) * rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await current()).staff).toBeUndefined();
  await expect(page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="opalstaff"]')).toHaveAttribute('data-skin-id', 'moonstaff_crystal');
  expect((await audio()).filter(sound => sound.loop).every(sound => sound.stopped)).toBe(true);
  const taken = await saveGame();
  const slots = Object.values(taken.players.local.inventory.containers).flatMap((container: any) => container.slots) as any[];
  expect(slots.find(slot => slot.item.itemId === 'opalstaff').item).toEqual(complete.staff);
  expect(taken.world.entities.moonbase[0].components.moonbase).toBeUndefined();
  expect(errors).toEqual([]);
});
