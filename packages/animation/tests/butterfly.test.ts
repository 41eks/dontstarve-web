import * as THREE from 'three';
import { ItemEntity } from '../../inventory/src';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BUTTERFLY_DEFINITIONS, ButterflyController, createButterflyGroundFactory,
  type ButterflyFlower, type ButterflyWorld,
} from '../../prefab/src/butterfly';

import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { bindTestWorld } from './worldContentFixture';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(stop => stop()); });

function setup(prefab: 'butterfly' | 'moonbutterfly' = 'butterfly', dropLoot = vi.fn()) {
  let complete: (() => void) | undefined;
  let current = 'idle_flight_loop';
  const animation = {
    start: vi.fn((name: string) => { current = name; }), update: vi.fn(),
    playOnce: vi.fn((name: string, callback?: () => void) => { current = name; complete = callback; }),
    get currentAnimation() { return current; },
    get currentAnimationLength() { return 1; },
  };
  let threats: THREE.Vector3[] = [];
  let flowers: ButterflyFlower[] = [];
  const scheduler = new GameTimeScheduler();
  const { cycle, getWatchWorldContent, unbind } = bindTestWorld(scheduler);
  const world: ButterflyWorld = {
    getWatchWorldContent,
    getThreatPositions: () => threats,
    getFlowers: () => flowers,
  };
  const entity = new ItemEntity({ itemId: prefab, count: 1 });
  const controller = new ButterflyController(BUTTERFLY_DEFINITIONS[prefab], entity.transform, animation, world, () => [], () => 0, dropLoot);
  cleanups.push(() => { controller.dispose(); unbind(); scheduler.dispose(); });
  return {
    cycle, animation, controller, world, entity,
    position: () => entity.transform.position.clone(),
    setThreats: (value: THREE.Vector3[]) => { threats = value; },
    setFlowers: (value: ButterflyFlower[]) => { flowers = value; },
    setDay: (value: boolean) => { cycle.set(value ? 'day' : 'dusk'); },
    complete: () => { const callback = complete; complete = undefined; callback?.(); },
    tick: (seconds: number) => { for (let i = 0; i < Math.round(seconds * 10); i++) controller.update(0.1); },
  };
}

describe('live butterfly source behavior', () => {
  it('stays in idle flight until its brain wakes, then wanders and holds still again', () => {
    const s = setup();
    expect(s.animation.start).toHaveBeenLastCalledWith('idle_flight_loop');
    expect(s.controller.state).toBe('idle');
    // PriorityNode scatter (1.5s) and Wander's first 1s wait come before the first step.
    s.tick(2.4);
    expect(s.position().toArray()).toEqual([0, 0, 0]);
    // The idle state hands over to `moving` only after its animation timeout; Wander walks for minwalktime = 2s.
    s.tick(2.6);
    expect(s.position().x).toBeGreaterThan(5);
    expect(s.animation.start).toHaveBeenCalledWith('flight_cycle');
    expect(s.controller.state).toBe('idle');
    const position = s.position().clone();
    s.tick(.5);
    expect(s.position().equals(position)).toBe(true);
  });

  it('runs away from scarytoprey inside 5 units until 10 units away', () => {
    const s = setup();
    s.setThreats([new THREE.Vector3(1, 100, 0)]);
    s.tick(5);
    // RunAway keeps the walking butterfly moving until it is farther than STOP_RUN_AWAY_DIST, then stops.
    expect(s.position().x).toBeLessThan(-9);
    expect(Math.abs(s.position().x - 1)).toBeGreaterThanOrEqual(10);
    expect(s.controller.state).toBe('idle');
    const position = s.position().clone();
    s.tick(.5);
    expect(s.position().equals(position)).toBe(true);
  });

  it('lands, pollinates once, takes off and does not revisit the flower', () => {
    const s = setup();
    s.setFlowers([{ id: 'flower1', position: new THREE.Vector3(3, 0, 0) }]);
    s.tick(5);
    expect(s.controller.state).toBe('land');
    expect(s.animation.playOnce).toHaveBeenLastCalledWith('land', expect.any(Function));
    // arrive_dist = ARRIVE_STEP + physics radii of the flower (0) and the butterfly (0.5)... measured to the flower's centre.
    expect(s.position().distanceTo(new THREE.Vector3(3, 0, 0))).toBeLessThan(.7);
    expect(s.controller.hasTag('flying')).toBe(false);
    const landed = s.position().clone();
    s.tick(.5);
    expect(s.position().equals(landed)).toBe(true);
    s.complete();
    expect(s.controller.state).toBe('pollinate');
    expect(s.controller.components.pollinator!.flowers).toHaveLength(1);
    // GetRandomWithVariance(3, 1) with random 0 is 2 seconds.
    s.tick(1.9);
    expect(s.controller.state).toBe('pollinate');
    s.tick(.2);
    expect(s.controller.state).toBe('takeoff');
    expect(s.animation.playOnce).toHaveBeenLastCalledWith('take_off', expect.any(Function));
    s.complete();
    expect(s.controller.state).toBe('idle');
    expect(s.controller.hasTag('flying')).toBe(true);
    s.tick(8);
    expect(s.controller.state).not.toBe('land');
    expect(s.controller.components.pollinator!.flowers).toHaveLength(1);
  });

  it('goes home to a flower at dusk and is removed only after landing', () => {
    const s = setup();
    s.setDay(false);
    s.setFlowers([{ id: 'home', position: new THREE.Vector3(3, 0, 0) }]);
    s.tick(5);
    expect(s.controller.state).toBe('land');
    expect(s.controller.removed).toBe(false);
    s.complete();
    expect(s.controller.removed).toBe(true);
    const position = s.position().clone();
    s.tick(1);
    expect(s.position().equals(position)).toBe(true);
  });
});

describe('moonbutterfly', () => {
  it('ignores flowers, walks at MOONBUTTERFLY_SPEED and is leashed to its home', () => {
    const s = setup('moonbutterfly');
    s.setFlowers([{ id: 'flower', position: new THREE.Vector3(2, 0, 0) }]);
    expect(s.controller.components.pollinator).toBeUndefined();
    expect(s.controller.components.locomotor!.walkspeed).toBe(2.5);
    expect(s.controller.components.knownlocations!.GetLocation('home')).toEqual({ x: 0, y: 0, z: 0 });
    s.tick(10);
    expect(s.controller.state).not.toBe('land');
    // Carried 30 units from home (beyond MAX_WANDER_DIST 20): Wander heads back.
    s.entity.transform.position.set(30, 0, 0);
    s.tick(8);
    expect(s.position().x).toBeLessThan(30);
  });

  it('drops moonbutterflywings when it dies', () => {
    const dropLoot = vi.fn();
    const s = setup('moonbutterfly', dropLoot);
    s.controller.PushEvent('death');
    expect(s.controller.state).toBe('death');
    expect(s.animation.playOnce).toHaveBeenLastCalledWith('death', expect.any(Function));
    expect(dropLoot).toHaveBeenCalledWith(['moonbutterflywings'], expect.any(THREE.Vector3));
  });
});

it('registers both butterflies in the shared ground factory', () => {
  const factory = createButterflyGroundFactory({ animationBaseUrl: '/dst/data/anim' } as never);
  expect(factory.itemIds).toEqual(['butterfly', 'moonbutterfly']);
  factory.dispose?.();
});
