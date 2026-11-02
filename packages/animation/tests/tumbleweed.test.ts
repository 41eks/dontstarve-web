import { findActionEntity } from '../../prefab/src/actionEntity';
import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import { createTestWorldSources } from './worldContentFixture';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal, getWatchWorldContent, type WorldContentEnvironment } from '../../signals/src';
import { prefabDisplay } from '../../display/src';
import type { PrefabInstance } from '../../prefab/src/prefabInstance';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { BlowInWind } from '../../componets/src/blowinwind';
import { WorldWind } from '../../componets/src/worldwind';
import { TumbleweedManager, rollTumbleweedLoot, type TumbleweedWorld } from '../../prefab/src/tumbleweed';
import { canDoSceneAction } from './sceneActions';

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

it('worldwind keeps angle as a signal and announces each change on discrete game-time tasks', () => {
  const scheduler = new GameTimeScheduler(), values = [.5, 0, 0, .99];
  const wind = new WorldWind(scheduler, () => values.shift() ?? 0);
  expect(wind.GetWindAngle()).toBe(180); expect(wind.GetWindVelocity()).toBe(1);
  expect(wind.timerSnapshot.peek()).toEqual({ status: 'scheduled', endTime: 1 });
  const angles: number[] = [], changes: unknown[] = [];
  wind.angle.subscribe(angle => angles.push(angle));
  wind.windchange.subscribe(change => changes.push(change));
  scheduler.advance(.9); expect(changes).toHaveLength(0);
  scheduler.advance(.1);
  // The new angle (0) and the next delay (15 s) come from the injected random source.
  expect(wind.GetWindAngle()).toBe(0); expect(angles).toEqual([0]);
  expect(changes).toEqual([{ angle: 0, velocity: 1 }]);
  expect(wind.timerSnapshot.peek()).toEqual({ status: 'scheduled', endTime: 16 });
  // A repeated angle still produces a windchange.
  values.splice(0, values.length, 0, 0); scheduler.advance(15);
  expect(angles).toEqual([0]); expect(changes).toHaveLength(2);
  wind.Stop(); expect(wind.timerSnapshot.peek()).toEqual({ status: 'stopped' });
  scheduler.advance(100); expect(changes).toHaveLength(2);
  wind.dispose();
});

it('blowinwind accumulates the wind vector, walks along its rotation and varies the speed', () => {
  const rotations: number[] = [], walker = { walkspeed: 0, WalkForward: vi.fn() };
  const blow = new BlowInWind({ setRotation: degrees => rotations.push(degrees) }, 5, walker, () => .5);
  blow.Update(1); expect(walker.WalkForward).not.toHaveBeenCalled();
  blow.Start(0);
  expect(blow.windVector).toEqual({ x: 1, z: 0 });
  blow.Update(.25);
  expect(blow.GetSpeed()).toBeCloseTo(1.25); expect(rotations.at(-1)).toBeCloseTo(0);
  blow.Update(.75); // velocity length 1: the speed varies between min and max multipliers of 5
  expect(walker.walkspeed).toBeGreaterThanOrEqual(2.5); expect(walker.walkspeed).toBeLessThanOrEqual(7.5);
  blow.ChangeDirection(Math.PI / 2);
  blow.Update(1);
  expect(blow.GetVelocity().x ** 2 + blow.GetVelocity().z ** 2).toBeCloseTo(1);
  expect(rotations.at(-1)).toBeGreaterThan(0); expect(rotations.at(-1)).toBeLessThan(90);
  blow.Stop(); blow.Update(1); expect(walker.WalkForward).toHaveBeenCalledTimes(3);
});

it('rolls three weighted loot items', () => {
  expect(rollTumbleweedLoot(() => 0)).toEqual(['cutgrass', 'cutgrass', 'cutgrass']);
  expect(rollTumbleweedLoot(() => .5)).toEqual(['twigs', 'twigs', 'twigs']);
});

function fixture() {
  const scene = new THREE.Scene(), physics = new CANNON.World(), scheduler = new GameTimeScheduler();
  const drops: { items: readonly string[]; position: THREE.Vector3 }[] = [], awake = createSignal(true);
  const wind = new WorldWind(scheduler, () => 0);
  const sources: WorldContentEnvironment = { ...createTestWorldSources(scheduler),
    playerpositions: createSignal<THREE.Vector3[]>([]), snowLevel: createSignal(0), scheduler, wind: wind.windchange, perishTick: createSignal({ time: 0, total: 0 }),
    temperature: createSignal(30), cycle: createSignal('day'), season: createSignal({ season: 'spring', progress: .5 }),
  };
  const state = { ground: true };
  const world: TumbleweedWorld = { scheduler, wind, tickingarea: () => createMemo(() => awake.get()),
    getWatchWorldContent: (key, register) => getWatchWorldContent(key, register, sources), random: () => .5,
    isOnValidGround: () => state.ground, constrainPosition: () => undefined,
    dropLoot: (items, position) => drops.push({ items, position }) };
  const manager = new TumbleweedManager(scene, physics, world);
  const step = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 30); i++) {
      scheduler.advance(1 / 30); manager.beforePhysics(1 / 30); physics.step(1 / 30); manager.sync();
    }
  };
  const modelOf = (weed: PrefabInstance) => scene.children.find(child => lookupPrefabInstance(child) === weed)!;
  const artLoaded = async (weed: PrefabInstance) => { await prefabDisplay(modelOf(weed))!.artLoaded(); };
  return { scene, scheduler, drops, awake, state, world, manager, step, modelOf, artLoaded, dispose: () => { manager.dispose(); wind.dispose(); } };
}

