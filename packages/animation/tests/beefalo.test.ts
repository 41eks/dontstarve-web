import { readFile } from 'node:fs/promises';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BEEFALO_BEHAVIOR, BeefaloController, BeefaloManager, type BeefaloWorld, type BeefaloManagerWorld } from '../../prefab/src/beefalo';
import { createSignal } from '@dontstarve-web/signals';
import { createBeefaloSpriteFactory, type FacingSpriteAnimationController } from '../src/beefaloSprite';
import { setSpriteEntityRenderOrder } from '../src/renderOrder';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(random = () => 0) {
  const model = new THREE.Group();
  const body = new CANNON.Body({ mass: 100 });
  let complete: (() => void) | undefined;
  const animation = { start: vi.fn(), update: vi.fn(), setFacing: vi.fn(), playTransient: vi.fn(),
    playOnce: vi.fn((_clip: string, callback?: () => void) => { complete = callback; }) };
  let players: THREE.Vector3[] = [];
  const world: BeefaloWorld = { phase: 'day', season: 'spring',
    getPlayerPositions: () => players, findPath: vi.fn((_start, target) => [target]),
    constrainPosition: vi.fn(), spawnPoop: vi.fn() };
  const controller = new BeefaloController(model, body, animation, world, undefined, random);
  return { controller, model, body, animation, world,
    setPlayers: (value: THREE.Vector3[]) => { players = value; },
    setNight: (value: boolean) => { world.phase = value ? 'night' : 'day'; },
    complete: () => { const callback = complete; complete = undefined; callback?.(); },
    tick: (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 10); i++) {
        controller.update(0.1);
        body.position.x += body.velocity.x * 0.1;
        body.position.z += body.velocity.z * 0.1;
        controller.sync(new THREE.Quaternion());
      }
    },
  };
}

describe('wild beefalo behavior', () => {
  it('walks using physics velocity and source pre/loop/post clips, then rests', () => {
    const s = setup();
    s.tick(1.1);
    expect(s.controller.state).toBe('walk_pre');
    expect(s.body.velocity.x).toBe(0);
    s.complete();
    s.tick(1);
    expect(s.model.position.x).toBeCloseTo(BEEFALO_BEHAVIOR.walkSpeed);
    expect(s.animation.start).toHaveBeenLastCalledWith('walk_loop');
    s.tick(1.2);
    expect(s.controller.state).toBe('walk_pst');
    expect(s.body.velocity.x).toBe(0);
    s.complete();
    expect(s.animation.start).toHaveBeenLastCalledWith('idle_loop');
  });

  it('interrupts movement to sleep at night and wakes at dawn; stale callbacks cannot restart walking', () => {
    const s = setup();
    s.tick(1.1);
    const stale = s.animation.playOnce.mock.calls.at(-1)?.[1];
    s.setNight(true); s.tick(0.1); stale?.();
    expect(s.controller.state).toBe('sleep_pre');
    expect(s.body.velocity.x).toBe(0);
    s.complete();
    expect(s.animation.start).toHaveBeenLastCalledWith('sleep_loop');
    s.setNight(false); s.tick(0.1);
    expect(s.animation.playOnce).toHaveBeenLastCalledWith('sleep_pst', expect.any(Function));
    s.complete();
    expect(s.controller.state).toBe('idle');
  });

  it('drops manure on the original 40–60 second schedule and restores the remaining timer', () => {
    const s = setup();
    s.setNight(true); s.tick(39.9);
    expect(s.world.spawnPoop).not.toHaveBeenCalled();
    s.tick(0.2);
    expect(s.world.spawnPoop).toHaveBeenCalledTimes(1);
    expect(vi.mocked(s.world.spawnPoop).mock.calls[0][0].toArray()).toEqual([-3, 0, 0]);
    const saved = s.controller.exportState();
    const restored = new BeefaloController(s.model, s.body, s.animation, s.world, saved, () => 0);
    expect(restored.exportState()).toEqual(saved);
    restored.dispose(); restored.update(0.1);
    expect(restored.exportState()).toEqual(saved);
  });

  it('uses six-direction art relative to camera heading while keeping the foot fixed', () => {
    const s = setup();
    s.controller.sync(new THREE.Quaternion());
    expect(s.animation.setFacing).toHaveBeenLastCalledWith(1, false);
    s.controller.sync(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    expect(s.animation.setFacing).toHaveBeenLastCalledWith(4, true);
    s.setPlayers([new THREE.Vector3(1, 0, -10)]); s.tick(0.1);
    expect(s.animation.setFacing).toHaveBeenLastCalledWith(16, false);
    expect(s.model.position.y).toBe(0);
  });
});

function serveAssets() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const file = await readFile(new URL(`../../../public/dst/data/anim/${url.split('/').at(-1)}`, import.meta.url));
    return new Response(file);
  }));
}

