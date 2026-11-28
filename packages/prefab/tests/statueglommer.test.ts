import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { statueGlommerPrefabs, STATUEGLOMMER_ID, StatueGlommerInstance } from '../src/statueglommer';
import { PrefabEntityManager, type PrefabInstance } from '../src/prefabInstance';
import type { EntityPersistData, EntitySaveRecord } from '../src/saveRecord';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { createPickupInventory } from '../../../tests/fixtures/pickupFixture';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(playerPosition = new THREE.Vector3()) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  const scene = new THREE.Scene(),
    scheduler = new GameTimeScheduler(),
    awake = createSignal(true),
    physics = new CANNON.World();
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', {
    tickingarea: () => createMemo(() => awake.get()),
    scheduler,
    physics,
  });
  prefabs.register(statueGlommerPrefabs({ scheduler }));
  const registry = new EntityRegistry([], prefabs, () => playerPosition);
  registry.registerPrefabs(PREFAB_DEFINITIONS.glommerStatues);
  const spawn = (record: EntitySaveRecord) => prefabs.restore(STATUEGLOMMER_ID, record) as StatueGlommerInstance;
  const records = () => registry.exportRecords().statueglommer ?? [];
  const dispose = () => {
    registry.dispose();
    prefabs.dispose();
    displays.dispose();
    scheduler.dispose();
  };
  return { scene, scheduler, awake, physics, prefabs, registry, spawn, records, dispose };
}
const record = (id: string, x: number, components: EntityPersistData): EntitySaveRecord => ({
  id,
  transform: { position: [x, 0, 3], rotationY: 0 },
  components,
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('constructs full once, then declares the Lua OnLoadWorked pose for saved work', async () => {
  const { spawn, records, physics, prefabs, dispose } = setup();
  try {
    const saved = record('saved-statue', 2, {
      workable: { maxwork: -1, workleft: 2 },
      pickable: { picked: true, caninteractwith: true },
    });
    const inst = spawn(saved);
    expect(inst.listTags()).toContain('statue');
    expect(inst.minimap.icon).toBe('statueglommer.png');
    expect(physics.bodies).toHaveLength(1);
    expect(inst.sprite.sprite.value.clip).toMatchObject({ name: 'med', loop: false });
    expect(inst.sprite.sprite.value.queue).toEqual([]);
    expect(records()).toEqual([saved]);
    await prefabDisplay(inst.transform.model)!.artLoaded();
    expect(inst.sprite.currentAnimation).toBe('med');
    const fresh = prefabs.spawnAs(StatueGlommerInstance, STATUEGLOMMER_ID, new THREE.Vector3(3, 0, 3));
    expect(fresh.sprite.sprite.value.clip).toMatchObject({ name: 'full', loop: false });
    // A new pickable is empty: the flower stays hidden and the record is the source's picked shelf.
    expect(fresh.components.pickable.canBePicked).toBe(false);
    expect(fresh.light.peek()).toBeUndefined();
    const worked = spawn(record('worked-statue', 4, { statueglommer: { worked: true } }));
    expect(worked.sprite.sprite.value.clip).toMatchObject({ name: 'low', loop: false });
    expect(worked.components.workable).toBeUndefined();
    expect(records().find(({ id }) => id === 'worked-statue')!.components).toEqual({
      statueglommer: { worked: true },
      pickable: { picked: true, caninteractwith: true },
    });
    // A saved flower: pickable:OnLoad's makefullfn shows it, and OnLoad finishes the light tween.
    const flower = spawn(
      record('flower-statue', 6, {
        workable: { maxwork: -1, workleft: 6 },
        pickable: { caninteractwith: true },
        statueglommer: { spawned: true },
      }),
    );
    expect(flower.components.pickable.canBePicked).toBe(true);
    expect(flower.spawned).toBe(true);
    expect(flower.light.peek()).toMatchObject({ intensity: 0.9, falloff: 0.3 });
    expect(records().find(({ id }) => id === 'flower-statue')!.components).toEqual({
      workable: { maxwork: -1, workleft: 6 },
      pickable: { caninteractwith: true },
      statueglommer: { spawned: true },
    });
  } finally {
    dispose();
  }
});

it('rebuilds the declared clip after tile sleep without changing saved work', async () => {
  const { scene, awake, spawn, records, dispose } = setup();
  try {
    const inst = spawn(
      record('sleeping-statue', 1, { workable: { maxwork: -1, workleft: 2 }, pickable: { picked: true } }),
    );
    const model = inst.transform.model;
    await prefabDisplay(model)!.artLoaded();
    awake.set(false);
    await settle();
    expect(inst.status.value).toBe('asleep');
    expect(inst.sprite.loaded).toBe(false);
    expect(model.parent).toBeNull();
    awake.set(true);
    await settle();
    expect(model.parent).toBe(scene);
    expect(inst.sprite.currentAnimation).toBe('med');
    expect(records()[0].components.workable?.workleft).toBe(2);
  } finally {
    dispose();
  }
});

it('keeps a c_spawn statue and a worked one through c_save and a reload', async () => {
  const first = setup(new THREE.Vector3(3, 0, -6)),
    second = setup(),
    inventory = createPickupInventory();
  try {
    expect(
      (await executeDebugCommand('c_spawn("statueglommer")', inventory, prefab => first.registry.spawn(prefab))).ok,
    ).toBe(true);
    expect((await executeDebugCommand('c_give("statueglommer")', inventory)).ok).toBe(false);
    first.spawn(
      record('inline-statue', 5, {
        pickable: { picked: true, caninteractwith: true },
        workable: { maxwork: -1, workleft: 2 },
      }),
    );
    const before = first.registry.exportRecords();
    let json = '';
    expect(
      (
        await executeDebugCommand('c_save()', inventory, undefined, () => {
          json = serializeSave(
            deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG),
            {
              entities: before,
              inventory: inventory.exportSaved(),
              elapsedSeconds: 1,
              playerTransform: { position: [3, 0, -6], rotationY: 0 },
            },
            SAVE_CATALOG,
          );
        })
      ).ok,
    ).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG).world.entities.statueglommer!;
    expect(saved).toEqual(before.statueglommer);
    expect(saved[0]).toMatchObject({
      transform: { position: [3, 0, -6] },
      components: { workable: { maxwork: -1, workleft: 6 }, pickable: { picked: true, caninteractwith: true } },
    });
    await second.registry.restoreAll({ statueglommer: saved });
    expect(saved.map(({ id }) => second.prefabs.get(id)!.sprite.sprite.value.clip.name)).toEqual(['full', 'med']);
    expect(second.records()).toEqual(saved);
  } finally {
    first.dispose();
    second.dispose();
    inventory.dispose();
  }
});
