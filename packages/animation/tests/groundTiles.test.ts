import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { groundTileVariant, loadGroundTileAssets, loadGroundFalloffAssets, groundFalloffGeometry, sortGroundFalloffGeometry } from '../../prefab/src/groundTiles';
import { GroundDepthPrepass } from '../../prefab/src/groundDepthPrepass';
import { TurfMap, WORLD_TILES } from '../../prefab/src/turfMap';
import { createSignal, type ClockState } from '../../signals/src';

beforeEach(() => vi.stubGlobal('fetch', async (url: string) => {
  const bytes = await readFile(new URL(`../../../public/dst/data/${String(url).slice('/dst/data/'.length)}`, import.meta.url));
  return new Response(bytes);
}));
afterEach(() => vi.unstubAllGlobals());

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
