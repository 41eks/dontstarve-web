import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createMemo,
  createSignal,
  WorldContentKey,
  type WorldMoonPhase,
  type WorldMoonState,
  type WorldPhase,
} from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import {
  moonFissurePrefabs,
  MOON_FISSURE_FX_ID,
  MOON_FISSURE_ID,
  MoonFissureInstance,
} from '../../prefab/src/moon_fissure';
import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';
import type { EntitySaveRecord } from '../../prefab/src/saveRecord';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { createPickupInventory } from './pickupFixture';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(phase: WorldMoonPhase = 'new', playerPosition = new THREE.Vector3()) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))),
  );
  const scene = new THREE.Scene(),
    scheduler = new GameTimeScheduler(),
    awake = createSignal(true);
  const moon = createSignal<WorldMoonState>({ phase, waxing: true });
  const cycle = createSignal<WorldPhase>('night');
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', {
    tickingarea: () => createMemo(() => awake.get()),
    scheduler,
  });
  // TheWorld.state.moonphase / isnight, as the world's Moon and Cycle content.
  const definitions = moonFissurePrefabs({
    scheduler,
    getWatchWorldContent: ((key: WorldContentKey) => (key === WorldContentKey.Moon ? moon : cycle)) as never,
    spawnPrefab: (id, position) => prefabs.spawn(id, position),
  });
  prefabs.register(definitions);
  const registry = new EntityRegistry([], prefabs, () => playerPosition);
  registry.registerPrefabs(PREFAB_DEFINITIONS.moonFissures);
  const spawn = (record: EntitySaveRecord) => prefabs.restore(MOON_FISSURE_ID, record) as MoonFissureInstance;
  const records = () => registry.exportRecords().moon_fissure ?? [];
  const requested = (archive: string) =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([url]) =>
      String(url).endsWith(`/dst/data/anim/${archive}`),
    );
  const dispose = () => {
    registry.dispose();
    prefabs.dispose();
    displays.dispose();
    scheduler.dispose();
  };
  return { scene, awake, scheduler, moon, cycle, prefabs, registry, definitions, spawn, records, requested, dispose };
}
const record = (id: string, x: number): EntitySaveRecord => ({
  id,
  transform: { position: [x, 0, 3], rotationY: 0 },
  components: {},
});
/** The fissure's own Show / Hide layer declarations. */
const layers = (inst: PrefabInstance) =>
  Object.fromEntries(
    [...inst.sprite.sprite.peek().appearance.values()].flatMap(op =>
      op.kind === 'layer' ? [[op.layer, op.hidden]] : [],
    ),
  );
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('loads a save record with the clip, tags, bank and component values moon_fissure.lua fn declares', async () => {
  const { spawn, records, definitions, requested, dispose } = setup('new');
  const half = setup('half');
  try {
    const saved = record('saved-fissure', 2);
    const inst = spawn(saved);
    // AddTag, then the inspectable and sanityaura constructors and repairable's repairmaterial setter, in fn's order.
    // workleft 0 of maxwork 1: no CHOP_workable, and repairable derives workrepairable.
    expect(inst.listTags()).toEqual([
      'antlion_sinkhole_blocker',
      'inspectable',
      'sanityaura',
      'repairable_moon_altar',
      'workrepairable',
    ]);
    expect(inst.sprite.sprite.peek()).toMatchObject({
      clip: { name: 'crack_idle', loop: true },
      queue: [],
      billboard: true,
      depthOffset: true,
    });
    expect(definitions.moon_fissure).toMatchObject({
      assets: { animationArchive: 'moon_fissure.zip', buildArchives: ['moon_fissure.zip'], bank: 'moon_fissure' },
    });
    expect(inst.getPhysicsRadius()).toBeCloseTo(0.4 * 3);
    const { workable, sanityaura, repairable } = inst.components;
    expect([workable.maxwork.peek(), workable.workleft.peek(), workable.savestate]).toEqual([1, 0, false]);
    expect([repairable.repairmaterial, repairable.noannounce]).toEqual(['moon_altar', true]);
    // UpdateState at a new moon: level 1, radius 0, the backing shown, every glow layer hidden on the fissure, and no light.
    expect([inst._level, sanityaura.max_distsq]).toEqual([1, 0]);
    expect(sanityaura.aurafn?.(inst, undefined)).toBe(0);
    expect(layers(inst)).toEqual({ low: true, med: true, high: true, full: true, backing: false });
    expect(inst.light.peek()).toBeUndefined();
    expect(records()).toEqual([saved]);
    await prefabDisplay(inst.transform.model)!.artLoaded();
    expect(requested('moon_fissure.zip')).toBe(true);
    expect(inst.sprite.currentAnimation).toBe('crack_idle');
    // A lit phase hides the backing too, the aura reaches 1.25 times the light radius, and the fissure emits light.
    const lit = half.spawn(record('half-fissure', 4));
    expect([lit._level, lit.components.sanityaura.max_distsq]).toEqual([3, 6 * 6 * 1.25 * 1.25]);
    expect(lit.components.sanityaura.aurafn?.(lit, undefined)).toBe(100 / (30 * 4));
    expect(layers(lit)).toEqual({ low: true, med: true, high: true, full: true, backing: true });
    expect(lit.light.peek()).toBeDefined();
    expect(lit.light.peek()!.radius).toBeGreaterThan(0);
    expect(lit.light.peek()!.colour).toEqual([130 / 255, 160 / 255, 170 / 255]);
  } finally {
    dispose();
    half.dispose();
  }
});

