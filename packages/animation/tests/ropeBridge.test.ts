import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { FACING } from '../../animation/src/facing';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { RopeBridgeManager } from '../../componets/src/ropebridgemanager';
import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';
import {
  ROPE_BRIDGE_FX_ID,
  ROPE_BRIDGE_ICON_ID,
  ROPE_BRIDGE_ROPE_ID,
  RopeBridgeFxInstance,
  RopeBridgeRopeInstance,
  ropeBridgePrefabs,
} from '../../prefab/src/rope_bridge';
import { TILE_SIZE } from '../../prefab/src/tile';
import { TurfMap, WORLD_TILES, type TurfTileSave } from '../../prefab/src/turfMap';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { importedSave } from './importedSave';
import { drawGround, layerMeshes } from './groundDisplayFixture';

const UNIT = TILE_SIZE / 4;
/**
 * What scripts/dst-region-tile.py makes of Cluster_65's cave snapshot 0000000145: two three-tile bridges and one
 * single tile, each with ropebridgemanager's health, direction (z mirrored) and the middle tiles' icon offset.
 */
const BRIDGES: TurfTileSave[] = [
  { col: 63, row: 35, tileId: 266, ropeBridge: { health: 100, direction: { x: 0, z: 4 } } },
  { col: 63, row: 34, tileId: 266, ropeBridge: { health: 100, direction: { x: 0, z: 4 }, iconOffset: 0 } },
  { col: 63, row: 33, tileId: 266, ropeBridge: { health: 100, direction: { x: 0, z: 4 } } },
  { col: 49, row: -16, tileId: 266, ropeBridge: { health: 200, direction: { x: 0, z: 4 } } },
  { col: 49, row: -17, tileId: 266, ropeBridge: { health: 200, direction: { x: 0, z: 4 }, iconOffset: 0 } },
  { col: 49, row: -18, tileId: 266, ropeBridge: { health: 200, direction: { x: 0, z: 4 } } },
  { col: 82, row: -38, tileId: 266, ropeBridge: { health: 100, direction: { x: 0, z: -4 }, iconOffset: 0 } },
];

/** The imported Caves save, whose bridges cross its void, through the save reader. */
const caveWithBridges = () => importedSave('Caves');

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('loads rope bridge tiles as walkable land that draws no ground and keeps their bridge data through a save', async () => {
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  const save = caveWithBridges();
  expect(WORLD_TILES.ROPE_BRIDGE).toBe(266);
  const saved = save.world.map.tiles!.filter(tile => tile.tileId === WORLD_TILES.ROPE_BRIDGE);
  expect(saved).toEqual(BRIDGES);
  const map = new TurfMap(save.world.map.generator.options.size, save.world.map.tiles, save.world.map.defaultTileId);
  try {
    // A bridge joins two banks across the void: both ends are cave land, the sides stay void.
    expect([map.tileIdAtCell(63, 36), map.tileIdAtCell(63, 32)].every(tile => tile !== WORLD_TILES.IMPASSABLE)).toBe(
      true,
    );
    expect(map.isVoidAtCell(62, 34)).toBe(true);
    const middle = new THREE.Vector3(63.5 * TILE_SIZE, 0, 34.5 * TILE_SIZE);
    expect(map.isPassableAtPoint(middle)).toBe(true);
    // isinvisibletile: no ground layer of its own; the banks' default falloff faces the bridge, the bridge has none.
    expect(map.groundLayers().map(layer => layer.tileId)).not.toContain(WORLD_TILES.ROPE_BRIDGE);
    const edges = map.falloffEdges();
    expect(edges.some(edge => edge.col === 63 && edge.row === 36)).toBe(true);
    expect(edges.some(edge => edge.col === 63 && edge.row === 32)).toBe(true);
    expect(edges.filter(edge => BRIDGES.some(tile => tile.col === edge.col && tile.row === edge.row))).toEqual([]);
    const display = await drawGround(map);
    expect(layerMeshes(display, 'ROPE_BRIDGE')).toEqual([]);
    display.dispose();
    expect(map.exportTiles().filter(tile => tile.tileId === WORLD_TILES.ROPE_BRIDGE)).toEqual(BRIDGES);
  } finally {
    map.dispose();
  }
  // Bridge data belongs to bridge tiles, which cover the void.
  const document = JSON.parse(JSON.stringify(save)) as typeof save;
  document.world.map.tiles = [
    ...document.world.map.tiles!.filter(tile => tile.tileId !== WORLD_TILES.ROPE_BRIDGE),
    { col: 63, row: 34, tileId: WORLD_TILES.MUD, ropeBridge: BRIDGES[1]!.ropeBridge },
  ];
  expect(() => deserializeSave(JSON.stringify(document), SAVE_CATALOG, save.players.local)).toThrow(
    /only rope bridge tiles/,
  );
});

