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
import { PERISH_MED, Perishable } from '../../componets/src/perishable';
import { batch, createSignal } from '../../signals/src';
import type { WorldPerishClock } from '../../componets/src/worldperishclock';
import { createPerishWorld } from './perishWorldFixture';
import { PERISHABLE_FOODS, getFoodEffects } from '../../prefab/src/food';
import { configureIceEntity } from '../../prefab/src/ice';
import { PERISH_FAST, PERISH_SUPERFAST } from '../../componets/src/perishable';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const a = inventorySlotAddress(0), b = inventorySlotAddress(1);
const specs = {
  red_cap: { name: '红蘑菇', icon: 'red_cap.tex', maxStack: 40,
    perishTime: PERISHABLE_FOODS.red_cap.perishTime, perishReplacement: PERISHABLE_FOODS.red_cap.replacement },
  spoiled_food: { name: '腐烂物', icon: 'spoiled_food.tex', maxStack: 40 },
};
const setup = () => {
  const store = new InventoryStore([
    { address: a, slot: new InventorySlot() }, { address: b, slot: new InventorySlot() },
  ], specs);
  const perishWorld = createPerishWorld();
  store.entities.bindPerishWorld(perishWorld);
  return Object.assign(store, { perishWorld });
};
/** Advance game time and settle the final partial period. */
function settle(store: ReturnType<typeof setup>, seconds: number): void {
  store.perishWorld.advance(seconds);
  store.getEntity(a)?.components.perishable.flush();
}

it('derives fresh, stale and spoiled from the settled red_cap timer and eats source values per stage', () => {
  const store = setup();
  store.add('red_cap', 3);
  const entity = store.getEntity(a)!, perishable = entity.components.perishable;
  expect(perishable.timer.peek()).toEqual({ status: 'perishing', remainingSeconds: PERISH_MED });
  expect(entity.signals.freshnessPercent.peek()).toBe(1);
  expect(perishable.stage.peek()).toBe('fresh');
  expect(getFoodEffects(entity)).toEqual({ health: -20, hunger: 12.5, sanity: 0 });

  // More than 60 frames can elapse without a settlement when less than 10 game seconds pass.
  const timerChanges: unknown[] = [];
  const stop = perishable.timer.subscribe(timer => timerChanges.push(timer));
  const scheduled = perishable.updateTimer.peek();
  for (let frame = 0; frame < 79; frame++) store.perishWorld.advance(.125);
  expect(timerChanges).toHaveLength(0);
  expect(perishable.updateTimer.peek()).toBe(scheduled);
  store.perishWorld.advance(.125);
  expect(timerChanges).toEqual([{ status: 'perishing', remainingSeconds: PERISH_MED - 10 }]);
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
  expect(perishable.updateTimer.peek()).toEqual({ status: 'stopped' });
  expect(store.get(a)).toMatchObject({ itemId: 'spoiled_food', count: 3 });
  store.dispose();
});

it('catches up 10-second deadlines during a long frame, flushes the tail and cancels tasks while paused', () => {
  const store = setup();
  store.add('red_cap', 1);
  const perish = store.getEntity(a)!.components.perishable;
  const changes: unknown[] = [];
  const stop = perish.timer.subscribe(timer => changes.push(timer));
  try {
    store.perishWorld.advance(25);
    expect(changes).toEqual([
      { status: 'perishing', remainingSeconds: PERISH_MED - 10 },
      { status: 'perishing', remainingSeconds: PERISH_MED - 20 },
    ]);
    expect(perish.updateTimer.peek()).toEqual({ status: 'scheduled', endTime: 30 });
    perish.StopPerishing();
    expect(perish.timer.peek()).toEqual({ status: 'paused', remainingSeconds: PERISH_MED - 25 });
    expect(perish.updateTimer.peek()).toEqual({ status: 'stopped' });
    store.perishWorld.advance(100);
    expect(perish.timer.peek()).toEqual({ status: 'paused', remainingSeconds: PERISH_MED - 25 });
    perish.StartPerishing();
    expect(perish.updateTimer.peek()).toEqual({ status: 'scheduled', endTime: 135 });
    store.perishWorld.advance(9);
    expect(perish.timer.peek()).toEqual({ status: 'perishing', remainingSeconds: PERISH_MED - 25 });
    store.perishWorld.advance(1);
    expect(perish.timer.peek()).toEqual({ status: 'perishing', remainingSeconds: PERISH_MED - 35 });
  } finally { stop(); store.dispose(); }
});

