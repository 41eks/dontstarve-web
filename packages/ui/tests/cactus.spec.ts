import { hoverSprite } from './sprite-input';
import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('picking a spawned cactus hurts through the worn dreadstone hat, flinches, and c_save keeps both cacti', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.entities = {}; save.world.elapsedSeconds = 0;
    save.players.local.transform.position = [0, 0, 0];
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  const urls = Object.fromEntries(['main', 'universal', 'view', 'player', 'playerStats'].map(name =>
    [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));
  await page.goto('/tests/dst-lighting.html?save=initial-world.json');
  await page.evaluate(async urls => {
    const { inventory, gameReady } = await import(urls.main); await gameReady;
    const { scene } = await import(urls.universal), { view } = await import(urls.view);
    const { player, playerBody } = await import(urls.player), { playerStats } = await import(urls.playerStats);
    playerBody.position.set(0, playerBody.shapes[0].radius, 0); playerBody.velocity.set(0, 0, 0); player.position.set(0, 0, 0);
    (window as any).cactusGame = { inventory, scene, view, player, playerStats, states: [] as string[] };
    const { stategraph } = (window as any).__prefabInstance(player).animationController;
    stategraph.listenForEvent('newstate', () => (window as any).cactusGame.states.push(stategraph.stateName));
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const cacti = () => page.evaluate(() => (window as any).cactusGame.scene.children
    .filter((model: any) => ['cactus', 'oasis_cactus'].includes((window as any).__prefabInstance(model)?.prefab)).map((model: any) => (window as any).__prefabInstance(model).prefab));

  await submit('c_spawn("cactus");c_give("dreadstonehat");c_give("cactus_flower", 2);c_spawn("cactus_flower")');
  await expect.poll(cacti).toEqual(['cactus']);
  await page.evaluate(() => {
    const { inventory } = (window as any).cactusGame;
    inventory.EquipFromInventory(inventory.FindItem((entity: any) => entity.prefab === 'dreadstonehat'));
  });
  await expect.poll(() => page.evaluate(() => (window as any).cactusGame.inventory.GetEquippedItem('head')?.prefab)).toBe('dreadstonehat');
  const point = () => page.evaluate(async moduleUrl => {
    const { scene, view } = (window as any).cactusGame;
    const model = scene.children.find((model: any) => (window as any).__prefabInstance(model)?.prefab === 'cactus');
    scene.updateMatrixWorld(true);
    const { spriteScreenPoint } = await import(moduleUrl);
    return spriteScreenPoint(model, view.camera, view.renderer);
  }, `/@fs${fileURLToPath(new URL('./sprite-screen-point.ts', import.meta.url))}`);
  const target = await hoverSprite(page, point, 'cactusGame', 'left', 'PICK');
  await page.mouse.click(target.x, target.y);
  await expect.poll(() => page.evaluate(() => (window as any).cactusGame.inventory.count('cactus_meat'))).toBe(1);
  // CACTUS_DAMAGE 6: the hat absorbs 90%, so 0.6 reaches health and 5.4 wears the hat, which starts regenerating.
  const after = await page.evaluate(() => {
    const { inventory, playerStats, states } = (window as any).cactusGame;
    return { health: playerStats.health.peek(), armor: inventory.GetEquippedItem('head').components.armor.condition.peek(), states: [...states] };
  });
  expect(after.health).toBeCloseTo(150 - .6);
  expect(after.armor).toBeGreaterThanOrEqual(840 - 5.4 - 1e-9);
  expect(after.armor).toBeLessThan(840);
  expect(after.states).toContain('hit');

  await submit('c_spawn("oasis_cactus")');
  await expect.poll(cacti).toHaveLength(2);
  const download = page.waitForEvent('download'); await submit('c_save()');
  const saved = JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  expect(saved.world.entities.cactus).toHaveLength(1);
  expect(saved.world.entities.cactus[0].components.pickable).toMatchObject({ picked: true });
  expect(saved.world.entities.oasis_cactus).toHaveLength(1);
  expect(saved.world.entities.ground_item.map((record: any) => record.components.stack.itemId)).toContain('cactus_flower');
  const items = Object.values(saved.players.local.inventory.containers as Record<string, { slots: { item: any }[] }>)
    .flatMap(container => container.slots.map(slot => slot.item));
  expect(items.find(item => item.itemId === 'cactus_flower').count).toBe(2);
  expect(items.find(item => item.itemId === 'dreadstonehat').armor.condition).toBeLessThan(840);
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload();
  await page.evaluate(async urls => {
    const { inventory, gameReady } = await import(urls.main); await gameReady;
    const { scene } = await import(urls.universal);
    (window as any).cactusGame = { inventory, scene };
  }, urls);
  await expect.poll(cacti).toEqual(expect.arrayContaining(['cactus', 'oasis_cactus']));
  await expect.poll(() => page.evaluate(() => ((window as any).__findActionEntity((window as any).cactusGame.scene.children
    .find((model: any) => (window as any).__prefabInstance(model)?.prefab === 'cactus'))?.components ?? (window as any).__prefabInstance((window as any).cactusGame.scene.children
    .find((model: any) => (window as any).__prefabInstance(model)?.prefab === 'cactus'))!.components).pickable.canBePicked)).toBe(false);
  expect(await page.evaluate(() => (window as any).cactusGame.inventory.GetEquippedItem('head').components.armor.condition.peek() < 840)).toBe(true);
  expect(errors).toEqual([]);
});
