import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { beehivePrefabs, BEEHIVE_ID, BeehiveInstance } from '../../prefab/src/beehive';
import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';
import type { EntitySaveRecord } from '../../prefab/src/saveRecord';
import { wasphivePrefabs, WASPHIVE_ID, WasphiveInstance } from '../../prefab/src/wasphive';
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
  const definitions = { ...beehivePrefabs({ scheduler }), ...wasphivePrefabs({ scheduler }) };
  prefabs.register(definitions);
  const registry = new EntityRegistry([], prefabs, () => playerPosition);
  registry.registerPrefabs(PREFAB_DEFINITIONS.beehives);
  registry.registerPrefabs(PREFAB_DEFINITIONS.wasphives);
  const beehive = (record: EntitySaveRecord) =>
    prefabs.restore(BEEHIVE_ID, record) as BeehiveInstance;
  const wasphive = (record: EntitySaveRecord) =>
    prefabs.restore(WASPHIVE_ID, record) as WasphiveInstance;
  const requested = (archive: string) =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([url]) => String(url).endsWith(`/dst/data/anim/${archive}`));
  const dispose = () => { registry.dispose(); prefabs.dispose(); displays.dispose(); scheduler.dispose(); };
  return { scene, awake, prefabs, registry, definitions, beehive, wasphive, requested, dispose };
}
/**
 * Cluster_65's forest snapshot 0000000315: beehive 105614 saves `health = { health = 104 }` and `childspawner = {
 * childreninside = 5, emergencychildreninside = 8, ... }`; scripts/dst-region-prefab.py keeps these and drops the timing.
 */
const importedRecord = (id: string, position: [number, number, number], health: number, maximum: number,
  childreninside: number, emergencychildreninside: number): EntitySaveRecord => ({
  id, transform: { position, rotationY: 0 },
  components: { health: { current: health, maximum }, childspawner: { childreninside, childrenoutside: [], emergencychildreninside } },
});
const clip = (inst: PrefabInstance) => inst.sprite.sprite.peek().clip;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('loads saved hives with the clip, tags, bank and component values beehive.lua and wasphive.lua fn declare', async () => {
  const { beehive, wasphive, definitions, requested, registry, dispose } = setup();
  try {
    const bees = beehive(importedRecord('dst_03741E1B78B29575_beehive_id_105614', [4, 0, -8], 104, 200, 5, 8));
    // MakeObstaclePhysics's blocker, fn's AddTag, MakeSnowCoveredPristine, then the component constructors' tags.
    expect(bees.listTags()).toEqual(['blocker', 'structure', 'lifedrainable', 'beaverchewable', 'hive', 'beehive', 'SnowCovered',
      'canlight', 'freezable', 'inspectable']);
    // PlayAnimation("cocoon_small", true), with MakeSnowCovered's snow symbol and hidden layer.
    expect(clip(bees)).toMatchObject({ name: 'cocoon_small', loop: true });
    const appearance = bees.sprite.sprite.peek().appearance;
    expect([appearance.get('archive-symbol:snow'), appearance.get('layer:snow')]).toEqual([
      { kind: 'archive-symbol', symbol: 'snow', archive: 'snow.zip', sourceSymbol: 'snow' }, { kind: 'layer', layer: 'snow', hidden: true }]);
    expect(definitions.beehive).toMatchObject({
      assets: { animationArchive: 'beehive.zip', buildArchives: ['beehive.zip', 'snow.zip', 'frozen.zip'], bank: 'beehive' },
      physics: { radius: .5 }, minimapIcon: 'beehive.png',
    });
    expect(Object.keys(bees.components)).toEqual(['health', 'childspawner', 'worldsettingstimer', 'lootdropper', 'burnable',
      'freezable', 'combat', 'propagator', 'lunarhailbuildup', 'hauntable', 'inspectable']);
    const { health, childspawner, freezable } = bees.components;
    expect([health.currenthealth, health.maxhealth, freezable.resistance]).toEqual([104, 200, 2]);
    expect([childspawner.childname, childspawner.maxchildren, childspawner.childreninside, childspawner.maxemergencychildren,
      childspawner.emergencychildreninside, childspawner.emergencydetectionradius]).toEqual(['bee', 5, 5, 8, 8, 20]);

    const wasps = wasphive(importedRecord('dst_03741E1B78B29575_wasphive_id_116613', [9, 0, 2], 250, 250, 0, 7));
    expect(wasps.listTags()).toEqual(['blocker', 'structure', 'hive', 'WORM_DANGER', 'SnowCovered', 'canlight', 'inspectable']);
    expect(clip(wasps)).toMatchObject({ name: 'cocoon_small', loop: true });
    expect(definitions.wasphive).toMatchObject({
      assets: { animationArchive: 'wasphive.zip', buildArchives: ['wasphive.zip', 'snow.zip'], bank: 'wasphive' },
      physics: { radius: .5 }, minimapIcon: 'wasphive.png',
    });
    expect(Object.keys(wasps.components)).toEqual(['health', 'childspawner', 'worldsettingstimer', 'lootdropper', 'burnable',
      'playerprox', 'combat', 'propagator', 'lunarhailbuildup', 'inspectable', 'hauntable']);
    // `childspawner.childspawner = "killerbee"` leaves childname empty.
    expect([wasps.components.childspawner.childname, wasps.components.childspawner.childreninside,
      wasps.components.childspawner.emergencychildreninside, wasps.components.health.maxhealth]).toEqual(['', 0, 7, 250]);
    const records = registry.exportRecords();
    expect(records.beehive![0]!.components).toEqual({ health: { current: 104, maximum: 200 },
      childspawner: { childreninside: 5, childrenoutside: [], emergencychildreninside: 8 } });
    await Promise.all([bees, wasps].map(inst => prefabDisplay(inst.transform.model)!.artLoaded()));
    expect(['beehive.zip', 'wasphive.zip', 'snow.zip'].map(requested)).toEqual([true, true, true]);
  } finally { dispose(); }
});

