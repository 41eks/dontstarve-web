import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { groundTileVariant, groundTileGeometry, loadGroundTileAssets, loadGroundFalloffAssets, groundFalloffGeometry, sortGroundFalloffGeometry } from '../../prefab/src/groundTiles';
import { GroundDepthPrepass } from '../../prefab/src/groundDepthPrepass';
import { TurfMap, WORLD_TILES } from '../../prefab/src/turfMap';
import { placeStaticLayout } from '../../prefab/src/staticLayout';
import { createSignal, type ClockState } from '../../signals/src';

beforeEach(() => vi.stubGlobal('fetch', async (url: string) => {
  const bytes = await readFile(new URL(`../../../public/dst/data/${String(url).slice('/dst/data/'.length)}`, import.meta.url));
  return new Response(bytes);
}));
afterEach(() => vi.unstubAllGlobals());

it('clips ground geometry without losing UVs, upward normals or large-map indices', async () => {
  const assets = await loadGroundTileAssets('/dst/data', 'GRASS');
  const clipped = groundTileGeometry([
    { col: -1, row: -1, variant: 2 }, { col: 99, row: 0, variant: 1 }, { col: 0, row: 0, variant: 1 },
  ], assets, 18);
  const large = groundTileGeometry(Array.from({ length: 16385 }, (_, col) => ({ col, row: 0, variant: 1 })), assets, 400000);
  const empty = groundTileGeometry([], assets, 18);
  try {
    expect(Array.from(clipped.getAttribute('position').array)).toEqual([
      -9, 0, -9, -9, 0, 0, 0, 0, -9, 0, 0, 0,
      0, 0, 0, 0, 0, 9, 9, 0, 0, 9, 0, 9,
    ]);
    expect(Array.from(clipped.index!.array)).toEqual([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7]);
    expect(clipped.boundingBox!.min.toArray()).toEqual([-9, 0, -9]);
    expect(clipped.boundingBox!.max.toArray()).toEqual([9, 0, 9]);
    const cell = assets.elements.get('02')!;
    expect(clipped.getAttribute('groundTileUv').getX(0)).toBeCloseTo(cell.u1 + (cell.u2 - cell.u1) / 4);
    expect(clipped.getAttribute('groundTileUv').getY(0)).toBeCloseTo(1 - cell.v2 + (cell.v2 - cell.v1) / 4);
    const normals = Array.from(clipped.getAttribute('normal').array);
    expect(normals).toEqual(Array.from({ length: 8 }, () => [0, 1, 0]).flat());
    clipped.computeVertexNormals();
    expect(Array.from(clipped.getAttribute('normal').array)).toEqual(normals);
    expect(large.index!.array).toBeInstanceOf(Uint32Array);
    expect(large.index!.getX(large.index!.count - 1)).toBe(65539);
    expect(large.getAttribute('position').count).toBe(65540);
    expect(empty.index!.count).toBe(0);
    expect(empty.getAttribute('normal').count).toBe(0);
  } finally { clipped.dispose(); large.dispose(); empty.dispose(); assets.material.dispose(); }
});

it('commits layout tiles once, preserves saved overrides and retains geometry on unchanged registration', async () => {
  const tiles = placeStaticLayout('default_pigking', new THREE.Vector3(0, 0, 24), 'pigking').tiles
    .map(({ position, tile }) => ({ position, tileId: WORLD_TILES[tile] }));
  const saved = [{ col: Math.floor(tiles[0].position.x / 12), row: Math.floor(tiles[0].position.z / 12), tileId: WORLD_TILES.DIRT }];
  const map = new TurfMap(240, saved), reference = new TurfMap(240, saved);
  try {
    const visual = await map.createVisual('/dst/data');
    const changed = vi.fn(); map.onTerrainChanged(changed);
    map.setOriginalTiles(tiles);
    expect(changed).toHaveBeenCalledOnce();
    expect(map.getTileAtWorld(tiles[0].position)).toBe(WORLD_TILES.DIRT);
    expect(map.exportTiles()).toEqual(saved);
    for (const { position, tileId } of tiles) reference.setOriginalTile(position, tileId);
    const referenceVisual = await reference.createVisual('/dst/data');
    for (const name of ['TurfBlend:GRASS', 'TurfBlend:WOODFLOOR', 'TurfBlend:DECIDUOUS']) {
      const mesh = visual.getObjectByName(name) as THREE.Mesh, expected = referenceVisual.getObjectByName(name) as THREE.Mesh;
      expect(mesh.geometry.getAttribute('position').array).toEqual(expected.geometry.getAttribute('position').array);
      expect(mesh.geometry.getAttribute('groundTileUv').array).toEqual(expected.geometry.getAttribute('groundTileUv').array);
    }
    const wood = visual.getObjectByName('TurfBlend:WOODFLOOR') as THREE.Mesh, geometry = wood.geometry;
    const disposed = vi.spyOn(geometry, 'dispose');
    map.setOriginalTiles(tiles);
    map.setOriginalTile(tiles[0].position, WORLD_TILES.WOODFLOOR); // Saved dirt still wins.
    expect(changed).toHaveBeenCalledTimes(1);
    expect(wood.geometry).toBe(geometry);
    expect(disposed).not.toHaveBeenCalled();
  } finally { map.dispose(); reference.dispose(); }
});

