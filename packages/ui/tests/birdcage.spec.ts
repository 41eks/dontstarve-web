import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera', 'player'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

async function harness(page: Page, errors: string[]) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || (message.type() === 'warning' && /Unable to (prepare|play)/.test(message.text()))) errors.push(message.text());
  });
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
    (window as any).cageGame = { main, scene, renderer, camera, player };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const saveGame = async () => {
    const download = page.waitForEvent('download'); await submit('c_save()');
    return JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  };
  const cage = () => page.evaluate(() => {
    const model = (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage');
    const birdcage = model?.userData.actionEntity.components.birdcage;
    if (!birdcage) return null;
    return { state: birdcage.cageState.peek(), status: birdcage.status.peek(), animation: model.userData.animationController.currentAnimation,
      bird: birdcage.getBird()?.prefab ?? null, shelf: birdcage.item?.prefab ?? null,
      tags: ['occupied', 'takeshelfitem', 'trader'].filter(tag => model.userData.actionEntity.hasTag(tag)) };
  });
  const clickCage = async () => {
    const point = await page.evaluate(() => {
      const { scene, camera, renderer } = (window as any).cageGame;
      const model = scene.children.find((child: any) => child.name === 'Birdcage');
      const mesh = model.children[0].children[0];
      mesh.geometry.computeBoundingBox();
      const centre = mesh.geometry.boundingBox.getCenter(model.position.clone());
      mesh.localToWorld(centre).project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return { x: rect.left + (centre.x + 1) * rect.width / 2, y: rect.top + (1 - centre.y) * rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
  };
  const slot = (id: string) => page.locator(`dst-inventory-bar .inventory-bar__items [data-item-id="${id}"]`);

  const approach = async () => {
    await page.keyboard.down('w');
    await expect.poll(() => page.evaluate(() => {
      const { scene, player } = (window as any).cageGame;
      const model = scene.children.find((child: any) => child.name === 'Birdcage');
      return Math.hypot(model.position.x - player.position.x, model.position.z - player.position.z);
    })).toBeLessThan(8);
    await page.keyboard.up('w');
  };
  const start = async () => { await page.goto('/tests/dst-lighting.html'); await prepare(); };
  return { prepare, submit, saveGame, cage, clickCage, slot, approach, start };
}

test('keeps a canary in the cage, starves it onto the shelf and saves every state', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const { prepare, submit, saveGame, cage, clickCage, slot, approach, start } = await harness(page, errors);
  await start();
  await submit('c_spawn("birdcage")');
  await expect.poll(cage).toMatchObject({ state: '_empty', status: 'GENERIC', animation: 'idle_empty', bird: null, tags: [] });
  await submit('c_give("canary")');
  await approach();

  // The held canary is imprisoned: the same inst leaves the cursor and the cage turns on its trader.
  await slot('canary').click();
  await clickCage();
  await expect.poll(cage).toMatchObject({ state: '_bird', status: 'OCCUPIED', bird: 'canary', tags: ['occupied', 'trader'] });
  await expect(slot('canary')).toHaveCount(0);
  await expect.poll(async () => (await cage())!.animation).toBe('idle_bird');

  // Sweeping the cage with the reskin tool swaps the skin build and keeps the canary override.
  await submit('c_give("reskin_tool")');
  const sweeper = await page.evaluate(async inventoryUrl => {
    const { equipmentSlotAddress, inventorySlotAddress } = await import(inventoryUrl);
    const game = (window as any).cageGame, store = game.main.inventory, hand = equipmentSlotAddress('hand');
    const source = store.exportState().slots.find((entry: any) => entry.address.containerId === 'player:inventory' && entry.item?.itemId === 'reskin_tool');
    if (!source || !store.applySlotChanges([
      { slot: inventorySlotAddress(Number(source.address.slotKey)), itemId: 'reskin_tool', skinId: source.item.skinId, delta: -1 },
      { slot: hand, itemId: 'reskin_tool', skinId: source.item.skinId, delta: 1 },
    ])) throw new Error('Unable to equip sweeper');
    await game.player.userData.animationController.setCarryItem('reskin_tool', source.item.skinId);
    return true;
  }, `/@fs${fileURLToPath(new URL('../../inventory/src/index.ts', import.meta.url))}`);
  expect(sweeper).toBe(true);
  const plainAtlases = await page.evaluate(() => (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage').children[0].children[0].material.length);
  const point = await page.evaluate(() => {
    const { scene, camera, renderer } = (window as any).cageGame;
    const model = scene.children.find((child: any) => child.name === 'Birdcage');
    const mesh = model.children[0].children[0];
    mesh.geometry.computeBoundingBox();
    const centre = mesh.geometry.boundingBox.getCenter(model.position.clone()).applyMatrix4(mesh.matrixWorld).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (centre.x + 1) * rect.width / 2, y: rect.top + (1 - centre.y) * rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage').userData.skinId)).toBe('birdcage_adventure');
  await expect.poll(() => page.evaluate(() => (window as any).cageGame.player.userData.animationController.isReskinning)).toBe(false);
  expect(await cage()).toMatchObject({ state: '_bird', bird: 'canary', animation: 'idle_bird' });
  expect(await page.evaluate(() => (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage').children[0].children[0].material.length))
    .toBeGreaterThanOrEqual(plainAtlases);

  const saved = await saveGame();
  const record = saved.world.entities.birdcage[0].components.birdcage;
  expect(saved.world.entities.birdcage[0].components.building.skinId).toBe('birdcage_adventure');
  expect(record).toMatchObject({ cageState: '_bird', birdType: 'canary', occupant: { itemId: 'canary', count: 1 } });
  expect(record.occupant.freshnessPercent).toBeGreaterThan(.99);
  expect(JSON.stringify(saved.players.local.inventory)).not.toContain('canary');

  // A skinned cage keeps drawing its canary from the override build.
  saved.world.entities.birdcage[0].components.building.skinId = 'birdcage_circus';
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload(); await prepare();
  await expect.poll(cage).toMatchObject({ state: '_bird', bird: 'canary', animation: 'idle_bird' });
  expect(await page.evaluate(() => {
    const model = (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage');
    return { skin: model.userData.skinId, atlases: model.children[0].children[0].material.length };
  })).toMatchObject({ skin: 'birdcage_circus', atlases: expect.any(Number) });
  expect((await saveGame()).world.entities.birdcage[0].components.birdcage.occupant.entityId).toBe(record.occupant.entityId);

  // Starvation: the bird's perishable ends, the cage shows the death state and shelves the meat.
  await page.evaluate(() => {
    const model = (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage');
    model.userData.actionEntity.components.birdcage.getBird().components.perishable.SetPercent(.0001);
  });
  await expect.poll(cage, { timeout: 60_000 }).toMatchObject({ state: '_death', status: 'DEAD', bird: null, shelf: 'smallmeat', tags: ['takeshelfitem'] });
  const dead = await saveGame();
  expect(dead.world.entities.birdcage[0].components.birdcage).toMatchObject({ cageState: '_death', birdType: 'canary', item: { itemId: 'smallmeat' } });

  // Rot: the shelved meat spoils into the skeleton state.
  await page.evaluate(() => {
    const model = (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage');
    model.userData.actionEntity.components.birdcage.item.components.perishable.SetPercent(.0001);
  });
  await expect.poll(cage, { timeout: 60_000 }).toMatchObject({ state: '_skeleton', status: 'SKELETON', shelf: 'spoiled_food', tags: ['takeshelfitem'] });
  expect((await saveGame()).world.entities.birdcage[0].components.birdcage).toMatchObject({ cageState: '_skeleton', item: { itemId: 'spoiled_food' } });

  // TAKEITEM mucks the cage out and re-enables the occupiable.
  await clickCage();
  await expect.poll(cage).toMatchObject({ state: '_empty', status: 'GENERIC', shelf: null, tags: [] });
  await expect(slot('spoiled_food')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('feeds, wakes, releases and hammers an occupied cage', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const { submit, saveGame, cage, clickCage, slot, approach, start } = await harness(page, errors);
  const bird = () => page.evaluate(() => (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage')
    .userData.actionEntity.components.birdcage);
  await start();
  await submit('c_spawn("birdcage")');
  await expect.poll(cage).toMatchObject({ state: '_empty' });
  await submit('c_give("canary")');
  await submit('c_give("smallmeat")');
  await approach();
  await slot('canary').click();
  await clickCage();
  await expect.poll(cage).toMatchObject({ state: '_bird', bird: 'canary' });

  // Meat is accepted: after the peck clips the bird is full again and an egg drops beside the cage.
  await page.evaluate(async () => {
    const cageComponent = (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage')
      .userData.actionEntity.components.birdcage;
    cageComponent.getBird().components.perishable.SetPercent(.4);
  });
  await expect.poll(cage).toMatchObject({ status: 'HUNGRY' });
  await slot('smallmeat').click();
  await clickCage();
  await expect.poll(async () => (await cage())!.status, { timeout: 30_000 }).toBe('OCCUPIED');
  await expect.poll(async () => JSON.stringify((await saveGame()).world.entities.ground_item ?? [])).toContain('bird_egg');
  await expect(slot('smallmeat')).toHaveCount(0);

  // A sleeping cage refuses gifts; waking returns to the idle loop.
  await page.evaluate(async () => {
    const cageComponent = (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage')
      .userData.actionEntity.components.birdcage;
    cageComponent.sleeper.GoToSleep();
  });
  await expect.poll(cage).toMatchObject({ status: 'SLEEPING', animation: 'sleep_loop' });
  expect((await page.evaluate(async () => {
    const cageComponent = (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage')
      .userData.actionEntity.components.birdcage;
    return cageComponent.trader.AbleToAccept({ prefab: 'smallmeat', hasTag: () => false });
  }))).toEqual({ ok: false, reason: 'SLEEPING' });
  await page.evaluate(() => (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage')
    .userData.actionEntity.components.birdcage.sleeper.WakeUp());
  await expect.poll(cage).toMatchObject({ animation: 'idle_bird' });

  // HARVEST (FREE) returns the same inst, with its hunger, to the inventory.
  await page.evaluate(() => (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage')
    .userData.actionEntity.components.birdcage.getBird().components.perishable.SetPercent(.7));
  const before = (await saveGame()).world.entities.birdcage[0].components.birdcage.occupant;
  await clickCage();
  await expect.poll(cage).toMatchObject({ state: '_empty', bird: null });
  await expect(slot('canary')).toHaveCount(1);
  const freed = JSON.stringify((await saveGame()).players.local.inventory);
  expect(freed).toContain(before.entityId);
  expect(freed).toMatch(/"freshnessPercent":0\.[67]/);

  // Hammering an occupied cage drops the bird itself along with the recipe loot.
  await slot('canary').click();
  await clickCage();
  await expect.poll(cage).toMatchObject({ state: '_bird' });
  await page.evaluate(() => {
    const model = (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage');
    const workable = model.userData.actionEntity.components.workable;
    for (let hit = 0; hit < 4; hit++) workable.WorkedBy({}, 1);
  });
  await expect.poll(cage).toBeNull();
  await expect.poll(async () => JSON.stringify((await saveGame()).world.entities.ground_item ?? []), { timeout: 15_000 }).toContain('"itemId":"canary"');
  expect(errors).toEqual([]);
});

test('c_give and c_spawn carry birds and eggs through c_save: carried birds starve, grounded ones do not', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const { submit, saveGame, prepare, start } = await harness(page, errors);
  await start();
  await submit('c_give("crow")');
  await submit('c_give("robin_winter")');
  await submit('c_give("bird_egg")');
  await submit('c_spawn("canary")');
  await submit('c_spawn("rottenegg")');
  const inventoryItems = (save: any) => JSON.stringify(save.players.local.inventory);
  await expect.poll(async () => inventoryItems(await saveGame())).toMatch(/robin_winter/);
  await expect.poll(async () => JSON.stringify((await saveGame()).world.entities.ground_item ?? [])).toMatch(/canary[\s\S]*rottenegg|rottenegg[\s\S]*canary/);
  const first = await saveGame();
  expect(inventoryItems(first)).toMatch(/"itemId":"crow"/);
  expect(inventoryItems(first)).toMatch(/"itemId":"bird_egg"/);
  const ground = JSON.stringify(first.world.entities.ground_item);
  expect(ground).toContain('"itemId":"canary"');
  expect(ground).toContain('"itemId":"rottenegg"');

  // A carried bird loses freshness; the one standing on the ground keeps it.
  await page.waitForTimeout(3_000);
  const later = await saveGame();
  const freshness = (save: any, id: string) => {
    const hit = (JSON.stringify(save).match(new RegExp(`"itemId":"${id}"[^}]*?"freshnessPercent":([0-9.e-]+)`)) ?? [])[1];
    return hit === undefined ? undefined : Number(hit);
  };
  expect(freshness(later, 'crow')).toBeLessThan(1);
  expect(freshness(later, 'canary')).toBe(1);

  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: later }));
  await page.reload(); await prepare();
  const reloaded = await saveGame();
  // Time passes between the save and the reload, so the carried bird can only have starved a little more.
  expect(freshness(reloaded, 'crow')).toBeLessThanOrEqual(freshness(later, 'crow')!);
  expect(freshness(reloaded, 'crow')).toBeGreaterThan(freshness(later, 'crow')! - .02);
  expect(freshness(reloaded, 'canary')).toBe(1);
  expect(JSON.stringify(reloaded.world.entities.ground_item)).toContain('"itemId":"canary"');
  expect(errors).toEqual([]);
});
