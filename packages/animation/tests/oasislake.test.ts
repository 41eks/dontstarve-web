import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { oasislakePrefabs, OASISLAKE_ID, OasislakeInstance } from '../../prefab/src/oasislake';
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

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(playerPosition = new THREE.Vector3()) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true);
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim',
    { tickingarea: () => createMemo(() => awake.get()), scheduler });
  const definitions = oasislakePrefabs({ scheduler });
  prefabs.register(definitions);
  const registry = new EntityRegistry([], prefabs, () => playerPosition);
  registry.registerPrefabs(PREFAB_DEFINITIONS.oasislakes);
  const spawn = (record: EntitySaveRecord) =>
    prefabs.restoreAs(OasislakeInstance, OASISLAKE_ID, record);
  const records = () => registry.exportRecords().oasislake ?? [];
  const requested = (archive: string) =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([url]) => String(url).endsWith(`/dst/data/anim/${archive}`));
  const dispose = () => { registry.dispose(); prefabs.dispose(); displays.dispose(); scheduler.dispose(); };
  return { scene, awake, prefabs, registry, definitions, spawn, records, requested, dispose };
}
/** Cluster_65's forest snapshot 0000000315 holds one lake, `{x=354.06,z=-93.94}` with no data, imported with empty components. */
const importedRecord = (id: string, position: [number, number, number]): EntitySaveRecord =>
  ({ id, transform: { position, rotationY: 0 }, components: {} });
const clip = (inst: PrefabInstance) => inst.sprite.sprite.peek().clip;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('loads a saved lake with the clip, tags, bank and component values oasislake.lua fn and OnLoad declare', async () => {
  const { spawn, records, definitions, requested, dispose } = setup();
  try {
    const inst = spawn(importedRecord('dst_03741E1B78B29575_oasislake_index_000001', [4, 0, -8]));
    // MakeObstaclePhysics's blocker, fn's AddTag in order, then the inspectable and fishable constructors' tags.
    expect(inst.listTags()).toEqual(['blocker', 'watersource', 'birdblocker', 'antlion_sinkhole_blocker', 'allow_casting',
      'inspectable', 'fishable']);
    // PlayAnimation("idle", true), OnGround on LAYER_BACKGROUND / SortOrder -3, Transform:SetRotation(45).
    expect(clip(inst)).toMatchObject({ name: 'idle', loop: true });
    expect(inst.sprite.sprite.peek()).toMatchObject({ ground: { renderOrder: 0, flat: true }, meshOrder: -.56 });
    expect(inst.rotation).toBe(45);
    expect(definitions.oasislake).toMatchObject({
      assets: { animationArchive: 'oasis_tile.zip', buildArchives: ['oasis_tile.zip'], bank: 'oasis_tile' },
      physics: { radius: 6 }, minimapIcon: 'oasis.png',
    });
    expect(Object.keys(inst.components)).toEqual(['pointofinterest', 'inspectable', 'fishable', 'hauntable', 'oasis', 'watersource']);
    const { fishable } = inst.components;
    // maxfish = OASISLAKE_MAX_FISH leaves the constructor's fishleft of 10, as in fishable.lua.
    expect([fishable.maxfish, fishable.fishleft, fishable.fishrespawntime]).toEqual([15, 10, 90]);
    // OnLoad: a record without regrowth = false loads as regrowing, which OnSave leaves out; fishable saves its 10 fish.
    expect([inst.regrowth, inst.driedup, inst.isdamp, inst.no_wet_prefix]).toEqual([true, false, false, true]);
    expect(records()[0]!.components).toEqual({ fishable: { fish: 10 } });
    await prefabDisplay(inst.transform.model)!.artLoaded();
    expect(requested('oasis_tile.zip')).toBe(true);
  } finally { dispose(); }
});

it('rebuilds the declared clip and appearance after tile sleep', async () => {
  const { scene, awake, spawn, dispose } = setup();
  try {
    const inst = spawn(importedRecord('sleeping-lake', [1, 0, 3]));
    const model = inst.transform.model;
    await prefabDisplay(model)!.artLoaded();
    const before = inst.sprite.sprite.peek();
    awake.set(false); await settle();
    expect(inst.status.peek()).toBe('asleep');
    expect(inst.sprite.loaded).toBe(false);
    expect(model.parent).toBeNull();
    awake.set(true); await settle();
    await prefabDisplay(model)!.artLoaded();
    expect(model.parent).toBe(scene);
    expect(inst.sprite.currentAnimation).toBe('idle');
    expect(clip(inst)).toMatchObject({ name: 'idle', loop: true });
    expect(inst.sprite.sprite.peek()).toMatchObject({ ground: { renderOrder: 0, flat: true }, meshOrder: -.56 });
    expect(inst.sprite.sprite.peek().appearance).toEqual(before.appearance);
    expect(inst.rotation).toBe(45);
  } finally { dispose(); }
});

it('keeps a c_spawn lake and an imported one through c_save and a reload, and rejects c_give', async () => {
  const first = setup(new THREE.Vector3(3, 0, -6)), second = setup(), inventory = createPickupInventory();
  try {
    expect((await executeDebugCommand('c_spawn("oasislake")', inventory, prefab => first.registry.spawn(prefab))).ok).toBe(true);
    expect((await executeDebugCommand('c_give("oasislake")', inventory)).ok).toBe(false);
    const spawned = [...first.prefabs.instances(OASISLAKE_ID)][0] as OasislakeInstance;
    // A spawned lake never runs OnLoad: fn's regrowth = false, which OnSave writes.
    expect(spawned.regrowth).toBe(false);
    expect(clip(spawned)).toMatchObject({ name: 'idle', loop: true });
    expect(first.records()[0]!.components).toEqual({ fishable: { fish: 10 }, oasislake: { regrowth: false } });
    const imported = first.spawn(importedRecord('imported-lake', [20, 0, 1]));
    imported.components.fishable.fishleft = 3;
    const before = first.registry.exportRecords();
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      json = serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG),
        { entities: before, inventory: inventory.exportSaved(), elapsedSeconds: 1, playerTransform: { position: [3, 0, -6], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG).world.entities.oasislake!;
    expect(saved).toEqual(before.oasislake);
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ id: spawned.entityId, transform: { position: [3, 0, -6] } });
    await second.registry.restoreAll({ oasislake: saved });
    const loaded = second.prefabs.get(saved[0]!.id);
    if (!(loaded instanceof OasislakeInstance)) throw new Error('The saved lake did not load');
    expect(loaded.position.toArray()).toEqual([3, 0, -6]);
    expect([loaded.regrowth, loaded.components.fishable.fishleft, loaded.rotation, clip(loaded)?.name]).toEqual([false, 10, 45, 'idle']);
    const reloaded = second.prefabs.get('imported-lake') as OasislakeInstance;
    expect([reloaded.regrowth, reloaded.components.fishable.fishleft]).toEqual([true, 3]);
    expect(second.records()).toEqual(saved);
  } finally { first.dispose(); second.dispose(); inventory.dispose(); }
});
