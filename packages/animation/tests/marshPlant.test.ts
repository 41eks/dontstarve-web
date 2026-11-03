import { prefabManager } from './prefabManagerFixture';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prefabDisplay, PrefabDisplayGroup } from '../../display/src';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { InventoryStore } from '../../inventory/src';
import { marshPlantPrefabs, MARSH_PLANT_ID, type MarshPlantInstance } from '../../prefab/src/marsh_plant';
import { pondPrefabs, POND_ID, type PondInstance } from '../../prefab/src/pond';
import { WORLD_SCALE } from '../../prefab/src/tile';
import { FireFxHost } from '../../prefab/src/treeFire';
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { createSignal } from '@dontstarve-web/signals';

const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function setup() {
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), fire = FireFxHost.create('/dst/data/anim');
  const snow = createSignal(0), spawnGroundItem = vi.fn();
  const plantDisplays = new PrefabDisplayGroup(scene), pondDisplays = new PrefabDisplayGroup(scene);
  const plants = prefabManager(plantDisplays, '/dst/data/anim', { scheduler, fire, spawnGroundItem: spawnGroundItem as never }, marshPlantPrefabs);
  const spawned: MarshPlantInstance[] = [];
  const world = { scheduler, getWatchWorldContent: (() => snow) as never,
    spawnPrefab: (_: string, position: THREE.Vector3) => { const plant = plants.spawn(MARSH_PLANT_ID, position); spawned.push(plant); return plant; } };
  const ponds = prefabManager(pondDisplays, '/dst/data/anim', world, pondPrefabs);
  cleanups.push(() => { ponds.dispose(); plants.dispose(); pondDisplays.dispose(); plantDisplays.dispose(); fire.dispose(); });
  return { scene, scheduler, snow, plants, ponds, spawned, spawnGroundItem, world };
}
const offsets = (pond: PondInstance) => pond.GetPersistData().plants;

it('spawns two to four plants around a new pond, parented so that only the pond saves them', () => {
  const { ponds, plants, spawned } = setup();
  const pond = ponds.spawn(POND_ID, new THREE.Vector3(30, 0, 60));
  expect(spawned.length).toBeGreaterThanOrEqual(2);
  expect(spawned.length).toBeLessThanOrEqual(4);
  expect(offsets(pond)).toHaveLength(spawned.length);
  offsets(pond)!.forEach(({ offset }, index) => {
    expect(spawned[index].position.toArray()).toEqual([30 + offset[0] * WORLD_SCALE, 0, 60 + offset[2] * WORLD_SCALE]);
  });
  expect(spawned[0].hasTag('plant')).toBe(true);
  expect(spawned[0].components.burnable).toBeDefined();
  expect(spawned[0].components.propagator).toBeDefined();
  expect(plants.exportRecords()).toEqual([]);
  pond.remove();
  expect(spawned.every(plant => plant.isRemoved)).toBe(true);
});

it('restores saved offsets, loses them to a freeze and thaws with new ones, as the source does', () => {
  const { ponds, spawned, snow } = setup();
  const saved = [{ offset: [1, 0, -2] as [number, number, number] }];
  const pond = ponds.spawn(POND_ID, new THREE.Vector3(), { id: 'pond', components: { plants: saved } });
  expect(spawned.map(plant => plant.position.toArray())).toEqual([[WORLD_SCALE, 0, -2 * WORLD_SCALE]]);
  expect(offsets(pond)).toEqual(saved);
  snow.set(.5);
  expect(spawned[0].isRemoved).toBe(true);
  expect(offsets(pond)).toBeUndefined();
  snow.set(0);
  expect(spawned.length).toBeGreaterThanOrEqual(3);
  expect(offsets(pond)).not.toEqual(saved);

  // Loaded into a frozen world: the first OnSnowLevel drops them before any plant exists.
  const count = spawned.length;
  snow.set(.5);
  const frozen = ponds.spawn(POND_ID, new THREE.Vector3(90, 0, 0), { id: 'frozen', components: { plants: saved } });
  expect(spawned).toHaveLength(count);
  expect(offsets(frozen)).toBeUndefined();
});

