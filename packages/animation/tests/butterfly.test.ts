import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ButterflyController, type ButterflyFlower, type ButterflyWorld } from '../../prefab/src/butterfly';

function setup(random = () => 0) {
  const model = new THREE.Group();
  const visual = new THREE.Group();
  visual.scale.set(0.02, -0.02, 0.02);
  model.add(visual);
  let complete: (() => void) | undefined;
  const animation = {
    start: vi.fn(), update: vi.fn(),
    playOnce: vi.fn((_name: string, callback?: () => void) => { complete = callback; }),
  };
  let threats: THREE.Vector3[] = [];
  let flowers: ButterflyFlower[] = [];
  let day = true;
  const world: ButterflyWorld = {
    isDay: () => day,
    getThreatPositions: () => threats,
    getFlowers: () => flowers,
  };
  const controller = new ButterflyController(model, animation, world, random);
  return {
    model, visual, animation, controller, world,
    setThreats: (value: THREE.Vector3[]) => { threats = value; },
    setFlowers: (value: ButterflyFlower[]) => { flowers = value; },
    setDay: (value: boolean) => { day = value; },
    complete: () => { const callback = complete; complete = undefined; callback?.(); },
    tick: (seconds: number) => { for (let i = 0; i < Math.round(seconds * 10); i++) controller.update(0.1); },
  };
}

describe('live butterfly source behavior', () => {
  it('enters idle flight on drop, then alternates wandering with hovering', () => {
    const s = setup();
    expect(s.animation.start).toHaveBeenLastCalledWith('idle_flight_loop');
    s.tick(0.9);
    expect(s.model.position.toArray()).toEqual([0, 0, 0]);
    s.tick(0.4);
    expect(s.model.position.x).toBeGreaterThan(0);
    expect(s.animation.start).toHaveBeenLastCalledWith('flight_cycle');
    s.tick(2);
    expect(s.controller.state).toBe('idle');
    const position = s.model.position.clone();
    s.tick(0.5);
    expect(s.model.position.equals(position)).toBe(true);
  });

  it('flees at 5 units, continues until 10 units and mirrors in camera space', () => {
    const s = setup();
    s.setThreats([new THREE.Vector3(1, 100, 0)]);
    s.controller.update(0.1);
    expect(s.model.position.x).toBeCloseTo(-0.4);
    expect(s.visual.scale.x).toBe(-0.02);
    s.tick(1.5);
    expect(s.model.position.x).toBeLessThan(-5);
    s.tick(0.9);
    expect(s.model.position.x).toBeLessThanOrEqual(-9);
    expect(s.controller.state).toBe('idle');
    const position = s.model.position.clone();
    s.tick(0.5);
    expect(s.model.position.equals(position)).toBe(true);
    s.model.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    s.setThreats([s.model.position.clone().add(new THREE.Vector3(1, 0, 0))]);
    s.controller.update(0.1);
    expect(s.visual.scale.x).toBe(0.02);
  });

  it('escapes coincident drops, respects map edges, and ignores faraway threats', () => {
    const s = setup();
    s.setThreats([new THREE.Vector3()]);
    s.controller.update(0.1);
    expect(s.model.position.x).toBeGreaterThan(0);
    s.world.constrainPosition = (point) => { point.x = Math.min(point.x, 1); };
    s.tick(3);
    expect(s.model.position.x).toBe(1);
    const far = setup();
    far.setThreats([new THREE.Vector3(6, 0, 0)]);
    far.tick(0.5);
    expect(far.controller.state).toBe('idle');
  });

  it('lands, pollinates for 2–4 seconds, takes off and avoids revisiting the same flower', () => {
    const s = setup();
    s.setFlowers([{ id: 'flower1', position: new THREE.Vector3(0.2, 0, 0) }]);
    s.controller.update(0.1);
    expect(s.controller.state).toBe('land');
    expect(s.animation.playOnce).toHaveBeenLastCalledWith('land', expect.any(Function));
    const landed = s.model.position.clone();
    s.setThreats([new THREE.Vector3()]);
    s.tick(0.5);
    expect(s.model.position.equals(landed)).toBe(true);
    s.setThreats([]);
    s.complete();
    expect(s.controller.state).toBe('pollinate');
    expect(s.animation.start).toHaveBeenLastCalledWith('idle');
    s.tick(1.9);
    expect(s.controller.state).toBe('pollinate');
    s.tick(0.2);
    expect(s.controller.state).toBe('takeoff');
    expect(s.animation.playOnce).toHaveBeenLastCalledWith('take_off', expect.any(Function));
    s.complete();
    s.controller.update(0.1);
    expect(s.controller.state).toBe('idle');
    expect(s.controller.targetFlowerId).toBeUndefined();
    s.tick(6);
    expect(s.controller.state).not.toBe('land');
  });

  it('returns to a flower outside daytime and removes itself only after landing', () => {
    const s = setup();
    s.setDay(false);
    s.setFlowers([{ id: 'home', position: new THREE.Vector3(2, 0, 0) }]);
    s.tick(1);
    expect(s.controller.state).toBe('land');
    expect(s.controller.removed).toBe(false);
    s.complete();
    expect(s.controller.removed).toBe(true);
    const position = s.model.position.clone();
    s.tick(1);
    expect(s.model.position.equals(position)).toBe(true);
  });

  it('goes home after more than 5 different flowers, even during daytime', () => {
    const s = setup();
    for (let index = 0; index < 6; index++) {
      s.setFlowers([{ id: `flower${index}`, position: s.model.position.clone() }]);
      s.controller.update(0.1);
      expect(s.controller.state).toBe('land');
      s.complete();
      expect(s.controller.state).toBe('pollinate');
      s.tick(2.1);
      s.complete();
    }
    s.controller.update(0.1);
    expect(s.controller.state).toBe('land');
    s.complete();
    expect(s.controller.removed).toBe(true);
  });

  it('wanders without flowers at night and ignores missing, distant or occupied flowers', () => {
    const s = setup();
    s.setDay(false);
    s.tick(2);
    expect(s.controller.removed).toBe(false);
    expect(s.model.position.x).toBeGreaterThan(0);
    s.setDay(true);
    s.setFlowers([{ id: 'far', position: new THREE.Vector3(100, 0, 0) }]);
    s.controller.update(0.1);
    expect(s.controller.targetFlowerId).toBeUndefined();
    s.setFlowers([{ id: 'occupied', position: s.model.position.clone() }]);
    s.world.isFlowerOccupied = () => true;
    s.controller.update(0.1);
    expect(s.controller.targetFlowerId).toBeUndefined();
    s.world.isFlowerOccupied = () => false;
    s.setFlowers([{ id: 'gone', position: s.model.position.clone().add(new THREE.Vector3(10, 0, 0)) }]);
    s.controller.update(0.1);
    expect(s.controller.targetFlowerId).toBe('gone');
    s.setFlowers([]);
    s.controller.update(0.1);
    expect(s.controller.targetFlowerId).toBeUndefined();
  });
});