it('rolls with the wind, stops for a long action and restarts, is picked for loot and a break fx, and reloads by position', async () => {
  const { scene, drops, state, world, manager, step, modelOf, artLoaded, dispose } = fixture();
  const restoredManager = new TumbleweedManager(new THREE.Scene(), new CANNON.World(), { ...world, wind: undefined, getWatchWorldContent: undefined, tickingarea: undefined });
  try {
    // SpawnPrefab is synchronous: the entity rolls and is pickable before its art arrives.
    const weed = manager.spawn(new THREE.Vector3(10, 0, 4));
    const model = modelOf(weed);
    expect(weed.sprite.loaded).toBe(false);
    expect(findActionEntity(model).hasTag('pickable')).toBe(true);
    await artLoaded(weed);
    // Angle 0 ± 10 variance (random .5 → none) rolls toward +x.
    step(3);
    expect(weed.position.x).toBeGreaterThan(12); expect(Math.abs(weed.position.z - 4)).toBeLessThan(.01);
    expect(weed.position).toBe(model.position);
    expect(model.userData).not.toHaveProperty('tumbleweed');
    expect(manager.renderEntities).toHaveLength(1);
    expect(canDoSceneAction('PICK', model)).toBe(true);
    const before = weed.position.x;

    weed.PushEvent('startlongaction');
    expect(weed.sprite.currentAnimation).toBe('move_pst');
    step(1); expect(weed.position.x).toBeCloseTo(before, 1);
    expect(weed.sprite.currentAnimation).toBe('idle');
    step(3.1); // random 2 + floor(.5 * 5) = 4 seconds in total
    expect(weed.sprite.currentAnimation).toBe('move_pre');
    step(2); expect(weed.sprite.currentAnimation).toBe('move_loop');
    step(2); expect(weed.position.x).toBeGreaterThan(before);

    const records = manager.exportRecords();
    expect(records).toHaveLength(1);
    const reloaded = restoredManager.spawn(new THREE.Vector3(...records[0].transform.position), records[0]);
    expect(reloaded.entityId).toBe(records[0].id);
    expect(reloaded.position.x).toBeCloseTo(weed.position.x);

    const pickable = findActionEntity(model)!.components.pickable as unknown as { pick(doer: { giveItem(): boolean }): boolean };
    expect(pickable.pick({ giveItem: () => false })).toBe(true);
    expect(weed.isRemoved).toBe(true);
    expect(drops).toHaveLength(1); expect(drops[0].items).toEqual(['twigs', 'twigs', 'twigs']);
    expect(manager.exportRecords()).toEqual([]);
    const fx = manager.renderEntities.filter(({ object }) => object.name === 'tumbleweedbreakfx');
    expect(fx).toHaveLength(1);
    expect(lookupPrefabInstance(fx[0].object)!.hasTag('FX')).toBe(true);
    expect(lookupPrefabInstance(fx[0].object)!.persists).toBe(false);
    expect(fx[0].object.position.x).toBeCloseTo(weed.position.x);
    await settle();
    step(2);
    expect(manager.renderEntities).toHaveLength(0);
    expect(scene.children).toEqual([]);

    state.ground = false;
    const sunk = manager.spawn(new THREE.Vector3(0, 0, 0));
    step(2);
    expect(sunk.isRemoved).toBe(true);
    expect(manager.exportRecords()).toEqual([]);
  } finally { dispose(); restoredManager.dispose(); }
});

it('sleeps with its tile: stops rolling and releases the sprite, and wakes on the same entity in move_loop', async () => {
  const { scheduler, awake, manager, step, modelOf, artLoaded, dispose } = fixture();
  try {
    const weed = manager.spawn(new THREE.Vector3(10, 0, 4));
    const model = modelOf(weed), blowinwind = weed.blowinwind;
    await artLoaded(weed);
    step(1);
    weed.PushEvent('startlongaction'); // A cancelled restart must not fire while asleep.
    awake.set(false);
    await settle();
    expect(weed.status.peek()).toBe('asleep');
    expect(weed.sprite.loaded).toBe(false);
    expect(model.parent).toBeNull();
    expect(manager.renderEntities).toEqual([]);
    expect(blowinwind.isUpdating).toBe(false);
    const position = weed.position.clone();
    step(10);
    expect(weed.position.distanceTo(position)).toBeLessThan(.01);
    expect(weed.sprite.sprite.peek().clip.name).not.toBe('move_pre');
    expect(manager.exportRecords()).toHaveLength(1); // Asleep is not removed.
    awake.set(true);
    await settle();
    await artLoaded(weed);
    expect(weed.sprite.loaded).toBe(true);
    expect(lookupPrefabInstance(model)).toBe(weed);
    expect(weed.sprite.currentAnimation).toBe('move_loop');
    expect(blowinwind.isUpdating).toBe(true);
    expect(scheduler.now).toBeGreaterThan(10);
    step(2);
    expect(weed.position.distanceTo(position)).toBeGreaterThan(.1);
  } finally { dispose(); }
});
