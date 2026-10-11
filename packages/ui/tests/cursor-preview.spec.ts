import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('world previews override lighting and UI labels use controllers mouse glyphs', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/tests/dst-lighting.html');
  const result = await page.evaluate(async (url) => {
    const { checkCursorPreview } = await import(url);
    return checkCursorPreview();
  }, `/@fs${fileURLToPath(new URL('./cursor-preview-fixture.ts', import.meta.url))}`);
  const brightness = (rgb: number[]) => rgb.reduce((sum, value) => sum + value, 0);
  expect(brightness(result.night.preview)).toBeGreaterThan(500);
  expect(brightness(result.night.ground)).toBeLessThan(30);
  expect(result.torch.preview).toEqual(result.night.preview);
  expect(brightness(result.torch.ground)).toBeGreaterThan(brightness(result.night.ground) + 100);
  expect(result.committed.preview).toEqual(result.night.ground);
  expect(result.night.label).toEqual({ hidden: false, text: ': 施放法术', glyph: 'U+E101', colour: 'rgb(255, 255, 255)' });
  expect(result.torch.label).toEqual(result.night.label);
  expect(result.dayLabel).toEqual(result.night.label);
  expect(result.rightGlyph).toMatchObject({ width: 52, height: 52 });
  expect(result.rightGlyph.opaque).toBeGreaterThan(300);
  expect(result.differentButtons).toBe(true);
  expect(result.building).toMatchObject({ inScene: true, override: 1, footY: 0,
    label: { hidden: false, glyph: 'U+E100' } });
  expect(result.placed).toMatchObject({ inScene: true, override: null, count: 1, label: result.night.label });
  expect(result.wallBefore).toEqual({ inScene: true, override: 1 });
  expect(result.cancelled).toMatchObject({ removed: true, override: null, count: 0, label: result.night.label });
  expect(result.overUiHidden).toBe(true);
  expect(result.unequippedHidden).toBe(true);
  expect(errors).toEqual([]);
});
