import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { CaveEntranceManager } from '../../prefab/src/cave_entrance';
import { GroundItemManager } from '../../../src/groundItems';
import { createInventoryStore } from '../../../src/inventory';
import { performToolWork } from '../../stategraphs/src/componentactions';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('mines a closed entrance into cave_entrance_open, dropping rocks and flint, and keeps the open entrance in saves', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const inventory = createInventoryStore([]), scene = new THREE.Scene(), physics = new CANNON.World();
  const ground = new GroundItemManager(scene, new THREE.PerspectiveCamera(), { domElement: new EventTarget() } as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', new THREE.Group());
  const caves = new CaveEntranceManager(scene, { physics, prepareSpawn: (definition, fling) => ground.prepareSpawn(definition, fling) });
  try {
    await caves.spawn('cave_entrance', new THREE.Vector3(5, 0, 7));
    expect(caves.miniMapEntities.map(({ icon }) => icon)).toEqual(['cave_closed.png']);
    const pickaxe = inventory.entities.create({ itemId: 'pickaxe', count: 1 });
    const [mine] = caves.mineTargets;
    for (let i = 0; i < 5; i++) expect(performToolWork('MINE', mine.entity, {}, pickaxe)).toBe(true);
    expect(caves.exportRecords().map(({ prefabId }) => prefabId)).toEqual(['cave_entrance']);
    expect(performToolWork('MINE', mine.entity, {}, pickaxe)).toBe(true);

    // The open entrance replaces it at the same point, is background layered, and is no longer mineable.
    const [{ prefabId, record }] = caves.exportRecords();
    expect([prefabId, record.transform.position]).toEqual(['cave_entrance_open', [5, 0, 7]]);
    expect(caves.mineTargets).toEqual([]);
    expect(caves.renderEntities.map(entity => entity.renderLayer)).toEqual([-1]);
    expect(caves.miniMapEntities.map(({ icon }) => icon)).toEqual(['cave_open.png']);
    await vi.waitFor(() => expect(ground.exportRecords().map(r => r.components.stack?.itemId).sort())
      .toEqual(['flint', 'flint', 'flint', 'rocks', 'rocks']));

    const restored = new CaveEntranceManager(scene, { physics: new CANNON.World(), prepareSpawn: () => { throw new Error('unused'); } });
    await restored.spawn('cave_entrance_open', new THREE.Vector3(...record.transform.position), record);
    expect(restored.exportRecords()).toEqual(caves.exportRecords());
    restored.dispose();
  } finally { caves.dispose(); ground.dispose(); inventory.dispose(); }
}, 20000);
