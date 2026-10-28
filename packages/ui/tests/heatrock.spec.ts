import { readSaveDownload } from './save-download';
import { minimalSave, savePageUrl } from './inline-save';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera', 'player'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('spawns and gives neutral thermal stones, reskins and transfers one, then saves and reloads their identities and fuel', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const prepare = () => page.evaluate(async urls => {
    const main = await import(urls.main), { scene, renderer } = await import(urls.universal);
    const { camera } = await import(urls.camera), { player, playerBody } = await import(urls.player);
    (window as any).heatRockGame = { main, scene, renderer, camera, player, playerBody };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const saveGame = async () => {
    const download = page.waitForEvent('download'); await submit('c_save()');
    return JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  };
  const ground = () => page.evaluate(() => (window as any).heatRockGame.scene.children
    .filter((model: any) => model.userData.itemId === 'heatrock').map((model: any) => ({
      id: (window as any).__prefabInstance(model)?.entityId, skin: (window as any).__prefabInstance(model)?.skinId,
      vertices: model.getObjectByProperty('isMesh', true).geometry.drawRange.count,
      materials: model.getObjectByProperty('isMesh', true).material.map((material: any) => material.name),
    })));
  const clickStone = async (id: string, button: 'left' | 'right') => {
    await expect.poll(() => page.evaluate(() => !(window as any).heatRockGame.player.userData.stategraph.hasStateTag('busy')),
      { timeout: 20_000 }).toBe(true);
    const point = await page.evaluate(async ({ id, pointerUrl }) => {
      const { scene, camera, renderer } = (window as any).heatRockGame;
      const model = scene.children.find((model: any) => (window as any).__prefabInstance(model)?.entityId === id), mesh = model.getObjectByProperty('isMesh', true);
      const { PointerRaycaster } = await import(pointerUrl);
      const pointer = new PointerRaycaster({ scene, camera, renderer });
      const rect = renderer.domElement.getBoundingClientRect();
      // Animation buffers can include unused vertices, and a frame's centre can be transparent.
      const box = mesh.geometry.boundingBox;
      try {
        for (const y of [.5, .3, .7, .1, .9]) for (const x of [.5, .3, .7, .1, .9]) {
          const sample = model.position.clone().set(box.min.x + (box.max.x - box.min.x) * x,
            box.min.y + (box.max.y - box.min.y) * y, box.min.z);
          mesh.localToWorld(sample).project(camera);
          const point = { x: rect.left + (sample.x + 1) * rect.width / 2, y: rect.top + (1 - sample.y) * rect.height / 2 };
          pointer.trackPointer({ clientX: point.x, clientY: point.y } as PointerEvent);
          let picked = pointer.pickMouseTarget()?.object;
          while (picked && picked !== model) picked = picked.parent;
          if (picked === model) return point;
        }
        throw new Error('No opaque thermal stone pixel to click');
      } finally { pointer.dispose(); }
    }, { id, pointerUrl: `/@fs${fileURLToPath(new URL('../../stategraphs/src/pointerRaycaster.ts', import.meta.url))}` });
    await page.mouse.click(point.x, point.y, { button });
  };
  const slots = (save: any) => Object.values(save.players.local.inventory.containers).flatMap((container: any) => container.slots) as any[];
  const stones = (save: any) => slots(save).filter(slot => slot.item.itemId === 'heatrock').map(slot => slot.item);
  const expectStoneState = (actual: any, expected: any, elapsed: number) => {
    const { temperature: actualTemperature, ...actualState } = actual;
    const { temperature: expectedTemperature, ...expectedState } = expected;
    expect(actualState).toEqual(expectedState);
    // These neutral stones keep exchanging heat while the browser performs input and save/load.
    // Their source rate is at most 1 degree/game second; discrete item state must remain exact.
    expect(Math.abs(actualTemperature.current - expectedTemperature.current)).toBeLessThanOrEqual(elapsed + 1e-6);
  };
  const expectInventoryStones = (actual: any, expected: any) => {
    expect(stones(actual)).toHaveLength(stones(expected).length);
    stones(actual).forEach((stone: any, index: number) => expectStoneState(stone, stones(expected)[index],
      actual.world.elapsedSeconds - expected.world.elapsedSeconds));
  };

  await page.goto(savePageUrl(minimalSave())); await prepare();
  await submit('c_give("heatrock", 2); c_give("reskin_tool"); c_spawn("heatrock")');
  const bar = page.locator('dst-inventory-bar'), bag = bar.locator('.inventory-bar__items');
  await expect(bag.locator('[data-item-id="heatrock"]')).toHaveCount(2);
  await expect(bag.locator('[data-item-id="heatrock"]').first().locator('.inventory-slot__icon')).toHaveAttribute('data-element', 'heat_rock3.tex');
  await expect.poll(async () => (await ground()).length).toBe(1);
  const spawned = (await ground())[0];
  expect(spawned.vertices).toBeGreaterThan(0); expect(spawned.materials).toContain('ground:heat_rock');
  await page.evaluate(id => {
    const game = (window as any).heatRockGame;
    game.scene.children.find((model: any) => (window as any).__prefabInstance(model)?.entityId === id).userData.components.fueled.SetPercent(.75);
    game.playerBody.position.set(-3, game.playerBody.shapes[0].radius, 3); game.player.position.set(-3, 0, 3);
  }, spawned.id);
  await bag.locator('[data-item-id="reskin_tool"]').dragTo(bar.locator('[data-slot-key="hand"]'));
  await clickStone(spawned.id, 'right');
  await expect.poll(async () => (await ground())[0]?.skin, { timeout: 20_000 }).toBe('heatrock_fantasy');
  expect((await ground())[0].materials).toContain('ground:heatrock_fantasy');
  const groundSave = await saveGame();
  const savedStone = groundSave.world.entities.ground_item.find((record: any) => record.id === spawned.id);
  expect(savedStone.components.stack).toMatchObject({ itemId: 'heatrock', count: 1, skinId: 'heatrock_fantasy', remainingFuel: 75 });
  expect(stones(groundSave)).toHaveLength(2);

  await clickStone(spawned.id, 'left');
  const skinned = bag.locator('[data-item-id="heatrock"][data-skin-id="heatrock_fantasy"]');
  await expect(skinned).toBeVisible();
  await expect(skinned.locator('.inventory-slot__icon')).toHaveAttribute('data-element', 'heatrock_fantasy3.tex');
  await page.keyboard.down('Shift'); await skinned.click({ button: 'right' }); await page.keyboard.up('Shift');
  await expect.poll(async () => (await ground()).some(stone => stone.id === spawned.id && stone.skin === 'heatrock_fantasy')).toBe(true);
  const dropped = await saveGame();
  expectStoneState(dropped.world.entities.ground_item.find((record: any) => record.id === spawned.id).components.stack,
    savedStone.components.stack, dropped.world.elapsedSeconds - groundSave.world.elapsedSeconds);
  await page.goto(savePageUrl(dropped)); await prepare();
  await expect.poll(async () => (await ground())[0]?.skin).toBe('heatrock_fantasy');
  const restored = await saveGame();
  expect(restored.world.entities.ground_item).toHaveLength(dropped.world.entities.ground_item.length);
  restored.world.entities.ground_item.forEach((record: any, index: number) => {
    const expected = dropped.world.entities.ground_item[index];
    expect({ ...record, components: undefined }).toEqual({ ...expected, components: undefined });
    expect({ ...record.components, stack: undefined }).toEqual({ ...expected.components, stack: undefined });
    expectStoneState(record.components.stack, expected.components.stack,
      restored.world.elapsedSeconds - dropped.world.elapsedSeconds);
  });
  expectInventoryStones(restored, dropped);
  await clickStone(spawned.id, 'left'); await expect(skinned).toBeVisible();
  const taken = await saveGame();
  expectStoneState(stones(taken).find(item => item.entityId === spawned.id), { entityId: spawned.id, ...savedStone.components.stack },
    taken.world.elapsedSeconds - groundSave.world.elapsedSeconds);
  expect(taken.world.entities.ground_item ?? []).toEqual([]);
  await page.goto(savePageUrl(taken)); await prepare();
  expectInventoryStones(await saveGame(), taken);
  await expect(skinned.locator('.inventory-slot__icon')).toHaveAttribute('data-element', 'heatrock_fantasy3.tex');
  expect(errors).toEqual([]);
});