it('rebuilds the declared clip and appearance after tile sleep', async () => {
  const { scene, awake, beehive, dispose } = setup();
  try {
    const inst = beehive(importedRecord('sleeping-hive', [1, 0, 3], 200, 200, 3, 8));
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
    expect(inst.sprite.currentAnimation).toBe('cocoon_small');
    expect(clip(inst)).toMatchObject({ name: 'cocoon_small', loop: true });
    expect(inst.sprite.sprite.peek().appearance).toEqual(before.appearance);
  } finally { dispose(); }
});

it('keeps c_spawn hives and imported ones through c_save and a reload, and rejects c_give', async () => {
  const first = setup(new THREE.Vector3(3, 0, -6)), second = setup(), inventory = createPickupInventory();
  try {
    for (const id of [BEEHIVE_ID, WASPHIVE_ID]) {
      expect((await executeDebugCommand(`c_spawn("${id}")`, inventory, prefab => first.registry.spawn(prefab))).ok).toBe(true);
      expect((await executeDebugCommand(`c_give("${id}")`, inventory)).ok).toBe(false);
    }
    const spawned = [...first.prefabs.instances(BEEHIVE_ID)][0] as BeehiveInstance;
    expect(clip(spawned)).toMatchObject({ name: 'cocoon_small', loop: true });
    // SetMaxChildren fills the hive; SetMaxEmergencyChildren its emergency bees.
    expect(first.registry.exportRecords().beehive![0]!.components).toEqual({ health: { current: 200, maximum: 200 },
      childspawner: { childreninside: 5, childrenoutside: [], emergencychildreninside: 8 } });
    first.beehive(importedRecord('imported-hive', [20, 0, 1], 104, 200, 2, 6));
    const before = first.registry.exportRecords();
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      json = serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG),
        { entities: before, inventory: inventory.exportSaved(), elapsedSeconds: 1, playerTransform: { position: [3, 0, -6], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    const { beehive: savedBees, wasphive: savedWasps } = deserializeSave(json, SAVE_CATALOG).world.entities;
    expect([savedBees, savedWasps]).toEqual([before.beehive, before.wasphive]);
    expect([savedBees, savedWasps].map(records => records?.length)).toEqual([2, 1]);
    expect(savedBees![0]).toMatchObject({ id: spawned.entityId, transform: { position: [3, 0, -6] } });
    await second.registry.restoreAll({ beehive: savedBees!, wasphive: savedWasps! });
    const loaded = second.prefabs.get('imported-hive');
    if (!(loaded instanceof BeehiveInstance)) throw new Error('The saved hive did not load');
    expect(loaded.position.toArray()).toEqual([20, 0, 1]);
    expect([loaded.components.health.currenthealth, loaded.components.childspawner.childreninside,
      loaded.components.childspawner.emergencychildreninside, clip(loaded)?.name]).toEqual([104, 2, 6, 'cocoon_small']);
    expect(second.prefabs.get(savedWasps![0]!.id)).toBeInstanceOf(WasphiveInstance);
    const records = second.registry.exportRecords();
    expect([records.beehive, records.wasphive]).toEqual([savedBees, savedWasps]);
  } finally { first.dispose(); second.dispose(); inventory.dispose(); }
});
