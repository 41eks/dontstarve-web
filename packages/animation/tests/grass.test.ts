import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { executeDebugCommand } from '../../../src/debugCommands';
import type { InventoryStore } from '../../../src/inventory';
import { EntityRegistry } from '../../../src/entityRegistry';
import { GrassManager, GRASS_ID } from '../../prefab/src/grass';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('spawns grass through the debug command using its source bank and build, then restores it', async () => {
  const archives = new Map<string, Uint8Array>();
  for (const file of ['grass.zip', 'grass1.zip']) {
    archives.set(file, await readFile(new URL(`../../../public/dst/data/anim/${file}`, import.meta.url)));
  }
  const fetchAsset = vi.fn(async (url: string) => new Response(archives.get(url.split('/').pop()!)!));
  vi.stubGlobal('fetch', fetchAsset);
  vi.stubGlobal('window', new EventTarget());

  const scene = new THREE.Scene();
  const grasses = new GrassManager(scene, '/dst/data/anim');
  const registry = new EntityRegistry();
  registry.register({
    prefabIds: [GRASS_ID],
    restore: (_, record) => grasses.spawn(new THREE.Vector3(...record.transform.position), {
      id: record.id, transform: record.transform, components: {},
    }),
    debugSpawn: { prefabIds: [GRASS_ID], create: () => grasses.spawn(new THREE.Vector3(4, 0, -6)) },
    exportRecords: () => grasses.exportRecords().map((record) => ({ prefabId: GRASS_ID, record })),
    update: (dt, quaternion) => grasses.update(dt, quaternion),
    renderEntities: () => grasses.renderEntities,
    dispose: () => grasses.dispose(),
  });

  expect(await executeDebugCommand('c_spawn("grass")', {} as InventoryStore, (id) => registry.spawn(id)))
    .toEqual({ ok: true, message: '已生成 grass' });
  // grass.lua ships the bank in grass.zip and the build in grass1.zip.
  expect([...archives.keys()].sort()).toEqual([...fetchAsset.mock.calls.map((call) =>
    String(call[0]).split('/').pop()!)].sort());

  const [model] = scene.children;
  expect(model.userData.prefab).toBe(GRASS_ID);
  expect(model.position.toArray()).toEqual([4, 0, -6]);
  expect(model.userData.billboard).toBe(true);
  const controller = model.userData.animationController as { currentAnimation: string; update: (dt: number) => void };
  expect(controller.currentAnimation).toBe('idle');
  const mesh = model.children[0].children[0] as THREE.Mesh;
  expect(mesh.isMesh).toBe(true);
  expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(4);

  grasses.update(1 / 30, new THREE.Quaternion());
  expect(model.quaternion.x).toBe(0);
  expect([...grasses.renderEntities]).toEqual([{ object: model, footPosition: model.position, cameraDepth: 0 }]);

  const [{ prefabId, record }] = grasses.exportRecords().map((value) => ({ prefabId: GRASS_ID, record: value }));
  expect(prefabId).toBe(GRASS_ID);
  expect(record.transform).toEqual({ position: [4, 0, -6], rotationY: 0 });
  expect(record.components).toEqual({});

  const restored = await grasses.spawn(new THREE.Vector3(...record.transform.position), {
    id: record.id, transform: record.transform, components: {},
  });
  expect(restored.position.toArray()).toEqual([4, 0, -6]);
  expect(restored.userData.entityId).toBe(record.id);

  registry.dispose();
  expect(scene.children).toHaveLength(0);
});