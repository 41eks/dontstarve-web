import { plantManager } from '../../../tests/fixtures/plantManagerFixture';
import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { berrybushPrefabs } from '../../prefab/src/berrybush';
import { ItemWorldFixture } from '../../../tests/fixtures/itemWorldFixture';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { bindTestWorld, drawn, plantInstance } from '../../../tests/fixtures/worldContentFixture';
import { workTargets } from '../../../tests/fixtures/workTargets';
import { createInventoryStore } from '../../../tests/fixtures/testInventory';

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop: vi.fn() })),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

it('restores a sleeping plant with its identity and skin, and finishes burning while its visual is unloaded', async () => {
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  vi.stubGlobal('window', new EventTarget());
  const scene = new THREE.Scene(),
    scheduler = new GameTimeScheduler(),
    awake = createSignal(true);
  bindTestWorld(scheduler);
  const player = new THREE.Group(),
    inventory = createInventoryStore([]);
  const ground = new ItemWorldFixture(
    scene,
    new THREE.PerspectiveCamera(),
    { domElement: new EventTarget() } as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip',
    inventory,
    '/dst/data/anim',
    player,
  );
  const bushes = plantManager(berrybushPrefabs, scene, {
    tickingarea: () => createMemo(() => awake.get()),
    spawnGroundItem: (definition, position, options) => ground.spawnGroundItem(definition, position, options),
  });
  try {
    await drawn(
      bushes.spawn('berrybush', new THREE.Vector3(4, 0, 6), {
        id: 'bush:resident',
        skinname: 'berrybush_cawnival',
        components: {},
      }).transform.model,
    );
    await tick();
    const model = workTargets('DIG')[0].model;
    const instance = plantInstance(model),
      components = instance.components;
    expect(model.parent).toBe(scene);
    const meshes = () => {
      let count = 0;
      model.traverse(object => {
        if (object instanceof THREE.Mesh) {
          count++;
        }
      });
      return count;
    };
    expect(meshes()).toBeGreaterThan(0);

    awake.set(false);
    await tick();
    expect(model.parent).toBeNull();
    expect(meshes()).toBe(0);
    expect(lookupPrefabInstance(model)?.entityId).toBe('bush:resident');
    expect(bushes.exportRecords().map(({ record }) => record)[0].id).toBe('bush:resident');
    expect(instance.components).toBe(components);
    expect(instance.skinId).toBe('berrybush_cawnival');

    awake.set(true);
    await tick();
    expect(model.parent).toBe(scene);
    expect(meshes()).toBeGreaterThan(0);

    const burnable = components.burnable;
    burnable.Ignite();
    await tick();
    const [fire] = instance.sprite.fx.value.values();
    // The fire only plays and queues clips: it is drawn from the fire's shared frames, with no display of its own.
    expect(fire.display).toBeUndefined();
    expect(fire.sprite.sprite.value.plainClips).toBeDefined();
    // The fire is the plant's child: it sleeps with it and stays declared until the burnable kills it.
    awake.set(false);
    await tick();
    expect(instance.sprite.fx.value.size).toBe(1);
    expect(model.parent).toBeNull();
    expect(burnable.IsBurning()).toBe(true);
    // Domain deadlines still run without a manager frame or a drawn sprite.
    scheduler.advance(30);
    await tick();
    expect(instance.isRemoved).toBe(true);
    expect(instance.sprite.fx.value.size).toBe(0);
    expect(fire.sprite.sprite.value.status).toBe('removed');
    expect(burnable.timer.value).toEqual({ status: 'stopped' });
    expect(ground.groundStacks().map(stack => stack.itemId)).toEqual(['ash']);
    plantInstance(model).remove();
    expect(model.parent).toBeNull();
    expect(bushes.exportRecords().map(({ record }) => record)).toHaveLength(0);
  } finally {
    bushes.dispose();
    ground.dispose();
    inventory.dispose();
    scheduler.dispose();
  }
});
