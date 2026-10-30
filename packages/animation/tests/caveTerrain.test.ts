import { readFile } from 'node:fs/promises';
import { Vector3 } from 'three';
import * as CANNON from 'cannon-es';
import { afterEach, expect, it, vi } from 'vitest';
import { TurfMap, WORLD_TILES } from '../../prefab/src/turfMap';
import { Locomotor, findGroundPath } from '../../prefab/src/locomotor';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { TILE_SIZE } from '../../prefab/src/tile';
import { placeStaticLayout } from '../../prefab/src/staticLayout';
import { importedSave } from './importedSave';
import { drawGround, layerGeometry } from './groundDisplayFixture';

afterEach(() => vi.unstubAllGlobals());

it('loads the entire imported map and retains cave identity, sparse void and player state through save/load', () => {
  const template = importedSave('Caves');
  const map = new TurfMap(template.world.map.generator.options.size, template.world.map.tiles, template.world.map.defaultTileId);
  try {
    expect(template.world.prefab).toBe('cave');
    expect(template.world.map.tiles).toHaveLength(45977);
    expect(map.cellsOfTile(WORLD_TILES.VAULT)).toHaveLength(82);
    expect(template.world.entities.grass.filter(record => record.components.witherable)).toHaveLength(23);
    const wood = map.cellsOfTile(WORLD_TILES.WOODFLOOR);
    // Sample one of the two resurrectionstone layouts.
    const woodNearOrigin = wood.filter(([col]) => col >= 0);
    const cx = (Math.min(...woodNearOrigin.map(([col]) => col)) + Math.max(...woodNearOrigin.map(([col]) => col)) + 1) * TILE_SIZE / 2;
    const cz = (Math.min(...woodNearOrigin.map(([, row]) => row)) + Math.max(...woodNearOrigin.map(([, row]) => row)) + 1) * TILE_SIZE / 2;
    expect(template.world.entities.pighead.filter(record => new Vector3(...record.transform.position)
      .distanceToSquared(new Vector3(cx, 0, cz)) <= TILE_SIZE ** 2).map(record => record.transform.position).sort()).toEqual([
      [cx - TILE_SIZE, 0, cz], [cx + TILE_SIZE, 0, cz], [cx, 0, cz - TILE_SIZE], [cx, 0, cz + TILE_SIZE],
    ].sort());
    // Three source statues are outside the archive; their original locations must also be retained.
    expect(template.world.entities.archive_moon_statue.filter(record =>
      map.getTileAtWorld(new Vector3(...record.transform.position)) === WORLD_TILES.ARCHIVE)).toHaveLength(24);
    expect(template.world.entities.archive_moon_statue).toHaveLength(27);
    expect(map.cellsOfTile(WORLD_TILES.SINKHOLE)).toHaveLength(8597);
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
    expect(() => deserializeSave(JSON.stringify({ ...template, world: { ...template.world,
      map: { ...template.world.map, defaultTileId: undefined } } }), SAVE_CATALOG)).toThrow('impassable background');
    expect(() => deserializeSave(JSON.stringify({ ...template, world: { ...template.world,
      map: { ...template.world.map, tiles: [{ col: 0, row: 0, tileId: 9999 }] } } }), SAVE_CATALOG)).toThrow('tileId');
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
    const display = await drawGround(map);
    for (const name of ['FUNGUS', 'ARCHIVE']) {
      // One full land cell plus the eight source atlas skirts blending into neighbouring void cells.
      expect(layerGeometry(display, name).getIndex()!.count).toBe(9 * 6);
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
    display.dispose();
  } finally { map.dispose(); }
});

it('loads the imported forest with distinct ocean types, ice, underlying dock tiles and retained entity state', async () => {
  const save = importedSave('Master');
  const map = new TurfMap(save.world.map.generator.options.size, save.world.map.tiles, save.world.map.defaultTileId);
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  try {
    expect(save.world.prefab).toBe('forest');
    expect(save.players.local.shardId).toBe('master');
    expect(map.isPassableAtPoint(new Vector3(...save.players.local.transform.position))).toBe(true);
    expect(map.cellsOfTile(WORLD_TILES.OCEAN_SWELL)).toHaveLength(34173);
    expect(map.cellsOfTile(WORLD_TILES.OCEAN_ICE)).toHaveLength(21);
    const [col, row] = map.cellsOfTile(WORLD_TILES.OCEAN_ROUGH)[0];
    expect(map.isOceanAtWorld(new Vector3((col + .5) * TILE_SIZE, 0, (row + .5) * TILE_SIZE))).toBe(true);
    expect(map.isPassableAtPoint(new Vector3((col + .5) * TILE_SIZE, 0, (row + .5) * TILE_SIZE))).toBe(false);
    const [iceCol, iceRow] = map.cellsOfTile(WORLD_TILES.OCEAN_ICE)[0];
    expect(map.isPassableAtPoint(new Vector3((iceCol + .5) * TILE_SIZE, 0, (iceRow + .5) * TILE_SIZE))).toBe(true);
    expect(save.world.map.tiles!.filter(tile => tile.tileId === WORLD_TILES.MONKEY_DOCK).every(tile => tile.underTileId !== undefined)).toBe(true);
    expect(save.world.entities.evergreen.some(entity => entity.components.evergreenTimer)).toBe(true);
    expect(save.world.entities.pigking).toHaveLength(1);
    expect(save.world.entities.researchlab2).toHaveLength(1);
    expect(save.world.entities.researchlab3[0].components.building?.skinId).toBe('researchlab3_nature');
    const terrainChanged = vi.fn(); map.onTerrainChanged(terrainChanged);
    map.setOriginalTiles(save.world.entities.pigking.flatMap(king =>
      placeStaticLayout('default_pigking', new Vector3(...king.transform.position), 'pigking').tiles
        .map(({ position, tile }) => ({ position, tileId: WORLD_TILES[tile] }))));
    expect(terrainChanged).not.toHaveBeenCalled(); // Imported final tiles already cover the entire layout.
    expect(save.world.entities.deciduoustree.some(entity => entity.components.deciduousTimer)).toBe(true);
    expect(save.world.entities.flower.length).toBeGreaterThan(0);
    expect(save.world.entities.flower.every(entity => entity.components.flower?.planted === undefined)).toBe(true);
    expect(save.world.entities.ground_item.some(entity => entity.components.stack?.itemId === 'fireflies')).toBe(true);
    // Imported chest contents become world container slots in the authoritative inventory.
    const chestSlotCounts = save.world.entities.treasurechest.map(chest => chest.components.container?.slots.length ?? 0);
    expect(chestSlotCounts).toHaveLength(2);
    expect(chestSlotCounts.every(count => count > 0)).toBe(true);
    expect(inventoryStateFromSave(save).slots.filter(({ address }) => address.containerId.startsWith('world:treasurechest:dst_')))
      .toHaveLength(chestSlotCounts.reduce((total, count) => total + count, 0));
    const restored = deserializeSave(serializeSave(save, {
      entities: save.world.entities, tiles: map.exportTiles(), playerTransform: save.players.local.transform,
      inventory: inventoryStateFromSave(save), elapsedSeconds: 10,
    }, SAVE_CATALOG), SAVE_CATALOG);
    expect(restored.world.map).toEqual(save.world.map);
    expect(restored.world.entities).toEqual(save.world.entities);
  } finally { map.dispose(); }
});
