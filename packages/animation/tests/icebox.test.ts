import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { ItemEntity, inventorySlotAddress } from '../../inventory/src';
import { createSignal } from '../../signals/src';
import type { WorldPerishClock } from '../../componets/src/worldperishclock';
import { createPerishWorld } from './perishWorldFixture';
import { ComponentUpdates } from '../../componets/src/componentUpdates';
import { Temperature } from '../../componets/src/temperature';
import { Heater } from '../../componets/src/heater';
import { createBuildingContainer } from '../../prefab/src/containers';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { ICE_BOX_DEFINITION } from '../../prefab/src/icebox';
import { HeatRock } from '../../prefab/src/heatrock';
import type { WorldContext } from '../../prefab/src/worldContext';
import { createPickupInventory } from './pickupFixture';
import { executeDebugCommand } from '../../../src/debugCommands';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const held = inventorySlotAddress(0), chilled = { containerId: 'world:icebox:fridge', slotKey: '0' };

it('uses the fridge multiplier while closed, settles the old holder on transfer and releases scheduled updates', () => {
  const inventory = createPickupInventory(), world = createPerishWorld(), clock = world.perishClock;
  inventory.entities.bindPerishWorld(world);
  const container = createBuildingContainer('icebox', {});
  inventory.registerContainer(chilled.containerId, container);
  try {
    inventory.add('red_cap', 2);
    const item = inventory.getEntity(held)!, perish = item.components.perishable;
    world.advance(3);
    expect(inventory.transfer(held, chilled, 2)).toBe(true);
    expect(perish.timer.peek()).toMatchObject({ remainingSeconds: 4800 - 3 });
    expect(item.components.inventoryitem.owner?.hasTag?.('fridge')).toBe(true);
    expect(container.IsOpen()).toBe(false);
    world.advance(10);
    expect(perish.timer.peek()).toMatchObject({ remainingSeconds: 4800 - 6.5 });
    perish.flush();
    expect(perish.timer.peek()).toMatchObject({ remainingSeconds: 4800 - 8 });
    world.advance(4);
    expect(inventory.transfer(chilled, held, 2)).toBe(true);
    expect(inventory.getEntity(held)).toBe(item);
    expect(perish.timer.peek()).toMatchObject({ remainingSeconds: 4800 - 8 - 2 });
    world.advance(2); perish.flush();
    expect(perish.timer.peek()).toMatchObject({ remainingSeconds: 4800 - 8 - 2 - 2 });
    item.destroy();
    expect(perish.updateTimer.peek()).toEqual({ status: 'stopped' });
    const before = perish.timer.peek();
    world.advance(20);
    expect(perish.timer.peek()).toBe(before);
  } finally { inventory.dispose(); clock.dispose(); }
});

it('stops frozen perishables in a fridge and below zero, with nocool/lowcool using ordinary refrigeration', () => {
  const ambient = createSignal(20), world = createPerishWorld(ambient), clock = world.perishClock;
  const item = new ItemEntity({ itemId: 'frozen_fixture', count: 1, wet: true }, world);
  item.addTag('frozen');
  const tags = new Set(['fridge']);
  item.components.inventoryitem.owner = { address: chilled, hasTag: tag => tags.has(tag),
    changed() {}, PushEvent() {}, remove: () => false, replace: () => false };
  const perish = item.components.perishable;
  perish.SetPerishTime(100); perish.StartPerishing();
  const advance = (dt: number) => { world.advance(dt); perish.flush(); };
  try {
    advance(20);
    expect(perish.GetPercent()).toBe(1);
    tags.add('lowcool'); advance(10);
    expect(perish.GetPercent()).toBeCloseTo(.935);
    tags.delete('lowcool'); tags.add('nocool'); advance(10);
    expect(perish.GetPercent()).toBeCloseTo(.87);
    ambient.set(-1); advance(10);
    expect(perish.GetPercent()).toBeCloseTo(.87);
    // Exactly zero is outside perishable.lua's frozen ambient branch.
    ambient.set(0); advance(10);
    expect(perish.GetPercent()).toBeCloseTo(.805);
    tags.delete('nocool');
    perish.SetPercent(0); advance(10);
    expect(perish.timer.peek()).toEqual({ status: 'perished' });
  } finally { item.destroy(); clock.dispose(); }
});

