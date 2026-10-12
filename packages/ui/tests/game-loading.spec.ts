import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const bootstrapUrl = `/@fs${fileURLToPath(new URL('../../../src/bootstrap.tsx', import.meta.url))}`;

async function openGame(page: Page): Promise<void> {
  await page.goto('/tests/dst-lighting.html');
  await page.evaluate(url => {
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
    void import(url);
  }, bootstrapUrl);
}

test('keeps world generation visible until the complete game renders and preserves its UI', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/saves/initial-world.json', async route => {
    const response = await route.fetch();
    const save = await response.json();
    save.world.entities = {};
    await route.fulfill({ response, json: save });
  });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let waiting = false;
  await page.route('**/dst/data/anim/vig.zip', async route => {
    waiting = true;
    await pending;
    await route.continue();
  });
  await openGame(page);
  const generatingPage = page.getByRole('main', { name: '世界生成中' });
  const canvas = page.locator('canvas[data-game-canvas]');
  await expect(generatingPage).toBeVisible();
  await expect.poll(() => waiting, { timeout: 90_000 }).toBe(true);
  await expect(canvas).toHaveAttribute('data-loaded', 'false');
  // Waiting longer than the former five-second delay must not reveal the game.
  await page.waitForTimeout(5_500);
  await expect(generatingPage).toBeVisible();
  await expect(generatingPage).toHaveCSS('pointer-events', 'auto');
  release();
  await expect(canvas).toHaveAttribute('data-loaded', 'true', { timeout: 30_000 });
  await expect(generatingPage).toHaveCount(0);
  await expect(page.locator('#app > dst-crafting-ui')).toHaveCount(1);
  await page.keyboard.press('Backquote');
  await expect(page.locator('dst-debug-console input')).toBeFocused();
  expect(errors).toEqual([]);
});

test('keeps the generating page and reports a failed game load', async ({ page }) => {
  await page.route('**/saves/initial-world.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await openGame(page);
  const generatingPage = page.getByRole('main', { name: '世界生成中' });
  await expect(generatingPage.getByText('游戏载入失败', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(generatingPage.getByText('游戏载入失败，请刷新页面后重试。', { exact: true })).toBeVisible();
  await expect(generatingPage).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('canvas[data-game-canvas][data-loaded="true"]')).toHaveCount(0);
});
