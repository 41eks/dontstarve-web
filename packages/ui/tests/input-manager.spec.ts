import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { InputManager, Key } from '../../../src/InputManager';

declare global {
  interface Window {
    inputFixture: { input: InputManager; changes: number; held?: ReadonlySet<Key> };
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/dst-lighting.html');
  await page.evaluate(async (url) => {
    const { input } = await import(url);
    window.inputFixture = { input, changes: 0 };
    input.keys.subscribe(() => window.inputFixture.changes++);
  }, `/@fs${fileURLToPath(new URL('../../../src/InputManager.ts', import.meta.url))}`);
});

function state(page: Page) {
  return page.evaluate(() => {
    const { input, changes } = window.inputFixture;
    return { keys: [...input.keys.peek()], manual: input.isManualMovement(),
      interrupting: input.isActionInterrupting(), changes };
  });
}

test('combines movement and jump input synchronously, ignoring repeats and preserving previous key sets', async ({ page }) => {
  await page.keyboard.down('w');
  expect(await state(page)).toEqual({ keys: ['KeyW'], manual: true, interrupting: true, changes: 1 });
  await page.evaluate(() => { window.inputFixture.held = window.inputFixture.input.keys.peek(); });
  await page.keyboard.down('w');
  await page.keyboard.press('g');
  expect((await state(page)).changes).toBe(1);
  await page.keyboard.down('Space');
  await page.keyboard.up('w');
  expect(await state(page)).toEqual({ keys: ['Space'], manual: false, interrupting: true, changes: 3 });
  expect(await page.evaluate(() => [...window.inputFixture.held!])).toEqual(['KeyW']);
  await page.keyboard.up('Space');
  expect(await state(page)).toEqual({ keys: [], manual: false, interrupting: false, changes: 4 });
});

test('filters shadow text input, releases held keys from text input, and clears blocked or blurred input', async ({ page }) => {
  await page.keyboard.down('w');
  await page.evaluate(() => {
    const host = document.createElement('div');
    const field = document.createElement('input');
    host.attachShadow({ mode: 'open' }).append(field);
    document.body.append(host);
    field.focus();
  });
  await page.keyboard.up('w');
  await page.keyboard.type('wasd ');
  expect(await state(page)).toEqual({ keys: [], manual: false, interrupting: false, changes: 2 });
  await page.evaluate(() => (document.activeElement as HTMLElement).shadowRoot!.querySelector('input')!.blur());
  await page.keyboard.down('w');
  await page.evaluate(() => window.inputFixture.input.setBlocked(true));
  await page.keyboard.down('Space');
  expect(await state(page)).toMatchObject({ keys: [], manual: false, interrupting: false });
  await page.evaluate(() => window.inputFixture.input.setBlocked(false));
  expect((await state(page)).keys).toEqual([]);
  await page.keyboard.up('w');
  await page.keyboard.up('Space');
  await page.keyboard.down('d');
  expect((await state(page)).manual).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect(await state(page)).toMatchObject({ keys: [], manual: false, interrupting: false });
  await page.keyboard.up('d');
});

test('dispose clears input and releases only its own listeners and memo dependencies', async ({ page }) => {
  await page.keyboard.down('w');
  await page.keyboard.down('Space');
  expect(await page.evaluate(async (url) => {
    const { InputManager } = await import(url);
    const other = new InputManager();
    const { input } = window.inputFixture;
    input.dispose();
    input.dispose();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    const observed = {
      disposedKeys: [...input.keys.peek()], disposedMovement: input.isManualMovement(),
      disposedInterrupting: input.isActionInterrupting(),
      otherKeys: [...other.keys.peek()], otherMovement: other.isManualMovement(),
    };
    other.dispose();
    return observed;
  }, `/@fs${fileURLToPath(new URL('../../../src/InputManager.ts', import.meta.url))}`)).toEqual({
    disposedKeys: [], disposedMovement: false, disposedInterrupting: false,
    otherKeys: ['KeyD'], otherMovement: true,
  });
  await page.keyboard.up('w');
  await page.keyboard.up('Space');
  expect((await state(page)).changes).toBe(3);
});
