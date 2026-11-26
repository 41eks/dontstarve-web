import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Hauntable } from '../../componets/src/hauntable';
import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';
import type { EntitySaveRecord } from '../../prefab/src/saveRecord';
import { shadowForgePrefabs, SHADOW_FORGE_ID, ShadowForgeInstance } from '../../prefab/src/shadow_forge';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { createPickupInventory } from './pickupFixture';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(playerPosition = new THREE.Vector3()) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))),
  );
  const scene = new THREE.Scene(),
    scheduler = new GameTimeScheduler(),
    awake = createSignal(true);
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', {
    tickingarea: () => createMemo(() => awake.get()),
    scheduler,
  });
  const definitions = shadowForgePrefabs({ scheduler });
  prefabs.register(definitions);
  const registry = new EntityRegistry([], prefabs, () => playerPosition);
  registry.registerPrefabs(PREFAB_DEFINITIONS.shadowForges);
  const spawn = (record: EntitySaveRecord) => prefabs.restore(SHADOW_FORGE_ID, record) as ShadowForgeInstance;
  const records = () => registry.exportRecords().shadow_forge ?? [];
  const requested = (archive: string) =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([url]) =>
      String(url).endsWith(`/dst/data/anim/${archive}`),
    );
  const dispose = () => {
    registry.dispose();
    prefabs.dispose();
    displays.dispose();
    scheduler.dispose();
  };
  return { scene, awake, prefabs, registry, definitions, spawn, records, requested, dispose };
}
/** Cluster_65's 0000000315 Master snapshot holds one forge, `{ x = 384, z = -308 }` with no data; this is its import. */
const importedRecord = (id: string, position: [number, number, number]): EntitySaveRecord => ({
  id,
  transform: { position, rotationY: 0 },
  components: {},
});
const clip = (inst: PrefabInstance) => inst.sprite.sprite.value.clip;
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('loads a saved forge with the clip, tags, bank and component values shadow_forge.lua fn declares', async () => {
  const { spawn, records, definitions, requested, dispose } = setup();
  try {
    const hauntValue = vi.spyOn(Hauntable.prototype, 'SetHauntValue');
    const saved = importedRecord('dst_03741E1B78B29575_shadow_forge_index_000001', [4, 0, -8]);
    const inst = spawn(saved);
    // MakeObstaclePhysics, fn's AddTag calls, MakeSnowCoveredPristine, then inspectable's and workable's tags.
    expect(inst.listTags()).toEqual([
      'blocker',
      'structure',
      'shadow_forge',
      'prototyper',
      'SnowCovered',
      'inspectable',
      'HAMMER_workable',
    ]);
    // PlayAnimation("idle") once, held on its last frame; no OnLoad changes it.
    expect(clip(inst)).toMatchObject({ name: 'idle', loop: false });
    expect(definitions.shadow_forge).toMatchObject({
      assets: {
        animationArchive: 'shadow_forge.zip',
        buildArchives: ['shadow_forge.zip', 'snow.zip'],
        bank: 'shadow_forge',
        hiddenLayers: ['snow'],
      },
      physics: { radius: 0.4 },
      minimapIcon: 'shadow_forge.png',
    });
    const { prototyper, workable } = inst.components;
    expect(prototyper.trees).toMatchObject({ SHADOWFORGING: 2, SCIENCE: 0 });
    expect([workable.GetWorkAction(), workable.GetWorkLeft()]).toEqual(['HAMMER', 4]);
    // hauntable:SetHauntValue(TUNING.HAUNT_TINY).
    expect(hauntValue).toHaveBeenCalledExactlyOnceWith(1);
    expect(Object.keys(inst.components)).toEqual([
      'inspectable',
      'prototyper',
      'lootdropper',
      'workable',
      'hauntable',
      'lunarhailbuildup',
    ]);
    expect(records()).toEqual([saved]);
    await prefabDisplay(inst.transform.model)!.artLoaded();
    expect(requested('shadow_forge.zip')).toBe(true);
    expect(requested('snow.zip')).toBe(true);
  } finally {
    dispose();
  }
});

it('rebuilds the declared clip and appearance after tile sleep', async () => {
  const { scene, awake, spawn, records, dispose } = setup();
  try {
    const saved = importedRecord('sleeping-forge', [1, 0, 3]);
    const inst = spawn(saved);
    const model = inst.transform.model;
    await prefabDisplay(model)!.artLoaded();
    const before = inst.sprite.sprite.value;
    awake.set(false);
    await settle();
    expect(inst.status.value).toBe('asleep');
    expect(inst.sprite.loaded).toBe(false);
    expect(model.parent).toBeNull();
    awake.set(true);
    await settle();
    await prefabDisplay(model)!.artLoaded();
    expect(model.parent).toBe(scene);
    expect(inst.sprite.currentAnimation).toBe('idle');
    expect(clip(inst)).toMatchObject({ name: 'idle', loop: false });
    expect(inst.sprite.sprite.value.appearance).toEqual(before.appearance);
    expect(records()).toEqual([saved]);
  } finally {
    dispose();
  }
});

it('keeps a c_spawn forge and an imported one through c_save and a reload, and rejects c_give', async () => {
  const first = setup(new THREE.Vector3(3, 0, -6)),
    second = setup(),
    inventory = createPickupInventory();
  try {
    expect(
      (await executeDebugCommand('c_spawn("shadow_forge")', inventory, prefab => first.registry.spawn(prefab))).ok,
    ).toBe(true);
    expect((await executeDebugCommand('c_give("shadow_forge")', inventory)).ok).toBe(false);
    const spawned = [...first.prefabs.instances(SHADOW_FORGE_ID)][0] as ShadowForgeInstance;
    expect(clip(spawned)).toMatchObject({ name: 'idle', loop: false });
    expect(first.records()[0]!.components).toEqual({});
    first.spawn(importedRecord('imported-forge', [5, 0, 1]));
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
    const saved = deserializeSave(json, SAVE_CATALOG).world.entities.shadow_forge!;
    expect(saved).toEqual(before.shadow_forge);
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ id: spawned.entityId, transform: { position: [3, 0, -6] }, components: {} });
    await second.registry.restoreAll({ shadow_forge: saved });
    const loaded = second.prefabs.get(saved[0]!.id);
    if (!(loaded instanceof ShadowForgeInstance)) {
      throw new Error('The saved forge did not load');
    }
    expect(loaded.position.toArray()).toEqual([3, 0, -6]);
    expect([clip(loaded)?.name, loaded.components.workable.GetWorkLeft(), loaded.hasTag('shadow_forge')]).toEqual([
      'idle',
      4,
      true,
    ]);
    expect(second.prefabs.get('imported-forge')?.position.toArray()).toEqual([5, 0, 1]);
    expect(second.records()).toEqual(saved);
  } finally {
    first.dispose();
    second.dispose();
    inventory.dispose();
  }
});
