import { wilsonPlayer } from './wilsonPlayer';
import { findActionEntity } from '../../prefab/src/actionEntity';
import { createTestWorldSources } from './worldContentFixture';
import { readFile } from 'node:fs/promises';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BEEFALO_ART, BEEFALO_BEHAVIOR, BEEFALO_BUILD, BEEFALO_SHAVED_BUILD, beefaloPrefabs, BeefaloInstance, type BeefaloWorld } from '../../prefab/src/beefalo';
import { createSignal, getWatchWorldContent, type WorldPhase, type WorldContentEnvironment } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ComponentUpdates } from '../../componets/src/componentUpdates';
import { ArchiveSpriteAssets, createArchiveSprite } from '../src/archiveSprite';
import { smallHash } from '../src/animationAssets';
import { COLLISION } from '../../componets/src/physicsState';
import { PrefabEntityManager, PrefabInstance } from '../../prefab/src/prefabInstance';
import { PrefabDisplayGroup, SpriteState } from '../../display/src';
import { updateSceneMatrices } from '../src/matrixUpdates';
import { TransformRoot } from '../src/transformRoot';
import { Pathfinder } from '../../prefab/src/pathfinder';
import type { PlacementSaveRecord } from '../../prefab/src/saveRecord';
import { cursorSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { activeItemUse } from './inventoryUseFixture';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { createInventoryStore } from './testInventory';

const OPEN_GROUND = { isPassableAtPoint: () => true, isOceanAtWorld: () => false };
const DAY = 480;

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function serveAssets() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const file = await readFile(new URL(`../../../public/dst/data/anim/${url.split('/').at(-1)}`, import.meta.url));
    return new Response(file);
  }));
}

/** beefalo as the application wires it: its world services, the shared PrefabEntityManager and the frame's component updates. */
function beefaloWorld({ random = (): number => 0, physics = new CANNON.World() }: { random?: () => number; physics?: CANNON.World } = {}) {
  serveAssets();
  let poop: Iterable<THREE.Vector3> = [];
  const scheduler = new GameTimeScheduler(), componentUpdates = new ComponentUpdates();
  const clock = createSignal<{ phase: WorldPhase }>({ phase: 'day' }), cycle = createSignal<WorldPhase>('day');
  const sources: WorldContentEnvironment = { ...createTestWorldSources(scheduler), playerpositions: createSignal<THREE.Vector3[]>([]), snowLevel: createSignal(0),
    wind: createSignal({ angle: 0, velocity: 1 }), perishTick: createSignal({ time: 0, total: 0 }), scheduler, temperature: createSignal(30), cycle,
    season: createSignal({ season: 'spring', progress: .5 }) };
  const world: BeefaloWorld = { scheduler, componentUpdates, clock, random,
    getWatchWorldContent: (key, register) => getWatchWorldContent(key, register, sources),
    secondsUntilNextDay: now => DAY - now % DAY, spawnPrize: vi.fn(),
    pathfinder: new Pathfinder(OPEN_GROUND), isWalkable: () => true,
    constrainPosition: vi.fn(), getPoopPositions: () => poop, spawnPoop: vi.fn() };
  const displays = new PrefabDisplayGroup(new THREE.Scene());
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { physics }, beefaloPrefabs(world));
  const spawn = (saved?: Pick<PlacementSaveRecord, 'id' | 'components' | 'transform'>, position = new THREE.Vector3()) =>
    prefabs.spawnAs(BeefaloInstance, 'beefalo', position, saved);
  return { world, prefabs, physics, scheduler, componentUpdates, spawn,
    /** A player the manager tracks, as the scene tracks its player instance for TheSim. */
    addPlayer: (position: THREE.Vector3) => {
      const player = new PrefabInstance('wilson', new SpriteState({ name: 'idle_loop', billboard: true }));
      player.addTag('player'); player.setPosition(position.x, position.y, position.z); prefabs.track(player);
      return player;
    },
    setPoop: (value: Iterable<THREE.Vector3>) => { poop = value; },
    setNight: (value: boolean) => { const phase = value ? 'night' : 'day'; clock.set({ phase }); cycle.set(phase); },
    dispose: () => { prefabs.dispose(); displays.dispose(); scheduler.dispose(); },
  };
}