it('binds existing items to the world queue, preserves pending deadlines on rebind and cancels only removed items', () => {
  const store = setup();
  const schedule = vi.spyOn(store.perishWorld.scheduler, 'schedule');
  const nextWorld = createPerishWorld(createSignal(20), 200);
  try {
    store.add('spoiled_food', 1);
    expect(schedule).not.toHaveBeenCalled();
    store.add('red_cap', 1);
    const item = store.getEntity(b)!, perish = item.components.perishable;
    store.perishWorld.advance(3);
    store.entities.bindPerishWorld(nextWorld);
    expect(perish.GetPercent()).toBeCloseTo(1 - 3 / PERISH_MED);
    expect(perish.updateTimer.peek()).toEqual({ status: 'scheduled', endTime: 207 });
    const settled = perish.timer.peek();
    store.perishWorld.advance(100);
    expect(perish.timer.peek()).toBe(settled);
    nextWorld.advance(6);
    expect(perish.timer.peek()).toBe(settled);
    nextWorld.advance(1);
    expect(perish.timer.peek()).toEqual({ status: 'perishing', remainingSeconds: PERISH_MED - 10 });
    item.remove();
    expect(perish.updateTimer.peek()).toEqual({ status: 'stopped' });
    const update = vi.spyOn(perish, 'Update'), peer = vi.fn();
    nextWorld.scheduler.schedule(10, peer);
    nextWorld.advance(20);
    expect(update).not.toHaveBeenCalled();
    expect(peer).toHaveBeenCalledOnce();
  } finally { store.dispose(); }
});

it('settles other items at the current task deadline when a long-frame perish callback saves the inventory', () => {
  const store = setup();
  try {
    store.add('red_cap', 1);
    store.add('red_cap', 40);
    const first = store.getEntity(a)!, other = store.getEntity(b)!;
    first.components.perishable.SetPercent(10 / PERISH_MED);
    other.components.perishable.StartPerishing();
    let savedAtPerish: ReturnType<InventoryStore['exportState']> | undefined;
    first.ListenForEvent('perished', () => { savedAtPerish = store.exportState(); });
    store.perishWorld.advance(25);
    expect(savedAtPerish?.slots.find(slot => slot.address.containerId === b.containerId && slot.address.slotKey === b.slotKey)?.item?.freshnessPercent)
      .toBeCloseTo(1 - 10 / PERISH_MED, 9);
    expect(store.get(a)).toMatchObject({ itemId: 'spoiled_food', count: 40 });
    expect(other.components.perishable.timer.peek()).toEqual({ status: 'perishing', remainingSeconds: PERISH_MED - 20 });
    other.flush();
    expect(other.components.perishable.GetPercent()).toBeCloseTo(1 - 25 / PERISH_MED, 9);
  } finally { store.dispose(); }
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
  // A partial 10-second period stays pending until the transfer settles it.
  store.perishWorld.advance(3);
  expect(entity.signals.freshnessPercent.peek()).toBeCloseTo(.625, 9);
  expect(store.transfer(a, b, 2)).toBe(true);
  expect(store.getEntity(b)).toBe(entity);
  expect(entity.signals.freshnessPercent.peek()).toBeCloseTo(.625 - 3 / PERISH_MED, 9);
  const restored = setup();
  restored.replaceState(store.exportState(), {});
  const loaded = restored.getEntity(b)!;
  expect(loaded.id).toBe(entity.id);
  expect(loaded.signals.freshnessPercent.peek()).toBeCloseTo(.625 - 3 / PERISH_MED, 9);
  expect(loaded.components.perishable.timer.peek()).toMatchObject({ status: 'perishing' });
  store.dispose(); restored.dispose();
});

