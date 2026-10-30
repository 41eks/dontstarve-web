import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera', 'player'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('a cursor-held razor refuses an awake beefalo, shaves a sleeping one, and the result survives save and reload', async ({ page }) => {
  test.setTimeout(180_000);
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
    const main = await import(urls.main), { scene, renderer } = await import(urls.universal);
    const { camera } = await import(urls.camera), { player, playerBody } = await import(urls.player);
    (window as any).razorGame = { main, scene, renderer, camera, player, playerBody };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const saveGame = async () => {
    const download = page.waitForEvent('download'); await submit('c_save()');
    return JSON.parse(await readSaveDownload((await (await download).path())!));
  };
  const beefalo = () => page.evaluate(() => {
    const model = (window as any).razorGame.scene.children.find((model: any) => (window as any).__prefabInstance(model)?.prefab === 'beefalo');
    if (!model) return null;
    const { beard, sleeper } = ((window as any).__findActionEntity(model)?.components ?? (window as any).__prefabInstance(model)!.components), inst = (window as any).__findActionEntity(model);
    return { id: (window as any).__prefabInstance(model)?.entityId, state: (window as any).__prefabInstance(model).sg.stateName, bits: beard.bits.peek(), growth: beard.daysgrowth.peek(),
      asleep: sleeper.IsAsleep(), bearded: inst.hasTag('bearded'), hairy: inst.hasTag('has_beard') };
  });
  const wool = () => page.evaluate(() => (window as any).razorGame.scene.children
    .filter((model: any) => ((window as any).__findActionEntity(model)?.prefab ?? (window as any).__prefabInstance(model)?.prefab) === 'beefalowool').length);
  const clickBeefalo = async () => {
    const point = await page.evaluate(() => {
      const { scene, camera, renderer } = (window as any).razorGame;
      const model = scene.children.find((model: any) => (window as any).__prefabInstance(model)?.prefab === 'beefalo'), mesh = model.children[0].children[0];
      mesh.geometry.computeBoundingBox();
      const center = mesh.geometry.boundingBox.getCenter(model.position.clone()); mesh.localToWorld(center).project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return { x: rect.left + (center.x + 1) * rect.width / 2, y: rect.top + (1 - center.y) * rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
  };
  const slots = (save: any) => Object.entries(save.players.local.inventory.containers).flatMap(([id, container]: [string, any]) =>
    container.slots.map((slot: any) => ({ container: id, ...slot })));
  const cursor = page.locator('.slot-drag-preview[data-cursor="true"]');

  await page.goto('/tests/dst-lighting.html'); await prepare();
  await submit('c_give("razor"); c_spawn("razor"); c_spawn("beefalo")');
  await expect.poll(beefalo).not.toBeNull();
  // The ground razor is built from razor.zip/swap_razor, not from its inventory icon.
  await expect.poll(() => page.evaluate(() => (window as any).razorGame.scene.children
    .filter((model: any) => ((window as any).__findActionEntity(model)?.prefab ?? (window as any).__prefabInstance(model)?.prefab) === 'razor')
    .map((model: any) => model.children[0].children[0].geometry.drawRange.count > 0))).toEqual([true]);
  // Wandering is not under test here; stop its brain while testing the player's tool input.
  await page.evaluate(() => {
    const { scene, player, playerBody } = (window as any).razorGame;
    const model = scene.children.find((model: any) => (window as any).__prefabInstance(model)?.prefab === 'beefalo');
    (window as any).__prefabInstance(model).brain.Stop();
    playerBody.position.set(model.position.x - 6, playerBody.shapes[0].radius, model.position.z + 6);
    player.position.set(model.position.x - 6, 0, model.position.z + 6);
  });
  // reskin_tool cycles the ground razor through its three source skins, keeping its identity.
  const groundRazor = () => page.evaluate(() => (window as any).razorGame.scene.children
    .filter((model: any) => ((window as any).__findActionEntity(model)?.prefab ?? (window as any).__prefabInstance(model)?.prefab) === 'razor')
    .map((model: any) => ({ id: (window as any).__prefabInstance(model)?.entityId, skin: (window as any).__prefabInstance(model)?.skinId })));
  const spawnedRazor = (await groundRazor())[0];
  await submit('c_give("reskin_tool")');
  const bar = page.locator('dst-inventory-bar');
  await bar.locator('.inventory-bar__items [data-item-id="reskin_tool"]').dragTo(bar.locator('[data-slot-key="hand"]'));
  await page.evaluate(id => {
    const { scene, camera, renderer, player, playerBody } = (window as any).razorGame;
    const model = scene.children.find((model: any) => (window as any).__prefabInstance(model)?.entityId === id);
    playerBody.position.set(model.position.x + 3, playerBody.shapes[0].radius, model.position.z + 3);
    player.position.set(model.position.x + 3, 0, model.position.z + 3);
    (window as any).razorPoint = () => {
      const mesh = model.children[0].children[0]; mesh.geometry.computeBoundingBox();
      const center = mesh.geometry.boundingBox.getCenter(model.position.clone()); mesh.localToWorld(center).project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return { x: rect.left + (center.x + 1) * rect.width / 2, y: rect.top + (1 - center.y) * rect.height / 2 };
    };
  }, spawnedRazor.id);
  const razorPoint = await page.evaluate(() => (window as any).razorPoint());
  await page.mouse.click(razorPoint.x, razorPoint.y, { button: 'right' });
  await expect.poll(async () => (await groundRazor())[0]?.skin, { timeout: 20_000 }).toBe('razor_barber');
  expect((await groundRazor())[0].id).toBe(spawnedRazor.id);

  const razor = page.locator('dst-inventory-bar .inventory-bar__items [data-item-id="razor"]');
  await expect(razor.locator('.inventory-slot__icon[data-loaded="true"]')).toBeVisible();
  await razor.click();
  await expect(cursor).toHaveAttribute('data-item-id', 'razor');

  // Awake: the shave state reports AWAKEBEEFALO, the beard and the cursor are untouched.
  expect((await beefalo())!.asleep).toBe(false);
  await clickBeefalo();
  await page.waitForTimeout(4000);
  expect(await beefalo()).toMatchObject({ bits: 3, asleep: false });
  expect(await wool()).toBe(0);
  await expect(cursor).toHaveAttribute('data-item-id', 'razor');

  // Night: the sleeper puts it to sleep by itself, and the same click shaves it, drops three wool and
  // keeps it sleeping in the shaved build. DST nights start at 420 s of the 480 s day.
  const day = await saveGame();
  expect(day.world.entities.beefalo[0].components.beefalo.knownlocations).toEqual({ locations: [] });
  expect(day.world.entities.ground_item.filter((entry: any) => entry.components.stack.itemId === 'razor')).toHaveLength(1);
  day.world.elapsedSeconds = 425;
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: day }));
  await page.reload(); await prepare();
  await expect(cursor).toHaveAttribute('data-item-id', 'razor');
  await expect.poll(async () => (await beefalo())?.state, { timeout: 20_000 }).toBe('sleeping');
  expect(await beefalo()).toMatchObject({ bits: 3, asleep: true });
  await page.evaluate(() => {
    const { scene, player, playerBody } = (window as any).razorGame;
    const model = scene.children.find((model: any) => (window as any).__prefabInstance(model)?.prefab === 'beefalo');
    playerBody.position.set(model.position.x - 6, playerBody.shapes[0].radius, model.position.z + 6);
    player.position.set(model.position.x - 6, 0, model.position.z + 6);
  });
  await clickBeefalo();
  await expect.poll(wool, { timeout: 30_000 }).toBe(3);
  const shaved = (await beefalo())!;
  expect(shaved).toMatchObject({ bits: 0, growth: 0, asleep: true });
  expect(shaved).toMatchObject({ bearded: true, hairy: false });
  await expect(cursor).toHaveAttribute('data-item-id', 'razor');

  const saved = await saveGame();
  const record = saved.world.entities.beefalo.find((entry: any) => entry.id === shaved.id);
  expect(record.components.beefalo.beard).toEqual({ growth: 0, growthaccumulator: 0, bits: 0 });
  expect(saved.world.entities.ground_item.filter((entry: any) => entry.components.stack.itemId === 'beefalowool')).toHaveLength(3);
  expect(slots(saved).filter(slot => slot.item.itemId === 'razor' && slot.container === 'player:cursor')).toHaveLength(1);

  saved.world.elapsedSeconds = 425;
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload(); await prepare();
  await expect.poll(beefalo).toMatchObject({ id: shaved.id, bits: 0 });
  expect(await beefalo()).toMatchObject({ bearded: true, hairy: false });
  const restored = await saveGame();
  expect(restored.world.entities.beefalo.find((entry: any) => entry.id === shaved.id).components.beefalo.beard)
    .toEqual(record.components.beefalo.beard);
  expect(slots(restored).filter(slot => slot.item.itemId === 'razor' && slot.container === 'player:cursor')).toHaveLength(1);
  expect(errors).toEqual([]);
});
