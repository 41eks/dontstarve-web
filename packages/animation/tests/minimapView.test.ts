import { afterEach, expect, it, vi } from 'vitest';
import { MinimapView } from '../../ui/src/minimap-view';
import { TurfMap, WORLD_TILES } from '../../prefab/src/turfMap';
import { groundTileVariant } from '../../prefab/src/groundTiles';

afterEach(() => vi.unstubAllGlobals());

it('queries bounded terrain with the same neighbour masks and reports the changed source cells', () => {
  const map = new TurfMap(120, [
    { col: -1, row: 0, tileId: WORLD_TILES.GRASS },
    { col: 0, row: 1, tileId: WORLD_TILES.OCEAN_COASTAL },
    { col: 1, row: 1, tileId: WORLD_TILES.WOODFLOOR },
  ]);
  const bounds = { minCol: 0, minRow: -1, maxCol: 2, maxRow: 2 };
  // A reference calculation includes neighbours outside the requested chunk.
  for (const [id, quads] of map.tileLayerQuads(bounds)) {
    const expected = [];
    for (let row = bounds.minRow; row < bounds.maxRow; row++) for (let col = bounds.minCol; col < bounds.maxCol; col++) {
      const is = (dx: number, dz: number) => map.tileIdAtCell(col + dx, row + dz) === id;
      const cardinal = Number(is(-1, 0)) | Number(is(0, -1)) << 1 | Number(is(1, 0)) << 2 | Number(is(0, 1)) << 3;
      const diagonal = Number(is(-1, -1)) | Number(is(1, -1)) << 1 | Number(is(1, 1)) << 2 | Number(is(-1, 1)) << 3;
      const variant = groundTileVariant(is(0, 0), cardinal, diagonal);
      if (variant !== 17) expected.push({ col, row, variant });
    }
    expect(quads).toEqual(expected);
  }
  const listener = vi.fn(), stop = map.onTerrainChanged(listener);
  map.dig({ x: 6, z: 6 });
  expect(listener).toHaveBeenCalledExactlyOnceWith({ minCol: 0, minRow: 0, maxCol: 1, maxRow: 1 });
  stop();
  map.setTile(1, 0, WORLD_TILES.GRASS);
  expect(listener).toHaveBeenCalledTimes(1);
  map.dispose();
});

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

it('sizes the padded square to 1.5 viewport long sides at furthest zoom, preserving the inverse zoom ratio', () => {
  for (const worldSize of [9480, 1200]) {
    const view = new MinimapView(worldSize, 1280, 720);
    expect(view.zoom).toBe(3);
    for (const [width, height] of [[1280, 720], [720, 1280], [1920, 1080]]) {
      view.resize(width, height);
      view.center(worldSize / 4, -worldSize / 4);
      for (const heading of [-90, 45]) {
        view.heading = heading;
        for (const zoom of [20, 10, 1]) {
          view.zoom = zoom;
          const half = view.boundsSize / 2;
          const a = view.worldToScreen(-half, -half), b = view.worldToScreen(half, -half), c = view.worldToScreen(half, half);
          const side = 1.5 * Math.max(width, height) * 20 / zoom;
          expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(side);
          expect(Math.hypot(c.x - b.x, c.z - b.z)).toBeCloseTo(side);
        }
      }
    }
  }
});

it('turns with the camera heading so screen up is the camera forward and screen right its right', () => {
  const view = new MinimapView(1000, 800, 600);
  view.center(0, 0);
  // followcamera.lua default heading 45: forward is (-cos, -sin) on the ground, i.e. toward -x/-z.
  view.heading = 45;
  const ahead = view.worldToScreen(-1, -1), right = view.worldToScreen(1, -1);
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
  const corners = [[0, 0], [800, 0], [800, 600], [0, 600]].map(([x, y]) => view.screenToWorld(x, y));
  expect(Math.min(...corners.map(point => point.x))).toBeCloseTo(-view.boundsSize / 2);
  expect(Math.max(...corners.map(point => point.z))).toBeCloseTo(view.boundsSize / 2);
});

it('limits the entire viewport when panning, zooming out, rotating and resizing near the padded boundary', () => {
  const view = new MinimapView(1200, 1280, 720);
  for (const [width, height] of [[1280, 720], [720, 1280], [900, 900]]) {
    view.resize(width, height);
    for (const heading of [-90, 45, 135]) {
      view.heading = heading;
      for (const direction of [-1, 1]) {
        view.zoom = 1;
        view.pan(direction * 1e9, direction * 1e9);
        view.zoom = 20;
        const corners = [[0, 0], [width, 0], [width, height], [0, height]].map(([x, y]) => view.screenToWorld(x, y));
        for (const point of corners) {
          expect(Math.abs(point.x)).toBeLessThanOrEqual(view.boundsSize / 2 + 1e-8);
          expect(Math.abs(point.z)).toBeLessThanOrEqual(view.boundsSize / 2 + 1e-8);
        }
      }
    }
  }
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
  const alphas = (atlas: { data: Uint8ClampedArray; width: number; height: number }, rect: { u0: number; v0: number; u1: number; v1: number }) => {
    const values: number[] = [];
    for (let y = Math.ceil(rect.v0 * atlas.height); y < Math.floor(rect.v1 * atlas.height); y++) {
      for (let x = Math.ceil(rect.u0 * atlas.width); x < Math.floor(rect.u1 * atlas.width); x++) values.push(atlas.data[(y * atlas.width + x) * 4 + 3]);
    }
    return values;
  };
  for (const id of [WORLD_TILES.DIRT, WORLD_TILES.DECIDUOUS, WORLD_TILES.FARMING_SOIL]) {
    const { atlas, masks, noise } = layers.get(id)!;
    expect(masks.size).toBe(48);
    // Every layer names the same map_edge atlas and shares its decoded pixels.
    expect(atlas).toBe(layers.get(WORLD_TILES.DIRT)!.atlas);
    expect(atlas.data).toHaveLength(atlas.width * atlas.height * 4);
    expect(noise.width * noise.height * 4).toBe(noise.data.length);
    expect(alphas(atlas, masks.get(1)!).some(value => value === 255)).toBe(true);
    expect(alphas(atlas, masks.get(17)!).every(value => value === 0)).toBe(true);
    expect(alphas(atlas, masks.get(2)!).some(value => value > 0 && value < 255)).toBe(true);
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
