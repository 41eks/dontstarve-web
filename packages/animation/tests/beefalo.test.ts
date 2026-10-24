import { readFile } from 'node:fs/promises';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BEEFALO_BEHAVIOR, BeefaloController, BeefaloManager, type BeefaloWorld, type BeefaloManagerWorld } from '../../prefab/src/beefalo';
import { createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { createBeefaloSpriteFactory, type FacingSpriteAnimationController } from '../src/beefaloSprite';
import { setSpriteEntityRenderOrder } from '../src/renderOrder';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const DAY = 480;

function setup(random = () => 0) {
  const model = new THREE.Group();
  const body = new CANNON.Body({ mass: 100 });
  let complete: (() => void) | undefined;
  const animation = { start: vi.fn(), update: vi.fn(), setFacing: vi.fn(), setShaved: vi.fn(), playTransient: vi.fn(),
    playOnce: vi.fn((_clip: string, callback?: () => void) => { complete = callback; }) };
  let players: THREE.Vector3[] = [];
  const scheduler = new GameTimeScheduler();
  const world: BeefaloWorld = { phase: 'day', season: 'spring', scheduler,
    secondsUntilNextDay: now => DAY - now % DAY,
    spawnPrize: vi.fn(),
    getPlayerPositions: () => players, findPath: vi.fn((_start, target) => [target]),
    constrainPosition: vi.fn(), spawnPoop: vi.fn() };
  const controller = new BeefaloController(model, body, animation, world, undefined, random);
  return { controller, model, body, animation, world,
    setPlayers: (value: THREE.Vector3[]) => { players = value; },
    setNight: (value: boolean) => { world.phase = value ? 'night' : 'day'; },
    /** Advance game time to the next day boundary, running every task due on the way. */
    endDay: () => { scheduler.advance(world.secondsUntilNextDay(scheduler.now)); },
    scheduler,
    complete: () => { const callback = complete; complete = undefined; callback?.(); },
    tick: (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 10); i++) {
        scheduler.advance(0.1);
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
    // sleeper.lua tests every 4 ± .5 seconds; with random() = 0 the tests run at 3.5 and 7.0 seconds.
    s.setNight(true); s.tick(7.1); stale?.();
    expect(s.controller.state).toBe('sleep_pre');
    expect(s.controller.sleeper.IsAsleep()).toBe(true);
    expect(s.body.velocity.x).toBe(0);
    s.complete();
    expect(s.animation.start).toHaveBeenLastCalledWith('sleep_loop');
    s.setNight(false); s.tick(3);
    expect(s.controller.sleeper.IsAsleep()).toBe(false);
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

  it('shaves only a sleeping beefalo: wool drops, the shaved build is applied, and it keeps sleeping', async () => {
    const s = setup();
    s.setNight(true); s.tick(7.1);
    expect(s.controller.sleeper.IsAsleep()).toBe(true);
    s.complete();
    expect(s.controller.beard.bits.peek()).toBe(3);
    expect(s.controller.beard.Shave(undefined)).toEqual({ ok: true });
    expect(s.world.spawnPrize).toHaveBeenCalledExactlyOnceWith('beefalowool', 3, expect.objectContaining({ x: 0, z: 0 }));
    expect(s.controller.state).toBe('shaved');
    await Promise.resolve();
    expect(s.animation.setShaved).toHaveBeenLastCalledWith(true);
    expect(s.animation.playOnce).toHaveBeenLastCalledWith('shave', expect.any(Function));
    expect(s.model.userData.actionEntity.hasTag('has_beard')).toBe(false);
    expect(s.model.userData.actionEntity.hasTag('bearded')).toBe(true);
    s.complete();
    expect(s.controller.state).toBe('sleep');
    expect(s.animation.start).toHaveBeenLastCalledWith('sleep_loop');
    expect(s.controller.beard.ShouldTryToShave(undefined)).toEqual({ ok: false, reason: 'NOBITS' });
  });

  it('refuses to shave an awake beefalo and leaves the beard untouched', async () => {
    const s = setup();
    expect(s.controller.beard.Shave(undefined)).toEqual({ ok: false, reason: 'AWAKEBEEFALO' });
    expect(s.controller.beard.bits.peek()).toBe(3);
    expect(s.world.spawnPrize).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(s.animation.setShaved).not.toHaveBeenLastCalledWith(true);
  });

  it('regrows hair on the third day, entering hair_growth when it next idles, and persists the beard', async () => {
    const s = setup();
    s.setNight(true); s.tick(7.1); s.complete();
    s.controller.beard.Shave(undefined); s.complete();
    const shavedState = s.controller.exportState();
    expect(shavedState.beard).toMatchObject({ growth: 0, bits: 0 });
    const restored = new BeefaloController(new THREE.Group(), new CANNON.Body({ mass: 100 }), s.animation, s.world, shavedState, () => 0);
    await Promise.resolve();
    expect(s.animation.setShaved).toHaveBeenLastCalledWith(true);
    expect(restored.model.userData.actionEntity.hasTag('has_beard')).toBe(false);
    restored.dispose();
    s.endDay(); s.endDay();
    expect(s.controller.beard.bits.peek()).toBe(0);
    s.endDay();
    s.setNight(false); s.tick(4); s.complete();
    expect(s.controller.state).toBe('hair_growth');
    expect(s.animation.playOnce).toHaveBeenLastCalledWith('hair_growth_pre', expect.any(Function));
    s.complete();
    expect(s.controller.state).toBe('hair_growth_pop');
    expect(s.controller.beard.bits.peek()).toBe(3);
    await Promise.resolve();
    expect(s.animation.setShaved).toHaveBeenLastCalledWith(false);
    expect(s.model.userData.actionEntity.hasTag('has_beard')).toBe(true);
    s.complete();
    expect(s.controller.state).toBe('idle');
  });

  it('arms one day-boundary timer, stays quiet while waiting, and catches up one day at a time', async () => {
    const s = setup();
    const beard = s.controller.beard;
    expect(beard.dayTimerState.peek()).toEqual({ status: 'scheduled', endTime: DAY });
    s.setNight(true); s.tick(7.1); s.complete();
    beard.Shave(undefined); s.complete();
    s.scheduler.advance(DAY - 8.5);
    expect(beard.daysgrowth.peek()).toBe(0);
    expect(beard.dayTimerState.peek()).toEqual({ status: 'scheduled', endTime: DAY });
    // One long jump crosses three boundaries; the day-3 callback runs exactly once, on the third.
    s.scheduler.advance(3 * DAY);
    expect(beard.daysgrowth.peek()).toBe(3);
    expect(s.controller.hairGrowthPending.peek()).toBe(true);
    expect(beard.dayTimerState.peek()).toEqual({ status: 'scheduled', endTime: 4 * DAY });
    await Promise.resolve();
  });

  it('stops its day timer, hairy memo and appearance effect on dispose', async () => {
    const s = setup();
    s.setNight(true); s.tick(7.1); s.complete();
    s.controller.beard.Shave(undefined); s.complete();
    await Promise.resolve();
    s.controller.dispose();
    const calls = s.animation.setShaved.mock.calls.length;
    s.endDay(); s.endDay(); s.endDay();
    expect(s.controller.beard.dayTimerState.peek()).toEqual({ status: 'stopped' });
    s.controller.beard.SetBits(3);
    await Promise.resolve();
    expect(s.controller.beard.daysgrowth.peek()).toBe(0);
    expect(s.animation.setShaved.mock.calls).toHaveLength(calls);
    expect(s.controller.hairGrowthPending.peek()).toBe(false);
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
    const clock = createSignal<{ phase: BeefaloWorld['phase']; cycles?: number }>({ phase: 'night' });
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
      constrainPosition() {}, spawnPoop() {}, spawnPrize() {}, secondsUntilNextDay: now => DAY - now % DAY,
    });
    try {
      const model = await manager.spawn(new THREE.Vector3(10, 0, 20));
      const controller = model.userData.beefaloController as BeefaloController;
      const world = (controller as any).world as BeefaloWorld;
      expect(world).toMatchObject({ phase: 'night', season: 'winter' });
      for (let i = 0; i < 60 && controller.state !== 'sleep_pre'; i++) manager.update(0.1);
      expect(controller.state).toBe('sleep_pre');
      const records = manager.exportRecords();
      clock.set({ phase: 'dusk' });
      season.set({ season: 'spring' });
      expect(world).toMatchObject({ phase: 'dusk', season: 'spring' });
      expect(manager.exportRecords()).toEqual(records);
      for (let i = 0; i < 60 && controller.state !== 'sleep_pst'; i++) manager.update(0.1);
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
      findPath: (_start, target) => [target], constrainPosition() {}, spawnPoop() {}, spawnPrize() {},
      secondsUntilNextDay: now => DAY - now % DAY };
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