describe('original beefalo assets', () => {
  it('initializes and subscribes to world signals, shares updates with later spawns, and releases subscriptions', async () => {
    serveAssets();
    const clock = createSignal<{ phase: BeefaloWorld['phase'] }>({ phase: 'night' });
    const season = createSignal<{ season: BeefaloWorld['season'] }>({ season: 'winter' });
    const clockPeek = vi.spyOn(clock, 'peek'), seasonPeek = vi.spyOn(season, 'peek');
    const stopClock = vi.fn(), stopSeason = vi.fn();
    const subscribeClock = clock.subscribe, subscribeSeason = season.subscribe;
    vi.spyOn(clock, 'subscribe').mockImplementation((listener) => {
      const stop = subscribeClock(listener);
      return () => { stop(); stopClock(); };
    });
    vi.spyOn(season, 'subscribe').mockImplementation((listener) => {
      const stop = subscribeSeason(listener);
      return () => { stop(); stopSeason(); };
    });
    const physics = new CANNON.World();
    const manager = new BeefaloManager(new THREE.Scene(), physics, '/dst/data/anim', {
      clock, season, getPlayerPositions: () => [], findPath: (_start, target) => [target],
      constrainPosition() {}, spawnPoop() {},
    });
    try {
      const model = await manager.spawn(new THREE.Vector3(10, 0, 20));
      const controller = model.userData.beefaloController as BeefaloController;
      const world = (controller as any).world as BeefaloWorld;
      expect(world).toMatchObject({ phase: 'night', season: 'winter' });
      manager.update(0.1);
      expect(controller.state).toBe('sleep_pre');
      const records = manager.exportRecords();
      clock.set({ phase: 'dusk' });
      season.set({ season: 'spring' });
      expect(world).toMatchObject({ phase: 'dusk', season: 'spring' });
      expect(manager.exportRecords()).toEqual(records);
      manager.update(0.1);
      expect(controller.state).toBe('sleep_pst');
      const later = await manager.spawn(new THREE.Vector3(30, 0, 40));
      expect((later.userData.beefaloController as any).world).toBe(world);
      expect(clockPeek).toHaveBeenCalledOnce();
      expect(seasonPeek).toHaveBeenCalledOnce();
      manager.dispose(); manager.dispose();
      clock.set({ phase: 'day' });
      season.set({ season: 'summer' });
      expect(world).toMatchObject({ phase: 'dusk', season: 'spring' });
      expect(stopClock).toHaveBeenCalledOnce();
      expect(stopSeason).toHaveBeenCalledOnce();
      expect(physics.bodies).toHaveLength(0);
      expect(manager.exportRecords()).toEqual([]);
    } finally { manager.dispose(); }
  });

  it('shares the two build atlases, merges frames, hides HEAT, and preserves one-shot completion across facing changes', async () => {
    serveAssets();
    const factory = await createBeefaloSpriteFactory('/dst/data/anim');
    const a = factory.create({ initialAnimation: 'idle_loop' });
    const b = factory.create({ initialAnimation: 'idle_loop' });
    expect(a.children[0].children).toHaveLength(1);
    setSpriteEntityRenderOrder(a, 7);
    expect(a.children[0].renderOrder).toBe(7);
    const mesh = a.children[0].children[0] as THREE.Mesh;
    expect(mesh.material).toEqual((b.children[0].children[0] as THREE.Mesh).material);
    for (const material of mesh.material as THREE.MeshBasicMaterial[]) expect(material.forceSinglePass).toBe(true);
    const controller = a.userData.animationController as FacingSpriteAnimationController;
    const complete = vi.fn();
    controller.playOnce('sleep_pre', complete);
    for (let i = 0; i < 6; i++) controller.update(0.1);
    controller.setFacing(32, true);
    for (let i = 0; i < 6; i++) controller.update(0.1);
    expect(complete).toHaveBeenCalledTimes(1);
    for (const clip of ['walk_pre', 'walk_loop', 'walk_pst', 'graze2_pre', 'graze2_loop', 'graze2_pst',
      'sleep_loop', 'sleep_pst', 'shake', 'bellow']) {
      controller.start(clip);
      for (const facing of [1, 4, 16, 32, 64, 128]) { controller.setFacing(facing); controller.update(0.1); }
      expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
    }
    factory.dispose();
  });

  it('keeps walking over the physical ground rather than losing velocity to static friction', async () => {
    serveAssets();
    const scene = new THREE.Scene();
    const physics = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    const floor = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: new CANNON.Material('ground') });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    physics.addBody(floor);
    const world: BeefaloManagerWorld = {
      clock: createSignal({ phase: 'day' }), season: createSignal({ season: 'spring' }), getPlayerPositions: () => [],
      findPath: (_start, target) => [target], constrainPosition() {}, spawnPoop() {} };
    const manager = new BeefaloManager(scene, physics, '/dst/data/anim', world);
    const model = await manager.spawn(new THREE.Vector3());
    const controller = model.userData.beefaloController as BeefaloController;
    // Use the actual locomotor and animated sprite over a deterministic two-second walk.
    (controller as any).random = () => 0;
    (controller as any).wanderRemaining = 1;
    (controller as any).idleRemaining = 1;
    for (let i = 0; i < 240; i++) {
      manager.update(1 / 60);
      physics.step(1 / 60);
      manager.sync(new THREE.Quaternion());
    }
    expect(model.position.x).toBeGreaterThan(4);
    manager.dispose();
  });
});
