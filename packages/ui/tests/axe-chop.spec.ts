import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera', 'player'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('an equipped axe chops a moon tree with right-click, drops loot and keeps the stump across save and load', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.entities = { moon_tree: [{ id: 'chop_tree', transform: { position: [0, 0, -6], rotationY: 0 }, components: {} }] };
    save.players.local.transform.position = [0, 0, 0];
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  const prepare = () => page.evaluate(async urls => {
    const main = await import(urls.main), { scene, renderer } = await import(urls.universal);
    const { camera } = await import(urls.camera);
    const { player } = await import(urls.player);
    (window as any).chopGame = { main, scene, renderer, camera, player };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const saveGame = async () => {
    const download = page.waitForEvent('download'); await submit('c_save()');
    return JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  };
  const treeAnimation = () => page.evaluate(() => {
    const forest = (window as any).chopGame.scene.children.find((model: any) => model.name === 'MoonTreeForest');
    return forest?.children[0]?.userData.animationController.currentAnimation ?? null;
  });
  const clickTree = async () => {
    const point = await page.evaluate(() => {
      const { scene, camera, renderer } = (window as any).chopGame;
      const tree = scene.children.find((model: any) => model.name === 'MoonTreeForest').children[0];
      const ndc = tree.position.clone().setY(3).project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return { x: rect.left + (ndc.x + 1) * rect.width / 2, y: rect.top + (1 - ndc.y) * rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y, { button: 'right' });
  };

  await page.goto('/tests/dst-lighting.html'); await prepare();
  await submit('c_give("axe")');
  const bar = page.locator('dst-inventory-bar');
  const hand = bar.locator('.inventory-bar__equipment .inventory-slot').first();
  await bar.locator('.inventory-bar__items [data-item-id="axe"]').dragTo(hand);
  await expect(hand).toHaveAttribute('data-item-id', 'axe');
  await expect.poll(treeAnimation).toBe('sway1_loop_tall');

  // The player walks to the tree; the first strike wears the axe but leaves the tree standing.
  const uses = async () => (await saveGame()).players.local.inventory.containers['player:equipment'].slots[0].item.remainingUses ?? 100;
  await clickTree();
  await expect.poll(uses, { timeout: 20_000 }).toBeLessThan(100);
  expect((await saveGame()).world.entities.moon_tree[0].components).toEqual({});

  // Sixteen strikes in total; keep clicking while the tree stands.
  for (let attempt = 0; attempt < 40 && !(await treeAnimation())?.match(/^(fall|stump)/); attempt++) {
    await clickTree(); await page.waitForTimeout(700);
  }
  await expect.poll(treeAnimation, { timeout: 20_000 }).toBe('stump_tall');
  const felled = await saveGame();
  expect(felled.world.entities.moon_tree[0].components).toEqual({ moonTree: { stump: true } });
  await expect.poll(async () => (await saveGame()).world.entities.ground_item?.length ?? 0).toBeGreaterThanOrEqual(6);
  const loot = (await saveGame()).world.entities.ground_item.map((record: any) => record.components.stack.itemId);
  expect(loot.filter((itemId: string) => itemId === 'log')).toHaveLength(4);
  expect(loot.filter((itemId: string) => itemId === 'moon_tree_blossom')).toHaveLength(2);

  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: felled }));
  await page.reload(); await prepare();
  await expect.poll(treeAnimation).toBe('stump_tall');
  expect((await saveGame()).world.entities.moon_tree[0].components).toEqual({ moonTree: { stump: true } });
  expect(errors).toEqual([]);
});