it('rebuilds the declared clip and layers after tile sleep', async () => {
  const { scene, awake, spawn, records, dispose } = setup('full');
  try {
    const saved = record('sleeping-fissure', 1);
    const inst = spawn(saved);
    const model = inst.transform.model,
      before = inst.sprite.sprite.peek();
    await prefabDisplay(model)!.artLoaded();
    awake.set(false);
    await settle();
    expect(inst.status.peek()).toBe('asleep');
    expect(inst.sprite.loaded).toBe(false);
    expect(model.parent).toBeNull();
    awake.set(true);
    await settle();
    await prefabDisplay(model)!.artLoaded();
    expect(model.parent).toBe(scene);
    expect(inst.sprite.currentAnimation).toBe('crack_idle');
    expect(inst.sprite.sprite.peek().clip).toMatchObject({ name: 'crack_idle', loop: true });
    expect(layers(inst)).toEqual({ low: true, med: true, high: true, full: true, backing: true });
    expect(inst.sprite.sprite.peek().appearance).toEqual(before.appearance);
    expect([inst._level, inst.components.workable.workleft.peek()]).toEqual([5, 0]);
    expect(records()).toEqual([saved]);
  } finally {
    dispose();
  }
});

it('keeps a c_spawn fissure through c_save and a reload, and rejects c_give', async () => {
  const first = setup('quarter', new THREE.Vector3(3, 0, -6)),
    second = setup('quarter'),
    inventory = createPickupInventory();
  try {
    expect(
      (await executeDebugCommand('c_spawn("moon_fissure")', inventory, prefab => first.registry.spawn(prefab))).ok,
    ).toBe(true);
    expect((await executeDebugCommand('c_give("moon_fissure")', inventory)).ok).toBe(false);
    const before = first.registry.exportRecords();
    let json = '';
    expect(
      (
        await executeDebugCommand('c_save()', inventory, undefined, () => {
          json = serializeSave(
            deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG),
            {
              entities: before,
              inventory: inventory.exportSaved(),
              elapsedSeconds: 1,
              playerTransform: { position: [3, 0, -6], rotationY: 0 },
            },
            SAVE_CATALOG,
          );
        })
      ).ok,
    ).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG).world.entities.moon_fissure!;
    expect(saved).toEqual(before.moon_fissure);
    // No OnSave and a workable without savestate: the record is the identity and position alone.
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ transform: { position: [3, 0, -6] }, components: {} });
    await second.registry.restoreAll({ moon_fissure: saved });
    const loaded = second.prefabs.get(saved[0]!.id);
    if (!(loaded instanceof MoonFissureInstance)) {
      throw new Error('The saved fissure did not load');
    }
    expect(loaded.sprite.sprite.peek().clip).toMatchObject({ name: 'crack_idle', loop: true });
    expect([
      loaded.components.workable.maxwork.peek(),
      loaded.components.workable.workleft.peek(),
      loaded._level,
    ]).toEqual([1, 0, 2]);
    expect(second.records()).toEqual(saved);
  } finally {
    first.dispose();
    second.dispose();
    inventory.dispose();
  }
});

