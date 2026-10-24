import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const modules = Object.fromEntries(['main', 'playerStats'].map(name =>
  [name, `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`]));

test('equipping a nightsword updates the sanity HUD, persists through reload and stops draining when dragged out', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const prepare = () => page.evaluate(async paths => {
    const main = await import(paths.main), { playerStats } = await import(paths.playerStats);
    (window as any).nightswordGame = { main, playerStats };
  }, modules);
  await page.goto('/tests/dst-lighting.html'); await prepare();
  await page.evaluate(() => {
    const { main, playerStats } = (window as any).nightswordGame;
    main.inventory.applySlotChanges(main.inventory.exportState().slots.filter((slot: any) => slot.item)
      .map((slot: any) => ({ slot: slot.address, ...slot.item, delta: -slot.item.count })));
    playerStats.sanity.set(100);
    document.querySelector('dst-debug-console')!.dispatchEvent(new CustomEvent('game:debug-command', {
      detail: { command: 'c_give("nightsword")' },
    }));
  });
  const bar = page.locator('dst-inventory-bar'), hand = bar.locator('[data-slot-key="hand"]');
  const items = bar.locator('.inventory-bar__items');
  await items.locator('[data-item-id="nightsword"]').dragTo(hand);
  await expect(hand).toHaveAttribute('data-item-id', 'nightsword');
  const meter = page.locator('dst-status-hud .survival-meter--sanity output');
  await expect.poll(async () => Number(await meter.textContent()), { timeout: 15_000 }).toBeLessThan(100);

  const download = page.waitForEvent('download');
  await page.evaluate(() => document.querySelector('dst-debug-console')!.dispatchEvent(
    new CustomEvent('game:debug-command', { detail: { command: 'c_save()' } })));
  const saved = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(saved.players.local.inventory.containers['player:equipment'].slots.find((slot: any) => slot.slotKey === 'hand')
    .item.itemId).toBe('nightsword');
  await page.route('**/saves/initial-world.json', route => route.fulfill({ json: saved }));
  await page.reload(); await prepare();
  await expect(hand).toHaveAttribute('data-item-id', 'nightsword');
  await expect.poll(() => page.evaluate(() => (window as any).nightswordGame.playerStats.sanity.peek()))
    .toBeLessThan(saved.players.local.stats.sanity);
  await hand.dragTo(items.locator('[data-item-id=""]').first());
  await expect(hand).toHaveAttribute('data-item-id', '');
  const unequipped = await page.evaluate(() => (window as any).nightswordGame.playerStats.sanity.peek());
  // Observe active gameplay frames after the actual inventory drag finished.
  await page.evaluate(() => new Promise<void>(resolve => {
    let frames = 0;
    const advance = () => { if (++frames === 30) resolve(); else requestAnimationFrame(advance); };
    requestAnimationFrame(advance);
  }));
  expect(await page.evaluate(() => (window as any).nightswordGame.playerStats.sanity.peek())).toBe(unequipped);
  await expect(meter).toHaveText(String(Math.round(unequipped)));
  expect(errors).toEqual([]);
});
