import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { GroundItemManager } from '../../../src/groundItems';
import { executeDebugCommand } from '../../../src/debugCommands';
import { INVENTORY_ITEM_SPECS } from '../../../src/inventoryItems';
import { inventorySlotAddress } from '../../inventory/src';
import { createPickupInventory } from './pickupFixture';
import { collectEquippedActions, performLightAction } from '../../stategraphs/src/componentactions';
import { createPickupDoer, performPickupAction } from '../../stategraphs/src/pickup';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const inventory = createPickupInventory(), scene = new THREE.Scene(), player = new THREE.Group();
  const manager = new GroundItemManager(scene, new THREE.PerspectiveCamera(),
    { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer, '/dst/data/databundles/images.zip',
    inventory, '/dst/data/anim', player);
  return { inventory, manager, player, scene };
}

it('burns dropped live grass/log stacks to prepared ash, notifies signals and immediately saves/reloads ash quantities and positions', async () => {
  const { inventory, manager, scene } = setup();
  const restored = setup();
  try {
    expect((await executeDebugCommand('c_give("torch");c_give("cutgrass",3);c_give("log",7)', inventory)).ok).toBe(true);
    const grass = inventory.getEntity(inventorySlotAddress(1))!, log = inventory.getEntity(inventorySlotAddress(2))!;
    for (const [entity, index, position] of [[grass, 1, new THREE.Vector3(3, 0, 6)], [log, 2, new THREE.Vector3(40, 0, 8)]] as const) {
      expect(await manager.drop({ ...INVENTORY_ITEM_SPECS[entity.prefab], ...entity.snapshot(), entity }, position,
        () => inventory.extract(inventorySlotAddress(index), entity.components.stackable.count)!)).toBe(true);
    }
    const models = manager.renderEntities.map(entry => entry.object);
    const notifications = models.map(model => {
      const notify = vi.fn(); model.userData.burntSignal.subscribe(notify); return notify;
    });
    const torch = inventory.getEntity(inventorySlotAddress(0))!;
    for (const model of models) {
      expect(collectEquippedActions(torch, model.userData.actionEntity, true)).toEqual(['LIGHT']);
      expect(performLightAction(torch, model.userData.actionEntity, torch)).toBe(true);
      expect(model.userData.burningSignal.peek()).toBe(true);
      expect(model.userData.persistenceSignal.peek()).toBe(false);
      expect(performPickupAction(model.userData.pickupTarget, createPickupDoer(new THREE.Group(), inventory))).toBe(false);
    }
    // The fire is a child of the burning item, as DST's Burnable:SpawnFX adds it, with the source's tags.
    const fires = () => models.flatMap(model => model.children.filter(child => child.name === 'fire'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fires()).toHaveLength(2);
    expect(fires().every(fire => fire.userData.tags.includes('FX') && fire.userData.tags.includes('HASHEATER'))).toBe(true);
    expect(manager.renderEntities.filter(entry => entry.object.name === 'fire')).toHaveLength(2);
    const save = () => serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG), {
      entities: { ground_item: manager.exportRecords() }, inventory: inventory.exportState(), elapsedSeconds: 15,
      playerTransform: { position: [3, 0, 6], rotationY: 0 },
    }, SAVE_CATALOG);
    let burningJson = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => { burningJson = save(); })).ok).toBe(true);
    expect(deserializeSave(burningJson, SAVE_CATALOG).world.entities.ground_item).toEqual([]);
    manager.update(7.5, new THREE.Quaternion());
    expect(grass.isRemoved).toBe(true); expect(log.isRemoved).toBe(false);
    expect(notifications[0]).toHaveBeenCalledExactlyOnceWith(true, false);
    expect(notifications[1]).not.toHaveBeenCalled();
    manager.update(7.5, new THREE.Quaternion());
    expect(log.isRemoved).toBe(true); expect(fires()).toHaveLength(0);
    expect(notifications[1]).toHaveBeenCalledExactlyOnceWith(true, false);
    const records = manager.exportRecords();
    expect(records.map(record => record.components.stack)).toEqual([{ itemId: 'ash', count: 3 }, { itemId: 'ash', count: 7 }]);
    expect(records.map(record => record.transform.position)).toEqual([[3, 0, 6], [40, 0, 8]]);
    // Output is committed synchronously at burnout, with no promise/microtask gap before saving.
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => { json = save(); })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG);
    restored.inventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
    for (const record of saved.world.entities.ground_item) await restored.manager.spawnFromSave(record.id,
      { ...SAVE_CATALOG.items.ash, ...record.components.stack! }, new THREE.Vector3(...record.transform.position));
    expect(restored.manager.exportRecords()).toEqual(records);
    expect(restored.inventory.exportState()).toEqual(inventory.exportState());
  } finally { manager.dispose(); inventory.dispose(); restored.manager.dispose(); restored.inventory.dispose(); }
});

