import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPigKingSetPiece } from '../../prefab/src/setpieces/pigking';
import { TILE_SIZE, snapToTileCenter } from '../../prefab/src/tile';
import { setSpriteEntityRenderOrder } from '../src/renderOrder';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const relative = url.slice('/dst/data/'.length);
    const bytes = await readFile(new URL(`../../../public/dst/data/${relative}`, import.meta.url));
    return new Response(bytes);
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Pig King woodfloor set piece', () => {
  it.each([
    undefined,
    new THREE.Vector3(-13, 2, -25),
    new THREE.Vector3(12, 0, 0),
  ])('covers the containing tile and its eight neighbors at %s', async (position) => {
    const piece = await createPigKingSetPiece({ assetBaseUrl: '/dst/data/', position });
    const feet = position ?? new THREE.Vector3(0, 0, 25);
    const center = snapToTileCenter(feet);
    expect(piece.group.children).toEqual([piece.turf, piece.pigKing.standee]);
    expect(piece.footPosition).toEqual(feet);
    expect(piece.pigKing.standee.position.x).toBe(feet.x);
    expect(piece.pigKing.standee.position.z).toBe(feet.z);
    expect(piece.pigKing.body.position.x).toBe(feet.x);
    expect(piece.pigKing.body.position.y).toBe(feet.y + 12);
    expect(piece.pigKing.body.position.z).toBe(feet.z);
    expect(piece.turf.position.toArray()).toEqual([center.x, feet.y, center.z]);
    expect(piece.tiles).toHaveLength(9);
    expect(new Set(piece.tiles.map(({ position: p }) => `${p.x},${p.z}`)).size).toBe(9);
    for (const tile of piece.tiles) {
      expect(tile.turfId).toBe('turf_woodfloor');
      expect(snapToTileCenter(tile.position)).toEqual(tile.position);
      expect(Math.abs(tile.position.x - center.x)).toBeLessThanOrEqual(TILE_SIZE);
      expect(Math.abs(tile.position.z - center.z)).toBeLessThanOrEqual(TILE_SIZE);
    }
    piece.group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(piece.turf);
    expect(bounds.getSize(new THREE.Vector3()).x).toBeCloseTo(3 * TILE_SIZE);
    expect(bounds.getSize(new THREE.Vector3()).z).toBeCloseTo(3 * TILE_SIZE);
    expect(bounds.min.y).toBeCloseTo(feet.y);
    expect(new THREE.Box3().setFromObject(piece.pigKing.standee).min.y).toBeCloseTo(feet.y);
    const material = piece.turf.material as THREE.MeshLambertMaterial;
    expect(material.map).toBeInstanceOf(THREE.DataTexture);
    expect(material.map!.repeat.toArray()).toEqual([3 / 8, 3 / 8]);
    expect(material.polygonOffset).toBe(true);
    expect(fetch).toHaveBeenCalledWith('/dst/data/levels/textures/noise_woodfloor.tex');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(piece.group.getObjectByName('PigKingFloor')).toBeUndefined();
    setSpriteEntityRenderOrder(piece.pigKing.standee, 9);
    expect(piece.pigKing.standee.children[0].renderOrder).toBe(9);
    piece.pigKing.update(0.1);
    if (position) expect(position.toArray()).toEqual(feet.toArray());
  });

  it('aligns adjacent woodfloor textures to the same world-space phase', async () => {
    const left = await createPigKingSetPiece({ assetBaseUrl: '/dst/data', position: new THREE.Vector3(6, 0, 6) });
    const right = await createPigKingSetPiece({ assetBaseUrl: '/dst/data', position: new THREE.Vector3(42, 0, 6) });
    const texture = (piece: typeof left) => (piece.turf.material as THREE.MeshLambertMaterial).map!;
    expect(texture(left).offset.x + texture(left).repeat.x).toBeCloseTo(texture(right).offset.x);
    expect(texture(left).offset.y).toBe(texture(right).offset.y);
  });
});
