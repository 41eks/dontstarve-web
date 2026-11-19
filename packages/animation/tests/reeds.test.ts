import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { reedsPrefabs, REEDS_ID, REEDS_REGROW_TIME, ReedsInstance } from '../../prefab/src/reeds';
import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';
import type { PlacementSaveRecord } from '../../prefab/src/saveRecord';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import type { SavedEntity } from '../../../src/save/types';
import { createPickupInventory } from './pickupFixture';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(playerPosition = new THREE.Vector3()) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true);
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim',
    { tickingarea: () => createMemo(() => awake.get()), scheduler });
  const definitions = reedsPrefabs({ scheduler });
  prefabs.register(definitions);
  const registry = new EntityRegistry([], prefabs, () => playerPosition);
  registry.registerPrefabs(PREFAB_DEFINITIONS.reeds);
  const spawn = (record: PlacementSaveRecord) =>
    prefabs.spawnAs(ReedsInstance, REEDS_ID, new THREE.Vector3(...record.transform.position), record);
  const records = () => registry.exportRecords().reeds ?? [];
  const requested = (archive: string) =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([url]) => String(url).endsWith(`/dst/data/anim/${archive}`));
  const dispose = () => { registry.dispose(); prefabs.dispose(); displays.dispose(); scheduler.dispose(); };
  return { scene, awake, prefabs, registry, definitions, spawn, records, requested, dispose };
}
/** The imported default save's reeds, as the game's save reader parses them. */
async function importedReeds(): Promise<PlacementSaveRecord[]> {
  const cluster = new URL('../../../public/saves/Cluster_1/', import.meta.url);
  const json = await readFile(new URL('Master.json', cluster), 'utf8');
  const { session } = JSON.parse(json) as { session: { playerFile: string } };
  const { player } = JSON.parse(await readFile(new URL(session.playerFile, cluster), 'utf8')) as { player: unknown };
  return deserializeSave(json, SAVE_CATALOG, player).world.entities.reeds! as PlacementSaveRecord[];
}
const clip = (inst: PrefabInstance) => inst.sprite.sprite.peek().clip;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('loads the imported save records with the clip, tags, bank and component values reeds.lua fn declares', async () => {
  const reeds = await importedReeds();
  expect(reeds).toHaveLength(56);
  // Every reed in Cluster_65's forest snapshot stands unpicked; the second one is saved as picked here.
  expect(reeds.every(record => !record.components.pickable?.picked)).toBe(true);
  const [full, unpicked] = reeds as [PlacementSaveRecord, PlacementSaveRecord];
  const picked = [{ ...unpicked, components: { pickable: { picked: true, regrowSeconds: 600 } } }];
  const { spawn, records, definitions, requested, dispose } = setup();
  try {
    const inst = spawn(full);
    // fn's AddTag, then SetUp's pickable, the inspectable, fuel and burnable constructors' tags.
    expect(inst.listTags()).toEqual(['plant', 'silviculture', 'pickable', 'inspectable', 'BURNABLE_fuel', 'canlight']);
    expect(clip(inst)).toMatchObject({ name: 'idle', loop: true });
    expect(inst.sprite.sprite.peek().billboard).toBe(true);
    expect(definitions.reeds).toMatchObject({
      assets: { animationArchive: 'grass.zip', buildArchives: ['reeds.zip'], bank: 'grass' }, minimapIcon: 'reeds.png',
    });
    const { pickable, fuel, burnable } = inst.components;
    expect([pickable.product, pickable.picksound, pickable.canBePicked]).toEqual(['cutreeds', 'dontstarve/wilson/pickup_reeds', true]);
    expect(fuel.fuelvalue).toBe(15);
    expect(burnable.burntime).toBe(15);
    expect(Object.keys(inst.components)).toEqual(expect.arrayContaining(['pickable', 'inspectable', 'fuel', 'burnable', 'propagator', 'hauntable']));

    // pickable OnLoad of a picked reed: makeemptyfn plays "picked" once, and the regrow time stays scheduled.
    const empty = spawn(picked[0]!);
    expect(clip(empty)).toMatchObject({ name: 'picked', loop: false });
    expect(empty.hasTag('pickable')).toBe(false);
    expect(records()).toEqual([full, picked[0]]);
    await prefabDisplay(inst.transform.model)!.artLoaded();
    expect(requested('grass.zip')).toBe(true);
    expect(requested('reeds.zip')).toBe(true);
    expect(inst.sprite.currentAnimation).toBe('idle');
  } finally { dispose(); }
});

it('rebuilds the declared clip and appearance after tile sleep', async () => {
  const { scene, awake, spawn, records, dispose } = setup();
  try {
    const saved: PlacementSaveRecord = { id: 'sleeping-reeds', transform: { position: [1, 0, 3], rotationY: 0 },
      components: { pickable: { picked: true, regrowSeconds: 600 } } };
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
    expect(inst.sprite.currentAnimation).toBe('picked');
    expect(clip(inst)).toMatchObject({ name: 'picked', loop: false });
    expect(inst.sprite.sprite.peek().appearance).toEqual(before.appearance);
    expect(records()).toEqual([saved]);
  } finally { dispose(); }
});

it('keeps a c_spawn reed through c_save and a reload, and rejects c_give', async () => {
  const first = setup(new THREE.Vector3(3, 0, -6)), second = setup(), inventory = createPickupInventory();
  try {
    expect((await executeDebugCommand('c_spawn("reeds")', inventory, prefab => first.registry.spawn(prefab))).ok).toBe(true);
    expect((await executeDebugCommand('c_give("reeds")', inventory)).ok).toBe(false);
    const spawned = [...first.prefabs.instances(REEDS_ID)][0] as ReedsInstance;
    // pickable OnSave writes only the default caninteractwith, which the project omits.
    expect(first.records()[0]!.components).toEqual({});
    const before = first.registry.exportRecords();
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      json = serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG),
        { entities: before, inventory: inventory.exportState(), elapsedSeconds: 1, playerTransform: { position: [3, 0, -6], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG).world.entities.reeds!;
    expect(saved).toEqual(before.reeds);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: spawned.entityId, transform: { position: [3, 0, -6] } });
    await second.registry.restoreAll({ reeds: saved });
    const loaded = second.prefabs.get(saved[0]!.id);
    if (!(loaded instanceof ReedsInstance)) throw new Error('The saved reed did not load');
    expect(loaded.position.toArray()).toEqual([3, 0, -6]);
    expect(clip(loaded)).toMatchObject({ name: 'idle', loop: true });
    expect(loaded.components.pickable.canBePicked).toBe(true);
    expect(loaded.components.fuel.fuelvalue).toBe(15);
    expect(second.records()).toEqual(saved);
    // A picked reed keeps its picked state and regrow time through the same round trip.
    const picked: SavedEntity = { id: 'picked-reeds', transform: { position: [5, 0, 1], rotationY: 0 },
      components: { pickable: { picked: true, regrowSeconds: REEDS_REGROW_TIME / 2 } } };
    await second.registry.restoreAll({ reeds: [picked] });
    const empty = second.prefabs.get('picked-reeds')!;
    expect(clip(empty)).toMatchObject({ name: 'picked', loop: false });
    expect(second.records().find(record => record.id === 'picked-reeds')).toEqual(picked);
  } finally { first.dispose(); second.dispose(); inventory.dispose(); }
});
