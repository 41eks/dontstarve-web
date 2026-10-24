import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { CaveExitManager } from '../../prefab/src/cave_exit';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('renders the static cave_exit art as a solid obstacle and round-trips its record', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const scene = new THREE.Scene(), physics = new CANNON.World();
  const exits = new CaveExitManager(scene, { physics });
  try {
    const model = await exits.spawn(new THREE.Vector3(5, 0, 7));
    expect(exits.miniMapEntities.map(({ icon }) => icon)).toEqual(['cave_open2.png']);
    expect(physics.bodies).toHaveLength(1);
    exits.update(0.1, new THREE.Quaternion());
    const [{ prefabId, record }] = exits.exportRecords();
    expect([prefabId, record.id, record.transform.position]).toEqual(['cave_exit', model.userData.entityId, [5, 0, 7]]);

    const restored = new CaveExitManager(new THREE.Scene(), {});
    try {
      await restored.spawn(new THREE.Vector3(...record.transform.position), record);
      expect(restored.exportRecords()[0].record).toEqual(record);
    } finally { restored.dispose(); }
  } finally { exits.dispose(); }
  expect(physics.bodies).toHaveLength(0);
});
