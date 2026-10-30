import { readSaveDownload } from './save-download';
import { minimalSave } from './inline-save';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const urls = {
  ...Object.fromEntries(['main', 'universal', 'camera', 'player', 'view'].map(name =>
    [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`])),
};

async function harness(page: Page, errors: string[]) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || (message.type() === 'warning' && /Unable to (prepare|play)/.test(message.text()))) errors.push(message.text());
  });
  await page.route('**/saves/birdcage-test.json', route => route.fulfill({ json: minimalSave() }));
  const prepare = () => page.evaluate(async urls => {
    const main = await import(urls.main), { scene, renderer } = await import(urls.universal);
    const { camera } = await import(urls.camera);
    const { player } = await import(urls.player);
    const { view } = await import(urls.view);
    const cageModel = () => scene.children.find((child: any) => child.name === 'Birdcage');
    const cageMesh = () => {
      let mesh: any;
      cageModel()?.traverse((child: any) => { if (child.isMesh) mesh = child; });
      return mesh;
    };
    const cagePoint = (action: string, button: 'left' | 'right' = 'left') => {
      const model = cageModel()!, mesh = cageMesh();
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox, rect = renderer.domElement.getBoundingClientRect();
      const picker = view.mouseActions;
      // Choose visible art that offers the requested action and is not covered by DOM UI.
      for (const y of [.95, .05, .8, .2, .65, .35, .5]) for (const x of [.5, .35, .65, .2, .8, .05, .95]) {
        const point = box.getCenter(model.position.clone());
        point.x = box.min.x + (box.max.x - box.min.x) * x;
        point.y = box.min.y + (box.max.y - box.min.y) * y;
        mesh.localToWorld(point).project(camera);
        const clientX = Math.round(rect.left + (point.x + 1) * rect.width / 2);
        const clientY = Math.round(rect.top + (1 - point.y) * rect.height / 2);
        if (document.elementFromPoint(clientX, clientY) !== renderer.domElement) continue;
        const selected = picker.getMouseActions(new PointerEvent('pointermove', { clientX, clientY }))[button];
        if (picker.targetModel === model && selected?.action === action) return { x: clientX, y: clientY };
      }
      return null;
    };
    (window as any).cageGame = { main, scene, renderer, camera, player, cageMesh, cagePoint };
  }, urls);
  const submit = async (command: string) => {
    const completed = page.waitForEvent('console', {
      predicate: message => message.type() === 'info' && /^已(添加|生成|下载存档)/.test(message.text())
        || message.type() === 'warning' && /^(保存失败|未知)/.test(message.text()),
      timeout: 20_000,
    });
    await page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
      new CustomEvent('game:debug-command', { detail: { command } })), command);
    const result = await completed;
    if (result.type() !== 'info') throw new Error(result.text());
  };
  const saveGame = async () => {
    const download = page.waitForEvent('download', { timeout: 20_000 }); await submit('c_save()');
    try { return JSON.parse(await readSaveDownload((await (await download).path())!, 'Master')); }
    catch (error) { throw new Error(`c_save failed: ${errors.join('\n')}`, { cause: error }); }
  };
  const cage = () => page.evaluate(() => {
    const model = (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage');
    const instance = (window as any).__prefabInstance(model);
    const birdcage = instance?.components.birdcage;
    if (!birdcage) return null;
    return { state: birdcage.cageState.peek(), status: birdcage.status.peek(), animation: instance.sprite.currentAnimation,
      bird: birdcage.getBird()?.prefab ?? null, shelf: birdcage.item?.prefab ?? null,
      tags: ['occupied', 'takeshelfitem', 'trader'].filter(tag => instance.hasTag(tag)) };
  });
  const clickCage = async (action: string) => {
    await expect.poll(() => page.evaluate(() => (window as any).__prefabInstance((window as any).cageGame.player)
      .animationController.stategraph.hasStateTag('busy'))).toBe(false);
    let point: { x: number; y: number } | null = null;
    await expect.poll(async () => {
      point = await page.evaluate(action => (window as any).cageGame.cagePoint(action), action);
      return point !== null;
    }, { message: `The cage offers ${action}` }).toBe(true);
    await page.mouse.click(point!.x, point!.y);
  };
  const slot = (id: string) => page.locator(`dst-inventory-bar .inventory-bar__items [data-item-id="${id}"]`);

  const approach = async () => {
    await page.keyboard.down('w');
    await expect.poll(() => page.evaluate(() => {
      const { scene, player } = (window as any).cageGame;
      const model = scene.children.find((child: any) => child.name === 'Birdcage');
      return model.position.distanceTo(player.position);
    })).toBeLessThan(3.5);
    await page.keyboard.up('w');
  };
  const start = async () => {
    await page.goto('/tests/dst-lighting.html?save=birdcage-test.json'); await prepare();
    await expect(page.locator('canvas[data-game-canvas]')).toHaveAttribute('data-loaded', 'true', { timeout: 120_000 });
  };
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
  await clickCage('STORE');
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
    await (window as any).__prefabInstance(game.player).animationController.setCarryItem('reskin_tool', source.item.skinId);
    return true;
  }, `/@fs${fileURLToPath(new URL('../../inventory/src/index.ts', import.meta.url))}`);
  expect(sweeper).toBe(true);
  const plainAtlases = await page.evaluate(() => (window as any).cageGame.cageMesh().material.length);
  const point = await page.evaluate(() => (window as any).cageGame.cagePoint('CASTSPELL', 'right'));
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).__prefabInstance((window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage'))?.skinId)).toBe('birdcage_adventure');
  await expect.poll(() => page.evaluate(() => (window as any).__prefabInstance((window as any).cageGame.player).animationController.isReskinning)).toBe(false);
  expect(await cage()).toMatchObject({ state: '_bird', bird: 'canary', animation: 'idle_bird' });
  expect(await page.evaluate(() => (window as any).cageGame.cageMesh().material.length))
    .toBeGreaterThanOrEqual(plainAtlases);

  const saved = await saveGame();
  const record = saved.world.entities.birdcage[0].components.birdcage;
  expect(saved.world.entities.birdcage[0].components.building.skinId).toBe('birdcage_adventure');
  expect(record).toMatchObject({ cageState: '_bird', birdType: 'canary', occupant: { itemId: 'canary', count: 1 } });
  expect(record.occupant.freshnessPercent).toBeGreaterThan(.99);
  expect(JSON.stringify(saved.players.local.inventory)).not.toContain('canary');

  // A skinned cage keeps drawing its canary from the override build.
  saved.world.entities.birdcage[0].components.building.skinId = 'birdcage_circus';
  await page.route('**/saves/birdcage-test.json', route => route.fulfill({ json: saved }));
  await page.reload(); await prepare();
  await expect.poll(cage).toMatchObject({ state: '_bird', bird: 'canary', animation: 'idle_bird' });
  expect(await page.evaluate(() => {
    const model = (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage');
    return { skin: (window as any).__prefabInstance(model)?.skinId, atlases: (window as any).cageGame.cageMesh().material.length };
  })).toMatchObject({ skin: 'birdcage_circus', atlases: expect.any(Number) });
  expect((await saveGame()).world.entities.birdcage[0].components.birdcage.occupant.entityId).toBe(record.occupant.entityId);

  // Starvation: the bird's perishable ends, the cage shows the death state and shelves the meat.
  await page.evaluate(() => {
    const model = (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage');
    (window as any).__prefabInstance(model).components.birdcage.getBird().components.perishable.SetPercent(.0001);
  });
  await expect.poll(cage, { timeout: 60_000 }).toMatchObject({ state: '_death', status: 'DEAD', bird: null, shelf: 'smallmeat', tags: ['takeshelfitem'] });
  const dead = await saveGame();
  expect(dead.world.entities.birdcage[0].components.birdcage).toMatchObject({ cageState: '_death', birdType: 'canary', item: { itemId: 'smallmeat' } });

  // Rot: the shelved meat spoils into the skeleton state.
  await page.evaluate(() => {
    const model = (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage');
    (window as any).__prefabInstance(model).components.birdcage.item.components.perishable.SetPercent(.0001);
  });
  await expect.poll(cage, { timeout: 60_000 }).toMatchObject({ state: '_skeleton', status: 'SKELETON', shelf: 'spoiled_food', tags: ['takeshelfitem'] });
  expect((await saveGame()).world.entities.birdcage[0].components.birdcage).toMatchObject({ cageState: '_skeleton', item: { itemId: 'spoiled_food' } });

  // TAKEITEM mucks the cage out and re-enables the occupiable.
  await clickCage('TAKEITEM');
  await expect.poll(cage).toMatchObject({ state: '_empty', status: 'GENERIC', shelf: null, tags: [] });
  await expect(slot('spoiled_food')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('feeds, wakes, releases and hammers an occupied cage', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const { submit, saveGame, cage, clickCage, slot, approach, start } = await harness(page, errors);
  await start();
  await submit('c_spawn("birdcage")');
  await expect.poll(cage).toMatchObject({ state: '_empty' });
  await submit('c_give("canary")');
  await submit('c_give("smallmeat")');
  await approach();
  await slot('canary').click();
  await clickCage('STORE');
  await expect.poll(cage).toMatchObject({ state: '_bird', bird: 'canary' });

  // Meat is accepted: after the peck clips the bird is full again and an egg drops beside the cage.
  await page.evaluate(async () => {
    const cageComponent = (window as any).__prefabInstance((window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage')).components.birdcage;
    cageComponent.getBird().components.perishable.SetPercent(.4);
  });
  await expect.poll(cage).toMatchObject({ status: 'HUNGRY' });
  await slot('smallmeat').click();
  await clickCage('GIVE');
  await expect.poll(async () => (await cage())!.status, { timeout: 30_000 }).toBe('OCCUPIED');
  await expect.poll(async () => JSON.stringify((await saveGame()).world.entities.ground_item ?? [])).toContain('bird_egg');
  await expect(slot('smallmeat')).toHaveCount(0);

  // A sleeping cage refuses gifts; waking returns to the idle loop.
  await page.evaluate(async () => {
    const cageComponent = (window as any).__prefabInstance((window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage')).components.birdcage;
    cageComponent.sleeper.GoToSleep();
  });
  await expect.poll(cage).toMatchObject({ status: 'SLEEPING', animation: 'sleep_loop' });
  expect((await page.evaluate(async () => {
    const cageComponent = (window as any).__prefabInstance((window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage')).components.birdcage;
    return cageComponent.trader.AbleToAccept({ prefab: 'smallmeat', hasTag: () => false });
  }))).toEqual({ ok: false, reason: 'SLEEPING' });
  await page.evaluate(() => (window as any).__prefabInstance((window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage')).components.birdcage.sleeper.WakeUp());
  await expect.poll(cage).toMatchObject({ animation: 'idle_bird' });

  // HARVEST (FREE) returns the same inst, with its hunger, to the inventory.
  await page.evaluate(() => (window as any).__prefabInstance((window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage')).components.birdcage.getBird().components.perishable.SetPercent(.7));
  const before = (await saveGame()).world.entities.birdcage[0].components.birdcage.occupant;
  await clickCage('HARVEST');
  await expect.poll(cage).toMatchObject({ state: '_empty', bird: null });
  await expect(slot('canary')).toHaveCount(1);
  const freed = JSON.stringify((await saveGame()).players.local.inventory);
  expect(freed).toContain(before.entityId);
  expect(freed).toMatch(/"freshnessPercent":0\.[67]/);

  // Hammering an occupied cage drops the bird itself along with the recipe loot.
  await slot('canary').click();
  await clickCage('STORE');
  await expect.poll(cage).toMatchObject({ state: '_bird' });
  await page.evaluate(() => {
    const model = (window as any).cageGame.scene.children.find((child: any) => child.name === 'Birdcage');
    const workable = (window as any).__prefabInstance(model).components.workable;
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

  await page.route('**/saves/birdcage-test.json', route => route.fulfill({ json: later }));
  await page.reload(); await prepare();
  const reloaded = await saveGame();
  // Time passes between the save and the reload, so the carried bird can only have starved a little more.
  expect(freshness(reloaded, 'crow')).toBeLessThanOrEqual(freshness(later, 'crow')!);
  expect(freshness(reloaded, 'crow')).toBeGreaterThan(freshness(later, 'crow')! - .02);
  expect(freshness(reloaded, 'canary')).toBe(1);
  expect(JSON.stringify(reloaded.world.entities.ground_item)).toContain('"itemId":"canary"');
  expect(errors).toEqual([]);
});
