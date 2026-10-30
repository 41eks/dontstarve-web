import { hoverSprite } from './sprite-input';
import { readSaveDownload } from './save-download';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const urls = Object.fromEntries(['main', 'universal', 'camera', 'player', 'view'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('right-click mining breaks a moon shell and preserves the orb and mineral drops through c_save and reload', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch(), save = await response.json();
    save.world.entities = { rock_moon_shell: [{ id: 'mine-shell', transform: { position: [0, 0, -6], rotationY: 0 }, components: {} }] };
    save.players.local.transform.position = [0, 0, 0];
    for (const container of Object.values(save.players.local.inventory.containers) as any[]) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    await route.fulfill({ response, json: save });
  });
  const prepare = () => page.evaluate(async urls => {
    const main = await import(urls.main); await main.gameReady;
    const { scene, renderer } = await import(urls.universal), { camera } = await import(urls.camera);
    const { player } = await import(urls.player), { view } = await import(urls.view);
    (window as any).miningGame = { scene, renderer, camera, player, view, inventory: main.inventory };
  }, urls);
  const submit = (command: string) => page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command } })), command);
  const saveGame = async () => {
    const download = page.waitForEvent('download'); await submit('c_save()');
    return JSON.parse(await readSaveDownload((await (await download).path())!, 'Master'));
  };
  const workLeft = () => page.evaluate(() => {
    const shell = (window as any).miningGame.scene.children.find((model: any) => (window as any).__prefabInstance(model)?.entityId === 'mine-shell');
    return ((window as any).__findActionEntity(shell)?.components ?? (window as any).__prefabInstance(shell)!.components).workable.GetWorkLeft() ?? 0;
  });
  await page.goto('/tests/dst-lighting.html?save=initial-world.json'); await prepare();
  await expect(page.locator('canvas[data-game-canvas]')).toHaveAttribute('data-loaded', 'true');
  await submit('c_give("pickaxe")');
  const bar = page.locator('dst-inventory-bar'), hand = bar.locator('.inventory-bar__equipment .inventory-slot').first();
  await bar.locator('.inventory-bar__items [data-item-id="pickaxe"]').dragTo(hand);
  await expect(hand).toHaveAttribute('data-item-id', 'pickaxe');
  for (let hit = 0; hit < 6; hit++) {
    const point = await hoverSprite(page, () => page.evaluate(async moduleUrl => {
      const { scene, renderer, camera } = (window as any).miningGame;
      const shell = scene.children.find((model: any) => (window as any).__prefabInstance(model)?.entityId === 'mine-shell');
      const { spriteScreenPoint } = await import(moduleUrl);
      return spriteScreenPoint(shell, camera, renderer);
    }, `/@fs${fileURLToPath(new URL('./sprite-screen-point.ts', import.meta.url))}`), 'miningGame', 'right', 'MINE');
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await expect.poll(workLeft, { timeout: 10_000 }).toBe(5 - hit);
    if (hit < 5) await page.waitForTimeout(700);
  }
  const saved = await saveGame();
  expect(saved.world.entities.rock_moon_shell ?? []).toEqual([]);
  expect(saved.world.entities.moonrockseed).toHaveLength(1);
  expect(saved.players.local.inventory.containers['player:equipment'].slots[0].item.remainingUses).toBe(27);
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload(); await prepare();
  await expect(page.locator('canvas[data-game-canvas]')).toHaveAttribute('data-loaded', 'true');
  const restored = await saveGame();
  expect(restored.world.entities.rock_moon_shell ?? []).toEqual([]);
  expect(restored.world.entities.moonrockseed).toEqual(saved.world.entities.moonrockseed);
  expect(restored.world.entities.ground_item).toEqual(saved.world.entities.ground_item);
  expect(errors).toEqual([]);
});
