import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { oceanVinePrefabs, OCEANVINE_ID, OCEANVINE_REGROW_TIME, OceanVineInstance } from '../../prefab/src/oceanvine';
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
  const definitions = oceanVinePrefabs({ scheduler });
  prefabs.register(definitions);
  const registry = new EntityRegistry([], prefabs, () => playerPosition);
  registry.registerPrefabs(PREFAB_DEFINITIONS.oceanVines);
  const spawn = (record: EntitySaveRecord) =>
    prefabs.restore(OCEANVINE_ID, record) as OceanVineInstance;
  const records = () => registry.exportRecords().oceanvine ?? [];
  const requested = (archive: string) =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([url]) => String(url).endsWith(`/dst/data/anim/${archive}`));
  const dispose = () => { registry.dispose(); prefabs.dispose(); displays.dispose(); scheduler.dispose(); };
  return { scene, scheduler, awake, prefabs, registry, definitions, spawn, records, requested, dispose };
}
/** The vine's Show / Hide layer declarations. */
const layers = (inst: PrefabInstance) => Object.fromEntries([...inst.sprite.sprite.peek().appearance.values()]
  .flatMap(op => op.kind === 'layer' ? [[op.layer, op.hidden]] : []));
/** The imported default save's vines, as the game's save reader parses them. */
async function importedVines(): Promise<EntitySaveRecord[]> {
  const cluster = new URL('../../../public/saves/Cluster_1/', import.meta.url);
  const json = await readFile(new URL('Master.json', cluster), 'utf8');
  const { session } = JSON.parse(json) as { session: { playerFile: string } };
  const { player } = JSON.parse(await readFile(new URL(session.playerFile, cluster), 'utf8')) as { player: unknown };
  return deserializeSave(json, SAVE_CATALOG, player).world.entities.oceanvine! as EntitySaveRecord[];
}
const picked = (id: string, x: number): EntitySaveRecord => ({ id, transform: { position: [x, 0, 3], rotationY: 0 },
  components: { pickable: { picked: true, regrowSeconds: 600 } } });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('loads save records with the clip, tags, bank and component values oceanvine.lua commonfn declares', async () => {
  const vines = await importedVines();
  expect(vines).toHaveLength(45);
  const { spawn, records, definitions, requested, dispose } = setup();
  try {
    const inst = spawn(vines[0]!);
    // commonfn's AddTag in order, then inspectable's constructor, pickable's SetUp and burnable's canlight.
    expect(inst.listTags()).toEqual(['hangingvine', 'flying', 'NOBLOCK', 'oceanvine', 'high_dolongaction', 'inspectable',
      'pickable', 'canlight']);
    expect(inst.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_fruit', loop: true });
    expect(definitions.oceanvine).toMatchObject({
      assets: { animationArchive: 'oceanvine.zip', buildArchives: ['oceanvine.zip'], bank: 'oceanvine' }, minimapIcon: 'oceanvine.png',
    });
    const { pickable, burnable } = inst.components;
    expect([pickable.product, pickable.regenTime, pickable.cyclesLeft, pickable.maximumCycles, pickable.picksound]).toEqual(
      ['fig', OCEANVINE_REGROW_TIME, 1, undefined, 'dontstarve/wilson/harvest_berries']);
    expect([pickable.canBePicked, burnable.burntime]).toEqual([true, 7]);
    expect(Object.keys(inst.components)).toEqual(expect.arrayContaining(['inspectable', 'pickable', 'burnable', 'propagator', 'hauntable']));
    // A picked vine loads through makeemptyfn: the fig hidden, the bare loop, no inspectable, and its regrowth running.
    const empty = spawn(picked('picked-vine', 4));
    expect(empty.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_nofruit', loop: true });
    expect(layers(empty)).toEqual({ fig: true });
    expect([empty.components.inspectable, empty.hasTag('pickable'), empty.components.pickable.remainingSeconds])
      .toEqual([undefined, false, 600]);
    // Lua's OnLoad keeps fn's cycles_left when the record has none.
    expect(empty.components.pickable.cyclesLeft).toBe(1);
    expect(records().sort((a, b) => a.id.localeCompare(b.id))).toEqual([picked('picked-vine', 4), vines[0]!].sort((a, b) => a.id.localeCompare(b.id)));
    await prefabDisplay(inst.transform.model)!.artLoaded();
    expect(requested('oceanvine.zip')).toBe(true);
    expect(inst.sprite.currentAnimation).toBe('idle_fruit');
  } finally { dispose(); }
});

it('rebuilds the declared clip and layers after tile sleep', async () => {
  const { scene, awake, spawn, records, dispose } = setup();
  try {
    const saved = picked('sleeping-vine', 1);
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
    expect(inst.sprite.currentAnimation).toBe('idle_nofruit');
    expect(inst.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_nofruit', loop: true });
    expect(inst.sprite.sprite.peek().appearance).toEqual(before.appearance);
    expect(records()).toEqual([saved]);
  } finally { dispose(); }
});

it('keeps a c_spawn vine through c_save and a reload, and rejects c_give', async () => {
  const first = setup(new THREE.Vector3(3, 0, -6)), second = setup(), inventory = createPickupInventory();
  try {
    expect((await executeDebugCommand('c_spawn("oceanvine")', inventory, prefab => first.registry.spawn(prefab))).ok).toBe(true);
    expect((await executeDebugCommand('c_give("oceanvine")', inventory)).ok).toBe(false);
    const spawned = [...first.prefabs.instances(OCEANVINE_ID)][0] as OceanVineInstance;
    expect(spawned.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_fruit', loop: true });
    spawned.components.pickable.MakeEmpty();
    const before = first.registry.exportRecords();
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      json = serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG),
        { entities: before, inventory: inventory.exportSaved(), elapsedSeconds: 1, playerTransform: { position: [3, 0, -6], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG).world.entities.oceanvine!;
    expect(saved).toEqual(before.oceanvine);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: spawned.entityId, transform: { position: [3, 0, -6] },
      components: { pickable: { picked: true, regrowSeconds: OCEANVINE_REGROW_TIME } } });
    await second.registry.restoreAll({ oceanvine: saved });
    const loaded = second.prefabs.get(saved[0]!.id);
    if (!(loaded instanceof OceanVineInstance)) throw new Error('The saved vine did not load');
    expect(loaded.position.toArray()).toEqual([3, 0, -6]);
    expect(loaded.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_nofruit', loop: true });
    expect([loaded.components.pickable.canBePicked, loaded.components.pickable.remainingSeconds, layers(loaded)])
      .toEqual([false, OCEANVINE_REGROW_TIME, { fig: true }]);
    expect(second.records()).toEqual(saved);
  } finally { first.dispose(); second.dispose(); inventory.dispose(); }
});