it('burns to ash where it stands; a burnt plant stays gone from the world but not from the pond', async () => {
  const { ponds, plants, scene, scheduler, spawned, spawnGroundItem } = setup();
  const pond = ponds.spawn(POND_ID, new THREE.Vector3(), { id: 'pond', components: { plants: [{ offset: [1, 0, 0] }, { offset: [-1, 0, 0] }] } });
  const [burnt, extinguished] = spawned;
  // The source's instanced art path: the display loads the mirrored archive.
  await prefabDisplay(scene.children.find(child => child === burnt.transform.model)!)!.artLoaded();
  expect(burnt.sprite.loaded).toBe(true);
  burnt.components.burnable!.Ignite();
  expect(burnt.persists).toBe(false);
  extinguished.components.burnable!.Ignite();
  extinguished.components.burnable!.Extinguish();
  // DefaultExtinguishFn sets persists; the save loop still skips a child.
  expect(extinguished.persists).toBe(true);
  expect(plants.exportRecords()).toEqual([]);
  plants.update(1 / 30, new THREE.Quaternion());
  scheduler.advance(20);
  expect(burnt.isRemoved).toBe(true);
  expect(spawnGroundItem).toHaveBeenCalledOnce();
  expect(spawnGroundItem.mock.calls[0][0]).toMatchObject({ itemId: 'ash', count: 1 });
  expect(offsets(pond)).toHaveLength(2);
});

it('haunting fails with the source cooldown, and c_spawn plants save and reload on their own', async () => {
  const scheduler = new GameTimeScheduler(), position = new THREE.Vector3(6, 0, 9), fire = FireFxHost.create('/dst/data/anim');
  const createRegistry = () => {
    const registry = new EntityRegistry(), displays = new PrefabDisplayGroup(new THREE.Scene());
    const plants = prefabManager(displays, '/dst/data/anim', { scheduler, fire, spawnGroundItem: vi.fn() as never }, marshPlantPrefabs);
    registry.register(PREFAB_DEFINITIONS.marshPlants, {
      restore: (id, record) => plants.spawn(id, new THREE.Vector3(...record.transform.position), record),
      debugSpawn: id => plants.spawn(id, position.clone()),
      exportRecords: () => plants.exportRecords(),
      dispose: () => { plants.dispose(); displays.dispose(); },
    });
    return registry;
  };
  const registry = createRegistry(), restored = createRegistry(), inventory = new InventoryStore([], SAVE_CATALOG.items);
  cleanups.push(() => { registry.dispose(); restored.dispose(); inventory.dispose(); fire.dispose(); });
  expect((await executeDebugCommand('c_spawn("marsh_plant")', inventory, prefab => registry.spawn(prefab))).ok).toBe(true);
  const template = deserializeSave(await readFile(new URL('../../../public/saves/initial-world.json', import.meta.url), 'utf8'), SAVE_CATALOG);
  let exported = '';
  expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
    exported = serializeSave(template, { entities: { ...template.world.entities, ...registry.exportRecords() }, inventory: inventory.exportState(),
      playerTransform: { position: [6, 0, 9], rotationY: 0 }, elapsedSeconds: 0 }, SAVE_CATALOG);
  })).ok).toBe(true);
  const records = { marsh_plant: deserializeSave(exported, SAVE_CATALOG).world.entities.marsh_plant };
  expect(records.marsh_plant).toHaveLength(1);
  expect(records.marsh_plant[0].transform.position).toEqual([6, 0, 9]);
  await restored.restoreAll(records);
  expect(restored.exportRecords()).toEqual(records);

  const plant = [...restored.byEntityId.values()][0] as MarshPlantInstance;
  const hauntable = plant.components.hauntable!;
  hauntable.DoHaunt({ hasTag: () => false, PushEvent() {} });
  expect(plant.components.burnable!.IsBurning()).toBe(false);
  expect(hauntable.IsHaunted()).toBe(true);
  scheduler.advance(4.9);
  expect(hauntable.IsHaunted()).toBe(true);
  scheduler.advance(.2);
  expect(hauntable.IsHaunted()).toBe(false);
});
