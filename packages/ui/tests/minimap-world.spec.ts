import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('pig king and ground backpack icons render, backpack ownership hides them, and saved positions reload', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let saved: any;
  await page.route('**/saves/initial-world.json', async route => {
    if (saved) { await route.fulfill({ json: saved }); return; }
    const response = await route.fetch(), initial = await response.json();
    for (const [prefab, records] of Object.entries(initial.world.entities)) {
      if (prefab !== 'pigking') initial.world.entities[prefab] = [];
      else (records as any[]).forEach(record => { record.transform.position = [0, 0, 36]; });
    }
    for (const container of Object.values(initial.players.local.inventory.containers) as any[]) container.slots = [];
    initial.players.local.transform.position = [0, 0, 0];
    initial.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: initial });
  });
  const start = async () => {
    await page.evaluate(async urls => {
      const main = await import(urls.main), { scene } = await import(urls.universal);
      const map = document.querySelector('dst-minimap') as any;
      (window as any).worldIcons = { main, scene, map, entities: () => map.options.getMiniMapEntities() };
    }, urls);
    await page.keyboard.press('m');
    await expect(page.locator('dst-minimap section.minimap')).toBeVisible();
  };
  await page.goto('/tests/dst-lighting.html');
  await start();
  const command = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  await command('c_spawn("backpack")');
  await expect.poll(() => page.evaluate(() => (window as any).worldIcons.entities().filter((icon: any) => icon.icon === 'backpack.png').length)).toBe(1);
  const identities = await page.evaluate(() => {
    const g = (window as any).worldIcons;
    const model = g.scene.children.find((object: any) => object.userData.itemId === 'backpack');
    g.bag = model.userData.pickupTarget.entity;
    g.bag.transform.position.set(36, 0, -24);
    g.map.view.zoom = 6;
    g.map.view.center(0, 0);
    const king = g.scene.getObjectByName('PigKingStandee');
    const pigIcon = g.entities().find((icon: any) => icon.icon === 'pigking.png');
    return { backpackId: g.bag.id, pigKingId: king.userData.entityId, pigPriority: pigIcon.priority };
  });
  expect(identities.pigPriority).toBe(1);
  await expect.poll(() => page.evaluate(() => {
    const map = (window as any).worldIcons.map;
    return Boolean(map.icons.get('pigking.png') && map.icons.get('backpack.png'));
  })).toBe(true);
  const frame = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const pixels = () => page.evaluate(() => {
    const { map } = (window as any).worldIcons;
    const context = map.shadowRoot.querySelector('canvas').getContext('2d');
    return [[0, 36], [36, -24]].map(([x, z]) => {
      const at = map.view.worldToScreen(x, z);
      return Array.from(context.getImageData(at.x - 18, at.z - 18, 36, 36).data);
    });
  });
  await frame();
  const visible = await pixels();
  await page.screenshot({ path: testInfo.outputPath('pigking-backpack-minimap.png') });
  await page.evaluate(() => (window as any).worldIcons.entities().forEach((icon: any) => {
    if (icon.icon === 'pigking.png' || icon.icon === 'backpack.png') icon.SetEnabled(false);
  }));
  await frame();
  const hidden = await pixels();
  expect(visible[0]).not.toEqual(hidden[0]);
  expect(visible[1]).not.toEqual(hidden[1]);
  await page.evaluate(() => {
    const g = (window as any).worldIcons;
    g.entities().find((icon: any) => icon.icon === 'pigking.png').SetEnabled(true);
    g.bag.MiniMapEntity.SetEnabled(true);
    if (!g.main.inventory.Equip(g.bag)) throw new Error('Backpack equip failed');
  });
  await expect.poll(() => page.evaluate(() => (window as any).worldIcons.entities().some((icon: any) => icon.icon === 'backpack.png'))).toBe(false);
  expect(await page.evaluate(() => (window as any).worldIcons.bag.MiniMapEntity.enabled)).toBe(false);
  await page.evaluate(() => {
    const g = (window as any).worldIcons;
    g.main.inventory.DropItem(g.bag, g.bag.transform.position.clone().set(36, 0, -24));
  });
  await expect.poll(() => page.evaluate(() => (window as any).worldIcons.entities().some((icon: any) => icon.icon === 'backpack.png'))).toBe(true);
  const download = page.waitForEvent('download');
  await command('c_save()');
  saved = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  const bag = saved.world.entities.ground_item.find((record: any) => record.id === identities.backpackId);
  expect(bag.transform.position).toEqual([36, 0, -24]);
  expect(bag.components.stack).toMatchObject({ itemId: 'backpack', count: 1 });
  expect(saved.world.entities.pigking[0]).toMatchObject({ id: identities.pigKingId, transform: { position: [0, 0, 36] } });
  await page.reload();
  await start();
  await expect.poll(() => page.evaluate(() => {
    const g = (window as any).worldIcons;
    return g.entities().filter((icon: any) => icon.icon === 'pigking.png' || icon.icon === 'backpack.png')
      .map((icon: any) => ({ icon: icon.icon, x: icon.position.x, z: icon.position.z }));
  })).toEqual([{ icon: 'pigking.png', x: 0, z: 36 }, { icon: 'backpack.png', x: 36, z: -24 }]);
  expect(await page.evaluate(() => {
    const g = (window as any).worldIcons;
    return g.scene.children.find((object: any) => object.userData.itemId === 'backpack').userData.entityId;
  })).toBe(identities.backpackId);
  expect(errors).toEqual([]);
});
