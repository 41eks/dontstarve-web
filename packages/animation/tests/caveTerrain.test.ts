import { readFile } from 'node:fs/promises';
import { Vector3, Mesh } from 'three';
import * as CANNON from 'cannon-es';
import { afterEach, expect, it, vi } from 'vitest';
import cave from '../../../public/saves/Cluster_1/Caves.json' with { type: 'json' };
import { TurfMap, WORLD_TILES } from '../../prefab/src/turfMap';
import { Locomotor, findGroundPath } from '../../prefab/src/locomotor';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { TILE_SIZE } from '../../prefab/src/tile';

afterEach(() => vi.unstubAllGlobals());

it('loads the imported region and retains cave identity, sparse void and player state through save/load', () => {
  const template = deserializeSave(JSON.stringify(cave), SAVE_CATALOG);
  const map = new TurfMap(template.world.map.generator.options.size, template.world.map.tiles, template.world.map.defaultTileId);
  try {
    expect(template.world.prefab).toBe('cave');
    const wood = map.cellsOfTile(WORLD_TILES.WOODFLOOR);
    const cx = (Math.min(...wood.map(([col]) => col)) + Math.max(...wood.map(([col]) => col)) + 1) * TILE_SIZE / 2;
    const cz = (Math.min(...wood.map(([, row]) => row)) + Math.max(...wood.map(([, row]) => row)) + 1) * TILE_SIZE / 2;
    // resurrectionstone.lua's heads stand at the midpoints of the 2x2 wood floor's perimeter.
    expect(template.world.entities.pighead.map(record => record.transform.position).sort()).toEqual([
      [cx - TILE_SIZE, 0, cz], [cx + TILE_SIZE, 0, cz], [cx, 0, cz - TILE_SIZE], [cx, 0, cz + TILE_SIZE],
    ].sort());
    expect(template.world.entities.archive_moon_statue.every(record =>
      map.getTileAtWorld(new Vector3(...record.transform.position)) === WORLD_TILES.ARCHIVE)).toBe(true);
    expect(map.cellsOfTile(WORLD_TILES.SINKHOLE)).toHaveLength(433);
    expect(map.getTileAtWorld({ x: -map.size / 2 + 6, z: -map.size / 2 + 6 })).toBe(WORLD_TILES.IMPASSABLE);
    expect(map.isPassableAtPoint(new Vector3(...template.players.local.transform.position))).toBe(true);
    const restored = deserializeSave(serializeSave(template, {
      entities: template.world.entities, tiles: map.exportTiles(),
      playerTransform: template.players.local.transform, inventory: inventoryStateFromSave(template), elapsedSeconds: 10,
    }, SAVE_CATALOG), SAVE_CATALOG);
    expect(restored.world.map).toEqual(template.world.map);
    expect(restored.world.entities).toEqual(template.world.entities);
    expect(restored.world.prefab).toBe('cave');
    expect(restored.players).toEqual(template.players);
    expect(() => deserializeSave(JSON.stringify({ ...cave, world: { ...cave.world,
      map: { ...cave.world.map, defaultTileId: undefined } } }), SAVE_CATALOG)).toThrow('impassable background');
    expect(() => deserializeSave(JSON.stringify({ ...cave, world: { ...cave.world,
      map: { ...cave.world.map, tiles: [{ col: 0, row: 0, tileId: 9999 }] } } }), SAVE_CATALOG)).toThrow('tileId');
  } finally { map.dispose(); }
});

it('draws cave land only and blocks keyboard velocity and paths across void or fake ground', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const map = new TurfMap(96, [
    { col: 0, row: 0, tileId: WORLD_TILES.FUNGUS },
    { col: 1, row: 0, tileId: WORLD_TILES.FAKE_GROUND },
    { col: 2, row: 0, tileId: WORLD_TILES.ARCHIVE },
  ], WORLD_TILES.IMPASSABLE);
  try {
    const visual = await map.createVisual('/dst/data');
    for (const name of ['FUNGUS', 'ARCHIVE']) {
      const mesh = visual.getObjectByName(`TurfBlend:${name}`) as Mesh;
      expect(mesh.geometry.getIndex()!.count).toBe(6);
      expect(map.tileLayerQuads().get(WORLD_TILES[name as 'FUNGUS' | 'ARCHIVE'])).toHaveLength(1);
    }
    expect(map.isVoidAtCell(1, 0)).toBe(true);
    expect(map.isVoidAtCell(-1, 0)).toBe(true);
    expect(map.isVoidAtCell(0, 0)).toBe(false);
    expect(map.canTerraform(new Vector3(18, 0, 6))).toBe(false);
    const body = new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(1) });
    body.position.set(10.9, 1, 6);
    const locomotor = new Locomotor(body, {
      footprintRadius: 1, isPassable: (x, z) => map.isPassableAtPoint({ x, z }),
      findPath: (start, target) => findGroundPath(start, target, { isWalkable: point => map.isPassableAtPoint(point) }),
    });
    locomotor.update(16, .1, new Vector3(1, 0, 0));
    expect(body.velocity.x).toBe(0);
    expect(locomotor.goToPoint(new Vector3(30, 0, 6))).toBe(false);
    expect(locomotor.goToPoint(new Vector3(6, 0, 6))).toBe(true);
  } finally { map.dispose(); }
});