it('sorts merged cliff faces across negative coordinates without replacing vertices', async () => {
  const assets = await loadGroundFalloffAssets('/dst/data');
  const geometry = groundFalloffGeometry([{ col: 0, row: -2, edge: 0 }, { col: 0, row: -1, edge: 0 }], assets);
  try {
    const vertices = geometry.getAttribute('position');
    sortGroundFalloffGeometry(geometry, new THREE.Matrix4().makeRotationY(Math.PI));
    expect(geometry.index!.getX(0)).toBe(4);
    const version = geometry.index!.version;
    sortGroundFalloffGeometry(geometry, new THREE.Matrix4().makeRotationY(Math.PI));
    expect(geometry.index!.version).toBe(version);
    sortGroundFalloffGeometry(geometry, new THREE.Matrix4());
    expect(geometry.index!.getX(0)).toBe(0);
    expect(geometry.getAttribute('position')).toBe(vertices);
  } finally { geometry.dispose(); assets.material.dispose(); }
});

it('borrows ground geometry and atlas shaders for depth, updates replacements, and releases only its own material', async () => {
  const assets = await loadGroundTileAssets('/dst/data', 'FUNGUS');
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), assets.material), pass = new GroundDepthPrepass();
  const original = mesh.geometry, originalDispose = vi.spyOn(original, 'dispose');
  const sourceDispose = vi.spyOn(assets.material, 'dispose');
  pass.add(mesh);
  const depth = mesh.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  const depthDispose = vi.spyOn(depth.material, 'dispose');
  expect(depth.material.onBeforeCompile).toBe(assets.material.onBeforeCompile);
  expect(depth.geometry).toBe(original);
  mesh.geometry = new THREE.PlaneGeometry(2, 2); pass.sync(mesh); original.dispose();
  expect(depth.geometry).toBe(mesh.geometry);
  pass.dispose();
  expect(originalDispose).toHaveBeenCalledOnce();
  expect(depthDispose).toHaveBeenCalledOnce();
  expect(sourceDispose).not.toHaveBeenCalled();
  expect(depth.parent).toBeNull();
  mesh.geometry.dispose(); assets.material.dispose();
});

it('selects every source mask for the 256 possible neighbours, with adjacent diagonal bits suppressed', () => {
  const variants = new Set<number>();
  for (let c = 0; c < 16; c++) for (let d = 0; d < 16; d++) {
    const variant = groundTileVariant(false, c, d);
    expect(variant).toBeGreaterThanOrEqual(2);
    expect(variant).toBeLessThanOrEqual(48);
    expect(groundTileVariant(true, c, d)).toBe(1);
    variants.add(variant);
  }
  expect(variants.size).toBe(47);
  expect(groundTileVariant(false, 0, 0)).toBe(17);
  expect(groundTileVariant(false, 1, 9)).toBe(2); // west absorbs northwest/southwest
  expect(groundTileVariant(false, 2, 4)).toBe(33); // north plus southeast
  expect(groundTileVariant(false, 15, 15)).toBe(16); // enclosed concave hole
});

it('updates the outer boundary of contiguous dirt while leaving its interior free of seams', async () => {
  const map = new TurfMap(1000);
  const visual = await map.createVisual('/dst/data');
  const edge = visual.getObjectByName('TurfBlend:DECIDUOUS') as THREE.Mesh;
  expect(edge.visible).toBe(false);
  map.dig({ x: 6, z: 6 });
  expect(edge.geometry.getIndex()!.count).toBe(9 * 6);
  for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) map.dig({ x: col * 12 + 6, z: row * 12 + 6 });
  expect(edge.geometry.getIndex()!.count).toBe(24 * 6);
  const positions = edge.geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i += 4) {
    expect([positions.getX(i), positions.getZ(i)]).not.toEqual([12, 12]);
  }
  const restored = new TurfMap(1000, map.exportTiles());
  const restoredVisual = await restored.createVisual('/dst/data');
  const restoredEdge = restoredVisual.getObjectByName('TurfBlend:DECIDUOUS') as THREE.Mesh;
  expect(restoredEdge.geometry.getAttribute('groundTileUv').array).toEqual(edge.geometry.getAttribute('groundTileUv').array);
});

