import { expect, it } from 'vitest';
import { boxBlur, renderMinimapOcean } from '../../ui/src/minimap-ocean';
import oceanMinimap from '../../prefab/src/minimapOcean.json';
import definitions from '../../prefab/src/groundTiles.json';

const config = {
  oceanTileIds: new Set([201]),
  colour: definitions.OCEAN_COASTAL.minimapColour,
  paper: { data: new Uint8ClampedArray(4 * 4).fill(255), width: 2, height: 2 },
  tuning: oceanMinimap.tuning,
};

it('blurs a constant field to itself and spreads an edge symmetrically with clamped borders', () => {
  const flat = boxBlur(new Float32Array(25).fill(0.5), 5, 2, 6);
  expect([...flat].every(value => Math.abs(value - 0.5) < 1e-6)).toBe(true);
  const row = new Float32Array(9 * 9);
  for (let y = 0; y < 9; y++) for (let x = 4; x < 9; x++) row[y * 9 + x] = 1;
  const blurred = boxBlur(row, 9, 1, 1);
  expect(blurred[4 * 9 + 3]).toBeCloseTo(1 / 3);
  expect(blurred[4 * 9 + 4]).toBeCloseTo(2 / 3);
  expect(blurred[4 * 9 + 0]).toBeCloseTo(0);
});

it('renders open ocean in the deep-edge colour, hides land, and shades the coast', () => {
  // 20x20 cells: ocean everywhere except a 6x6 island in the middle.
  const side = 20;
  const isOcean = (col: number, row: number) => !(col >= 7 && col < 13 && row >= 7 && row < 13);
  const image = renderMinimapOcean(side, 12, isOcean, config, 4);
  const pixel = (cellX: number, cellY: number) => {
    const i = ((cellY * 4 + 2) * image.width + cellX * 4 + 2) * 4;
    return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]];
  };
  const [r, g, b, a] = pixel(1, 1);
  expect(a).toBe(255);
  // Far from land the mask is saturated: EDGE_COLOR0 (47, 52, 79) times white paper.
  expect([r, g, b]).toEqual(oceanMinimap.tuning.EDGE_COLOR0);
  expect(b).toBeGreaterThan(r);
  // The island interior is drawn by the land layers; the ocean pass leaves it black.
  expect(pixel(10, 10).slice(0, 3)).toEqual([0, 0, 0]);
  // Just off the shore the colour differs from the open-ocean colour (coast tint / shadow).
  expect(pixel(6, 10).slice(0, 3)).not.toEqual([r, g, b]);
});
