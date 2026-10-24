import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { InventorySlot, InventoryStore, inventorySlotAddress } from '@dontstarve-web/inventory';
import { GroundItemManager } from '../../../src/groundItems';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';
import type { SavedEntity } from '../../../src/save/types';
import { createPickupInventory } from './pickupFixture';
import { PERISH_MED } from '../../componets/src/perishable';
import { PERISHABLE_FOODS, getFoodEffects } from '../../prefab/src/food';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const a = inventorySlotAddress(0), b = inventorySlotAddress(1);
const specs = {
  red_cap: { name: '红蘑菇', icon: 'red_cap.tex', maxStack: 40,
    perishTime: PERISHABLE_FOODS.red_cap.perishTime, perishReplacement: PERISHABLE_FOODS.red_cap.replacement },
  spoiled_food: { name: '腐烂物', icon: 'spoiled_food.tex', maxStack: 40 },
};
const setup = () => new InventoryStore([
  { address: a, slot: new InventorySlot() }, { address: b, slot: new InventorySlot() },
], specs);
/** Advance one 60-frame settlement of `seconds` total active time. */
function settle(store: InventoryStore, seconds: number): void {
  for (let frame = 0; frame < 60; frame++) store.getEntity(a)?.components.perishable.onFrame(seconds / 60);
}

it('derives fresh, stale and spoiled from the settled red_cap timer and eats source values per stage', () => {
  const store = setup();
  store.add('red_cap', 3);
  const entity = store.getEntity(a)!, perishable = entity.components.perishable;
  expect(perishable.timer.peek()).toEqual({ status: 'perishing', remainingSeconds: PERISH_MED });
  expect(entity.signals.freshnessPercent.peek()).toBe(1);
  expect(perishable.stage.peek()).toBe('fresh');
  expect(getFoodEffects(entity)).toEqual({ health: -20, hunger: 12.5, sanity: 0 });

  // Frames only accumulate; the timer signal changes once per 60-frame settlement.
  const timerChanges: unknown[] = [];
  const stop = perishable.timer.subscribe(timer => timerChanges.push(timer));
  for (let frame = 0; frame < 59; frame++) perishable.onFrame(1);
  expect(timerChanges).toHaveLength(0);
  perishable.onFrame(1);
  expect(timerChanges).toEqual([{ status: 'perishing', remainingSeconds: PERISH_MED - 60 }]);
  stop();

  settle(store, PERISH_MED * .5);
  expect(perishable.stage.peek()).toBe('stale');
  expect(getFoodEffects(entity)).toEqual({ health: -20, hunger: 12.5 * .667, sanity: 0 });
  settle(store, PERISH_MED * .35);
  expect(perishable.stage.peek()).toBe('spoiled');
  expect(getFoodEffects(entity)).toEqual({ health: -20, hunger: 6.25, sanity: -10 });

  // Perish replaces the whole stack in its slot with spoiled_food.
  settle(store, PERISH_MED);
  expect(entity.isRemoved).toBe(true);
  expect(store.get(a)).toMatchObject({ itemId: 'spoiled_food', count: 3 });
  store.dispose();
});

it('dilutes freshness when stacks merge and preserves it through transfer flush, save and load', () => {
  const store = setup();
  store.add('red_cap', 1);
  const entity = store.getEntity(a)!;
  entity.components.perishable.SetPercent(.25);
  // stackable:Put → Dilute weights the settled remaining times; new caps arrive fresh.
  store.add('red_cap', 1);
  expect(store.getEntity(a)).toBe(entity);
  expect(store.get(a)?.count).toBe(2);
  expect(entity.signals.freshnessPercent.peek()).toBeCloseTo(.625, 9);
  // A half batch stays pending until the transfer settles it.
  for (let frame = 0; frame < 30; frame++) entity.components.perishable.onFrame(PERISH_MED * .05 / 30);
  expect(entity.signals.freshnessPercent.peek()).toBeCloseTo(.625, 9);
  expect(store.transfer(a, b, 2)).toBe(true);
  expect(store.getEntity(b)).toBe(entity);
  expect(entity.signals.freshnessPercent.peek()).toBeCloseTo(.575, 9);
  const restored = setup();
  restored.replaceState(store.exportState(), {});
  const loaded = restored.getEntity(b)!;
  expect(loaded.id).toBe(entity.id);
  expect(loaded.signals.freshnessPercent.peek()).toBeCloseTo(.575, 9);
  expect(loaded.components.perishable.timer.peek()).toMatchObject({ status: 'perishing' });
  store.dispose(); restored.dispose();
});

