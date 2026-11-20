import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { atriumStatuePrefabs, ATRIUM_STATUE_ID, AtriumStatueInstance } from '../../prefab/src/atrium_statue';
import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';
import type { EntitySaveRecord } from '../../prefab/src/saveRecord';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { createPickupInventory } from './pickupFixture';

// An imported Caves record: the source statue has no id or data, so the importer derives the ID from its index.
const RECORD: EntitySaveRecord = {
  id: 'dst_04E26ADB66396E8D_atrium_statue_index_000001',
  transform: { position: [696, 0, 1605], rotationY: 0 },
  components: {},
};

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(playerPosition = new THREE.Vector3()) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))),
  );
  const scene = new THREE.Scene(),
    awake = createSignal(true),
    physics = new CANNON.World();
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', {
    tickingarea: () => createMemo(() => awake.get()),
    physics,
  });
  prefabs.register(atriumStatuePrefabs());
  const registry = new EntityRegistry([], prefabs, () => playerPosition);
  registry.registerPrefabs(PREFAB_DEFINITIONS.atriumStatues);
  const spawn = (record = RECORD) => prefabs.restore(ATRIUM_STATUE_ID, record) as AtriumStatueInstance;
  const dispose = () => {
    registry.dispose();
    prefabs.dispose();
    displays.dispose();
  };
  return { scene, awake, physics, prefabs, registry, spawn, dispose };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('loads a saved statue with the source construction, no tags, and the looping calm idle_full, and saves it unchanged', async () => {
  const { spawn, physics, registry, dispose } = setup();
  try {
    const inst = spawn();
    // fn plays idle_full once; OnNightmarePhaseChanged(..., true) then plays idle_full looping for a non-wild phase.
    expect(inst.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_full', loop: true });
    expect(inst.sprite.sprite.peek().queue).toEqual([]);
    await prefabDisplay(inst.transform.model)!.artLoaded();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/dst/data/anim/atrium_statue.zip'));
    expect(inst.sprite.currentAnimation).toBe('idle_full');
    // MakeStatue adds no tags; inspectable.lua adds `inspectable`, and `tickingarea` is this project's activity tag.
    expect([...inst.listTags()].sort()).toEqual(['inspectable']);
    // The workable and lootdropper are commented out in the source: only inspectable and roseinspectable remain.
    expect(Object.keys(inst.components).sort()).toEqual(['inspectable', 'roseinspectable']);
    expect(inst.minimap.icon).toBe('atrium_statue.png');
    expect(physics.bodies).toHaveLength(1);
    expect(registry.exportRecords()).toEqual({ [ATRIUM_STATUE_ID]: [RECORD] });
  } finally {
    dispose();
  }
});

it('releases the statue art while its tile sleeps and redraws the declared idle_full when it wakes', async () => {
  const { scene, awake, spawn, registry, dispose } = setup();
  try {
    const inst = spawn(),
      model = inst.transform.model;
    await prefabDisplay(model)!.artLoaded();
    const declared = inst.sprite.sprite.peek().clip;
    awake.set(false);
    await settle();
    expect(inst.status.peek()).toBe('asleep');
    expect(inst.sprite.loaded).toBe(false);
    expect(model.parent).toBeNull();
    awake.set(true);
    await settle();
    await prefabDisplay(model)!.artLoaded();
    expect(model.parent).toBe(scene);
    expect(inst.sprite.sprite.peek().clip).toEqual(declared);
    expect(inst.sprite.currentAnimation).toBe('idle_full');
    expect(registry.exportRecords()[ATRIUM_STATUE_ID]).toEqual([RECORD]);
  } finally {
    dispose();
  }
});

it('keeps a c_spawn statue through c_save and a reload', async () => {
  const first = setup(new THREE.Vector3(3, 0, -6)),
    second = setup(),
    inventory = createPickupInventory();
  try {
    expect(
      (await executeDebugCommand('c_spawn("atrium_statue")', inventory, prefab => first.registry.spawn(prefab))).ok,
    ).toBe(true);
    expect((await executeDebugCommand('c_give("atrium_statue")', inventory)).ok).toBe(false);
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
    const saved = deserializeSave(json, SAVE_CATALOG).world.entities.atrium_statue!;
    expect(saved).toEqual(before.atrium_statue);
    expect(saved).toEqual([
      expect.objectContaining({ transform: { position: [3, 0, -6], rotationY: 0 }, components: {} }),
    ]);
    await second.registry.restoreAll({ atrium_statue: saved });
    const restored = second.prefabs.get(saved[0].id) as AtriumStatueInstance;
    expect(restored.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_full', loop: true });
    expect(second.registry.exportRecords().atrium_statue).toEqual(saved);
  } finally {
    first.dispose();
    second.dispose();
    inventory.dispose();
  }
});