it('watches the moon phase and re-dresses the light after a transition', async () => {
  const { scheduler, moon, spawn, dispose } = setup('new');
  try {
    const inst = spawn(record('watching-fissure', 1));
    expect(inst._level).toBe(1);
    expect(inst.light.peek()).toBeUndefined();
    moon.set({ phase: 'half', waxing: true });
    await settle();
    // delayed_transition waits a random delay, then UpdateState runs 5 frames later; advance past both.
    scheduler.advance(2);
    expect(inst._level).toBe(3);
    expect(inst.light.peek()).toBeDefined();
    expect(inst.light.peek()!.radius).toBeGreaterThan(0);
  } finally {
    dispose();
  }
});

it('dims the light colour by the ambient brightness during the day', async () => {
  const { scheduler, cycle, spawn, dispose } = setup('half');
  try {
    const inst = spawn(record('day-fissure', 1));
    const night = inst.light.peek()!.colour;
    cycle.set('day');
    scheduler.advance(1 / 30);
    const day = inst.light.peek()!.colour;
    expect(day[0]).toBeLessThan(night[0]);
    expect(day[1]).toBeLessThan(night[1]);
    expect(day[2]).toBeLessThan(night[2]);
  } finally {
    dispose();
  }
});

it('spawns the moon_fissure_fx child and dresses its glow layers by the phase', async () => {
  const { scheduler, moon, spawn, dispose } = setup('new');
  try {
    const inst = spawn(record('fissure-with-fx', 1));
    const fx = inst.fx;
    expect(fx.prefab).toBe(MOON_FISSURE_FX_ID);
    expect(fx.entityParent).toBe(inst);
    expect(fx.listTags()).toEqual(['DECOR', 'NOCLICK']);
    expect(fx.persists).toBe(false);
    expect(fx.sprite.sprite.peek()).toMatchObject({
      clip: { name: 'crack_idle', loop: true },
      billboard: true,
    });
    // New moon: the fx draws no glow layer and no backing, while the fissure itself shows its backing.
    expect(layers(fx)).toEqual({ low: true, med: true, high: true, full: true, backing: true });
    await prefabDisplay(fx.transform.model)!.artLoaded();
    expect(fx.sprite.currentAnimation).toBe('crack_idle');
    // A half moon lights low and med on the fx and moves the backing onto it.
    moon.set({ phase: 'half', waxing: true });
    await settle();
    scheduler.advance(2);
    expect(layers(fx)).toEqual({ low: false, med: false, high: true, full: true, backing: false });
    expect(layers(inst)).toEqual({ low: true, med: true, high: true, full: true, backing: true });
  } finally {
    dispose();
  }
});

it('supports c_spawn of the moon_fissure_fx child', async () => {
  const { registry, dispose } = setup('quarter');
  const inventory = createPickupInventory();
  try {
    expect(
      (await executeDebugCommand('c_spawn("moon_fissure_fx")', inventory, prefab => registry.spawn(prefab))).ok,
    ).toBe(true);
  } finally {
    inventory.dispose();
    dispose();
  }
});
