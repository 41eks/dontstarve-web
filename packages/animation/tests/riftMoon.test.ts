import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { TILE_SIZE } from '../../prefab/src/tile';
import { TurfMap, WORLD_TILES, type TurfTileSave } from '../../prefab/src/turfMap';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { importedSave } from './importedSave';
import { drawGround, layerMeshes } from './groundDisplayFixture';

/**
 * One of the 61 tiles rift_terraformer turned into RIFT_MOON in Cluster_65's forest snapshot 0000000315, with the marsh
 * it replaced kept by undertile, as scripts/dst-region-tile.py imports it.
 */
const RIFT: TurfTileSave = { col: -60, row: 56, tileId: 274, underTileId: 8 };

/** The imported forest, with `tile` replacing the save's tile at its cell. */
function forestWith(tile: TurfTileSave) {
  const save = importedSave('Master');
  const document = JSON.parse(JSON.stringify(save)) as typeof save;
  document.world.map.tiles = (document.world.map.tiles ?? []).map(t =>
    t.col === tile.col && t.row === tile.row ? tile : t,
  );
  return deserializeSave(JSON.stringify(document), SAVE_CATALOG, save.players.local);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it('loads lunar rift ground as hard land drawn with its own noise, keeping the replaced tile through a save', async () => {
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  expect([WORLD_TILES.RIFT_MOON, WORLD_TILES.MARSH]).toEqual([274, 8]);
  const save = importedSave('Master');
  const rifts = save.world.map.tiles!.filter(tile => tile.tileId === WORLD_TILES.RIFT_MOON);
  expect(rifts).toHaveLength(61);
  expect(rifts).toContainEqual(RIFT);
  const map = new TurfMap(save.world.map.generator.options.size, save.world.map.tiles, save.world.map.defaultTileId);
  try {
    const centre = new THREE.Vector3((RIFT.col + 0.5) * TILE_SIZE, 0, (RIFT.row + 0.5) * TILE_SIZE);
    expect(map.tileIdAtCell(RIFT.col, RIFT.row)).toBe(WORLD_TILES.RIFT_MOON);
    expect(map.isPassableAtPoint(centre)).toBe(true);
    // tiledefs.lua: cannotbedug and hard.
    expect(map.canTerraform(centre)).toBe(false);
    expect(map.canDeployPlantAtPoint(centre)).toBe(false);
    // The meteor atlas with ground_noise_lunarrift, in its own layer.
    const layer = map.groundLayers().find(declaration => declaration.tileId === WORLD_TILES.RIFT_MOON)!;
    expect(layer.art).toMatchObject({
      atlas: 'levels/tiles/meteor.xml',
      noise: 'levels/textures/ground_noise_lunarrift.tex',
    });
    const display = await drawGround(map);
    expect(layerMeshes(display, 'RIFT_MOON').some(mesh => mesh.renderOrder === layer.renderOrder)).toBe(true);
    display.dispose();
    expect(map.exportTiles().filter(tile => tile.tileId === WORLD_TILES.RIFT_MOON)).toEqual(rifts);
  } finally {
    map.dispose();
  }
  // The terraformer only converts land.
  expect(() => forestWith({ ...RIFT, underTileId: WORLD_TILES.OCEAN_COASTAL })).toThrow(
    /lunar rift ground cannot cover ocean/,
  );
});
