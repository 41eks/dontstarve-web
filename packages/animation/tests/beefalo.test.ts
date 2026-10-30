
import { findActionEntity } from '../../prefab/src/actionEntity';
import { createTestWorldSources } from './worldContentFixture';
import { readFile } from 'node:fs/promises';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BEEFALO_BEHAVIOR, BeefaloController, BeefaloManager, type BeefaloWorld, type BeefaloManagerWorld } from '../../prefab/src/beefalo';
import { createMemo, createSignal, getWatchWorldContent, type WorldPhase, type WorldContentEnvironment } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { BEEFALO_BUILD, BEEFALO_SHAVED_BUILD, createBeefaloSpriteFactory, type FacingSpriteController } from '../src/beefaloSprite';
import { COLLISION } from '../../componets/src/physicsState';
import { bindInstance, PrefabInstance } from '../../prefab/src/prefabInstance';
import { setSpriteEntityRenderOrder } from '../src/renderOrder';
import type { SpriteController } from '../src/sprite';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const DAY = 480;
/** Frame counts of the source beefalo clips at 30 fps, as the sprite factory reports them. */
const CLIP_FRAMES: Record<string, number> = { idle_loop: 72, graze_loop: 28, graze2_pre: 13, graze2_loop: 28, graze2_pst: 9, alert_pre: 3, alert_idle: 44, walk_pre: 12, walk_loop: 56, walk_pst: 9, sleep_pre: 34, sleep_loop: 72, sleep_pst: 33, shave: 37, hair_growth_pre: 23, hair_growth: 17, shake: 24, bellow: 51 };
const lengths = new Map(Object.entries(CLIP_FRAMES).map(([name, frames]) => [name, frames / 30]));