function setup(random: () => number = () => 0) {
  const scene = beefaloWorld({ random });
  const inst = scene.spawn();
  const body = inst.physicsBody!, animstate = inst.animstate;
  return { ...scene, inst, body,
    playAnimation: vi.spyOn(animstate, 'PlayAnimation'), pushAnimation: vi.spyOn(animstate, 'PushAnimation'),
    clip: () => animstate.animation.peek().name,
    /** AnimState:SetBuild as the entity declares it to its display. */
    build: () => { const build = inst.sprite.sprite.peek().appearance.get('archive-build'); return build?.kind === 'archive-build' ? build.archive : undefined; },
    record: () => scene.prefabs.exportRecords().find(({ record }) => record.id === inst.entityId)!.record,
    /** Advance game time to the next day boundary, running every task due on the way. */
    endDay: () => { scene.scheduler.advance(scene.world.secondsUntilNextDay(scene.scheduler.now)); },
    /** Game time reaches the end of the current clip. */
    complete: () => { const timer = animstate.timer.peek(); if (timer.status === 'scheduled') scene.scheduler.advanceTo(timer.endTime); },
    /** The frame: game time, the physics step moving the body, then the beefalo's component update. */
    tick: (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 10); i++) {
        scene.scheduler.advance(0.1);
        body.position.x += body.velocity.x * 0.1;
        body.position.z += body.velocity.z * 0.1;
        scene.componentUpdates.update(0.1);
      }
    },
  };
}

