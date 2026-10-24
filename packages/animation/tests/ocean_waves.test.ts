import { useTestTileMap, testMap } from './tileMapFixture';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { OceanWaves } from '../../prefab/src/ocean_waves';
import type { WaveMap } from '../../componets/src/wavemanager';
import { createSignal, type TileStateQuery } from '../../signals/src';
import { GetTileKeyAtPoint } from '../../componets/src/tileManager';
import { createWorldState } from '../../../src/worldState';

useTestTileMap();

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const map: WaveMap = { tileSize: 12, tileAt: () => 201, isLandTile: () => false, isOceanTile: tile => tile === 201 };
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const meshOf = (model: THREE.Object3D) => {
  let mesh: THREE.Mesh | undefined;
  model.traverse(object => { if (object instanceof THREE.Mesh) mesh ??= object; });
  return mesh!;
};

async function setup(tickingarea?: TileStateQuery) {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const scene = new THREE.Scene();
  const waves = new OceanWaves(scene, map, 3, tickingarea);
  await waves.prepare();
  return { scene, waves };
}

it('plays standalone and undefined-query waves to completion and keeps shared art until disposal', async () => {
  const query = vi.fn(() => undefined);
  const standalone = await setup(), injected = await setup(query);
  try {
    for (const { scene, waves } of [standalone, injected]) {
      waves.spawnShimmer('wave_shimmer', 12, 24);
      waves.spawnShore(12, 24, 90);
      const [shimmer, shore] = scene.children;
      expect(shimmer.position.toArray()).toEqual([12, 0, 24]);
      expect(shore.position.toArray()).toEqual([12, 0, 24]);
      expect(shimmer.userData.persists).toBe(false);
      const geometryDispose = vi.spyOn(meshOf(shimmer).geometry, 'dispose');
      const material = (meshOf(shimmer).material as THREE.Material[])[0];
      const materialDispose = vi.spyOn(material, 'dispose');
      for (let frame = 0; frame < 300; frame++) waves.update(.1, new THREE.Quaternion());
      expect(scene.children).toEqual([]);
      expect(geometryDispose).toHaveBeenCalled();
      expect(materialDispose).not.toHaveBeenCalled();
      waves.spawnShimmer('wave_shimmer', 12, 24);
      expect(scene.children).toHaveLength(1);
      expect((meshOf(scene.children[0]).material as THREE.Material[])[0]).toBe(material);
      waves.dispose();
      await settle();
      expect(materialDispose).toHaveBeenCalledOnce();
    }
    expect(query).toHaveBeenCalledTimes(3);
  } finally { standalone.waves.dispose(); injected.waves.dispose(); }
});

it('removes sleeping FX permanently, preserves other tile consumers, and cancels queued effects on disposal', async () => {
  const state = createWorldState({ map: testMap(), elapsedSeconds: 0, systems: {} });
  state.playerpositions.set([new THREE.Vector3()]);
  const read = vi.fn();
  const query = vi.fn<TileStateQuery>((position, radius) => {
    const memo = state.tickingarea(position, radius);
    if (memo) {
      const get = memo.get;
      vi.spyOn(memo, 'get').mockImplementation(() => { read(); return get(); });
    }
    return memo;
  });
  const { scene, waves } = await setup(query);
  const shared = state.tickingarea(createSignal(GetTileKeyAtPoint(new THREE.Vector3())))!;
  try {
    waves.spawnShimmer('wave_shimmer', 0, 0);
    waves.spawnShore(1, 1, 90);
    const [shimmer, shore] = scene.children;
    expect(scene.children).toHaveLength(2);
    expect(query.mock.calls.map(([tile]) => tile.peek())).toEqual([shimmer.position, shore.position].map(position => GetTileKeyAtPoint(position)));
    const shimmerDispose = vi.spyOn(meshOf(shimmer).geometry, 'dispose');
    const shoreDispose = vi.spyOn(meshOf(shore).geometry, 'dispose');

    // Both wave kinds implement Lua OnEntitySleep = Remove.
    state.playerpositions.set([new THREE.Vector3(300, 0, 0)]);
    await settle();
    expect(scene.children).toEqual([]);
    expect(shimmerDispose).toHaveBeenCalledOnce();
    expect(shoreDispose).toHaveBeenCalledOnce();
    const readsAfterSleep = read.mock.calls.length;
    // An FX requested in an already inactive tile is removed immediately.
    waves.spawnShimmer('wave_shimmer', 1, 1);
    expect(scene.children).toEqual([]);
    const readsAfterSpawn = read.mock.calls.length;
    expect(readsAfterSpawn).toBeGreaterThan(readsAfterSleep);

    state.playerpositions.set([new THREE.Vector3()]);
    await settle();
    expect(scene.children).toEqual([]);
    expect(read).toHaveBeenCalledTimes(readsAfterSpawn);
    expect(shared.peek()).toBe(true); // Removing FX must not dispose the world's shared memo.
    waves.spawnShimmer('wave_shimmer', 1, 1);
    expect(scene.children).toHaveLength(1);
    const geometryDispose = vi.spyOn(meshOf(scene.children[0]).geometry, 'dispose');
    state.playerpositions.set([new THREE.Vector3(300, 0, 0)]);
    waves.dispose();
    await settle();
    const readsAfterDispose = read.mock.calls.length;
    state.playerpositions.set([new THREE.Vector3()]);
    await settle();
    expect(scene.children).toEqual([]);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledTimes(readsAfterDispose);
  } finally { waves.dispose(); state.dispose(); }
});
