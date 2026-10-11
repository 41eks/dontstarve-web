import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('game c_give uses real spellcaster equipment, blocks busy world input and exports its spent uses', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/dst-lighting.html');
  const urls = Object.fromEntries(['main', 'universal', 'view', 'playerStats', 'save/deserialize', 'save/catalog',
    'save/inventoryState'].map(name => [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  urls.inventory = `/@fs${fileURLToPath(new URL('../../inventory/src/index.ts', import.meta.url))}`;
  const before = await page.evaluate(async urls => {
    const { inventory } = await import(urls.main);
    const { view } = await import(urls.view);
    const { scene } = await import(urls.universal);
    const { playerStats } = await import(urls.playerStats);
    const { equipmentSlotAddress } = await import(urls.inventory);
    const hand = equipmentSlotAddress('hand'), old = inventory.get(hand);
    if (old) inventory.applySlotChanges([{ slot: hand, itemId: old.itemId, skinId: old.skinId, delta: -old.count }]);
    const ids = new Set(inventory.entities.values().map((item: any) => item.id));
    document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', {
      detail: { command: 'c_give("yellowstaff")' },
    }));
    const item = inventory.entities.values().find((item: any) => item.prefab === 'yellowstaff' && !ids.has(item.id));
    if (!item) throw new Error('c_give did not create a staff');
    const slot = inventory.addresses().find((slot: any) => inventory.getEntity(slot) === item);
    if (!slot || !inventory.transfer(slot, hand, 1)) throw new Error('Unable to equip staff');
    (window as any).spellGame = { inventory, view, scene, hand, item, playerStats,
      stars: new Set(scene.children.filter((model: any) => model.name === 'stafflight')) };
    return { id: item.id, sanity: playerStats.sanity.peek() };
  }, urls);
  await expect.poll(() => page.evaluate(() => {
    const { view, item } = (window as any).spellGame;
    const mesh = view.player.children[0].children[0];
    return item.hasTag('castonpoint') && mesh.material.some((material: any) => material.name === 'ground:swap_staffs')
      && view.player.userData.stategraph.stateName === 'idle';
  })).toBe(true);
  const point = await page.evaluate(() => {
    const { view } = (window as any).spellGame;
    const target = view.player.position.clone(); target.x += 12; target.z += 12; target.y = 0;
    target.project(view.camera);
    const rect = view.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (target.x + 1) * rect.width / 2, y: rect.top + (1 - target.y) * rect.height / 2 };
  });
  await page.mouse.move(point.x, point.y);
  expect(await page.evaluate(() => {
    const { view, item } = (window as any).spellGame;
    return view.mouseActions.getMouseActions().right?.invobject === item;
  })).toBe(true);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => (window as any).spellGame.view.player.userData.controllerEnabled)).toBe(false);
  expect(await page.evaluate(() => (window as any).spellGame.view.mouseActions.getMouseActions())).toEqual({});
  await expect.poll(() => page.evaluate(() => (window as any).spellGame.item.components.finiteuses.remaining)).toBe(19);
  await expect.poll(() => page.evaluate(() => (window as any).spellGame.view.player.userData.controllerEnabled)).toBe(true);
  expect(await page.evaluate(() => (window as any).spellGame.playerStats.sanity.peek())).toBe(Math.max(0, before.sanity - 20));
  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', {
    detail: { command: 'c_save()' },
  })));
  const download = await downloadPromise;
  const json = await readFile((await download.path())!, 'utf8');
  const result = await page.evaluate(async ({ json, urls }) => {
    const { deserializeSave } = await import(urls['save/deserialize']);
    const { SAVE_CATALOG } = await import(urls['save/catalog']);
    const { inventoryStateFromSave } = await import(urls['save/inventoryState']);
    const saved = deserializeSave(json, SAVE_CATALOG);
    const { inventory, hand, scene, stars } = (window as any).spellGame;
    const star = scene.children.find((model: any) => model.name === 'stafflight' && !stars.has(model));
    inventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
    return { item: inventory.getEntity(hand).snapshot(), sanity: saved.players.local.stats.sanity,
      star: saved.world.entities.stafflight.find((record: any) => record.id === star.userData.entityId),
      starPosition: star.position.toArray() };
  }, { json, urls });
  expect(result.item).toMatchObject({ entityId: before.id, itemId: 'yellowstaff', count: 1, remainingUses: 19 });
  expect(result.sanity).toBe(Math.max(0, before.sanity - 20));
  expect(result.star.transform.position).toEqual(result.starPosition);
  expect(result.star.components.timer.remainingSeconds).toBeGreaterThan(1430);
  expect(errors).toEqual([]);
});
