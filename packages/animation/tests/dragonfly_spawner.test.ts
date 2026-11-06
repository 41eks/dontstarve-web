import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import { createMemo, createSignal, getWatchWorldContent } from '@dontstarve-web/signals';
import { DragonflyManager } from '../../prefab/src/dragonfly';
import { dragonflySpawnerPrefabs, DRAGONFLY_SPAWNER_ID, type DragonflySpawnerInstance } from '../../prefab/src/dragonfly_spawner';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import type { PlacementSaveRecord } from '../../prefab/src/saveRecord';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { createInventoryStore } from '../../../src/inventory';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { createTestWorldSources } from './worldContentFixture';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const saved: PlacementSaveRecord = { id: 'spawner-1', transform: { position: [0, 0, 0], rotationY: 0 },
  components: { dragonflySpawner: { childspawner: { childreninside: 1, childrenoutside: [],
    spawning: true, regening: false, queued_spawn: true, timetonextspawn: 1, timetonextregen: 0,
    emergencychildreninside: 0 } } } };

function setup(initialAwake: boolean) {
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(initialAwake);
  const tickingarea = () => createMemo(() => awake.get());
  const sources = createTestWorldSources(scheduler);
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { tickingarea });
  const registry = new EntityRegistry([], prefabs, () => new THREE.Vector3(12, 0, -6)), inventory = createInventoryStore([]);
  const dragonflies = new DragonflyManager(scene, { scheduler, tickingarea,
    getWatchWorldContent: (key, register) => getWatchWorldContent(key, register, sources),
    trackDisplay: display => registry.trackDisplay(display) });
  prefabs.register(dragonflySpawnerPrefabs({ scheduler, spawnDragonfly: point => dragonflies.spawn(point),
    resolveDragonfly: id => dragonflies.getById(id), isPassable: () => true }) as never);
  registry.registerDisplayManager(PREFAB_DEFINITIONS.dragonflies, dragonflies, {
    restore: (_, record) => dragonflies.spawn(new THREE.Vector3(...record.transform.position), {
      id: record.id, transform: record.transform, components: { dragonfly: record.components.dragonfly! } }),
    debugSpawn: () => dragonflies.spawn(new THREE.Vector3(12, 0, -6)),
  });
  registry.registerPrefabs(PREFAB_DEFINITIONS.dragonflySpawners);
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  return { scheduler, awake, dragonflies, prefabs, registry, inventory,
    spawner: (record?: PlacementSaveRecord) => prefabs.spawn(DRAGONFLY_SPAWNER_ID, new THREE.Vector3(), record) as DragonflySpawnerInstance,
    spawnerRecord: () => prefabs.exportRecords()[0].record,
    save: () => serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportState(), elapsedSeconds: 0,
      playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG),
    dispose: () => { registry.dispose(); prefabs.dispose(); displays.dispose(); inventory.dispose(); scheduler.dispose(); } };
}
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps the saved child queued while asleep and spawns it when the spawner wakes', async () => {
  const s = setup(false);
  try {
    const spawner = s.spawner(saved);
    await settle();
    expect(spawner.hasTag('CLASSIFIED')).toBe(true);
    expect(PREFAB_DEFINITIONS.dragonflySpawners.parseComponents(saved.components, 'dragonfly_spawner', { grounded: true } as never))
      .toEqual(saved.components);
    s.scheduler.advance(10);
    expect(s.dragonflies.exportRecords()).toHaveLength(0);
    s.awake.set(true); await settle();
    s.scheduler.advance(0); await settle();
    const [child] = s.dragonflies.exportRecords();
    expect(child).toBeDefined();
    expect(child.record.components.dragonfly.knownlocations?.locations.map(location => location.name).sort())
      .toEqual(['home', 'spawnpoint']);
    expect(s.spawnerRecord().components.dragonflySpawner?.childspawner)
      .toMatchObject({ childreninside: 0, childrenoutside: [child.record.id], queued_spawn: false });
  } finally { s.dispose(); }
});

it('relinks an outside dragonfly after load and regenerates one child after its removal', async () => {
  const first = setup(true);
  let child: ReturnType<DragonflyManager['exportRecords']>[number]['record'];
  let spawner: PlacementSaveRecord;
  try {
    first.spawner(saved);
    await settle(); first.scheduler.advance(0); await settle();
    child = first.dragonflies.exportRecords()[0].record;
    spawner = first.spawnerRecord();
  } finally { first.dispose(); }
  const restored = setup(true);
  try {
    restored.dragonflies.spawn(new THREE.Vector3(...child.transform.position), child);
    restored.spawner(spawner);
    await settle(); restored.scheduler.advance(0);
    restored.scheduler.advance(10);
    expect(restored.dragonflies.exportRecords()).toHaveLength(1);
    prefabInstance(restored.dragonflies.getById(child.id)!)!.remove();
    expect(restored.spawnerRecord().components.dragonflySpawner?.worldsettingstimer?.timers.regen_dragonfly)
      .toMatchObject({ timeleft: 9600 });
    restored.scheduler.advance(9600 + 10); await settle();
    expect(restored.dragonflies.exportRecords()).toHaveLength(1);
    expect(restored.dragonflies.exportRecords()[0].record.id).not.toBe(child.id);
  } finally { restored.dispose(); }
});

it('c_spawn releases the queued child, and c_save and reload keep their linkage; c_give is refused', async () => {
  const first = setup(true);
  let json = '', childId = '';
  try {
    expect((await executeDebugCommand(`c_spawn("${DRAGONFLY_SPAWNER_ID}")`, first.inventory, id => first.registry.spawn(id))).ok).toBe(true);
    expect((await executeDebugCommand(`c_give("${DRAGONFLY_SPAWNER_ID}")`, first.inventory)).ok).toBe(false);
    // fn's StartSpawning: the first spawn tick releases the one child inside.
    first.scheduler.advance(10); await settle();
    [{ record: { id: childId } }] = first.dragonflies.exportRecords();
    expect((await executeDebugCommand('c_save()', first.inventory, undefined, () => { json = first.save(); })).ok).toBe(true);
  } finally { first.dispose(); }
  const { entities } = deserializeSave(json, SAVE_CATALOG).world;
  expect(entities.dragonfly.map(({ id }) => id)).toEqual([childId]);
  expect(entities.dragonfly_spawner[0]).toMatchObject({ transform: { position: [12, 0, -6] },
    components: { dragonflySpawner: { childspawner: { childreninside: 0, childrenoutside: [childId] } } } });

  const second = setup(true);
  try {
    await second.registry.restoreAll(entities);
    await settle(); second.scheduler.advance(0); second.scheduler.advance(10);
    // The restored spawner owns the restored child instead of releasing another.
    expect(second.dragonflies.exportRecords().map(({ record }) => record.id)).toEqual([childId]);
    expect(second.registry.exportRecords().dragonfly_spawner).toEqual(entities.dragonfly_spawner);
  } finally { second.dispose(); }
});
