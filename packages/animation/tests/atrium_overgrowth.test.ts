import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { SANITYAURA_SUPERHUGE } from '../../componets/src/sanityaura';
import { atriumOvergrowthPrefabs, ATRIUM_OVERGROWTH_ID, AtriumOvergrowthInstance } from '../../prefab/src/atrium_overgrowth';
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
  const definitions = atriumOvergrowthPrefabs();
  prefabs.register(definitions);
  const registry = new EntityRegistry([], prefabs, () => playerPosition);
  registry.registerPrefabs(PREFAB_DEFINITIONS.atriumOvergrowths);
  const spawn = (record: EntitySaveRecord) =>
    prefabs.restoreAs(AtriumOvergrowthInstance, ATRIUM_OVERGROWTH_ID, record);
  const records = () => registry.exportRecords().atrium_overgrowth ?? [];
  const requested = (archive: string) =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([url]) => String(url).endsWith(`/dst/data/anim/${archive}`));
  const dispose = () => { registry.dispose(); prefabs.dispose(); displays.dispose(); scheduler.dispose(); };
  return { scene, awake, prefabs, registry, definitions, spawn, records, requested, dispose };
}
/** The imported default cave's overgrowths, as the game's save reader parses them. */
async function importedOvergrowths(): Promise<EntitySaveRecord[]> {
  const cave = JSON.parse(await readFile(new URL('../../../public/saves/Cluster_1/Caves.json', import.meta.url), 'utf8'));
  cave.players = { local: { ...initialWorld.players.local, shardId: cave.world.shardId } };
  return deserializeSave(JSON.stringify(cave), SAVE_CATALOG).world.entities.atrium_overgrowth! as EntitySaveRecord[];
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('loads the imported save record with the clip, tags, bank and component values atrium_overgrowth.lua fn declares', async () => {
  const overgrowths = await importedOvergrowths();
  expect(overgrowths).toHaveLength(4);
  // The source records carry no data: no story line has been assigned yet.
  expect(overgrowths.map(record => record.components)).toEqual([{}, {}, {}, {}]);
  const { spawn, records, definitions, requested, dispose } = setup();
  try {
    const inst = spawn(overgrowths[0]!);
    // fn's AddTag, MakeObstaclePhysics's blocker, then the sanityaura and inspectable constructors' tags.
    expect(inst.listTags()).toEqual(['ancient_text', 'blocker', 'sanityaura', 'inspectable']);
    // PlayAnimation("idle") without looping.
    expect(inst.sprite.sprite.peek()).toMatchObject({ clip: { name: 'idle', loop: false }, queue: [], billboard: true });
    expect(definitions.atrium_overgrowth).toMatchObject({
      assets: { animationArchive: 'atrium_overgrowth.zip', buildArchives: ['atrium_overgrowth.zip'], bank: 'atrium_overgrowth' },
      physics: { radius: 1.5 }, minimapIcon: 'atrium_overgrowth.png',
    });
    expect(inst.components.sanityaura.aura).toBe(-SANITYAURA_SUPERHUGE);
    expect(Object.keys(inst.components)).toEqual(expect.arrayContaining(['sanityaura', 'inspectable', 'roseinspectable']));
    expect(inst.storyprogress).toBeUndefined();
    expect(records()).toEqual([overgrowths[0]]);
    await prefabDisplay(inst.transform.model)!.artLoaded();
    expect(requested('atrium_overgrowth.zip')).toBe(true);
    expect(inst.sprite.currentAnimation).toBe('idle');
  } finally { dispose(); }
});

it('rebuilds the declared clip and appearance after tile sleep', async () => {
  const { scene, awake, spawn, records, dispose } = setup();
  try {
    const saved: EntitySaveRecord = { id: 'sleeping-overgrowth', transform: { position: [1, 0, 3], rotationY: 0 },
      components: { atriumOvergrowth: { storyprogress: 2 } } };
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
    expect(inst.sprite.currentAnimation).toBe('idle');
    expect(inst.sprite.sprite.peek().clip).toMatchObject({ name: 'idle', loop: false });
    expect(inst.sprite.sprite.peek().appearance).toEqual(before.appearance);
    expect(inst.storyprogress).toBe(2);
    expect(records()).toEqual([saved]);
  } finally { dispose(); }
});

it('keeps a c_spawn overgrowth through c_save and a reload, and rejects c_give', async () => {
  const first = setup(new THREE.Vector3(3, 0, -6)), second = setup(), inventory = createPickupInventory();
  try {
    expect((await executeDebugCommand('c_spawn("atrium_overgrowth")', inventory, prefab => first.registry.spawn(prefab))).ok).toBe(true);
    expect((await executeDebugCommand('c_give("atrium_overgrowth")', inventory)).ok).toBe(false);
    const spawned = [...first.prefabs.instances(ATRIUM_OVERGROWTH_ID)][0] as AtriumOvergrowthInstance;
    // rune_onsave writes nil until an inspection assigns a story line (getstatus is not ported).
    expect(first.records()[0]!.components).toEqual({});
    spawned.storyprogress = 3;
    const before = first.registry.exportRecords();
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      json = serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG),
        { entities: before, inventory: inventory.exportState(), elapsedSeconds: 1, playerTransform: { position: [3, 0, -6], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG).world.entities.atrium_overgrowth!;
    expect(saved).toEqual(before.atrium_overgrowth);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: spawned.entityId, transform: { position: [3, 0, -6] },
      components: { atriumOvergrowth: { storyprogress: 3 } } });
    await second.registry.restoreAll({ atrium_overgrowth: saved });
    const loaded = second.prefabs.get(saved[0]!.id);
    if (!(loaded instanceof AtriumOvergrowthInstance)) throw new Error('The saved overgrowth did not load');
    expect(loaded.position.toArray()).toEqual([3, 0, -6]);
    expect(loaded.sprite.sprite.peek().clip).toMatchObject({ name: 'idle', loop: false });
    expect(loaded.storyprogress).toBe(3);
    expect(loaded.components.sanityaura.aura).toBe(-SANITYAURA_SUPERHUGE);
    expect(second.records()).toEqual(saved);
  } finally { first.dispose(); second.dispose(); inventory.dispose(); }
});
