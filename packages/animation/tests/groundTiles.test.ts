import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GROUND_TILE_DEFINITIONS, groundTileVariant, loadGroundTileAssets } from '../../prefab/src/groundTiles';
import { TurfMap, WORLD_TILES } from '../../prefab/src/turfMap';

beforeEach(() => vi.stubGlobal('fetch', async (url: string) => {
  const bytes = await readFile(new URL(`../../../public/dst/data/${String(url).slice('/dst/data/'.length)}`, import.meta.url));
  return new Response(bytes);
}));
afterEach(() => vi.unstubAllGlobals());

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
  expect(edge.geometry.getIndex()!.count).toBe(6);
  for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) map.dig({ x: col * 12 + 6, z: row * 12 + 6 });
  expect(edge.geometry.getIndex()!.count).toBe(8 * 6);
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
  expect(deciduous.visible).toBe(false);
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
