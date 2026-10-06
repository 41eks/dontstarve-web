import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    emoteFixture: Awaited<ReturnType<typeof import('./emote-fixture').createEmoteFixture>>;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/dst-lighting.html');
  await page.evaluate(async (url) => {
    const { createEmoteFixture } = await import(url);
    window.emoteFixture = await createEmoteFixture();
  }, `/@fs${fileURLToPath(new URL('./emote-fixture.ts', import.meta.url))}`);
});

test('G opens nested wheel; mouse direction selects source icons and plays emotes without world clicks', async ({ page }) => {
  const wheel = page.locator('dst-emote-wheel');
  await page.keyboard.down('w');
  await page.keyboard.press('g');
  await expect(wheel.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => window.emoteFixture.moving)).toBe(false);
  await page.keyboard.up('w');
  await page.keyboard.down('w');
  expect(await page.evaluate(() => window.emoteFixture.moving)).toBe(false);
  await page.keyboard.up('w');
  await expect(wheel.locator('canvas[data-loaded="true"]')).toHaveCount(2);
  await wheel.getByRole('button', { name: '情绪', exact: true }).click();
  await expect(wheel.locator('canvas[data-loaded="true"]')).toHaveCount(8);
  const bounds = await wheel.locator('.emote-wheel').boundingBox();
  // Select from an empty part of the pie slice rather than touching the icon.
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height * 0.28);
  await expect(wheel.getByRole('button', { name: '挥手' })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height * 0.28);
  await expect(wheel.getByRole('dialog')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.emoteFixture.animation.currentEmote)).toBe('wave');
  expect(await page.evaluate(() => ({ requests: window.emoteFixture.requests, clicks: window.emoteFixture.worldClicks })))
    .toEqual({ requests: ['wave'], clicks: 0 });
  await page.evaluate(() => window.emoteFixture.tick(240));
  expect(await page.evaluate(() => window.emoteFixture.animation.currentEmote)).toBeNull();

  await page.keyboard.press('g');
  await wheel.getByRole('button', { name: '动作', exact: true }).click();
  await expect(wheel.locator('canvas[data-loaded="true"]')).toHaveCount(7);
  await wheel.getByRole('button', { name: '跳舞', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.emoteFixture.animation.currentEmote)).toBe('dance');
  await page.evaluate(() => window.emoteFixture.tick(240));
  expect(await page.evaluate(() => window.emoteFixture.animation.currentEmote)).toBe('dance');
  await page.keyboard.down('w');
  await page.evaluate(() => window.emoteFixture.tick());
  expect(await page.evaluate(() => window.emoteFixture.animation.currentEmote)).toBeNull();
  expect(await page.evaluate(() => Math.hypot(...window.emoteFixture.velocity))).toBeGreaterThan(0);
  await page.keyboard.up('w');
});

test('cancel, back, repeat G, blur and shadow text input do not execute a selection', async ({ page }) => {
  const wheel = page.locator('dst-emote-wheel');
  await page.keyboard.press('g');
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', repeat: true })));
  await expect(wheel.getByRole('dialog')).toBeVisible();
  await wheel.getByRole('button', { name: '动作', exact: true }).click();
  await wheel.getByRole('button', { name: '返回分类' }).click();
  await expect(wheel.getByRole('button', { name: '情绪', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(wheel.getByRole('dialog')).toBeHidden();
  await page.keyboard.press('g');
  await page.mouse.click(5, 5, { button: 'right' });
  await expect(wheel.getByRole('dialog')).toBeHidden();
  await page.keyboard.press('g');
  await page.keyboard.press('g');
  await expect(wheel.getByRole('dialog')).toBeHidden();
  await page.keyboard.press('g');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(wheel.getByRole('dialog')).toBeHidden();
  await page.keyboard.press('Backquote');
  const consoleInput = page.locator('dst-debug-console').getByRole('textbox');
  await expect(consoleInput).toBeFocused();
  await page.keyboard.type('gwasd');
  await expect(consoleInput).toHaveValue('gwasd');
  await expect(wheel.getByRole('dialog')).toBeHidden();
  expect(await page.evaluate(() => window.emoteFixture.moving)).toBe(false);
  expect(await page.evaluate(() => window.emoteFixture.requests)).toEqual([]);
});