it('cools stones to the source floor, resumes ambient changes outside the fridge and consumes a completed cold cycle once', async () => {
  const inventory = createPickupInventory(), ambient = createSignal(35);
  inventory.entities.bindTemperatureWorld({ temperature: ambient, componentUpdates: new ComponentUpdates() });
  inventory.registerContainer(chilled.containerId, createBuildingContainer('icebox', {}));
  try {
    inventory.add('heatrock', 1);
    const item = inventory.getEntity(held)!, temp = item.components.temperature!, rock = item.getComponent<HeatRock>('heatrock')!;
    expect(temp.GetCurrent()).toBe(35);
    inventory.transfer(held, chilled, 1);
    temp.OnUpdate(15);
    expect(temp.GetCurrent()).toBe(20);
    expect(rock.range.peek()).toBe(2);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(inventory.getStackSpec(item.snapshot()).icon).toBe('heat_rock2.tex');
    temp.OnUpdate(60);
    expect(temp.GetCurrent()).toBe(0);
    expect(rock.range.peek()).toBe(1);
    expect(item.lowTemp).toBe(0);
    expect(item.components.fueled!.currentfuel).toBe(100);
    ambient.set(-10); temp.OnUpdate(100);
    expect(temp.GetCurrent()).toBe(-10);
    ambient.set(34);
    inventory.transfer(chilled, held, 1);
    temp.OnUpdate(1);
    expect(temp.GetCurrent()).toBe(-5);
    temp.OnUpdate(1); // thaw to zero at 5 degrees/s before the ordinary warming branch
    temp.OnUpdate(.2); // zero still uses the thaw rate
    for (let second = 0; second < 23; second++) temp.OnUpdate(1);
    expect(temp.GetCurrent()).toBe(24);
    expect(rock.range.peek()).toBe(2); // strict > ambient - 10
    temp.OnUpdate(.1);
    expect(rock.range.peek()).toBe(3);
    expect(item.components.fueled!.currentfuel).toBe(87.5);
    expect(item.lowTemp).toBeUndefined();
    for (let second = 0; second < 20; second++) temp.OnUpdate(1);
    expect(item.components.fueled!.currentfuel).toBe(87.5);
    item.setRemainingFuel(12.5);
    inventory.transfer(held, chilled, 1); temp.OnUpdate(100);
    inventory.transfer(chilled, held, 1);
    for (let second = 0; second < 21; second++) temp.OnUpdate(1);
    expect(item.isRemoved).toBe(true);
    expect(inventory.getEntity(held)).toBeNull();
  } finally { inventory.dispose(); }
});

it('honours lowcool, nocool, heater falloff and ignored stones, and cleans up world signal bridges', () => {
  const ambient = createSignal(35), phase = createSignal({ phase: 'day' });
  const item = new ItemEntity({ itemId: 'heatrock', count: 1 });
  const tags = new Set(['fridge', 'lowcool']);
  item.components.inventoryitem.owner = { address: chilled, hasTag: tag => tags.has(tag),
    changed() {}, PushEvent() {}, remove: () => false, replace: () => false };
  const heater = new Heater({ addTag() {}, removeTag() {} }); heater.SetHeat(60);
  const source = { getPosition: () => new THREE.Vector3(5, 0, 0), components: { heater }, hasTag: (_tag: string) => false };
  const temp = new Temperature(item, { temperature: ambient, componentUpdates: new ComponentUpdates(), clock: phase, findHeaters: () => [source] });
  const watchedAmbient = vi.spyOn(ambient, 'get'), watchedPhase = vi.spyOn(phase, 'get');
  try {
    temp.OnUpdate(10); expect(temp.GetCurrent()).toBe(30);
    tags.add('nocool'); temp.OnUpdate(1); expect(temp.GetCurrent()).toBe(31);
    temp.SetTemperature(40); temp.OnUpdate(1); expect(temp.GetCurrent()).toBe(40);
    temp.IgnoreTags('heatrock'); source.hasTag = tag => tag === 'heatrock';
    temp.OnUpdate(1); expect(temp.GetCurrent()).toBe(39);
    temp.dispose();
    const a = watchedAmbient.mock.calls.length, b = watchedPhase.mock.calls.length;
    ambient.set(-20); phase.set({ phase: 'night' }); temp.OnUpdate(10);
    expect(temp.GetCurrent()).toBe(39);
    expect(watchedAmbient).toHaveBeenCalledTimes(a); expect(watchedPhase).toHaveBeenCalledTimes(b);
  } finally { temp.dispose(); heater.dispose(); item.destroy(); }
});

