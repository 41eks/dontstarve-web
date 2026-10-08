import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { executeDebugCommand } from '../../../src/debugCommands';
import type { InventoryStore } from '../../../src/inventory';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SaplingManager, SAPLING_PREFABS } from '../../prefab/src/sapling';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([['sapling', 'sapling.zip']])('spawns %s through the debug command from its own archive, then restores it', async (prefabId, archive) => {
  const files = new Map<string, Uint8Array>();
  for (const file of ['sapling.zip', 'sapling_moon.zip']) {
    files.set(file, await readFile(new URL(`../../../public/dst/data/anim/${file}`, import.meta.url)));
  }
  const fetchAsset = vi.fn(async (url: string) => new Response(new Uint8Array(files.get(url.split('/').pop()!)!)));
  vi.stubGlobal('fetch', fetchAsset);
  vi.stubGlobal('window', new EventTarget());

  const scene = new THREE.Scene();
  const saplings = new SaplingManager(scene, '/dst/data/anim');
  const registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.saplings, {
    restore: (id, record) => saplings.spawn(id, new THREE.Vector3(...record.transform.position), {
      id: record.id, transform: record.transform, components: {},
    }),
    debugSpawn: (id) => saplings.spawn(id, new THREE.Vector3(id === prefabId ? 5 : -3, 0, 7)),
    exportRecords: () => saplings.exportRecords(),
    update: (dt, quaternion) => saplings.update(dt, quaternion),
    renderEntities: () => saplings.renderEntities,
    dispose: () => saplings.dispose(),
  });

  expect(await executeDebugCommand(`c_spawn("${prefabId}")`, {} as InventoryStore, (id) => registry.spawn(id)))
    .toEqual({ ok: true, message: `已生成 ${prefabId}` });
  // Each sapling variant ships its own bank and build in one archive.
  expect(fetchAsset.mock.calls.map((call) => String(call[0]))).toEqual([`/dst/data/anim/${archive}`]);

  const [model] = scene.children;
  expect(model.name).toBe(prefabId);
  expect(model.userData.prefab).toBe(prefabId);
  expect(model.userData.billboard).toBe(true);
  expect(model.position.toArray()).toEqual([5, 0, 7]);
  const controller = model.userData.animationController as { currentAnimation: string; update: (dt: number) => void };
  expect(controller.currentAnimation).toBe('sway');
  const mesh = model.children[0].children[0] as THREE.Mesh;
  expect(mesh.isMesh).toBe(true);
  expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(4);

  saplings.update(1 / 30, new THREE.Quaternion());
  expect([...saplings.renderEntities]).toEqual([{ object: model, footPosition: model.position, cameraDepth: 0 }]);

  const [{ prefabId: savedId, record }] = saplings.exportRecords();
  expect(savedId).toBe(prefabId);
  expect(record.transform).toEqual({ position: [5, 0, 7], rotationY: 0 });
  expect(record.components).toEqual({});

  const restored = await saplings.spawn(prefabId as typeof SAPLING_PREFABS[number],
    new THREE.Vector3(...record.transform.position), { id: record.id, transform: record.transform, components: {} });
  expect(restored.position.toArray()).toEqual([5, 0, 7]);
  expect(restored.userData.entityId).toBe(record.id);

  registry.dispose();
  expect(scene.children).toHaveLength(0);
});