it('renders woodfloor above deciduous and dirt, with a concave mask around an excavated wood tile', async () => {
  const map = new TurfMap(1000);
  for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) {
    map.setOriginalTile({ x: col * 12 + 6, z: row * 12 + 6 }, WORLD_TILES.WOODFLOOR);
  }
  const visual = await map.createVisual('/dst/data');
  const wood = visual.getObjectByName('TurfBlend:WOODFLOOR') as THREE.Mesh;
  const deciduous = visual.getObjectByName('TurfBlend:DECIDUOUS') as THREE.Mesh;
  const dirt = visual.getObjectByName('DugTurf:DIRT') as THREE.Mesh;
  expect(wood.geometry.getIndex()!.count).toBe(25 * 6);
  expect(wood.renderOrder).toBeGreaterThan(deciduous.renderOrder);
  expect(deciduous.renderOrder).toBeGreaterThan(dirt.renderOrder);
  expect(map.dig({ x: 18, z: 18 })).toBe(true);
  // The surrounding forest is drawn at its source layer order; the enclosed
  // dirt hole has no adjacent forest and must not receive a forest quad.
  const forestPositions = deciduous.geometry.getAttribute('position');
  for (let i = 0; i < forestPositions.count; i += 4) {
    expect([forestPositions.getX(i), forestPositions.getZ(i)]).not.toEqual([12, 12]);
  }
  const position = wood.geometry.getAttribute('position');
  const uvs = wood.geometry.getAttribute('groundTileUv');
  const assets = await loadGroundTileAssets('/dst/data', 'WOODFLOOR');
  const cell = assets.elements.get('16')!;
  let matched = false;
  for (let i = 0; i < position.count; i += 4) {
    if (position.getX(i) !== 12 || position.getZ(i) !== 12) continue;
    expect(uvs.getX(i)).toBeCloseTo(cell.u1);
    expect(uvs.getY(i)).toBeCloseTo(1 - cell.v2);
    matched = true;
  }
  expect(matched).toBe(true);
  assets.material.dispose();
});

it('draws the ocean surface as merged rectangles instead of a quad per cell', async () => {
  const tiles = [];
  for (let row = 0; row < 3; row++) for (let col = -3; col < 0; col++) tiles.push({ col, row, tileId: WORLD_TILES.OCEAN_COASTAL });
  const map = new TurfMap(96, tiles);
  const visual = await map.createVisual('/dst/data');
  const ocean = visual.getObjectByName('TurfOcean:OCEAN_COASTAL') as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  expect(ocean.geometry.getIndex()!.count).toBe(6);
  expect(ocean.geometry.getAttribute('position').count).toBe(4);
  const box = new THREE.Box3().setFromBufferAttribute(ocean.geometry.getAttribute('position') as THREE.BufferAttribute);
  expect([box.min.x, box.max.x, box.min.z, box.max.z]).toEqual([-36, 0, 0, 36]);
  expect(map.dig(new THREE.Vector3(-18, 0, 18))).toBe(false);
});

it('restores ocean terrain, rejects land actions and keeps ground overlays on land', async () => {
  const tiles = [{ col: -1, row: 0, tileId: WORLD_TILES.OCEAN_COASTAL }];
  const map = new TurfMap(48, tiles);
  const oceanPoint = new THREE.Vector3(-6, 0, 6);
  expect(map.isOceanAtWorld(oceanPoint)).toBe(true);
  expect(map.isOceanAtWorld(new THREE.Vector3(6, 0, 6))).toBe(false);
  expect(map.dig(oceanPoint)).toBe(false);
  expect(map.plow(oceanPoint)).toBe(false);
  expect(map.canPlant(oceanPoint)).toBe(false);
  expect(map.exportTiles()).toEqual(tiles);
  const visual = await map.createVisual('/dst/data');
  const ocean = visual.getObjectByName('TurfOcean:OCEAN_COASTAL') as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  const clock = createSignal<ClockState>({ phase: 'day', timeinphase: 0 });
  vi.spyOn(clock, 'get');
  map.bindOceanClock(clock);
  expect(clock.get).toHaveBeenCalledOnce();
  expect(ocean.geometry.getIndex()!.count).toBe(6);
  const overlay = map.createLandOverlay();
  expect(overlay.geometry.getIndex()!.count).toBe(16 * 6);
  const positions = overlay.geometry.getAttribute('position');
  const tileUvs = overlay.geometry.getAttribute('groundTileUv');
  const assets = await loadGroundTileAssets('/dst/data', 'DECIDUOUS');
  const shoreCell = assets.elements.get('16')!;
  let foundCoast = false;
  for (let i = 0; i < positions.count; i += 4) {
    if (positions.getX(i) !== -12 || positions.getZ(i) !== 0) continue;
    expect(tileUvs.getX(i)).toBeCloseTo(shoreCell.u1);
    expect(tileUvs.getY(i)).toBeCloseTo(1 - shoreCell.v2);
    foundCoast = true;
  }
  expect(foundCoast).toBe(true);
  const atlasDisposed = vi.fn();
  overlay.atlases[0].addEventListener('dispose', atlasDisposed);
  overlay.geometry.dispose();
  expect(atlasDisposed).not.toHaveBeenCalled();
  const disposed = vi.fn();
  ocean.material.addEventListener('dispose', disposed);
  map.dispose();
  expect(disposed).toHaveBeenCalledOnce();
  expect(atlasDisposed).toHaveBeenCalledOnce();
  vi.mocked(clock.get).mockClear();
  expect(() => clock.set({ phase: 'dusk', timeinphase: 0 })).not.toThrow();
  expect(clock.get).not.toHaveBeenCalled();
  assets.material.dispose();
});
