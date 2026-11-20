import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { oceanVineDecoPrefabs, OCEANVINE_DECO_ID, OceanVineDecoInstance } from '../../prefab/src/oceanvine_deco';
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
  const definitions = oceanVineDecoPrefabs();
  prefabs.register(definitions);
  const registry = new EntityRegistry([], prefabs, () => playerPosition);
  registry.registerPrefabs(PREFAB_DEFINITIONS.oceanVineDecos);
  const spawn = (record: EntitySaveRecord) =>
    prefabs.restore(OCEANVINE_DECO_ID, record) as OceanVineDecoInstance;
  const records = () => registry.exportRecords().oceanvine_deco ?? [];
  const requested = (archive: string) =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([url]) => String(url).endsWith(`/dst/data/anim/${archive}`));
  const dispose = () => { registry.dispose(); prefabs.dispose(); displays.dispose(); scheduler.dispose(); };
  return { scene, awake, prefabs, registry, definitions, spawn, records, requested, dispose };
}
/** The imported default save's vines, as the game's save reader parses them. */
async function importedVines(): Promise<EntitySaveRecord[]> {
  const cluster = new URL('../../../public/saves/Cluster_1/', import.meta.url);
  const json = await readFile(new URL('Master.json', cluster), 'utf8');
  const { session } = JSON.parse(json) as { session: { playerFile: string } };
  const { player } = JSON.parse(await readFile(new URL(session.playerFile, cluster), 'utf8')) as { player: unknown };
  return deserializeSave(json, SAVE_CATALOG, player).world.entities.oceanvine_deco! as EntitySaveRecord[];
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('loads imported save records with the idle_N loop, tags and bank oceanvine_deco.lua declares', async () => {
  const vines = await importedVines();
  expect(vines).toHaveLength(66);
  const { spawn, records, definitions, requested, dispose } = setup();
  try {
    const loaded = [2, 5].map(n => spawn(vines.find(record => record.components.animnum === n)!));
    for (const [index, n] of [2, 5].entries()) {
      const inst = loaded[index]!;
      expect(inst.listTags()).toEqual(['NOBLOCK', 'NOCLICK', 'flying']);
      expect(inst.animnum).toBe(n);
      expect(inst.sprite.sprite.peek().clip).toMatchObject({ name: `idle_${n}`, loop: true });
      expect(Object.keys(inst.components)).toContain('distancefade');
    }
    expect(definitions.oceanvine_deco).toMatchObject({
      assets: { animationArchive: 'waterforest_vines.zip', buildArchives: ['waterforest_vines.zip'], bank: 'vine_rainforest_border' },
      assetOptions: { instancedAnimations: ['idle_1', 'idle_2', 'idle_3', 'idle_4', 'idle_5', 'idle_6'] },
    });
    expect(records().map(record => record.components.animnum).sort()).toEqual([2, 5]);
    await prefabDisplay(loaded[0]!.transform.model)!.artLoaded();
    expect(requested('waterforest_vines.zip')).toBe(true);
    expect(loaded[0]!.sprite.currentAnimation).toBe('idle_2');
  } finally { dispose(); }
});

it('rebuilds the declared clip after tile sleep', async () => {
  const { scene, awake, spawn, records, dispose } = setup();
  try {
    const saved: EntitySaveRecord = { id: 'sleeping-vine', transform: { position: [1, 0, 3], rotationY: 0 }, components: { animnum: 4 } };
    const inst = spawn(saved);
    const model = inst.transform.model, before = inst.sprite.sprite.peek();
    await prefabDisplay(model)!.artLoaded();
    awake.set(false); await settle();
    expect(inst.status.peek()).toBe('asleep');
    expect(inst.sprite.loaded).toBe(false);
    expect(model.parent).toBeNull();
    awake.set(true); await settle();
    await prefabDisplay(model)!.artLoaded();
    expect(model.parent).toBe(scene);
    expect(inst.sprite.currentAnimation).toBe('idle_4');
    expect(inst.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_4', loop: true });
    expect(inst.sprite.sprite.peek().appearance).toEqual(before.appearance);
    expect(records()).toEqual([saved]);
  } finally { dispose(); }
});

it('keeps a c_spawn vine through c_save and a reload, and rejects c_give', async () => {
  const first = setup(new THREE.Vector3(3, 0, -6)), second = setup(), inventory = createPickupInventory();
  try {
    expect((await executeDebugCommand('c_spawn("oceanvine_deco")', inventory, prefab => first.registry.spawn(prefab))).ok).toBe(true);
    expect((await executeDebugCommand('c_give("oceanvine_deco")', inventory)).ok).toBe(false);
    const spawned = [...first.prefabs.instances(OCEANVINE_DECO_ID)][0] as OceanVineDecoInstance;
    // math.random(1, 6), and its loop.
    expect([1, 2, 3, 4, 5, 6]).toContain(spawned.animnum);
    expect(spawned.sprite.sprite.peek().clip).toMatchObject({ name: `idle_${spawned.animnum}`, loop: true });
    const before = first.registry.exportRecords();
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      json = serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG),
        { entities: before, inventory: inventory.exportSaved(), elapsedSeconds: 1, playerTransform: { position: [3, 0, -6], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG).world.entities.oceanvine_deco!;
    expect(saved).toEqual(before.oceanvine_deco);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: spawned.entityId, transform: { position: [3, 0, -6] }, components: { animnum: spawned.animnum } });
    await second.registry.restoreAll({ oceanvine_deco: saved });
    const loaded = second.prefabs.get(saved[0]!.id);
    if (!(loaded instanceof OceanVineDecoInstance)) { throw new Error('The saved vine did not load'); }
    expect(loaded.position.toArray()).toEqual([3, 0, -6]);
    expect([loaded.animnum, loaded.sprite.sprite.peek().clip]).toMatchObject([spawned.animnum, { name: `idle_${spawned.animnum}`, loop: true }]);
    expect(second.records()).toEqual(saved);
  } finally { first.dispose(); second.dispose(); inventory.dispose(); }
});
