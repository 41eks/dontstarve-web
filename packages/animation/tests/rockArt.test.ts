import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { rockWorld } from './rockWorldFixture';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { importedSave } from './importedSave';
import { workTargets } from './workTargets';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));

beforeEach(() => vi.stubGlobal('fetch', async (url: string) =>
  new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function loaded(...models: THREE.Object3D[]): Promise<void> {
  for (let attempt = 0; attempt < 30 && !models.every(model => prefabInstance(model)!.sprite.loaded); attempt++) await new Promise(resolve => setTimeout(resolve, 0));
}
function firstMesh(model: THREE.Object3D): THREE.Mesh {
  let found: THREE.Mesh | undefined;
  model.traverse(object => { if (!found && object instanceof THREE.Mesh) found = object; });
  return found!;
}

it('shares split-bank cave-in art and preserves its variation, raised pose, identity and resources through reload', async () => {
  const manager = rockWorld(new THREE.Scene());
  const restored = rockWorld(new THREE.Scene());
  const saved = { id: 'raised-boulder', transform: { position: [3, 0, 4] as [number, number, number], rotationY: 0 },
    components: { caveinBoulder: { variation: 7, raised: true as const } } };
  try {
    const first = manager.spawn('cavein_boulder', new THREE.Vector3(...saved.transform.position), saved);
    const second = manager.spawn('cavein_boulder', new THREE.Vector3(10, 0, 4), { ...saved, id: 'neighbour' });
    await loaded(first, second);
    const mesh = (model: THREE.Object3D) => firstMesh(model);
    expect(mesh(first).geometry).toBe(mesh(second).geometry);
    expect(prefabInstance(first)!.sprite.currentAnimation).toBe('idle_raised');
    expect(prefabInstance(first)!.listTags()).toEqual(expect.arrayContaining(['heavy', 'boulder', 'caveindebris']));
    expect(workTargets('MINE')).toEqual([]); // Raised cave-in boulders cannot be mined.
    const geometry = mesh(first).geometry, disposed = vi.fn(); geometry.addEventListener('dispose', disposed);
    const document = importedSave('Caves');
    document.world.entities = { cavein_boulder: manager.exportRecords().map(({ record }) => record) };
    const roundTrip = deserializeSave(JSON.stringify(document), SAVE_CATALOG);
    const [record] = roundTrip.world.entities.cavein_boulder;
    restored.spawn('cavein_boulder', new THREE.Vector3(...record.transform.position), record);
    expect(restored.exportRecords()[0].record).toEqual(saved);
    manager.dispose();
    expect(disposed).toHaveBeenCalledOnce();
    expect(restored.exportRecords()[0].record).toEqual(saved);
    document.world.entities.cavein_boulder[0].components.caveinBoulder!.variation = 9;
    expect(() => deserializeSave(JSON.stringify(document), SAVE_CATALOG)).toThrow('variation');
  } finally { manager.dispose(); restored.dispose(); }
});

it('keeps the celestial orb as static art without mining or dropping loot', async () => {
  const manager = rockWorld(new THREE.Scene(), {
    spawnGroundItem: () => { throw new Error('Static art must not drop loot'); },
  });
  try {
    const model = manager.spawn('moonrockseed', new THREE.Vector3());
    await loaded(model);
    expect(prefabInstance(model)!.sprite.currentAnimation).toBe('idle');
    expect(prefabInstance(model)!.listTags()).toEqual(expect.arrayContaining(['irreplaceable', 'nonpotatable', 'celestial_station']));
    expect(firstMesh(model).geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(workTargets('MINE')).toEqual([]);
  } finally { manager.dispose(); }
});
