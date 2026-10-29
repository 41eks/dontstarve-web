import { actionTargetModel } from '../../stategraphs/src/actionTargetView';
import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { BerrybushManager } from '../../prefab/src/berrybush';
import { GroundItemManager } from '../../../src/groundItems';
import { createInventoryStore } from '../../../src/inventory';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { bindTestWorld, drawn, plantInstance } from './worldContentFixture';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

it('restores a sleeping plant with its identity and skin, and finishes burning while its visual is unloaded', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true);
  bindTestWorld(scheduler);
  const player = new THREE.Group(), inventory = createInventoryStore([]);
  const ground = new GroundItemManager(scene, new THREE.PerspectiveCamera(), { domElement: new EventTarget() } as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', player);
  const bushes = new BerrybushManager(scene, '/dst/data/anim', { tickingarea: () => createMemo(() => awake.get()),
    spawnGroundItem: (definition, position, options) => ground.spawnGroundItem(definition, position, options) });
  try {
    await drawn(bushes.spawn(new THREE.Vector3(4, 0, 6), { id: 'bush:resident', transform: { position: [4, 0, 6], rotationY: 0 },
      components: { plant: { skinId: 'berrybush_cawnival' } } }));
    await tick();
    const model = actionTargetModel(bushes.digTargets[0]);
    const instance = plantInstance(model), components = instance.components;
    expect(model.parent).toBe(scene);
    const meshes = () => { let count = 0; model.traverse(object => { if (object instanceof THREE.Mesh) count++; }); return count; };
    expect(meshes()).toBeGreaterThan(0);

    awake.set(false); await tick();
    expect(model.parent).toBeNull();
    expect(meshes()).toBe(0);
    expect(lookupPrefabInstance(model)?.entityId).toBe('bush:resident');
    expect(bushes.exportRecords()[0].id).toBe('bush:resident');
    expect(instance.components).toBe(components);
    expect(instance.skinId).toBe('berrybush_cawnival');

    awake.set(true); await tick();
    expect(model.parent).toBe(scene);
    expect(meshes()).toBeGreaterThan(0);

    const burnable = components.burnable;
    burnable.Ignite(); await tick();
    const [fire] = instance.sprite.fx.peek().values();
    expect(lookupPrefabInstance(fire.display!.model)?.listTags()).toEqual(['FX', 'HASHEATER']);
    awake.set(false); await tick();
    expect(instance.sprite.fx.peek().size).toBe(0);
    expect(model.parent).toBeNull();
    expect(burnable.IsBurning()).toBe(true);
    // Domain deadlines still run without a manager frame or a drawn sprite.
    scheduler.advance(30); await tick();
    expect(instance.isRemoved).toBe(true);
    expect(burnable.timer.peek()).toEqual({ status: 'stopped' });
    expect(ground.exportRecords().map(record => record.components.stack?.itemId)).toEqual(['ash']);
    bushes.remove(model);
    expect(model.parent).toBeNull();
    expect(bushes.exportRecords()).toHaveLength(0);
  } finally { bushes.dispose(); ground.dispose(); inventory.dispose(); scheduler.dispose(); }
});