describe('wild beefalo behavior', () => {
  it('times graze_empty from entry and begins the next idle timeout during the post animation', () => {
    const s = setup();
    s.inst.StopBrain();
    const idleTimer = s.inst.stategraph.sg.timeoutSnapshot!.peek();
    s.scheduler.advanceTo(.9);
    expect(s.inst.stategraph.sg.timeoutSnapshot!.peek()).toBe(idleTimer);
    s.scheduler.advanceTo(1);
    expect(s.inst.state).toBe('graze_empty');
    expect(s.playAnimation).toHaveBeenLastCalledWith('graze2_pre', undefined);
    expect(s.pushAnimation).toHaveBeenLastCalledWith('graze2_loop', undefined);
    const grazeTimer = s.inst.stategraph.sg.timeoutSnapshot!.peek();
    // No animation completion yet: the timeout must still run during the pre animation.
    s.scheduler.advanceTo(1.9);
    expect(s.inst.stategraph.sg.timeoutSnapshot!.peek()).toBe(grazeTimer);
    s.scheduler.advanceTo(2);
    expect(s.inst.state).toBe('idle');
    expect(s.clip()).toBe('graze2_pst');
    expect(s.pushAnimation).toHaveBeenLastCalledWith('idle_loop', true);
    expect(s.inst.stategraph.sg.timeoutSnapshot!.peek()).toEqual({ status: 'scheduled', endTime: 3 });
    s.complete();
    expect(s.clip()).toBe('idle_loop');
    s.dispose();
  });

  it('cancels grazing on sleep and does not replay a cancelled pre animation after returning to the same state', () => {
    const s = setup();
    s.inst.StopBrain();
    s.scheduler.advanceTo(1);
    s.inst.components.sleeper.GoToSleep();
    expect(s.inst.state).toBe('sleep');
    expect(s.inst.stategraph.sg.timeoutSnapshot!.peek()).toEqual({ status: 'stopped' });
    // `nowake` keeps sleep_pre playing until animover, even if waking occurs during it.
    s.inst.components.sleeper.WakeUp();
    s.inst.StopBrain();
    expect(s.inst.state).toBe('sleep');
    s.complete();
    expect(s.inst.state).toBe('wake');
    s.complete();
    s.scheduler.advance(1);
    expect(s.inst.state).toBe('graze_empty');
    expect(s.clip()).toBe('graze2_pre');
    const calls = s.playAnimation.mock.calls.length;
    s.inst.remove();
    s.scheduler.advance(100);
    expect(s.playAnimation).toHaveBeenCalledTimes(calls);
    s.dispose();
  });

  it('uses FaceEntity alert states and keeps the target until the source keep distance is exceeded', () => {
    const s = setup();
    const player = s.addPlayer(new THREE.Vector3(10, 0, 0)); s.tick(1);
    expect(s.inst.state).toBe('actual_alert');
    expect(s.inst.stategraph.hasStateTag('idle')).toBe(true);
    expect(s.inst.stategraph.hasStateTag('alert')).toBe(true);
    // alert_pre is three frames long, so game time has already reached the queued alert_idle.
    expect(s.playAnimation).toHaveBeenCalledWith('alert_pre', undefined);
    expect(s.clip()).toBe('alert_idle');
    player.setPosition(15, 0, 0); s.tick(3);
    expect(s.inst.state).toBe('actual_alert');
    expect(s.body.velocity.x).toBe(0);
    player.setPosition(19, 0, 0); s.tick(2);
    // walk_pre has ended within those two seconds of game time.
    expect(s.inst.state).toBe('walk');
    expect(s.body.velocity.x).toBeGreaterThan(0);
    s.dispose();
  });

  it('walks using physics velocity and source pre/loop/post clips, then rests', () => {
    const s = setup();
    s.tick(2.1);
    expect(s.inst.state).toBe('walk_start');
    expect(s.body.velocity.x).toBe(BEEFALO_BEHAVIOR.walkSpeed);
    const startX = s.inst.position.x;
    s.tick(1);
    expect(s.inst.position.x - startX).toBeCloseTo(BEEFALO_BEHAVIOR.walkSpeed);
    expect(s.clip()).toBe('walk_loop');
    s.tick(.4);
    expect(s.inst.state).toBe('walk_stop');
    expect(s.body.velocity.x).toBe(0);
    s.complete();
    expect(s.clip()).toBe('idle_loop');
    s.dispose();
  });

  it('interrupts movement to sleep at night and wakes at dawn', async () => {
    const s = setup();
    s.tick(2.1);
    // The day/night effect reacts in a microtask without advancing game time.
    s.setNight(true); await new Promise(resolve => setTimeout(resolve, 0));
    expect(s.inst.state).toBe('sleep');
    expect(s.inst.components.sleeper.IsAsleep()).toBe(true);
    expect(s.body.velocity.x).toBe(0);
    s.complete();
    expect(s.clip()).toBe('sleep_loop');
    s.setNight(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(s.inst.components.sleeper.IsAsleep()).toBe(false);
    expect(s.clip()).toBe('sleep_pst');
    s.complete();
    expect(s.inst.state).toBe('idle');
    s.dispose();
  });

  it('drops manure on the source 40 + random * 60 schedule, saves the timer and cancels it on removal', () => {
    const s = setup();
    s.setNight(true); s.tick(39.9);
    expect(s.world.spawnPoop).not.toHaveBeenCalled();
    s.tick(0.2);
    expect(s.world.spawnPoop).toHaveBeenCalledTimes(1);
    expect(vi.mocked(s.world.spawnPoop).mock.calls[0][0].toArray()).toEqual([s.inst.position.x - 3, 0, 0]);
    // GetPersistData: each component under its own name.
    const saved = s.record();
    expect(Object.keys(saved.components).sort()).toEqual(['beard', 'periodicspawner']);
    const restored = s.spawn({ ...saved, id: 'restored' });
    expect(s.prefabs.exportRecords().find(({ record }) => record.id === 'restored')!.record.components).toEqual(saved.components);
    restored.remove();
    expect(restored.components.periodicspawner.timerState.peek()).toEqual({ status: 'stopped' });
    const poopCalls = vi.mocked(s.world.spawnPoop).mock.calls.length;
    s.inst.remove(); s.scheduler.advance(200);
    expect(s.world.spawnPoop).toHaveBeenCalledTimes(poopCalls);
    s.dispose();
    const late = setup(() => .999);
    expect(late.inst.components.periodicspawner.remainingSeconds).toBeCloseTo(99.94);
    late.dispose();
  });

  it('checks periodicspawner spacing at the source origin before moving manure behind the beefalo', () => {
    const s = setup();
    const spawner = s.inst.components.periodicspawner;
    // Exactly the source spacing is allowed, even though it is closer to the final rear position.
    s.setPoop([new THREE.Vector3(-BEEFALO_BEHAVIOR.poopSpacing, 0, 0)]);
    expect(spawner.TrySpawn().spawned).toBe(true);
    expect(s.world.spawnPoop).toHaveBeenCalledExactlyOnceWith(new THREE.Vector3(-3, 0, 0));
    s.setPoop([new THREE.Vector3(BEEFALO_BEHAVIOR.poopSpacing - .01, 0, 0)]);
    expect(spawner.TrySpawn().spawned).toBe(false);
    const closed = vi.fn();
    s.setPoop((function* () {
      try {
        yield new THREE.Vector3(BEEFALO_BEHAVIOR.poopDensityRadius, 0, 0);
        yield new THREE.Vector3(-BEEFALO_BEHAVIOR.poopDensityRadius, 0, 0);
        throw new Error('density failure must not consume the rest of the query');
      } finally { closed(); }
    })());
    expect(spawner.TrySpawn().spawned).toBe(false);
    expect(closed).toHaveBeenCalledOnce();
    expect(s.world.spawnPoop).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  it('shaves only a sleeping beefalo: wool drops, the shaved build is applied, and it keeps sleeping', async () => {
    const s = setup();
    const { beard } = s.inst.components;
    s.setNight(true); s.tick(7.1);
    expect(s.inst.components.sleeper.IsAsleep()).toBe(true);
    s.complete();
    expect(beard.bits.peek()).toBe(3);
    // A cursor-held razor: USEITEM.shaver offers SHAVE and SGwilson's shave state commits it after one second.
    vi.stubGlobal('window', new EventTarget());
    const inventory = createInventoryStore([]);
    const graph = wilsonPlayer(() => 1).sg;
    const use = activeItemUse({ player: new THREE.Object3D(), renderer: { domElement: new EventTarget() } }, graph, inventory);
    inventory.add('razor', 1);
    expect(inventory.transfer(inventorySlotAddress(0), cursorSlotAddress(), 1)).toBe(true);
    const razor = inventory.GetActiveItem();
    const target = findActionEntity(s.inst.transform.model)!;
    expect(use.actions(target)).toEqual(['SHAVE']);
    expect(use.useOn(target)).toBe(true);
    use.arrive(); expect(graph.stateName).toBe('shave');
    graph.update(.9); expect(beard.bits.peek()).toBe(3);
    graph.update(.1);
    expect(inventory.GetActiveItem()).toBe(razor);
    use.dispose(); graph.dispose(); inventory.dispose(); vi.unstubAllGlobals();
    expect(s.world.spawnPrize).toHaveBeenCalledExactlyOnceWith('beefalowool', 3, expect.objectContaining({ x: s.inst.position.x, z: s.inst.position.z }));
    expect(s.inst.state).toBe('shaved');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(s.build()).toBe(BEEFALO_SHAVED_BUILD);
    expect(s.clip()).toBe('shave');
    expect(s.inst.hasTag('has_beard')).toBe(false);
    expect(s.inst.hasTag('bearded')).toBe(true);
    s.complete();
    expect(s.inst.state).toBe('sleeping');
    expect(s.clip()).toBe('sleep_loop');
    expect(beard.ShouldTryToShave(undefined)).toEqual({ ok: false, reason: 'NOBITS' });
    s.dispose();
  });

  it('refuses to shave an awake beefalo and leaves the beard untouched', async () => {
    const s = setup();
    expect(s.inst.components.beard.Shave(undefined)).toEqual({ ok: false, reason: 'AWAKEBEEFALO' });
    expect(s.inst.components.beard.bits.peek()).toBe(3);
    expect(s.world.spawnPrize).not.toHaveBeenCalled();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(s.build()).toBe(BEEFALO_BUILD);
    s.dispose();
  });

  it('regrows hair on the third day, entering hair_growth when it next idles, and persists the beard', async () => {
    const s = setup();
    const { beard } = s.inst.components;
    s.setNight(true); s.tick(7.1); s.complete();
    beard.Shave(undefined); s.complete();
    const shaved = s.record();
    expect(shaved.components.beard).toMatchObject({ growth: 0, bits: 0 });
    const restored = s.spawn({ ...shaved, id: 'restored' });
    await new Promise(resolve => setTimeout(resolve, 0));
    const build = restored.sprite.sprite.peek().appearance.get('archive-build');
    expect(build?.kind === 'archive-build' && build.archive).toBe(BEEFALO_SHAVED_BUILD);
    expect(restored.hasTag('has_beard')).toBe(false);
    restored.remove();
    s.endDay(); s.endDay();
    expect(beard.bits.peek()).toBe(0);
    s.endDay();
    expect(s.inst.hairGrowthPending).toBe(true);
    s.setNight(false);
    for (let i = 0; i < 100 && s.inst.state !== 'hair_growth'; i++) s.tick(.1);
    expect(s.inst.state).toBe('hair_growth');
    expect(s.clip()).toBe('hair_growth_pre');
    s.complete();
    expect(s.inst.state).toBe('hair_growth_pop');
    expect(beard.bits.peek()).toBe(3);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(s.build()).toBe(BEEFALO_BUILD);
    expect(s.inst.hasTag('has_beard')).toBe(true);
    s.complete();
    expect(s.inst.state).toBe('idle');
    s.dispose();
  });

  it('stops its day timer and appearance effect when removed', async () => {
    const s = setup();
    const { beard } = s.inst.components;
    expect(beard.dayTimerState.peek()).toEqual({ status: 'scheduled', endTime: DAY });
    s.setNight(true); s.tick(7.1); s.complete();
    beard.Shave(undefined); s.complete();
    await new Promise(resolve => setTimeout(resolve, 0));
    s.inst.remove();
    s.endDay(); s.endDay(); s.endDay();
    expect(beard.dayTimerState.peek()).toEqual({ status: 'stopped' });
    beard.SetBits(3);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(beard.daysgrowth.peek()).toBe(0);
    expect(s.build()).toBe(BEEFALO_SHAVED_BUILD);
    expect(s.inst.hairGrowthPending).toBe(false);
    s.dispose();
  });

  it('declares a six-faced heading on the transform, which the record saves and a reload restores', () => {
    const s = setup();
    expect(s.inst.sprite.sprite.peek()).toMatchObject({ facingRotation: 0, facingMode: 6 });
    s.addPlayer(new THREE.Vector3(1, 0, -10)); s.tick(1);
    const heading = s.inst.transform.rotation;
    expect(heading).not.toBe(0);
    expect(s.inst.sprite.sprite.peek()).toMatchObject({ facingRotation: heading, facingMode: 6 });
    expect(s.inst.position.y).toBe(0);
    const restored = s.spawn({ ...s.record(), id: 'restored' });
    expect(restored.transform.rotation).toBeCloseTo(heading);
    expect(restored.sprite.sprite.peek().facingRotation).toBeCloseTo(heading);
    s.dispose();
  });
});

describe('beefalo saves', () => {
  it('c_save()s the components through the save file and loads a record from before they saved themselves', () => {
    const s = setup();
    s.setNight(true); s.tick(7.1); s.complete();
    s.inst.components.beard.Shave(undefined);
    s.inst.components.knownlocations.RememberLocation('herd', new THREE.Vector3(5, 0, 6));
    const legacy = { id: 'legacy', transform: { position: [20, 0, 30] as [number, number, number], rotationY: 0 }, components: { beefalo: {
      home: [21, 0, 31] as [number, number, number], heading: 90, poopRemainingSeconds: 51, beard: { growth: 1, growthaccumulator: 0, bits: 0 } } } };
    const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
    const json = serializeSave(template, { entities: { beefalo: [s.record(), legacy] } as never, inventory: createInventoryStore([]).exportState(),
      elapsedSeconds: 0, playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
    const [current, old] = deserializeSave(json, SAVE_CATALOG).world.entities.beefalo;
    expect(current.components).toEqual(s.record().components);
    const restored = s.spawn(current), migrated = s.spawn(old, new THREE.Vector3(20, 0, 30));
    expect(restored.components.beard.bits.peek()).toBe(0);
    expect(restored.components.knownlocations.GetLocation('herd')).toMatchObject({ x: 5, z: 6 });
    // The legacy fields load into the components they belong to, and the next save writes only those.
    expect(migrated.transform.rotation).toBeCloseTo(90);
    expect(migrated.components.knownlocations.GetLocation('herd')).toMatchObject({ x: 21, z: 31 });
    expect(migrated.components.periodicspawner.remainingSeconds).toBeCloseTo(51);
    expect(migrated.components.beard.OnSave()).toEqual({ growth: 1, growthaccumulator: 0, bits: 0 });
    const resaved = s.prefabs.exportRecords().find(({ record }) => record.id === 'legacy')!.record;
    expect(Object.keys(resaved.components).sort()).toEqual(['beard', 'knownlocations', 'periodicspawner']);
    expect(resaved.transform.rotationY).toBeCloseTo(Math.PI / 2);
    s.dispose();
  });
});

describe('original beefalo assets', () => {
  it('draws every action clip in all six facings from its shared archive, hides HEAT, and keeps one-shot completion across facing and build changes', async () => {
    serveAssets();
    const assets = new ArchiveSpriteAssets('sprite', '/dst/data/anim');
    try {
      const sprite = await createArchiveSprite(assets, { ...BEEFALO_ART, animation: 'idle_loop', loop: true });
      sprite.setBuildArchive(BEEFALO_BUILD);
      const heat = smallHash('HEAT');
      const drawn = () => sprite.getResolvedFrame();
      expect(drawn().length).toBeGreaterThan(0);
      const complete = vi.fn();
      sprite.playOnce('sleep_pre', complete);
      for (let i = 0; i < 6; i++) sprite.update(0.1);
      // A left-hand facing draws the right-hand clip mirrored.
      const scene = new THREE.Scene(), root = new TransformRoot();
      root.add(sprite.model); scene.add(root);
      updateSceneMatrices(scene);
      const facingRight = sprite.model.children[0].matrixWorld.elements[0];
      sprite.setFacing(32);
      sprite.update(0);
      updateSceneMatrices(scene);
      expect(Math.sign(sprite.model.children[0].matrixWorld.elements[0])).toBe(-Math.sign(facingRight));
      for (let i = 0; i < 6; i++) sprite.update(0.1);
      expect(complete).toHaveBeenCalledTimes(1);
      for (const clip of ['walk_pre', 'walk_loop', 'walk_pst', 'graze2_pre', 'graze2_loop', 'graze2_pst',
        'graze_loop', 'alert_pre', 'alert_idle', 'sleep_loop', 'sleep_pst', 'shake', 'bellow']) {
        sprite.start(clip);
        for (const facing of [1, 4, 16, 32, 64, 128]) {
          sprite.setFacing(facing); sprite.update(0.1);
          expect(drawn().length, `${clip} facing ${facing}`).toBeGreaterThan(0);
          expect(drawn().some(({ element }) => element.layerHash === heat)).toBe(false);
        }
      }
      // AnimState:SetBuild swaps the whole build and keeps the clip.
      sprite.setBuildArchive(BEEFALO_SHAVED_BUILD);
      expect(sprite.currentAnimation).toBe('bellow');
      expect(drawn().length).toBeGreaterThan(0);
      sprite.setBuildArchive(BEEFALO_BUILD);
      expect(drawn().length).toBeGreaterThan(0);
      sprite.dispose();
    } finally { assets.dispose(); }
  });

  it('draws a spawned beefalo from its shared archive and releases it with the manager', async () => {
    const s = setup();
    const display = (await import('../../display/src')).prefabDisplay(s.inst.transform.model)!;
    await display.artLoaded();
    expect(s.inst.sprite.loaded).toBe(true);
    s.dispose();
    expect(s.physics.bodies).toHaveLength(0);
    expect(s.prefabs.exportRecords()).toEqual([]);
  });

  it('keeps walking over the physical ground rather than losing velocity to static friction', () => {
    const physics = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    const floor = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: new CANNON.Material('ground') });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    physics.addBody(floor);
    const s = beefaloWorld({ physics });
    const inst = s.spawn();
    // The actual brain, locomotor and stategraph over a deterministic two-second walk.
    inst.StopBrain();
    inst.RestartBrain();
    inst.stategraph.goToState('idle');
    for (let i = 0; i < 240; i++) {
      s.scheduler.advance(1 / 60);
      physics.step(1 / 60);
      s.componentUpdates.update(1 / 60);
    }
    expect(inst.position.x).toBeGreaterThan(4);
    s.dispose();
  });

  it('absorbs a running player collision with the Lua character damping instead of flying far', () => {
    const s = beefaloWorld();
    const body = s.spawn().physicsBody!;
    body.position.set(0, 1.5, 0);
    const radius = 1.5;
    const player = new CANNON.Body({ mass: 75, shape: new CANNON.Sphere(radius), fixedRotation: true });
    player.collisionFilterGroup = COLLISION.CHARACTERS;
    player.position.set(-2 * radius, 1.5, 0);
    s.physics.addBody(player);
    let stoppedAt = 0;
    for (let i = 0; i < 120; i++) {
      s.scheduler.advance(1 / 60);
      player.velocity.x = i < 10 ? 16 : 0; // player_common MakeCharacterPhysics(75, .5) at run speed
      s.physics.step(1 / 60);
      s.componentUpdates.update(1 / 60);
      if (i === 29) stoppedAt = body.position.x;
    }
    expect(stoppedAt).toBeGreaterThan(0);
    // After the player stops, the beefalo only slides a short way.
    expect(body.position.x - stoppedAt).toBeLessThan(1);
    s.dispose();
  });
});
