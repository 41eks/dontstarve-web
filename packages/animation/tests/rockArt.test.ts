import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RockManager, type RockRecord } from '../../prefab/src/rocks';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import cave from '../../../public/saves/Cluster_1/Caves.json' with { type: 'json' };
import { prefabInstance } from '../../prefab/src/prefabInstance';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));

beforeEach(() => vi.stubGlobal('fetch', async (url: string) =>
  new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function firstMesh(model: THREE.Object3D): THREE.Mesh {
  let found: THREE.Mesh | undefined;
  model.traverse(object => { if (!found && object instanceof THREE.Mesh) found = object; });
  return found!;
}

it('shares split-bank cave-in art and preserves its variation, raised pose, identity and resources through reload', async () => {
  const world = { prepareSpawn: vi.fn(async () => ({ spawn: () => true, dispose() {} })) };
  const manager = new RockManager(new THREE.Scene(), '/dst/data/anim', world);
  const restored = new RockManager(new THREE.Scene(), '/dst/data/anim', world);
  const saved: RockRecord = { id: 'raised-boulder', transform: { position: [3, 0, 4], rotationY: 0 },
    components: { caveinBoulder: { variation: 7, raised: true } } };
  try {
    const first = await manager.spawn('cavein_boulder', new THREE.Vector3(...saved.transform.position), saved);
    const second = await manager.spawn('cavein_boulder', new THREE.Vector3(10, 0, 4), { ...saved, id: 'neighbour' });
    const mesh = (model: THREE.Group) => firstMesh(model);
    expect(mesh(first).geometry).toBe(mesh(second).geometry);
    expect(first.userData.animationController.currentAnimation).toBe('idle_raised');
    expect(prefabInstance(first)!.listTags()).toEqual(expect.arrayContaining(['heavy', 'boulder', 'caveindebris']));
    expect(manager.mineTargets).toEqual([]); // Raised cave-in boulders cannot be mined.
    const geometry = mesh(first).geometry, disposed = vi.fn(); geometry.addEventListener('dispose', disposed);
    const document = deserializeSave(JSON.stringify(cave), SAVE_CATALOG);
    document.world.entities = { cavein_boulder: manager.exportRecords().map(({ record }) => record) };
    const roundTrip = deserializeSave(JSON.stringify(document), SAVE_CATALOG);
    const [record] = roundTrip.world.entities.cavein_boulder;
    await restored.spawn('cavein_boulder', new THREE.Vector3(...record.transform.position), record);
    expect(restored.exportRecords()[0].record).toEqual(saved);
    manager.dispose();
    expect(disposed).toHaveBeenCalledOnce();
    expect(restored.exportRecords()[0].record).toEqual(saved);
    document.world.entities.cavein_boulder[0].components.caveinBoulder!.variation = 9;
    expect(() => deserializeSave(JSON.stringify(document), SAVE_CATALOG)).toThrow('variation');
  } finally { manager.dispose(); restored.dispose(); }
});

it('keeps the celestial orb as static art without mining or preparing loot', async () => {
  const manager = new RockManager(new THREE.Scene(), '/dst/data/anim', {
    prepareSpawn: async () => { throw new Error('Static art must not prepare loot'); },
  });
  try {
    const model = await manager.spawn('moonrockseed', new THREE.Vector3());
    expect(model.userData.animationController.currentAnimation).toBe('idle');
    expect(prefabInstance(model)!.listTags()).toEqual(expect.arrayContaining(['irreplaceable', 'nonpotatable', 'celestial_station']));
    expect(firstMesh(model).geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(manager.mineTargets).toEqual([]);
  } finally { manager.dispose(); }
});

it('cancels a pending spawn on disposal and releases every prepared drop without attaching stale art', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const scene = new THREE.Scene(), dispose = vi.fn();
  const manager = new RockManager(scene, '/dst/data/anim', {
    prepareSpawn: async () => { await gate; return { spawn: () => true, dispose }; },
  });
  const pending = manager.spawn('rock1', new THREE.Vector3());
  manager.dispose(); release();
  await expect(pending).rejects.toThrow('disposed');
  expect(dispose).toHaveBeenCalledTimes(7);
  expect(scene.children).toEqual([]);
});