it('supports c_spawn, blocks noncombustible targets and preserves identity/state through extinguishing, pickup and another drop', async () => {
  const { inventory, manager, player } = setup();
  const restored = setup();
  const registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.groundItems, {
    restore: (_prefab, record) => manager.spawnFromSave(record.id,
      { ...SAVE_CATALOG.items[record.components.stack!.itemId], ...record.components.stack! }, new THREE.Vector3(...record.transform.position)),
    debugSpawn: id => manager.spawnFromSave(`spawn:${id}`, { ...SAVE_CATALOG.items[id], itemId: id, count: 1 },
      new THREE.Vector3(id === 'log' ? 3 : id === 'cutgrass' ? 80 : 100, 0, 6)),
    exportRecords: () => manager.exportRecords().map(record => ({ prefabId: 'ground_item', record })),
    dispose: () => manager.dispose(),
  });
  try {
    expect((await executeDebugCommand('c_give("torch");c_spawn("log");c_spawn("cutgrass");c_spawn("ash")', inventory,
      id => registry.spawn(id))).ok).toBe(true);
    await manager.spawnFromSave('boundary:rocks', { ...SAVE_CATALOG.items.rocks, itemId: 'rocks', count: 1 }, new THREE.Vector3(120, 0, 6));
    const normalRecords = registry.exportRecords();
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      json = serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG), { entities: normalRecords,
        inventory: inventory.exportState(), elapsedSeconds: 0, playerTransform: { position: [3, 0, 6], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG);
    expect(saved.world.entities).toEqual(normalRecords);
    restored.inventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
    for (const record of saved.world.entities.ground_item) await restored.manager.spawnFromSave(record.id,
      { ...SAVE_CATALOG.items[record.components.stack!.itemId], ...record.components.stack! }, new THREE.Vector3(...record.transform.position));
    expect(restored.manager.exportRecords()).toEqual(normalRecords.ground_item);
    expect(restored.manager.entities.get('spawn:cutgrass')!.components.burnable!.IsBurning()).toBe(false);
    const entity = manager.entities.get('spawn:log')!;
    entity.setFreshnessPercent(.6); entity.setWet(true);
    const before = entity.snapshot();
    const model = manager.renderEntities.find(entry => entry.object.userData.itemId === 'log')!.object;
    const rocks = manager.renderEntities.find(entry => entry.object.userData.itemId === 'rocks')!.object;
    const torch = inventory.getEntity(inventorySlotAddress(0))!;
    expect(collectEquippedActions(torch, rocks.userData.actionEntity, true)).toEqual([]);
    performLightAction(torch, model.userData.actionEntity, torch); manager.update(5, new THREE.Quaternion());
    entity.components.burnable!.Extinguish(); manager.update(20, new THREE.Quaternion());
    expect(entity.isRemoved).toBe(false); expect(entity.persists).toBe(true); expect(entity.snapshot()).toEqual(before);
    expect(model.userData.burningSignal.peek()).toBe(false);
    const burningSignal = model.userData.burningSignal, burntSignal = model.userData.burntSignal;
    player.position.set(3, 0, 6);
    expect(performPickupAction(model.userData.pickupTarget, createPickupDoer(player, inventory))).toBe(true);
    expect(model.parent).toBeNull(); expect(inventory.getEntity(inventorySlotAddress(1))).toBe(entity);
    expect(await manager.drop({ ...SAVE_CATALOG.items.log, ...entity.snapshot(), entity }, new THREE.Vector3(8, 0, -4),
      () => inventory.extract(inventorySlotAddress(1), 1)!)).toBe(true);
    const dropped = manager.renderEntities.find(entry => entry.object.userData.itemId === 'log')!.object;
    expect(dropped.userData.burningSignal).toBe(burningSignal); expect(dropped.userData.burntSignal).toBe(burntSignal);
    expect(entity.snapshot()).toEqual(before); expect(entity.transform.position.toArray()).toEqual([8, 0, -4]);
    performLightAction(torch, dropped.userData.actionEntity, torch); manager.update(15, new THREE.Quaternion());
    expect(entity.isRemoved).toBe(true);
    expect(manager.exportRecords().map(record => record.components.stack?.itemId)).toEqual(['cutgrass', 'ash', 'rocks', 'ash']);
  } finally { registry.dispose(); inventory.dispose(); restored.manager.dispose(); restored.inventory.dispose(); }
});
