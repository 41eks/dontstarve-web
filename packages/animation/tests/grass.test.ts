import { prefabDisplays } from './prefabManagerFixture';
import { plantManager } from './plantManagerFixture';
import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { executeDebugCommand } from '../../../src/debugCommands';
import type { InventoryStore } from '../../../src/inventory';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { grassPrefabs, GRASS_ID } from '../../prefab/src/grass';
import { bindTestWorld, tickWorld, drawn, plantInstance } from './worldContentFixture';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('spawns grass through the debug command using its source bank and build, then restores it', async () => {
  const archives = new Map<string, Uint8Array>();
  for (const file of ['grass.zip', 'grass1.zip']) {
    archives.set(file, await readFile(new URL(`../../../public/dst/data/anim/${file}`, import.meta.url)));
  }
  const fetchAsset = vi.fn(async (url: string) => new Response(new Uint8Array(archives.get(url.split('/').pop()!)!)));
  vi.stubGlobal('fetch', fetchAsset);
  vi.stubGlobal('window', new EventTarget());

  const scene = new THREE.Scene();
  const scheduler = new GameTimeScheduler();
  const { season } = bindTestWorld(scheduler);
  const grasses = plantManager(grassPrefabs, scene, {
    spawnGroundItem: () => undefined,
  });
  const registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.grasses, {
    restore: (_, record) => drawn(grasses.spawn('grass', new THREE.Vector3(...record.transform.position), {
      id: record.id, transform: record.transform, components: {},
    }).transform.model),
    debugSpawn: () => drawn(grasses.spawn('grass', new THREE.Vector3(4, 0, -6)).transform.model),
    exportRecords: () => grasses.exportRecords(),
    update: (dt, quaternion) => tickWorld(scheduler, prefabDisplays(grasses), dt, quaternion),
    renderEntities: () => grasses.renderEntities,
    dispose: () => grasses.dispose(),
  });

  expect(await executeDebugCommand('c_spawn("grass")', {} as InventoryStore, (id) => registry.spawn(id)))
    .toEqual({ ok: true, message: '已生成 grass' });
  // grass.lua ships the bank in grass.zip and the build in grass1.zip.
  expect([...archives.keys()].sort()).toEqual([...fetchAsset.mock.calls.map((call) =>
    String(call[0]).split('/').pop()!)].sort());

  const [model] = scene.children;
  expect(lookupPrefabInstance(model)?.prefab).toBe(GRASS_ID);
  expect(Object.hasOwn(model.userData, 'instance')).toBe(false);
  expect(model.position.toArray()).toEqual([4, 0, -6]);
  expect(plantInstance(model).sprite.sprite.peek().billboard).toBe(true);
  const controller = plantInstance(model).sprite as { currentAnimation: string; update: (dt: number) => void };
  expect(controller.currentAnimation).toBe('idle');
  let mesh: THREE.Mesh | undefined;
  model.traverse(object => { if (!mesh && object instanceof THREE.Mesh) mesh = object; });
  expect(mesh).toBeDefined();
  expect(mesh!.geometry.getAttribute('position').count).toBeGreaterThan(4);

  tickWorld(scheduler, prefabDisplays(grasses), 1 / 30, new THREE.Quaternion());
  expect(model.quaternion.x).toBe(0);
  expect([...grasses.renderEntities]).toEqual([{ object: model, footPosition: model.position, cameraDepth: 0 }]);

  const [{ prefabId, record }] = grasses.exportRecords();
  expect(prefabId).toBe(GRASS_ID);
  expect(record.transform).toEqual({ position: [4, 0, -6], rotationY: 0 });
  expect(record.components).toEqual({ pickable: {}, witherable: { taskSeconds: expect.any(Number) } });

  const pickable = plantInstance(model).components.pickable;
  expect(pickable.pick({ giveItem: (id: string, count: number) => id === 'cutgrass' && count === 1 })).toBe(true);
  expect(controller.currentAnimation).toBe('picking');
  for (let i = 0; i < 60; i++) tickWorld(scheduler, prefabDisplays(grasses), 1 / 30, new THREE.Quaternion());
  expect(controller.currentAnimation).toBe('picked');
  const pickedRecord = grasses.exportRecords().map(({ record }) => record)[0];
  expect(pickedRecord.components.pickable?.picked).toBe(true);
  expect(pickedRecord.components.pickable?.regrowSeconds).toBeCloseTo(1438);
  const pickedRestored = await drawn(grasses.spawn('grass', new THREE.Vector3(...pickedRecord.transform.position), pickedRecord).transform.model);
  expect(plantInstance(pickedRestored).sprite.currentAnimation).toBe('picked');
  expect(plantInstance(pickedRestored).components.pickable.state.phase.peek()).toBe('picked');
  expect(plantInstance(pickedRestored).components.pickable.remainingSeconds).toBeCloseTo(1438);
  tickWorld(scheduler, prefabDisplays(grasses), pickable.remainingSeconds, new THREE.Quaternion());
  expect(controller.currentAnimation).toBe('grow');
  expect(pickable.state.phase.peek()).toBe('ready');
  for (let i = 0; i < 60; i++) tickWorld(scheduler, prefabDisplays(grasses), 1 / 30, new THREE.Quaternion());
  expect(controller.currentAnimation).toBe('idle');

  const restored = await drawn(grasses.spawn('grass', new THREE.Vector3(...record.transform.position), {
    id: record.id, transform: record.transform, components: {},
  }).transform.model);
  expect(restored.position.toArray()).toEqual([4, 0, -6]);
  expect(lookupPrefabInstance(restored)?.entityId).toBe(record.id);

  season.set({ season: 'winter', progress: 0 });
  expect(pickable.pick({ giveItem: () => true })).toBe(true);
  expect(pickable.exportState()).toEqual({ picked: true, paused: true });
  expect(pickable.state.timer.peek()).toEqual({ status: 'stopped' });
  tickWorld(scheduler, prefabDisplays(grasses), 500, new THREE.Quaternion());
  expect(pickable.canBePicked).toBe(false);
  season.set({ season: 'spring', progress: 0 });
  expect(pickable.remainingSeconds).toBe(1080);

  plantInstance(model as THREE.Group).remove();
  expect(pickable.state.phase.peek()).toBe('removed');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(model.parent).toBeNull();
  season.set({ season: 'winter', progress: 0 });
  tickWorld(scheduler, prefabDisplays(grasses), 1080, new THREE.Quaternion());
  expect(pickable.state.phase.peek()).toBe('removed');

  registry.dispose();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(scene.children).toHaveLength(0);
});