function setup(random = () => 0) {
  const physics = new CANNON.World();
  // The drawn sprite: it follows the logical AnimState, which owns the queue and the clip timing.
  const animation = { start: vi.fn(), playOnce: vi.fn(), update: vi.fn(), setFacing: vi.fn(), setBuildArchive: vi.fn(), setAwake: vi.fn() };
  const model = new THREE.Group();
  bindInstance(model, new PrefabInstance('beefalo', animation as never));
  let players: THREE.Vector3[] = [];
  let poop: Iterable<THREE.Vector3> = [];
  const scheduler = new GameTimeScheduler();
  const cycle = createSignal<WorldPhase>('day');
  const sources: WorldContentEnvironment = { ...createTestWorldSources(scheduler), playerpositions: createSignal<import('three').Vector3[]>([]), snowLevel: createSignal(0), wind: createSignal({ angle: 0, velocity: 1 }), perishTick: createSignal({ time: 0, total: 0 }), scheduler, temperature: createSignal(30), cycle, season: createSignal({ season: 'spring', progress: .5 }) };
  const world: BeefaloWorld = { phase: 'day', getWatchWorldContent: (key, register) => getWatchWorldContent(key, register, sources), season: 'spring', scheduler,
    secondsUntilNextDay: now => DAY - now % DAY,
    spawnPrize: vi.fn(),
    getPlayerPositions: () => players, findPath: vi.fn((_start, target) => [target]),
    constrainPosition: vi.fn(), getPoopPositions: () => poop, spawnPoop: vi.fn() };
  const controller = new BeefaloController(model, physics, lengths, world, undefined, random);
  const body = controller.body;
  const animstate = controller.animstate;
  return { controller, model, body, physics, animation, world, lengths,
    playAnimation: vi.spyOn(animstate, 'PlayAnimation'), pushAnimation: vi.spyOn(animstate, 'PushAnimation'),
    clip: () => animstate.animation.peek().name,
    setPlayers: (value: THREE.Vector3[]) => { players = value; },
    setPoop: (value: Iterable<THREE.Vector3>) => { poop = value; },
    setNight: (value: boolean) => { world.phase = value ? 'night' : 'day'; cycle.set(world.phase); },
    /** Advance game time to the next day boundary, running every task due on the way. */
    endDay: () => { scheduler.advance(world.secondsUntilNextDay(scheduler.now)); },
    scheduler,
    /** Game time reaches the end of the current clip. */
    complete: () => { const timer = animstate.timer.peek(); if (timer.status === 'scheduled') scheduler.advanceTo(timer.endTime); },
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
  it('times graze_empty from entry and begins the next idle timeout during the post animation', () => {
    const s = setup();
    s.controller.brain.Stop();
    const idleTimer = s.controller.sg.sg.timeoutSnapshot!.peek();
    s.scheduler.advanceTo(.9);
    expect(s.controller.sg.sg.timeoutSnapshot!.peek()).toBe(idleTimer);
    s.scheduler.advanceTo(1);
    expect(s.controller.state).toBe('graze_empty');
    expect(s.playAnimation).toHaveBeenLastCalledWith('graze2_pre', undefined);
    expect(s.pushAnimation).toHaveBeenLastCalledWith('graze2_loop', undefined);
    const grazeTimer = s.controller.sg.sg.timeoutSnapshot!.peek();
    // No animation completion yet: the timeout must still run during the pre animation.
    s.scheduler.advanceTo(1.9);
    expect(s.controller.sg.sg.timeoutSnapshot!.peek()).toBe(grazeTimer);
    s.scheduler.advanceTo(2);
    expect(s.controller.state).toBe('idle');
    expect(s.clip()).toBe('graze2_pst');
    expect(s.pushAnimation).toHaveBeenLastCalledWith('idle_loop', true);
    expect(s.controller.sg.sg.timeoutSnapshot!.peek()).toEqual({ status: 'scheduled', endTime: 3 });
    s.complete();
    expect(s.clip()).toBe('idle_loop');
    s.controller.dispose();
  });

  it('cancels grazing on sleep and does not replay a cancelled pre animation after returning to the same state', () => {
    const s = setup();
    s.controller.brain.Stop();
    s.scheduler.advanceTo(1);
    s.controller.sleeper.GoToSleep();
    expect(s.controller.state).toBe('sleep');
    expect(s.controller.sg.sg.timeoutSnapshot!.peek()).toEqual({ status: 'stopped' });
    // `nowake` keeps sleep_pre playing until animover, even if waking occurs during it.
    s.controller.sleeper.WakeUp();
    s.controller.brain.Stop();
    expect(s.controller.state).toBe('sleep');
    s.complete();
    expect(s.controller.state).toBe('wake');
    s.complete();
    s.scheduler.advance(1);
    expect(s.controller.state).toBe('graze_empty');
    expect(s.clip()).toBe('graze2_pre');
    const calls = s.playAnimation.mock.calls.length;
    s.controller.dispose();
    s.scheduler.advance(100);
    expect(s.playAnimation).toHaveBeenCalledTimes(calls);
  });

  it('uses FaceEntity alert states and keeps the target until the source keep distance is exceeded', () => {
    const s = setup();
    const player = new THREE.Vector3(10, 0, 0);
    s.setPlayers([player]); s.tick(1);
    expect(s.controller.state).toBe('actual_alert');
    expect(s.controller.sg.hasStateTag('idle')).toBe(true);
    expect(s.controller.sg.hasStateTag('alert')).toBe(true);
    // alert_pre is three frames long, so game time has already reached the queued alert_idle.
    expect(s.playAnimation).toHaveBeenCalledWith('alert_pre', undefined);
    expect(s.clip()).toBe('alert_idle');
    player.x = 15; s.tick(3);
    expect(s.controller.state).toBe('actual_alert');
    expect(s.body.velocity.x).toBe(0);
    player.x = 19; s.tick(2);
    // walk_pre has ended within those two seconds of game time.
    expect(s.controller.state).toBe('walk');
    expect(s.body.velocity.x).toBeGreaterThan(0);
    s.controller.dispose();
  });

  it('walks using physics velocity and source pre/loop/post clips, then rests', () => {
    const s = setup();
    s.tick(2.1);
    expect(s.controller.state).toBe('walk_start');
    expect(s.body.velocity.x).toBe(BEEFALO_BEHAVIOR.walkSpeed);
    const startX = s.model.position.x;
    s.tick(1);
    expect(s.model.position.x - startX).toBeCloseTo(BEEFALO_BEHAVIOR.walkSpeed);
    expect(s.clip()).toBe('walk_loop');
    s.tick(.4);
    expect(s.controller.state).toBe('walk_stop');
    expect(s.body.velocity.x).toBe(0);
    s.complete();
    expect(s.clip()).toBe('idle_loop');
  });

  it('interrupts movement to sleep at night and wakes at dawn; a cancelled walk clip cannot restart walking', async () => {
    const s = setup();
    s.tick(2.1);
    // The day/night effect reacts in a microtask without advancing game time.
    s.setNight(true); await new Promise(resolve => setTimeout(resolve, 0));
    expect(s.controller.state).toBe('sleep');
    expect(s.controller.sleeper.IsAsleep()).toBe(true);
    expect(s.body.velocity.x).toBe(0);
    s.complete();
    expect(s.clip()).toBe('sleep_loop');
    s.setNight(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(s.controller.sleeper.IsAsleep()).toBe(false);
    expect(s.clip()).toBe('sleep_pst');
    s.complete();
    expect(s.controller.state).toBe('idle');
  });

  it('drops manure on the source 40 + random * 60 schedule and restores and cancels the timer', () => {
    const s = setup();
    s.setNight(true); s.tick(39.9);
    expect(s.world.spawnPoop).not.toHaveBeenCalled();
    s.tick(0.2);
    expect(s.world.spawnPoop).toHaveBeenCalledTimes(1);
    expect(vi.mocked(s.world.spawnPoop).mock.calls[0][0].toArray()).toEqual([s.model.position.x - 3, 0, 0]);
    const saved = s.controller.exportState();
    const restoredScene = setup(); restoredScene.controller.dispose();
    bindInstance(restoredScene.model, new PrefabInstance('beefalo', restoredScene.animation as never));
    const restored = new BeefaloController(restoredScene.model, restoredScene.physics, restoredScene.lengths, s.world, saved, () => 0);
    expect(restored.exportState()).toEqual(saved);
    restored.dispose(); restored.update(0.1);
    expect(restored.periodicspawner.timerState.peek()).toEqual({ status: 'stopped' });
    const poopCalls = vi.mocked(s.world.spawnPoop).mock.calls.length;
    s.controller.dispose(); s.scheduler.advance(200);
    expect(s.world.spawnPoop).toHaveBeenCalledTimes(poopCalls);
    const late = setup(() => .999);
    expect(late.controller.periodicspawner.remainingSeconds).toBeCloseTo(99.94);
    late.controller.dispose();
  });

  it('checks periodicspawner spacing at the source origin before moving manure behind the beefalo', () => {
    const s = setup();
    // Exactly the source spacing is allowed, even though it is closer to the final rear position.
    s.setPoop([new THREE.Vector3(-BEEFALO_BEHAVIOR.poopSpacing, 0, 0)]);
    expect(s.controller.periodicspawner.TrySpawn().spawned).toBe(true);
    expect(s.world.spawnPoop).toHaveBeenCalledExactlyOnceWith(new THREE.Vector3(-3, 0, 0));
    s.setPoop([new THREE.Vector3(BEEFALO_BEHAVIOR.poopSpacing - .01, 0, 0)]);
    expect(s.controller.periodicspawner.TrySpawn().spawned).toBe(false);
    const closed = vi.fn();
    s.setPoop((function* () {
      try {
        yield new THREE.Vector3(BEEFALO_BEHAVIOR.poopDensityRadius, 0, 0);
        yield new THREE.Vector3(-BEEFALO_BEHAVIOR.poopDensityRadius, 0, 0);
        throw new Error('density failure must not consume the rest of the query');
      } finally { closed(); }
    })());
    expect(s.controller.periodicspawner.TrySpawn().spawned).toBe(false);
    expect(closed).toHaveBeenCalledOnce();
    expect(s.world.spawnPoop).toHaveBeenCalledTimes(1);
    s.controller.dispose();
  });

  it('shaves only a sleeping beefalo: wool drops, the shaved build is applied, and it keeps sleeping', async () => {
    const s = setup();
    s.setNight(true); s.tick(7.1);
    expect(s.controller.sleeper.IsAsleep()).toBe(true);
    s.complete();
    expect(s.controller.beard.bits.peek()).toBe(3);
    expect(s.controller.beard.Shave(undefined)).toEqual({ ok: true });
    expect(s.world.spawnPrize).toHaveBeenCalledExactlyOnceWith('beefalowool', 3, expect.objectContaining({ x: s.model.position.x, z: s.model.position.z }));
    expect(s.controller.state).toBe('shaved');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(s.animation.setBuildArchive).toHaveBeenLastCalledWith(BEEFALO_SHAVED_BUILD);
    expect(s.clip()).toBe('shave');
    expect(findActionEntity(s.model).hasTag('has_beard')).toBe(false);
    expect(findActionEntity(s.model).hasTag('bearded')).toBe(true);
    s.complete();
    expect(s.controller.state).toBe('sleeping');
    expect(s.clip()).toBe('sleep_loop');
    expect(s.controller.beard.ShouldTryToShave(undefined)).toEqual({ ok: false, reason: 'NOBITS' });
  });

  it('refuses to shave an awake beefalo and leaves the beard untouched', async () => {
    const s = setup();
    expect(s.controller.beard.Shave(undefined)).toEqual({ ok: false, reason: 'AWAKEBEEFALO' });
    expect(s.controller.beard.bits.peek()).toBe(3);
    expect(s.world.spawnPrize).not.toHaveBeenCalled();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(s.animation.setBuildArchive).not.toHaveBeenLastCalledWith(BEEFALO_SHAVED_BUILD);
  });

  it('regrows hair on the third day, entering hair_growth when it next idles, and persists the beard', async () => {
    const s = setup();
    s.setNight(true); s.tick(7.1); s.complete();
    s.controller.beard.Shave(undefined); s.complete();
    const shavedState = s.controller.exportState();
    expect(shavedState.beard).toMatchObject({ growth: 0, bits: 0 });
    const restoredScene = setup(); restoredScene.controller.dispose();
    bindInstance(restoredScene.model, new PrefabInstance('beefalo', restoredScene.animation as never));
    const restored = new BeefaloController(restoredScene.model, restoredScene.physics, restoredScene.lengths, s.world, shavedState, () => 0);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(restoredScene.animation.setBuildArchive).toHaveBeenLastCalledWith(BEEFALO_SHAVED_BUILD);
    expect(findActionEntity(restored.model).hasTag('has_beard')).toBe(false);
    restored.dispose();
    s.endDay(); s.endDay();
    expect(s.controller.beard.bits.peek()).toBe(0);
    s.endDay();
    s.setNight(false);
    for (let i = 0; i < 100 && s.controller.state !== 'hair_growth'; i++) s.tick(.1);
    expect(s.controller.state).toBe('hair_growth');
    expect(s.clip()).toBe('hair_growth_pre');
    s.complete();
    expect(s.controller.state).toBe('hair_growth_pop');
    expect(s.controller.beard.bits.peek()).toBe(3);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(s.animation.setBuildArchive).toHaveBeenLastCalledWith(BEEFALO_BUILD);
    expect(findActionEntity(s.model).hasTag('has_beard')).toBe(true);
    s.complete();
    expect(s.controller.state).toBe('idle');
  });

  it('arms one day-boundary timer, stays quiet while waiting, and catches up one day at a time', async () => {
    const s = setup();
    const beard = s.controller.beard;
    expect(beard.dayTimerState.peek()).toEqual({ status: 'scheduled', endTime: DAY });
    s.setNight(true); s.tick(7.1); s.complete();
    beard.Shave(undefined); s.complete();
    s.scheduler.advanceTo(DAY - .1);
    expect(beard.daysgrowth.peek()).toBe(0);
    expect(beard.dayTimerState.peek()).toEqual({ status: 'scheduled', endTime: DAY });
    // One long jump crosses three boundaries; the day-3 callback runs exactly once, on the third.
    s.scheduler.advance(3 * DAY);
    expect(beard.daysgrowth.peek()).toBe(3);
    expect(s.controller.hairGrowthPending.peek()).toBe(true);
    expect(beard.dayTimerState.peek()).toEqual({ status: 'scheduled', endTime: 4 * DAY });
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  it('stops its day timer, hairy memo and appearance effect on dispose', async () => {
    const s = setup();
    s.setNight(true); s.tick(7.1); s.complete();
    s.controller.beard.Shave(undefined); s.complete();
    await new Promise(resolve => setTimeout(resolve, 0));
    s.controller.dispose();
    const calls = s.animation.setBuildArchive.mock.calls.length;
    s.endDay(); s.endDay(); s.endDay();
    expect(s.controller.beard.dayTimerState.peek()).toEqual({ status: 'stopped' });
    s.controller.beard.SetBits(3);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(s.controller.beard.daysgrowth.peek()).toBe(0);
    expect(s.animation.setBuildArchive.mock.calls).toHaveLength(calls);
    expect(s.controller.hairGrowthPending.peek()).toBe(false);
  });

  it('uses six-direction art relative to camera heading while keeping the foot fixed', () => {
    const s = setup();
    s.controller.sync(new THREE.Quaternion());
    expect(s.animation.setFacing).toHaveBeenLastCalledWith(1, false);
    s.controller.sync(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    expect(s.animation.setFacing).toHaveBeenLastCalledWith(4, true);
    s.setPlayers([new THREE.Vector3(1, 0, -10)]); s.tick(1);
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
    const cycle = createMemo(() => clock.get().phase);
    const sources: WorldContentEnvironment = { ...createTestWorldSources(new GameTimeScheduler()), playerpositions: createSignal<import('three').Vector3[]>([]), snowLevel: createSignal(0), wind: createSignal({ angle: 0, velocity: 1 }), perishTick: createSignal({ time: 0, total: 0 }),  temperature: createSignal(30), cycle, season: createSignal({ season: 'winter', progress: .5 }) };
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
      scheduler: sources.scheduler, clock, getWatchWorldContent: (key, register) => getWatchWorldContent(key, register, sources), season, getPlayerPositions: () => [], findPath: (_start, target) => [target],
      constrainPosition() {}, getPoopPositions: () => [], spawnPoop() {}, spawnPrize() {}, secondsUntilNextDay: now => DAY - now % DAY,
    });
    try {
      const model = await manager.spawn(new THREE.Vector3(10, 0, 20));
      const controller = manager.controllerOf(model)!;
      const world = (controller as any).world as BeefaloWorld;
      expect(world).toMatchObject({ phase: 'night', season: 'winter' });
      for (let i = 0; i < 60 && controller.state !== 'sleep'; i++) {
        sources.scheduler.advance(.1); manager.update(.1);
      }
      expect(controller.state).toBe('sleep');
      const records = manager.exportRecords();
      clock.set({ phase: 'dusk' });
      season.set({ season: 'spring' });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(controller.sleeper.IsAsleep()).toBe(false);
      expect(world).toMatchObject({ phase: 'dusk', season: 'spring' });
      expect(manager.exportRecords()).toEqual(records);
      for (let i = 0; i < 60 && controller.state !== 'wake'; i++) {
        sources.scheduler.advance(.1); manager.update(.1);
      }
      expect(controller.state).toBe('wake');
      const later = await manager.spawn(new THREE.Vector3(30, 0, 40));
      expect((manager.controllerOf(later) as any).world).toBe(world);
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
    } finally { manager.dispose(); cycle.dispose(); sources.scheduler.dispose(); }
  });

  it('shares the two build atlases, merges frames, hides HEAT, and preserves one-shot completion across facing and build changes', async () => {
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
    const controller = a.userData.animationController as SpriteController & FacingSpriteController;
    const complete = vi.fn();
    controller.playOnce('sleep_pre', complete);
    for (let i = 0; i < 6; i++) controller.update(0.1);
    controller.setFacing(32, true);
    for (let i = 0; i < 6; i++) controller.update(0.1);
    expect(complete).toHaveBeenCalledTimes(1);
    for (const clip of ['walk_pre', 'walk_loop', 'walk_pst', 'graze2_pre', 'graze2_loop', 'graze2_pst',
      'graze_loop', 'alert_pre', 'alert_idle', 'sleep_loop', 'sleep_pst', 'shake', 'bellow']) {
      controller.start(clip);
      for (const facing of [1, 4, 16, 32, 64, 128]) { controller.setFacing(facing); controller.update(0.1); }
      expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
    }
    expect(factory.lengths.get('graze2_pre')).toBeGreaterThan(0);
    // AnimState:SetBuild swaps the whole build and keeps the clip.
    controller.setBuildArchive(BEEFALO_SHAVED_BUILD);
    controller.setBuildArchive(BEEFALO_BUILD);
    expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
    factory.dispose();
  });

  it('keeps walking over the physical ground rather than losing velocity to static friction', async () => {
    serveAssets();
    const scene = new THREE.Scene();
    const physics = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    const floor = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: new CANNON.Material('ground') });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    physics.addBody(floor);
    const sources: WorldContentEnvironment = { ...createTestWorldSources(new GameTimeScheduler()), playerpositions: createSignal<import('three').Vector3[]>([]), snowLevel: createSignal(0), wind: createSignal({ angle: 0, velocity: 1 }), perishTick: createSignal({ time: 0, total: 0 }),  temperature: createSignal(30), cycle: createSignal<WorldPhase>('day'), season: createSignal({ season: 'spring', progress: .5 }) };
    const world: BeefaloManagerWorld = {
      scheduler: sources.scheduler, clock: createSignal({ phase: 'day' }), getWatchWorldContent: (key, register) => getWatchWorldContent(key, register, sources), season: createSignal({ season: 'spring' }), getPlayerPositions: () => [],
      findPath: (_start, target) => [target], constrainPosition() {}, getPoopPositions: () => [], spawnPoop() {}, spawnPrize() {},
      secondsUntilNextDay: now => DAY - now % DAY };
    const manager = new BeefaloManager(scene, physics, '/dst/data/anim', world);
    const model = await manager.spawn(new THREE.Vector3());
    const controller = manager.controllerOf(model)!;
    // Use the actual brain, locomotor and animated sprite over a deterministic two-second walk.
    (controller as any).random = () => 0;
    controller.brain.Stop();
    controller.brain.Start();
    controller.sg.goToState('idle');
    for (let i = 0; i < 240; i++) {
      sources.scheduler.advance(1 / 60);
      manager.update(1 / 60);
      physics.step(1 / 60);
      manager.sync(1 / 60, new THREE.Quaternion());
    }
    expect(model.position.x).toBeGreaterThan(4);
    manager.dispose();
    sources.scheduler.dispose();
  });

  it('absorbs a running player collision with the Lua character damping instead of flying far', async () => {
    serveAssets();
    const physics = new CANNON.World();
    const sources: WorldContentEnvironment = { ...createTestWorldSources(new GameTimeScheduler()), playerpositions: createSignal<import('three').Vector3[]>([]), snowLevel: createSignal(0), wind: createSignal({ angle: 0, velocity: 1 }), perishTick: createSignal({ time: 0, total: 0 }),  temperature: createSignal(30), cycle: createSignal<WorldPhase>('day'), season: createSignal({ season: 'spring', progress: .5 }) };
    const world: BeefaloManagerWorld = {
      scheduler: sources.scheduler, clock: createSignal({ phase: 'day' }), getWatchWorldContent: (key, register) => getWatchWorldContent(key, register, sources), season: createSignal({ season: 'spring' }), getPlayerPositions: () => [],
      findPath: (_start, target) => [target], constrainPosition() {}, getPoopPositions: () => [], spawnPoop() {}, spawnPrize() {},
      secondsUntilNextDay: now => DAY - now % DAY };
    const manager = new BeefaloManager(new THREE.Scene(), physics, '/dst/data/anim', world);
    const model = await manager.spawn(new THREE.Vector3());
    const controller = manager.controllerOf(model)!;
    controller.body.position.set(0, 1.5, 0);
    const radius = 1.5;
    const player = new CANNON.Body({ mass: 75, shape: new CANNON.Sphere(radius), fixedRotation: true });
    player.collisionFilterGroup = COLLISION.CHARACTERS;
    player.position.set(-2 * radius, 1.5, 0);
    physics.addBody(player);
    let stoppedAt = 0;
    for (let i = 0; i < 120; i++) {
      sources.scheduler.advance(1 / 60);
      player.velocity.x = i < 10 ? 16 : 0; // player_common MakeCharacterPhysics(75, .5) at run speed
      manager.update(1 / 60);
      physics.step(1 / 60);
      if (i === 29) stoppedAt = controller.body.position.x;
    }
    expect(stoppedAt).toBeGreaterThan(0);
    // After the player stops, the beefalo only slides a short way.
    expect(controller.body.position.x - stoppedAt).toBeLessThan(1);
    manager.dispose();
    sources.scheduler.dispose();
  });
});