it('settles partial batches before resetting freshness or perish time without charging old time again', () => {
  const store = setup();
  store.add('red_cap', 1);
  const entity = store.getEntity(a)!;
  const perish = entity.components.perishable;
  const changes: unknown[] = [];
  const stop = perish.timer.subscribe(timer => changes.push(timer));

  store.perishWorld.advance(3);
  // Reapplying an unchanged item snapshot retains its pending batch.
  entity.apply(entity.snapshot());
  expect(changes).toEqual([]);
  perish.SetPercent(.5);
  expect(changes).toEqual([
    { status: 'perishing', remainingSeconds: PERISH_MED - 3 },
    { status: 'perishing', remainingSeconds: PERISH_MED * .5 },
  ]);
  perish.flush();
  expect(changes).toHaveLength(2);

  changes.length = 0;
  store.perishWorld.advance(2);
  perish.SetPerishTime(PERISH_MED * 2);
  expect(changes).toEqual([
    { status: 'perishing', remainingSeconds: PERISH_MED * .5 - 2 },
    { status: 'perishing', remainingSeconds: PERISH_MED * 2 },
  ]);
  for (let frame = 0; frame < 60; frame++) store.perishWorld.advance(.5);
  expect(perish.timer.peek()).toEqual({ status: 'perishing', remainingSeconds: PERISH_MED * 2 - 30 });
  stop(); store.dispose();
});

it('publishes a coherent full-freshness reset and applies successive percent changes inside a batch', () => {
  const store = setup();
  store.add('red_cap', 1);
  const perish = store.getEntity(a)!.components.perishable;
  perish.StopPerishing();
  perish.SetPercent(.8);
  const percentages: (number | undefined)[] = [];
  const stages: unknown[] = [];
  const snapshots: unknown[] = [];
  const stopPercent = perish.percent.subscribe(value => percentages.push(value));
  const stopStage = perish.stage.subscribe(value => stages.push(value));
  const stopTime = perish.perishtime.subscribe(time => snapshots.push({ time, timer: perish.timer.peek(),
    percent: perish.percent.peek(), stage: perish.stage.peek() }));
  perish.SetPerishTime(PERISH_MED * 4);
  expect(percentages).toEqual([1]);
  expect(stages).toEqual([]);
  expect(snapshots).toEqual([{ time: PERISH_MED * 4,
    timer: { status: 'paused', remainingSeconds: PERISH_MED * 4 }, percent: 1, stage: 'fresh' }]);

  perish.SetPercent(.6);
  batch(() => { perish.SetPercent(.2); perish.SetPercent(.6); });
  expect(perish.timer.peek()).toEqual({ status: 'paused', remainingSeconds: PERISH_MED * 4 * .6 });
  expect(perish.percent.peek()).toBe(.6);
  stopPercent(); stopStage(); stopTime(); store.dispose();
});

it.each(['SetPercent', 'SetPerishTime'] as const)('keeps the replacement when settling before %s perishes the original item', method => {
  const store = setup();
  store.add('red_cap', 3);
  const entity = store.getEntity(a)!;
  const perish = entity.components.perishable;
  perish.SetPercent(1 / PERISH_MED);
  const onPerish = vi.fn();
  perish.perishfn = onPerish;
  store.perishWorld.advance(2);
  if (method === 'SetPercent') perish.SetPercent(1);
  else perish.SetPerishTime(PERISH_MED * 2);
  expect(onPerish).toHaveBeenCalledTimes(1);
  expect(entity.isRemoved).toBe(true);
  expect(perish.timer.peek()).toEqual({ status: 'perished' });
  expect(perish.perishtime.peek()).toBe(PERISH_MED);
  expect(store.get(a)).toMatchObject({ itemId: 'spoiled_food', count: 3 });
  store.dispose();
});

