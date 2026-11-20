import { expect, it } from 'vitest';
import { TurfMap, WORLD_TILES } from '../../prefab/src/turfMap';

// One grass tile at cell (0, 0) in the ocean; cells are 12 units, and rows run against DST's y.
const map = new TurfMap(240, [{ col: 0, row: 0, tileId: WORLD_TILES.GRASS }], WORLD_TILES.OCEAN_COASTAL);
const at = (col: number, row: number, x: number, z: number) => ({ x: (col + x) * 12, z: (row + z) * 12 });

it('counts the land tile and the quarter of an ocean tile beside it as visual ground, as Map:IsVisualGroundAtPoint', () => {
  expect(map.isVisualGroundAtPoint(at(0, 0, 0.5, 0.5))).toBe(true);
  // The ocean tile right of the land: its first quarter is overhang.
  expect(map.isVisualGroundAtPoint(at(1, 0, 0.2, 0.5))).toBe(true);
  expect(map.isVisualGroundAtPoint(at(1, 0, 0.3, 0.5))).toBe(false);
  // Below it (row + 1 is DST's y - 1): the quarter at DST y's top, which is the row's low z.
  expect(map.isVisualGroundAtPoint(at(0, 1, 0.5, 0.2))).toBe(true);
  expect(map.isVisualGroundAtPoint(at(0, 1, 0.5, 0.3))).toBe(false);
  // Diagonal to it, only a band across the corner that touches the land.
  expect(map.isVisualGroundAtPoint(at(1, 1, 0.1, 0.1))).toBe(true);
  expect(map.isVisualGroundAtPoint(at(1, 1, 0.1, 0.2))).toBe(false);
  expect(map.isVisualGroundAtPoint(at(1, 1, 0.9, 0.9))).toBe(false);
  // Open water away from any land.
  expect(map.isVisualGroundAtPoint(at(3, 3, 0.5, 0.5))).toBe(false);
});

it('leaves the overhang out of Map:IsOceanAtPoint but not out of the ocean tile test', () => {
  const overhang = at(1, 0, 0.1, 0.5),
    water = at(1, 0, 0.6, 0.5);
  expect(map.isOceanAtWorld(overhang)).toBe(true);
  expect(map.isOceanAtPoint(overhang)).toBe(false);
  expect(map.isOceanAtPoint(water)).toBe(true);
  expect(map.isOceanAtPoint(at(0, 0, 0.5, 0.5))).toBe(false);
});

it('passes over the overhang as Map:IsPassableAtPoint does, while the land tile test stays per tile', () => {
  const overhang = at(1, 0, 0.1, 0.5),
    water = at(1, 0, 0.6, 0.5);
  expect(map.isPassableAtPoint(overhang)).toBe(true);
  expect(map.isLandTileAtPoint(overhang)).toBe(false);
  expect(map.isPassableAtPoint(water)).toBe(false);
  expect(map.isLandTileAtPoint(at(0, 0, 0.5, 0.5))).toBe(true);
});
