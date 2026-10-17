import { afterEach, expect, it, vi } from 'vitest';
import { MinimapView } from '../../ui/src/minimap-view';
import { TurfMap, WORLD_TILES } from '../../prefab/src/turfMap';

afterEach(() => vi.unstubAllGlobals());

it('round-trips world and screen positions, with screen up being +z', () => {
  const view = new MinimapView(1000, 800, 600);
  view.center(100, -50);
  view.zoom = 4;
  for (const [x, z] of [[0, 0], [-500, 499], [312.5, -48]]) {
    const screen = view.worldToScreen(x, z);
    const world = view.screenToWorld(screen.x, screen.z);
    expect(world.x).toBeCloseTo(x);
    expect(world.z).toBeCloseTo(z);
  }
  expect(view.worldToScreen(100, -50)).toEqual({ x: 400, z: 300 });
  expect(view.worldToScreen(100, 0).z).toBeLessThan(300);
});

it('turns with the camera heading so screen up is the camera forward and screen right its right', () => {
  const view = new MinimapView(1000, 800, 600);
  view.center(0, 0);
  // followcamera.lua default heading 45: forward is (-cos, -sin) on the ground, i.e. toward -x/-z.
  view.heading = 45;
  const ahead = view.worldToScreen(-1, -1), right = view.worldToScreen(-1, 1);
  expect(ahead.x).toBeCloseTo(400);
  expect(ahead.z).toBeLessThan(300);
  expect(right.z).toBeCloseTo(300);
  expect(right.x).toBeGreaterThan(400);
  // Q/E turn the heading by 45 degrees: the same world point swings around the centre and still round-trips.
  view.heading = 90;
  expect(view.worldToScreen(0, -1).z).toBeLessThan(300);
  const screen = view.worldToScreen(30, -70);
  expect(view.screenToWorld(screen.x, screen.z)).toEqual({ x: expect.closeTo(30), z: expect.closeTo(-70) });
  // Dragging follows the finger at any heading.
  view.pan(0, 50);
  const moved = view.worldToScreen(30, -70);
  expect(moved.z - screen.z).toBeCloseTo(50);
  expect(moved.x).toBeCloseTo(screen.x);
});

it('keeps the point under the cursor fixed while zooming, and clamps zoom and centre', () => {
  const view = new MinimapView(1000, 800, 600);
  view.center(200, 100);
  const before = view.screenToWorld(500, 250);
  view.zoomAt(500, 250, 7);
  const after = view.screenToWorld(500, 250);
  expect(after.x).toBeCloseTo(before.x);
  expect(after.z).toBeCloseTo(before.z);
  view.zoomAt(0, 0, 999);
  expect(view.zoom).toBe(20);
  view.zoomAt(0, 0, 0);
  expect(view.zoom).toBe(1);
  view.pan(-1e9, 1e9);
  expect(view.centerX).toBe(500);
  expect(view.centerZ).toBe(500);
});

it('loads all source minimap masks and noise per terrain layer, and reports changes', async () => {
  const { readFile } = await import('node:fs/promises');
  vi.stubGlobal('fetch', async (url: string) => new Response(
    await readFile(new URL(`../../../public/dst/data/${String(url).slice('/dst/data/'.length)}`, import.meta.url))));
  const map = new TurfMap(1000);
  await map.createVisual('/dst/data');
  const { min, max } = map.cellRange();
  expect(max - min).toBe(84);
  expect(map.tileIdAtCell(0, 0)).toBe(WORLD_TILES.DECIDUOUS);
  expect(map.tileIdAtCell(max, 0)).toBe(WORLD_TILES.INVALID);
  const layers = await map.tileLayerImages();
  for (const id of [WORLD_TILES.DIRT, WORLD_TILES.DECIDUOUS, WORLD_TILES.FARMING_SOIL]) {
    const { cells, noise } = layers.get(id)!;
    expect(cells.size).toBe(48);
    const cell = cells.get(1)!;
    expect(cell.data).toHaveLength(cell.width * cell.height * 4);
    expect(cell.data.some((value, i) => i % 4 === 3 && value === 255)).toBe(true);
    expect(noise.width * noise.height * 4).toBe(noise.data.length);
    expect(cells.get(17)!.data.every((value, i) => i % 4 !== 3 || value === 0)).toBe(true);
    const coast = cells.get(2)!;
    expect(coast.data.some((value, i) => i % 4 === 3 && value > 0 && value < 255)).toBe(true);
  }
  let changes = 0;
  map.onTerrainChanged(() => changes++);
  map.dig({ x: 6, z: 6 });
  expect(changes).toBe(1);
  expect(map.tileIdAtCell(0, 0)).toBe(WORLD_TILES.DIRT);
  map.dispose();
});

it('shares straight, diagonal and concave neighbour masks across changes and save restoration', () => {
  const saved = [];
  for (let row = -3; row < 3; row++) for (let col = -3; col < 3; col++) {
    saved.push({ col, row, tileId: WORLD_TILES.OCEAN_COASTAL });
  }
  const map = new TurfMap(72, saved.filter(tile => tile.col !== 0 || tile.row !== 0));
  const land = () => map.tileLayerQuads().get(WORLD_TILES.DECIDUOUS)!;
  expect(land()).toHaveLength(9);
  expect(land().find(tile => tile.col === 0 && tile.row === 0)?.variant).toBe(1);
  expect(land().find(tile => tile.col === 1 && tile.row === 0)?.variant).toBe(2);
  expect(land().find(tile => tile.col === 1 && tile.row === 1)?.variant).toBe(18);
  map.dig({ x: 6, z: 6 });
  expect(land()).toHaveLength(0);
  const restored = new TurfMap(72, map.exportTiles());
  expect(restored.tileLayerQuads()).toEqual(map.tileLayerQuads());
  map.dispose();
  restored.dispose();

  const hole = new TurfMap(72);
  hole.dig({ x: 6, z: 6 });
  expect(hole.tileLayerQuads().get(WORLD_TILES.DECIDUOUS)!.find(tile => tile.col === 0 && tile.row === 0)?.variant).toBe(16);
  hole.dispose();
});