it('spawns/gives red_cap, bananapop and spoiled_food, replaces a perished ground cap and reloads freshness through c_save', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const inventory = createPickupInventory(), restoredInventory = createPickupInventory();
  const player = new THREE.Group();
  player.position.set(2, 0, -4);
  const createManager = (store: InventoryStore) => new GroundItemManager(new THREE.Scene(), new THREE.PerspectiveCamera(),
    { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer, '/dst/data/databundles/images.zip',
    store, '/dst/data/anim', player);
  const manager = createManager(inventory);
  const restoreGround = (target: GroundItemManager, record: SavedEntity) => target.spawnFromSave(record.id,
    { ...SAVE_CATALOG.items[record.components.stack!.itemId], ...record.components.stack! }, new THREE.Vector3(...record.transform.position));
  const registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.groundItems, {
    debugSpawn: id => manager.spawnFromSave(`spawn:${id}`, { ...SAVE_CATALOG.items[id], itemId: id, count: 1 }, player.position),
    restore: (_prefab, record) => restoreGround(manager, record),
    exportRecords: () => manager.exportRecords().map(record => ({ prefabId: 'ground_item', record })),
    dispose: () => manager.dispose(),
  });
  let restored: GroundItemManager | undefined;
  try {
    for (const id of ['red_cap', 'bananapop', 'spoiled_food']) {
      expect((await executeDebugCommand(`c_spawn("${id}")`, inventory, prefab => registry.spawn(prefab))).ok).toBe(true);
    }
    expect((await executeDebugCommand('c_give("red_cap", 2)', inventory)).ok).toBe(true);
    expect((await executeDebugCommand('c_give("spoiled_food", 1)', inventory)).ok).toBe(true);
    expect((await executeDebugCommand('c_give("bananapop", 2)', inventory)).ok).toBe(true);
    // preparedfoods.lua: bananapop perishes in PERISH_SUPERFAST (3 days).
    const pop = manager.entities.get('spawn:bananapop')!;
    expect(pop.components.perishable.timer.peek()).toEqual({ status: 'perishing', remainingSeconds: 3 * 480 });
    pop.components.perishable.SetPercent(.15);
    inventory.getEntity(inventorySlotAddress(2))!.components.perishable.SetPercent(.8);
    const ground = manager.entities.get('spawn:red_cap')!;
    expect(ground.signals.freshnessPercent.peek()).toBe(1);
    ground.components.perishable.SetPercent(.3);
    inventory.getEntity(inventorySlotAddress(0))!.components.perishable.SetPercent(.6);

    const before = registry.exportRecords(), held = inventory.exportState();
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
      json = serializeSave(template, { entities: before, inventory: held, elapsedSeconds: 30,
        playerTransform: { position: [2, 0, -4], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG);
    expect(saved.world.entities).toEqual(before);
    restoredInventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
    restored = createManager(restoredInventory);
    for (const record of saved.world.entities.ground_item) await restoreGround(restored, record);
    expect(restored.exportRecords()).toEqual(before.ground_item);
    const loadedGround = restored.entities.get('spawn:red_cap')!;
    expect(loadedGround.signals.freshnessPercent.peek()).toBeCloseTo(.3, 9);
    expect(loadedGround.components.perishable.stage.peek()).toBe('stale');
    expect(restoredInventory.getEntity(inventorySlotAddress(0))!.snapshot())
      .toEqual(inventory.getEntity(inventorySlotAddress(0))!.snapshot());
    expect(restoredInventory.get(inventorySlotAddress(1))).toMatchObject({ itemId: 'spoiled_food', count: 1 });
    expect(restored.entities.get('spawn:bananapop')!.components.perishable.stage.peek()).toBe('spoiled');
    expect(restoredInventory.getEntity(inventorySlotAddress(2))!.snapshot())
      .toEqual(inventory.getEntity(inventorySlotAddress(2))!.snapshot());
    expect(restoredInventory.getEntity(inventorySlotAddress(2))!.signals.freshnessPercent.peek()).toBeCloseTo(.8, 9);

    // Ground perishing spends PERISH_GROUND_MULT and replaces the cap at its foot point.
    for (let frame = 0; frame < 60; frame++) loadedGround.components.perishable.onFrame(PERISH_MED * .3 / 1.5 / 60);
    await vi.waitFor(() => expect(loadedGround.isRemoved).toBe(true));
    const spoiled = restored.exportRecords().find(record => record.id !== 'spawn:spoiled_food'
      && record.components.stack?.itemId === 'spoiled_food');
    expect(spoiled).toMatchObject({ transform: { position: before.ground_item.find(record => record.id === 'spawn:red_cap')!.transform.position },
      components: { stack: { itemId: 'spoiled_food', count: 1 } } });
  } finally { registry.dispose(); restored?.dispose(); inventory.dispose(); restoredInventory.dispose(); }
});
