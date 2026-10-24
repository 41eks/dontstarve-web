import { expect, it } from 'vitest';
import { traceMinimapAlphaOutline } from '../../ui/src/minimap-alpha-outline';

function image(rows: number[][]) {
  return { width: rows[0].length, height: rows.length,
    data: Uint8ClampedArray.from(rows.flatMap(row => row.flatMap(alpha => [0, 0, 0, alpha]))) };
}

it('traces a solid region with a hole, keeping islands that touch only at a corner separate', () => {
  const ring = traceMinimapAlphaOutline(image([
    [255, 255, 255], [255, 0, 255], [255, 255, 255],
  ]));
  expect(ring).toBe('M0 0H3V3H0ZM2 1H1V2H2Z');
  expect(traceMinimapAlphaOutline(image([[255, 0], [0, 255]])))
    .toBe('M0 0H1V1H0ZM1 1H2V2H1Z');
});

it('excludes faint alpha and transparent chunks and places chunk contours in the full image', () => {
  expect(traceMinimapAlphaOutline(image([[0, 127], [0, 0]]))).toBe('');
  expect(traceMinimapAlphaOutline(image([[127, 128, 255]]), 32, 64)).toBe('M33 64H35V65H33Z');
});
