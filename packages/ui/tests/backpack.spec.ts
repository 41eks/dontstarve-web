import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test('equipping a backpack opens eight usable side slots and switches independent backpack contents', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/dst-lighting.html');
  await page.evaluate(async (urls) => {
    const main = await import(urls.main);
    const { player } = await import(urls.player);
    const { executeDebugCommand } = await import(urls.debug);
    const equipped = main.inventory.get({ containerId: 'player:equipment', slotKey: 'body' });
    if (equipped) main.inventory.applySlotChanges([
      { slot: { containerId: 'player:equipment', slotKey: 'body' }, ...equipped, delta: -equipped.count },
    ]);
    const result = await executeDebugCommand('c_give("backpack", 2)', main.inventory);
    if (!result.ok) throw new Error(result.message);
    main.inventory.add('cutgrass', 3);
    (window as any).backpackGame = { main, player };
  }, {
    main: `/@fs${fileURLToPath(new URL('../../../src/main.ts', import.meta.url))}`,
    player: `/@fs${fileURLToPath(new URL('../../../src/player.ts', import.meta.url))}`,
    debug: `/@fs${fileURLToPath(new URL('../../../src/debugCommands.ts', import.meta.url))}`,
  });
  const bar = page.locator('dst-inventory-bar');
  const body = bar.locator('[data-slot-key="body"]');
  const pack = page.locator('dst-backpack-panel');
  const background = pack.locator('canvas');
  await bar.locator('.inventory-bar__items [data-item-id="backpack"]').first().click({ button: 'right' });
  await expect(body).toHaveAttribute('data-item-id', 'backpack');
  await expect(background).toHaveAttribute('data-archive', /\/dst\/data\/anim\/ui_backpack_2x4\.zip$/);
  await expect(background).toHaveAttribute('data-animation', 'open');
  await expect(background).toHaveAttribute('data-loaded', 'true');
  await expect(background).toHaveAttribute('data-playing', 'false');
  await expect(pack.locator('.inventory-slot')).toHaveCount(8);
  await expect(pack.locator('.inventory-slot').last()).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).backpackGame.player.children[0].children[0].material
    .some((material: any) => material.name === 'ground:swap_backpack'))).toBe(true);

  for (const width of [1280, 640]) {
    await page.setViewportSize({ width, height: 720 });
    const inventoryBounds = await bar.locator('.inventory-bar__items .inventory-slot').first().boundingBox();
    const slotBounds = await pack.locator('.inventory-slot').first().boundingBox();
    expect(Math.abs(slotBounds!.width - inventoryBounds!.width)).toBeLessThan(0.5);
    expect(Math.abs(slotBounds!.height - inventoryBounds!.height)).toBeLessThan(0.5);
    const lastBounds = await pack.locator('.inventory-slot').last().boundingBox();
    expect(lastBounds!.x + lastBounds!.width).toBeLessThan(width);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  const grass = bar.locator('.inventory-bar__items [data-item-id="cutgrass"]').first();
  const stored = pack.locator('[data-slot-key="7"]');
  await grass.dragTo(stored);
  await expect(stored).toHaveAttribute('data-item-id', 'cutgrass');
  const count = await page.evaluate(() => (window as any).backpackGame.main.inventory.get({ containerId: document.querySelector('dst-backpack-panel')!.slotContainer!.id, slotKey: '7' }).count);
  await page.evaluate(() => {
    const panel = document.querySelector('dst-backpack-panel')!;
    panel.addEventListener('game:chest-close', () => {
      (window as any).backpackCloseAnimation = panel.shadowRoot!.querySelector('canvas')!.dataset.animation;
    }, { once: true });
  });
  await body.click({ button: 'right' });
  expect(await page.evaluate(() => (window as any).backpackCloseAnimation)).toBe('close');
  await expect(pack.locator('.chest-panel')).toBeHidden();
  await bar.locator('.inventory-bar__items [data-item-id="backpack"]').nth(1).click({ button: 'right' });
  await expect(stored).toHaveAttribute('data-item-id', '');
  await body.click({ button: 'right' });
  await bar.locator('.inventory-bar__items [data-item-id="backpack"]').first().dragTo(body);
  await expect(pack.locator('canvas')).toHaveAttribute('data-playing', 'false');
  await expect(stored).toHaveAttribute('data-item-id', 'cutgrass');
  expect(await page.evaluate(() => (window as any).backpackGame.main.inventory.get({ containerId: document.querySelector('dst-backpack-panel')!.slotContainer!.id, slotKey: '7' }).count)).toBe(count);
  await page.screenshot({ path: '/tmp/three-roaming-backpack.png' });
  const empty = bar.locator('.inventory-bar__items [data-item-id=""]').first();
  await stored.dragTo(empty);
  await expect(stored).toHaveAttribute('data-item-id', '');
  expect(errors).toEqual([]);
});