it('spawns rope_bridge_fx for each saved bridge tile as ropebridgemanager OnLoad does, and rebuilds it after sleep', async () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))),
  );
  const save = caveWithBridges();
  const map = new TurfMap(save.world.map.generator.options.size, save.world.map.tiles, save.world.map.defaultTileId);
  const scene = new THREE.Scene(),
    scheduler = new GameTimeScheduler(),
    awake = createSignal(true);
  const cameraFacing = createSignal<number>(FACING.DOWN);
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', {
    tickingarea: () => createMemo(() => awake.get()),
    scheduler,
  });
  prefabs.register(ropeBridgePrefabs({ cameraFacing, spawnPrefab: (id, position) => prefabs.spawn(id, position) }));
  const manager = new RopeBridgeManager(
    {
      *ropeBridges() {
        for (const tile of map.exportTiles()) {
          if (tile.ropeBridge) {
            yield [tile.col, tile.row, tile.ropeBridge] as const;
          }
        }
      },
      tileCenter: (col, row) => ({ x: (col + 0.5) * TILE_SIZE, z: (row + 0.5) * TILE_SIZE }),
    },
    (x, z) => prefabs.spawnAs(RopeBridgeFxInstance, ROPE_BRIDGE_FX_ID, new THREE.Vector3(x, 0, z)),
  );
  try {
    const fxs = [...prefabs.instances(ROPE_BRIDGE_FX_ID)] as RopeBridgeFxInstance[];
    expect(fxs).toHaveLength(7);
    const at = (col: number, row: number) =>
      fxs.find(fx => fx.position.x === (col + 0.5) * TILE_SIZE && fx.position.z === (row + 0.5) * TILE_SIZE)!;
    const fx = at(63, 34);
    // SpawnBridgeAnim: direction z > 0 turns the fx -90; OnLoad's SkipPre plays bridge_idle without the place clip.
    expect(fx.eightFacedRotation.peek()).toBe(-90);
    expect(at(82, -38).eightFacedRotation.peek()).toBe(90);
    expect(fx.sprite.sprite.peek().clip).toMatchObject({ name: 'bridge_idle', loop: false });
    expect(fx.listTags()).toEqual(['FX']);
    expect(fx.persists).toBe(false);
    // Eight-faced OnGround art: the camera's DOWN facing, turned by the -90 rotation.
    expect(fx.sprite.sprite.peek().facing).toBe(FACING.RIGHT);
    cameraFacing.set(FACING.LEFT);
    expect(fx.sprite.sprite.peek().facing).toBe(FACING.DOWN);
    expect(fx.sprite.sprite.peek().ground).toEqual({ renderOrder: 0, flat: true });

    // OnAnimData: two ropes of different variations at ROPE1/ROPE2_OFFSET, turned with the bridge to its two sides.
    const ropes = [fx.rope1!, fx.rope2!];
    expect(
      ropes.every(rope => rope instanceof RopeBridgeRopeInstance && rope.entityParent === fx && !rope.persists),
    ).toBe(true);
    expect(ropes[0]!.variation).not.toBe(ropes[1]!.variation);
    for (const rope of ropes) {
      expect(rope.sprite.sprite.peek().clip).toMatchObject({ name: `rope_support_${rope.variation}`, loop: false });
      expect(rope.listTags()).toEqual(['NOCLICK', 'decor']);
      const offset = rope.position.clone().sub(fx.position);
      expect(Math.abs(offset.x)).toBeCloseTo(2.6 * UNIT);
      expect(Math.abs(offset.z)).toBeCloseTo(0.1 * UNIT);
    }
    expect(Math.sign(ropes[0]!.position.x - fx.position.x)).toBe(-Math.sign(ropes[1]!.position.x - fx.position.x));

    // SetIconOffset(0) on each bridge's middle tile: the CLASSIFIED minimap icon at its centre; the others have none.
    const icons = [...prefabs.instances(ROPE_BRIDGE_ICON_ID)];
    expect(icons).toHaveLength(3);
    expect(fx.icon?.position.toArray()).toEqual(fx.position.toArray());
    expect([fx.icon?.minimap.icon, fx.icon?.listTags()]).toEqual(['rope_bridge.png', ['CLASSIFIED']]);
    expect(at(63, 35).icon).toBeUndefined();
    expect([...prefabs.instances(ROPE_BRIDGE_ROPE_ID)]).toHaveLength(14);

    await prefabDisplay(fx.transform.model)!.artLoaded();
    expect(
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([url]) =>
        String(url).endsWith('/dst/data/anim/rope_bridge.zip'),
      ),
    ).toBe(true);
    // Every facing draws the planks across local z, between the ropes; the turned root lays them across this z-run bridge.
    scene.updateMatrixWorld(true);
    const drawn = new THREE.Box3().setFromObject(fx.transform.model).getSize(new THREE.Vector3());
    expect(drawn.x).toBeGreaterThan(drawn.z * 1.5);
    expect(drawn.x / 2).toBeCloseTo(2.6 * UNIT, -1);
    const before = fx.sprite.sprite.peek();
    awake.set(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fx.status.peek()).toBe('asleep');
    awake.set(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    await prefabDisplay(fx.transform.model)!.artLoaded();
    expect(fx.sprite.sprite.peek()).toMatchObject({
      clip: { name: 'bridge_idle' },
      facing: before.facing,
      ground: before.ground,
    });

    // The anims do not persist: the world's save holds the tiles, and the manager removes the anims with the world.
    manager.dispose();
    expect([
      ...prefabs.instances(ROPE_BRIDGE_FX_ID),
      ...prefabs.instances(ROPE_BRIDGE_ROPE_ID),
      ...prefabs.instances(ROPE_BRIDGE_ICON_ID),
    ]).toEqual([]);
  } finally {
    prefabs.dispose();
    displays.dispose();
    scheduler.dispose();
    map.dispose();
  }
});
