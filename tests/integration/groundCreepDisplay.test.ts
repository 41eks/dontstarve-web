import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GameTimeScheduler } from '../../packages/componets/src/gameTimeScheduler';
import { GroundCreepEntity } from '../../packages/componets/src/groundcreep';
import { TILE_SIZE, WORLD_SCALE } from '../../packages/prefab/src/tile';
import { TurfMap } from '../../packages/prefab/src/turfMap';
import { createGroundCreep, groundCreepDeclaration } from '../../src/groundCreep';
import { drawGround, layerMeshes } from '../fixtures/groundDisplayFixture';

beforeEach(() =>
  vi.stubGlobal('fetch', async (url: string) => {
    const bytes = await readFile(
      new URL(`../../public/dst/data/${String(url).slice('/dst/data/'.length)}`, import.meta.url),
    );
    return new Response(bytes);
  }),
);
afterEach(() => vi.unstubAllGlobals());

// Row 10 and columns 10 and -40 sit inside 32-cell display chunks of the -64..64 map.
const cellCentre = (col: number) => new THREE.Vector3((col + 0.5) * TILE_SIZE, 0, 10.5 * TILE_SIZE);

it('draws the creep cells with their skirts and redraws only the chunk an update changed', async () => {
  const map = new TurfMap(128 * TILE_SIZE);
  const scheduler = new GameTimeScheduler();
  // Two players, so both dens' chunks are simulated; the dens lie in different 32-cell display chunks.
  const creep = createGroundCreep(map, scheduler, () => [{ position: cellCentre(10) }, { position: cellCentre(-40) }]);
  const near = new GroundCreepEntity({ position: cellCentre(10) }, creep);
  const far = new GroundCreepEntity({ position: cellCentre(-40) }, creep);
  near.SetRadius(5 * WORLD_SCALE);
  far.SetRadius(5 * WORLD_SCALE);
  creep.FastForward();
  scheduler.advance(0);
  const display = await drawGround(map);
  try {
    display.declareCreep(groundCreepDeclaration(creep, map));
    const meshes = () => layerMeshes(display, 'GroundCreep:web', '');
    await vi.waitFor(() => expect(meshes()).toHaveLength(2));
    const [first, second] = meshes();
    const minX = (mesh: THREE.Mesh) => mesh.geometry.boundingBox!.min.x;
    const [farMesh, nearMesh] = minX(first) < minX(second) ? [first, second] : [second, first];
    // A 5-unit den covers a plus of 5 tiles; its masks reach the 16 bare tiles around it.
    for (const mesh of meshes()) {
      expect(mesh.geometry.getIndex()!.count).toBe(21 * 6);
      expect(mesh.renderOrder).toBe(-0.58);
    }
    const material = nearMesh.material as THREE.MeshLambertMaterial;
    expect(material.customProgramCacheKey()).toBe('dst-creep-atlas-noise-v1');

    // Growing the near den redraws its chunk alone.
    near.SetRadius(9 * WORLD_SCALE);
    scheduler.advance(1);
    await vi.waitFor(() => expect(meshes()).not.toContain(nearMesh));
    expect(meshes()).toContain(farMesh);
    const grown = meshes().find(mesh => mesh !== farMesh)!;
    expect(grown.geometry.getIndex()!.count).toBeGreaterThan(21 * 6);

    const disposed = vi.fn();
    material.addEventListener('dispose', disposed);
    display.declareCreep(undefined);
    expect(meshes()).toEqual([]);
    expect(disposed).toHaveBeenCalledOnce();
  } finally {
    display.dispose();
    creep.dispose();
    scheduler.dispose();
    map.dispose();
  }
});
