import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSignal, getWatchWorldContent, type WorldContentEnvironment } from '../../signals/src';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { BlowInWind } from '../../componets/src/blowinwind';
import { WorldWind } from '../../componets/src/worldwind';
import { TumbleweedManager, rollTumbleweedLoot, type TumbleweedWorld } from '../../prefab/src/tumbleweed';
import { getPickActions } from '../../stategraphs/src/pick';

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

it('rolls with the wind, stops for a long action and restarts, is picked for loot and a break fx, and reloads by position', async () => {
  const scene = new THREE.Scene(), physics = new CANNON.World(), scheduler = new GameTimeScheduler();
  const heading = createSignal(45), drops: { items: readonly string[]; position: THREE.Vector3 }[] = [];
  let ground = true;
  const wind = new WorldWind(scheduler, () => 0);
  const sources: WorldContentEnvironment = {
    snowLevel: createSignal(0), scheduler, wind: wind.windchange, perishTick: createSignal({ time: 0, total: 0 }),
    temperature: createSignal(30), cycle: createSignal('day'), season: createSignal({ season: 'spring', progress: .5 }),
  };
  const world: TumbleweedWorld = { scheduler, wind,
    getWatchWorldContent: (key, register) => getWatchWorldContent(key, register, sources), cameraHeading: heading, random: () => .5,
    isOnValidGround: () => ground, constrainPosition: () => undefined,
    dropLoot: (items, position) => drops.push({ items, position }) };
  const manager = new TumbleweedManager(scene, physics, '/dst/data/anim', world);
  const restoredManager = new TumbleweedManager(new THREE.Scene(), new CANNON.World(), '/dst/data/anim', { ...world, wind: undefined, getWatchWorldContent: undefined });
  const quaternion = new THREE.Quaternion();
  const step = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 30); i++) {
      scheduler.advance(1 / 30); manager.beforePhysics(1 / 30); physics.step(1 / 30); manager.sync(quaternion);
    }
  };
  try {
    const model = await manager.spawn(new THREE.Vector3(10, 0, 4));
    const tumbleweed = model.userData.tumbleweed;
    expect(model.userData.actionEntity.hasTag('pickable')).toBe(true);
    // Angle 0 ± 10 variance (random .5 → none) rolls toward +x.
    step(3);
    expect(model.position.x).toBeGreaterThan(12); expect(Math.abs(model.position.z - 4)).toBeLessThan(.01);
    expect(manager.renderEntities).toHaveLength(1);
    const target = getPickActions(scene).find(candidate => candidate.model === model)!;
    expect(target.available).toBe(true);
    const before = model.position.x;

    model.dispatchEvent({ type: 'startlongaction' } as never);
    expect(tumbleweed.sprite.currentAnimation).toBe('move_pst');
    step(1); expect(model.position.x).toBeCloseTo(before, 1);
    expect(tumbleweed.sprite.currentAnimation).toBe('idle');
    step(3.1); // random 2 + floor(.5 * 5) = 4 seconds in total
    expect(tumbleweed.sprite.currentAnimation).toBe('move_pre');
    step(2); expect(tumbleweed.sprite.currentAnimation).toBe('move_loop');
    step(2); expect(model.position.x).toBeGreaterThan(before);

    const records = manager.exportRecords();
    expect(records).toHaveLength(1);
    const reloaded = await restoredManager.spawn(new THREE.Vector3(...records[0].transform.position), records[0]);
    expect(reloaded.userData.entityId).toBe(records[0].id);
    expect(reloaded.position.x).toBeCloseTo(model.position.x);

    expect((target.action.target as any).component.pick({})).toBe(true);
    expect(drops).toHaveLength(1); expect(drops[0].items).toEqual(['twigs', 'twigs', 'twigs']);
    expect(manager.exportRecords()).toEqual([]);
    expect(scene.children.some(child => child.userData.tumbleweed)).toBe(false);
    expect(manager.renderEntities).toHaveLength(1); // the break fx
    step(2); expect(manager.renderEntities).toHaveLength(0);

    ground = false;
    await manager.spawn(new THREE.Vector3(0, 0, 0));
    step(2); expect(manager.exportRecords()).toEqual([]);
  } finally { manager.dispose(); restoredManager.dispose(); wind.dispose(); }
});