it('settles world prefix differences, paused time and changed wetness without replaying historical temperature', async () => {
  const store = setup();
  const temperature = createSignal(-1);
  const world = createPerishWorld(temperature), clock = world.perishClock;
  store.entities.bindPerishWorld(world);
  store.add('red_cap', 1);
  const entity = store.getEntity(a)!;
  const perish = entity.components.perishable;
  clock.OnUpdate(20);
  temperature.set(71);
  clock.OnUpdate(40);
  expect(perish.timer.peek()).toEqual({ status: 'perishing', remainingSeconds: PERISH_MED });
  // The morning/wake-up caller can settle at a recorded time even after the world advanced further.
  perish.Update(clock.GetTick(30));
  expect(perish.GetPercent()).toBeCloseTo(1 - (15 + 12.5) / PERISH_MED, 9);
  perish.Update(clock.GetTick());
  expect(perish.GetPercent()).toBeCloseTo(1 - (15 + 50) / PERISH_MED, 9);
  const settled = perish.timer.peek();
  perish.Update(clock.GetTick());
  expect(perish.timer.peek()).toBe(settled);
  world.scheduler.advanceTo(clock.GetTick().time);

  perish.StopPerishing();
  world.advance(100);
  perish.StartPerishing();
  temperature.set(70);
  world.advance(10);
  entity.setWet(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  world.advance(10);
  perish.flush();
  expect(perish.GetPercent()).toBeCloseTo(1 - (65 + 10 + 13) / PERISH_MED, 9);

  store.dispose();
  clock.dispose();
});

it('settles watched wetness from apply and setWet, preserving it on reload', async () => {
  const store = setup(), restored = setup();
  const world = createPerishWorld(), clock = world.perishClock;
  store.entities.bindPerishWorld(world);
  restored.entities.bindPerishWorld(world);
  store.add('red_cap', 1);
  const entity = store.getEntity(a)!, perish = entity.components.perishable;
  try {
    world.advance(10);
    entity.apply({ ...entity.snapshot(), wet: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(perish.timer.peek()).toEqual({ status: 'perishing', remainingSeconds: PERISH_MED - 10 });

    world.advance(4);
    entity.apply({ ...entity.snapshot(), wet: false });
    await new Promise(resolve => setTimeout(resolve, 0));
    world.advance(6);
    entity.setWet(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    world.advance(8);
    const saved = store.exportState();
    const remainingSeconds = PERISH_MED - 10 - 4 * 1.3 - 6 - 8 * 1.3;
    expect(perish.timer.peek()).toEqual({ status: 'perishing', remainingSeconds });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(perish.timer.peek()).toEqual({ status: 'perishing', remainingSeconds });

    restored.replaceState(saved, {});
    const loaded = restored.getEntity(a)!;
    expect(loaded.snapshot()).toEqual(entity.snapshot());
    expect(loaded.GetIsWet()).toBe(true);
    world.advance(10);
    loaded.components.perishable.flush();
    expect(loaded.components.perishable.GetPercent()).toBeCloseTo((remainingSeconds - 13) / PERISH_MED, 9);
  } finally { store.dispose(); restored.dispose(); clock.dispose(); }
});

it('settles wetness on disposal and releases the source bridge and effect', async () => {
  const wet = createSignal(false);
  const world = createPerishWorld(), clock = world.perishClock;
  const perish = new Perishable({
    isRemoved: false,
    components: { inventoryitem: { owner: null } },
    PushEvent: vi.fn(),
  }, wet, world);
  perish.SetPerishTime(100);
  perish.StartPerishing();
  world.advance(10);
  wet.set(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  world.advance(10);
  wet.set(false);
  perish.dispose();
  expect(perish.timer.peek()).toEqual({ status: 'perishing', remainingSeconds: 100 - 15 - 19.5 });
  const update = vi.spyOn(perish, 'Update');
  const sample = vi.spyOn(clock, 'GetTick');
  wet.set(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(update).not.toHaveBeenCalled();
  expect(sample).not.toHaveBeenCalled();
  clock.dispose();
});

it('spawns/gives red_cap, bananapop and spoiled_food, replaces a perished ground cap and reloads freshness through c_save', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const inventory = createPickupInventory(), restoredInventory = createPickupInventory();
  const world = createPerishWorld(), clock = world.perishClock;
  inventory.entities.bindPerishWorld(world);
  let restoredClock: WorldPerishClock | undefined;
  const player = new THREE.Group();
  player.position.set(2, 0, -4);
  const createManager = (store: InventoryStore) => new GroundItemManager(new THREE.Scene(), new THREE.PerspectiveCamera(),
    { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer, '/dst/data/databundles/images.zip',
    store, '/dst/data/anim', player, undefined, undefined, undefined, store.entities);
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
    world.advance(30);
    pop.components.perishable.SetPercent(.15);
    inventory.getEntity(inventorySlotAddress(2))!.components.perishable.SetPercent(.8);
    const ground = manager.entities.get('spawn:red_cap')!;
    expect(ground.signals.freshnessPercent.peek()).toBeCloseTo(1 - 45 / PERISH_MED);
    ground.components.perishable.SetPercent(.3);
    inventory.getEntity(inventorySlotAddress(0))!.components.perishable.SetPercent(.6);

    const before = registry.exportRecords(), held = inventory.exportState();
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
      json = serializeSave(template, { entities: before, inventory: held, elapsedSeconds: clock.GetTick().time,
        playerTransform: { position: [2, 0, -4], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG);
    expect(saved.world.entities).toEqual(before);
    const restoredWorld = createPerishWorld(createSignal(20), saved.world.elapsedSeconds);
    restoredClock = restoredWorld.perishClock;
    restoredInventory.entities.bindPerishWorld(restoredWorld);
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
    loadedGround.components.perishable.flush();
    expect(loadedGround.signals.freshnessPercent.peek()).toBeCloseTo(.3, 9);

    // Ground perishing spends PERISH_GROUND_MULT and replaces the cap at its foot point.
    for (let frame = 0; frame < 60; frame++) {
      const dt = PERISH_MED * .3 / 1.5 / 60;
      restoredWorld.advance(dt);
    }
    loadedGround.components.perishable.flush();
    await vi.waitFor(() => expect(loadedGround.isRemoved).toBe(true));
    const spoiled = restored.exportRecords().find(record => record.id !== 'spawn:spoiled_food'
      && record.components.stack?.itemId === 'spoiled_food');
    expect(spoiled).toMatchObject({ transform: { position: before.ground_item.find(record => record.id === 'spawn:red_cap')!.transform.position },
      components: { stack: { itemId: 'spoiled_food', count: 1 } } });
  } finally { registry.dispose(); restored?.dispose(); inventory.dispose(); restoredInventory.dispose(); clock.dispose(); restoredClock?.dispose(); }
});

it('gives meat and ice source perish times: meat spoils into spoiled_food, a held ice stack just melts away', () => {
  const store = new InventoryStore([
    { address: a, slot: new InventorySlot() }, { address: b, slot: new InventorySlot() },
  ], {
    meat: { name: '肉', icon: 'meat.tex', maxStack: 40,
      perishTime: PERISHABLE_FOODS.meat.perishTime, perishReplacement: PERISHABLE_FOODS.meat.replacement },
    ice: { name: '冰', icon: 'ice.tex', maxStack: 40, perishTime: PERISHABLE_FOODS.ice.perishTime, configureEntity: configureIceEntity },
    spoiled_food: specs.spoiled_food,
  });
  const world = createPerishWorld();
  store.entities.bindPerishWorld(world);
  store.add('meat', 2); store.add('ice', 3);
  expect(store.getEntity(a)!.components.perishable.perishtime.peek()).toBe(PERISH_FAST);
  const ice = store.getEntity(b)!;
  expect(ice.components.perishable.perishtime.peek()).toBe(PERISH_SUPERFAST);
  expect(ice.hasTag('frozen')).toBe(true);

  world.advance(PERISH_SUPERFAST + 1);
  for (const slot of [a, b]) store.getEntity(slot)?.components.perishable.flush();
  expect(store.get(a)).toMatchObject({ itemId: 'meat', count: 2 });
  expect(store.get(b)).toBeNull();
  store.dispose();
});