it('saves a spawned fridge with skinned cold stones and food through c_save and reloads their state', async () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const inventory = createPickupInventory(), restored = createPickupInventory();
  const ambient = createSignal(35), perishWorld = createPerishWorld(ambient), clock = perishWorld.perishClock;
  inventory.entities.bindPerishWorld(perishWorld);
  inventory.entities.bindTemperatureWorld({ temperature: ambient, componentUpdates: new ComponentUpdates() });
  restored.entities.bindTemperatureWorld({ temperature: ambient, componentUpdates: new ComponentUpdates() });
  const scene = new THREE.Scene();
  const world = { scene, player: new THREE.Group(), camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() },
    registerContainer: (...args: Parameters<typeof inventory.registerContainer>) => inventory.registerContainer(...args),
    unregisterContainer: (...args: Parameters<typeof inventory.unregisterContainer>) => inventory.unregisterContainer(...args),
  } as unknown as WorldContext;
  const placement = new AnimatedBuildingPlacement(world, { icebox: ICE_BOX_DEFINITION }, () => false);
  let restoredClock: WorldPerishClock | undefined;
  try {
    const spawn = async (id: string) => {
      if (id !== 'icebox') return false;
      await placement.spawnFromSave('icebox', { id: 'fridge', transform: { position: [3, 0, -6], rotationY: 0 },
        components: { building: { state: 'closed', skinId: 'icebox_crystal' } } });
      return true;
    };
    expect((await executeDebugCommand('c_spawn("icebox"); c_give("heatrock"); c_give("red_cap", 2)', inventory, spawn)).ok).toBe(true);
    const stone = inventory.getEntity(held)!, food = inventory.getEntity(inventorySlotAddress(1))!;
    stone.skinId = 'heatrock_fantasy'; inventory.configureItem(stone);
    inventory.transfer(held, chilled, 1);
    inventory.transfer(inventorySlotAddress(1), { ...chilled, slotKey: '1' }, 2);
    stone.components.temperature!.OnUpdate(35);
    perishWorld.advance(7);
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
      json = serializeSave(template, { entities: { icebox: placement.exportRecords().map(({ record }) => ({ ...record,
        transform: { ...record.transform, position: [...record.transform.position] } })) },
        inventory: inventory.exportState(), elapsedSeconds: clock.GetTick().time,
        playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    const save = deserializeSave(json, SAVE_CATALOG), record = save.world.entities.icebox[0];
    expect(record.transform.position).toEqual([3, 0, -6]);
    expect(record.components.building?.skinId).toBe('icebox_crystal');
    const restoredWorld = createPerishWorld(ambient, save.world.elapsedSeconds);
    restoredClock = restoredWorld.perishClock;
    restored.entities.bindPerishWorld(restoredWorld);
    restored.registerContainer(chilled.containerId, createBuildingContainer('icebox', {}));
    restored.replaceState(inventoryStateFromSave(save), SAVE_CATALOG.recipes);
    const loaded = restored.getEntity(chilled)!;
    expect(loaded.snapshot()).toEqual(stone.snapshot());
    expect(loaded.getComponent<HeatRock>('heatrock')!.range.peek()).toBe(1);
    expect(restored.getStackSpec(loaded.snapshot())).toMatchObject({ icon: 'heatrock_fantasy1.tex', atlas: 'images/inventoryimages2.xml' });
    expect(restored.getEntity({ ...chilled, slotKey: '1' })!.snapshot()).toEqual(food.snapshot());
    loaded.components.temperature!.OnUpdate(10);
    expect(loaded.components.temperature!.GetCurrent()).toBe(0);
    expect(loaded.components.fueled!.currentfuel).toBe(100);
    restoredWorld.advance(10);
    restored.getEntity({ ...chilled, slotKey: '1' })!.components.perishable.flush();
    expect(restored.getEntity({ ...chilled, slotKey: '1' })!.components.perishable.GetPercent()).toBeCloseTo(1 - 8.5 / 4800);
    const invalid = JSON.parse(json);
    invalid.world.entities.icebox[0].components.container.slots[0].item.temperature.current = 91;
    expect(() => deserializeSave(JSON.stringify(invalid), SAVE_CATALOG)).toThrow();
  } finally { placement.dispose(); inventory.dispose(); restored.dispose(); clock.dispose(); restoredClock?.dispose(); }
});
