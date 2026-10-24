import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { BerrybushManager } from '../../prefab/src/berrybush';
import { GroundItemManager } from '../../../src/groundItems';
import { createInventoryStore } from '../../../src/inventory';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { bindTestWorld } from './worldContentFixture';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

it('takes a resident factory plant out of the scene outside the tickingarea and restores it with its identity and skin', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true);
  bindTestWorld(scheduler);
  const player = new THREE.Group(), inventory = createInventoryStore([]);
  const ground = new GroundItemManager(scene, new THREE.PerspectiveCamera(), { domElement: new EventTarget() } as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', player);
  const bushes = new BerrybushManager(scene, '/dst/data/anim', { tickingarea: () => createMemo(() => awake.get()),
    prepareSpawn: (definition, fling) => ground.prepareSpawn(definition, fling) } as never);
  try {
    await bushes.spawn(new THREE.Vector3(4, 0, 6), { id: 'bush:resident', transform: { position: [4, 0, 6], rotationY: 0 }, components: {} } as never);
    await tick();
    const model = bushes.digTargets[0].model;
    expect(model.parent).toBe(scene);
    const meshes = () => { let count = 0; model.traverse(object => { if (object instanceof THREE.Mesh) count++; }); return count; };
    expect(meshes()).toBeGreaterThan(0);

    awake.set(false); await tick();
    expect(model.parent).toBeNull();
    expect(meshes()).toBe(0);
    expect(model.userData.entityId).toBe('bush:resident');
    expect(bushes.exportRecords()[0].id).toBe('bush:resident');

    awake.set(true); await tick();
    expect(model.parent).toBe(scene);
    expect(meshes()).toBeGreaterThan(0);

    awake.set(false); await tick();
    bushes.remove(model);
    expect(model.parent).toBeNull();
    expect(bushes.exportRecords()).toHaveLength(0);
  } finally { bushes.dispose(); ground.dispose(); inventory.dispose(); scheduler.dispose(); }
});
