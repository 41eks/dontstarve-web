import { PrefabDisplayGroup } from '../../display/src';
import { prefabDisplay } from '@dontstarve-web/display';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { DwarfStarManager, dwarfStarLight, DWARF_STAR_DURATION, type StaffLightId, type StaffLightInstance } from '../../prefab/src/stafflight';
import { PlaySound } from '../../prefab/src/sound';
import { clockstate, createMemo, createSignal, seasonstate } from '@dontstarve-web/signals';
import { InventoryStore, ItemEntity } from '../../inventory/src';
import { ComponentUpdates } from '../../componets/src/componentUpdates';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { configureHeatRockEntity, type HeatRock } from '../../prefab/src/heatrock';
import { FindEntities } from '../../prefab/src/actionEntity';
import { TILE_SIZE } from '../../prefab/src/tile';
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';


vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop: vi.fn() })),
}));

const managers: DwarfStarManager[] = [];
beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(
    new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(async () => {
  for (const manager of managers.splice(0)) manager.dispose();
  await Promise.resolve();
  vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals();
});

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
/** The model the star's display keeps in `scene` while the star is awake. */
const modelIn = (scene: THREE.Scene, star: PrefabInstance) => scene.children.find(child => prefabInstance(child) === star) as THREE.Group | undefined;
/** A star exists as soon as it is spawned; its display then loads the art. */
async function artLoaded(scene: THREE.Scene, star: StaffLightInstance): Promise<StaffLightInstance> {
  await prefabDisplay(modelIn(scene, star)!)!.artLoaded();
  await settle();
  return star;
}
const haunter = { hasTag: () => false, PushEvent() {} };
const sounds = (event: string) => vi.mocked(PlaySound).mock.calls.flatMap(([path], index) => path === event ? [vi.mocked(PlaySound).mock.results[index].value] : []);

function setup(prefab: StaffLightId = 'stafflight') {
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true);
  const manager = new DwarfStarManager(new PrefabDisplayGroup(scene), '/dst/data/anim',
    { scheduler, tickingarea: () => createMemo(() => awake.get()) }, prefab);
  managers.push(manager);
  /** As the scene does: the world's scheduler advances, then the displays. */
  const update = (dt: number) => { scheduler.advance(dt); manager.update(dt, new THREE.Quaternion()); };
  return { manager, scene, scheduler, awake, update };
}

it('declares the source tags and components of each star', () => {
  const hot = setup().manager.spawn(new THREE.Vector3());
  for (const tag of ['HASHEATER', 'sanityaura', 'inspectable', 'ignorewalkableplatforms', 'cooker', 'daylight', 'heatstar']) expect(hot.hasTag(tag)).toBe(true);
  expect(hot.physicsRadiusOverride).toBe(.5);
  expect(hot.components.propagator!.heatoutput).toBe(15);
  expect(hot.components.propagator!.spreading.peek()).toBe(true);
  expect(hot.components.sanityaura!.GetBaseAura()).toBeCloseTo(100 / 240);
  const cold = setup('staffcoldlight').manager.spawn(new THREE.Vector3());
  for (const tag of ['cooker', 'daylight', 'heatstar']) expect(cold.hasTag(tag)).toBe(false);
  expect(cold.components.propagator).toBeUndefined();
});

it('pulses the light from .1s after spawning, as the periodic task enables it', () => {
  const { manager, update } = setup();
  const star = manager.spawn(new THREE.Vector3());
  expect(star.light.peek()).toBeUndefined();
  update(.1);
  expect(star.light.peek()!.radius).toBeCloseTo(dwarfStarLight(.1).radius);
  for (let i = 0; i < 125; i++) update(.1);
  expect(star.light.peek()!.radius).toBeCloseTo(dwarfStarLight(12.6).radius);
});

it('draws a new star from appear, then settles into its idle', async () => {
  const { manager, scene, update } = setup();
  const star = await artLoaded(scene, manager.spawn(new THREE.Vector3()));
  expect(star.sprite.currentAnimation).toBe('appear');
  for (let frame = 0; frame < 150; frame++) update(1 / 30);
  expect(star.sprite.currentAnimation).toBe('idle_loop');
});

it('expires on the extinguish timer: disappear, animover kills the loop, Remove a second later', async () => {
  const { manager, scene, update } = setup();
  const star = await artLoaded(scene, manager.spawn(new THREE.Vector3(), { id: 'e_star', remainingSeconds: 0.8 }));
  const model = modelIn(scene, star)!;
  const play = vi.spyOn(star.sprite, 'playOnce');
  const loop = sounds('dontstarve/common/staff_star_LP')[0];
  update(.7);
  expect(star.persists).toBe(true);
  expect(play).not.toHaveBeenCalled();
  update(.2);
  expect(star._killed).toBe(true);
  expect(star.persists).toBe(false);
  expect(star.components.timer!.TimerExists('extinguish')).toBe(false);
  expect(manager.exportRecords()).toEqual([]);
  expect(play).toHaveBeenCalledExactlyOnceWith('disappear', expect.any(Function));
  expect(loop.stop).not.toHaveBeenCalled();
  play.mock.calls[0][1]!();
  expect(loop.stop).toHaveBeenCalledOnce();
  update(.89);
  expect(star.isRemoved).toBe(false);
  expect(model.parent).toBe(scene);
  update(.02);
  expect(star.isRemoved).toBe(true);
  await settle();
  expect(model.parent).toBeNull();
  expect(FindEntities(star.position, 1, ['HASHEATER'])).toEqual([]);
});

it('haunting stops the timer and kills the light once; a repeat succeeds without another removal', async () => {
  const { manager, scene, update } = setup();
  const star = await artLoaded(scene, manager.spawn(new THREE.Vector3(), { id: 'e_haunted', remainingSeconds: 100 }));
  const play = vi.spyOn(star.sprite, 'playOnce');
  const hauntable = star.components.hauntable!;
  hauntable.DoHaunt(haunter);
  expect(star.components.timer!.TimerExists('extinguish')).toBe(false);
  expect(star.persists).toBe(false);
  expect(play).toHaveBeenCalledExactlyOnceWith('disappear', expect.any(Function));
  update(.6);
  hauntable.DoHaunt(haunter);
  expect(play).toHaveBeenCalledOnce();
  update(.41);
  expect(star.isRemoved).toBe(true);
});

it('sleeps without touching lifetime, light or sound, and wakes on the same entity', async () => {
  const { manager, scene, awake, update } = setup();
  const star = await artLoaded(scene, manager.spawn(new THREE.Vector3(4, 0, 6)));
  const model = modelIn(scene, star)!, heater = star.components.heater;
  const loop = sounds('dontstarve/common/staff_star_LP')[0];
  update(.2);
  awake.set(false);
  await settle();
  expect(star.status.peek()).toBe('asleep');
  expect(model.parent).toBeNull();
  expect(star.sprite.loaded).toBe(false);
  expect(manager.renderEntities).toEqual([]);
  update(10);
  // The periodic task and timer are not gated by sleep, and the emitter keeps its loop.
  expect(star.light.peek()!.radius).toBeCloseTo(dwarfStarLight(10.2).radius);
  expect(loop.stop).not.toHaveBeenCalled();
  expect(manager.exportRecords()[0].components.timer.remainingSeconds).toBeCloseTo(DWARF_STAR_DURATION - 10.2);
  const plays = vi.mocked(PlaySound).mock.calls.length;
  awake.set(true);
  await settle();
  await prefabDisplay(model)!.artLoaded();
  expect(model.parent).toBe(scene);
  expect(star.sprite.loaded).toBe(true);
  expect(prefabInstance(model)).toBe(star);
  expect(star.components.heater).toBe(heater);
  expect(star.sprite.sprite.peek().clip.name).toBe('idle_loop');
  expect(vi.mocked(PlaySound)).toHaveBeenCalledTimes(plays);
});

it('expires and is removed while asleep, without drawing anything', async () => {
  const { manager, awake, update } = setup();
  awake.set(false);
  const star = manager.spawn(new THREE.Vector3(), { id: 'e_far', remainingSeconds: .5 });
  await settle();
  expect(star.status.peek()).toBe('asleep');
  expect(star.sprite.loaded).toBe(false);
  const loop = sounds('dontstarve/common/staff_star_LP')[0];
  update(.6);
  expect(star._killed).toBe(true);
  expect(loop.stop).toHaveBeenCalledOnce(); // Nothing draws disappear, so its animover comes at once.
  expect(star.isRemoved).toBe(false);
  update(1);
  expect(star.isRemoved).toBe(true);
  expect(star.sprite.loaded).toBe(false);
});

it('chains random polar idles on animover, resuming after a sleep and stopping once killed', async () => {
  const { manager, scene, awake, update } = setup('staffcoldlight');
  const random = vi.spyOn(Math, 'random').mockReturnValue(.5);
  const star = await artLoaded(scene, manager.spawn(new THREE.Vector3()));
  const clip = () => star.sprite.sprite.peek().clip;
  expect(clip().name).toBe('appear');
  for (let frame = 0; frame < 150 && clip().name === 'appear'; frame++) update(1 / 30);
  expect(clip().name).toBe('idle_loop2');
  expect(clip().loop).toBe(false);
  // A sleep with art gone leaves no drawn clip to complete: the chain must not recurse, and resumes on wake.
  awake.set(false);
  await settle();
  star.PushEvent('animover');
  expect(clip().loop).toBe(true);
  awake.set(true);
  await settle();
  await prefabDisplay(modelIn(scene, star)!)!.artLoaded();
  await settle();
  expect(clip().loop).toBe(false);
  star.components.hauntable!.DoHaunt(haunter);
  expect(clip().name).toBe('disappear');
  star.PushEvent('animover');
  expect(clip().name).toBe('disappear');
  random.mockRestore();
});

it('removes a star disposed while its art is loading and draws nothing when the art arrives', async () => {
  const { manager, scene } = setup();
  const fetchAsset = globalThis.fetch;
  let finishLoading!: () => void;
  const loading = new Promise<void>(resolve => { finishLoading = resolve; });
  vi.stubGlobal('fetch', async (...args: Parameters<typeof fetch>) => {
    await loading;
    return fetchAsset(...args);
  });
  // SpawnPrefab is synchronous: the star and its loop exist before the art.
  const star = manager.spawn(new THREE.Vector3());
  const model = modelIn(scene, star)!;
  expect(model.parent).toBe(scene);
  expect(star.sprite.loaded).toBe(false);
  const loop = sounds('dontstarve/common/staff_star_LP')[0];
  manager.dispose();
  expect(loop.stop).toHaveBeenCalled();
  expect(star.isRemoved).toBe(true);
  finishLoading();
  await settle(); await settle();
  expect(scene.children).toEqual([]);
  expect(star.sprite.loaded).toBe(false);
  expect(manager.exportRecords()).toEqual([]);
});

it('world clock and season changes do not restart the idle', async () => {
  const { manager, scene } = setup();
  const star = await artLoaded(scene, manager.spawn(new THREE.Vector3()));
  const play = vi.spyOn(star.sprite, 'playOnce'), idle = vi.spyOn(star.sprite, 'start');
  clockstate.set({ phase: 'dusk', timeinphase: 0.5 });
  seasonstate.set({ season: 'winter', progress: 0.5 });
  await Promise.resolve();
  expect(play).not.toHaveBeenCalled();
  expect(idle).not.toHaveBeenCalled();
});

it('heats nearby thermal stones with distance falloff until permanent removal', async () => {
  const { manager, update } = setup();
  const star = manager.spawn(new THREE.Vector3());
  const source = FindEntities(star.position, 1, ['HASHEATER'])[0];
  expect(source.prefab).toBe('stafflight');
  expect(source.components.heater!.GetHeat()).toBe(100);
  expect(source.components.heater!.IsExothermic()).toBe(true);
  expect(source.components.heater!.IsEndothermic()).toBe(false);
  expect(source.components.heater!.ShouldFalloff()).toBe(true);
  expect(source.components.heater!.GetHeatRadiusCutoff()).toBeUndefined();
  const updates = new ComponentUpdates();
  const stone = new ItemEntity({ itemId: 'heatrock', count: 1, temperature: { current: 30 } });
  configureHeatRockEntity(stone);
  stone.BindTemperatureWorld({
    temperature: createSignal(0), componentUpdates: updates, unitScale: TILE_SIZE / 4,
    findHeaters: (position, radius, ignoredTags) => FindEntities(position, radius, ['HASHEATER'], ignoredTags),
  });
  const temperature = stone.components.temperature!;
  const rock = stone.getComponent<HeatRock>('heatrock')!;
  try {
    expect(rock.range.peek()).toBe(4);
    updates.update(1);
    expect(temperature.GetCurrent()).toBe(31);
    expect(rock.range.peek()).toBe(5);
    // Half the search radius: heat = 100 * (1 - .5²) = 75; equilibrium with ambient 0 is 37.5.
    stone.getPosition().set(5 * TILE_SIZE / 4, 0, 0);
    temperature.SetTemperature(37.5);
    updates.update(1);
    expect(temperature.GetCurrent()).toBe(37.5);
    // At the search boundary the heat contribution is zero.
    stone.getPosition().set(10 * TILE_SIZE / 4, 0, 0);
    updates.update(1);
    expect(temperature.GetCurrent()).toBeCloseTo(37.3);
    stone.getPosition().set(0, 0, 0);
    star.components.hauntable!.DoHaunt(haunter);
    updates.update(1);
    expect(temperature.GetCurrent()).toBeCloseTo(38.3); // Lua keeps heater during disappearance.
    update(1.01);
    expect(source.hasTag('HASHEATER')).toBe(false);
    expect(FindEntities(star.position, 1, ['HASHEATER'])).toEqual([]);
    updates.update(1);
    expect(temperature.GetCurrent()).toBeCloseTo(38.1);
  } finally { stone.destroy(); updates.dispose(); }
});

it('cools nearby thermal stones with endothermic falloff until permanent removal', async () => {
  const { manager, update, awake } = setup('staffcoldlight');
  const star = manager.spawn(new THREE.Vector3());
  const source = FindEntities(star.position, 1, ['HASHEATER'])[0];
  const heater = source.components.heater!;
  expect(source.prefab).toBe('staffcoldlight');
  expect(heater.GetHeat()).toBe(-100);
  expect(heater.IsExothermic()).toBe(false);
  expect(heater.IsEndothermic()).toBe(true);
  expect(heater.ShouldFalloff()).toBe(true);
  expect(source.components.propagator).toBeUndefined();
  const updates = new ComponentUpdates();
  const stone = new ItemEntity({ itemId: 'heatrock', count: 1, temperature: { current: 6 } });
  configureHeatRockEntity(stone);
  stone.BindTemperatureWorld({
    temperature: createSignal(35), componentUpdates: updates, unitScale: TILE_SIZE / 4,
    findHeaters: (position, radius, ignoredTags) => FindEntities(position, radius, ['HASHEATER'], ignoredTags),
  });
  const temperature = stone.components.temperature!, rock = stone.getComponent<HeatRock>('heatrock')!;
  try {
    expect(rock.range.peek()).toBe(2);
    updates.update(1);
    expect(temperature.GetCurrent()).toBe(5);
    expect(rock.range.peek()).toBe(1);
    // Cold-source falloff is relative to overheattemp 70: (-100 - 70) * .75 + 70 = -57.5.
    stone.transform.position.set(5 * TILE_SIZE / 4, 0, 0);
    temperature.SetTemperature(-11.25); // Equilibrium between ambient 35 and cooling target -57.5.
    updates.update(1);
    expect(temperature.GetCurrent()).toBe(-11.25);
    stone.transform.position.set(10 * TILE_SIZE / 4, 0, 0);
    updates.update(1);
    expect(temperature.GetCurrent()).toBeCloseTo(-11.05);
    awake.set(false);
    await settle();
    expect(star.status.peek()).toBe('asleep');
    expect(source.components.heater).toBe(heater);
    awake.set(true);
    await settle();
    expect(FindEntities(star.position, 1, ['HASHEATER'])[0].components.heater).toBe(heater);
    stone.transform.position.set(0, 0, 0);
    temperature.SetTemperature(5);
    star.components.hauntable!.DoHaunt(haunter);
    updates.update(1);
    expect(temperature.GetCurrent()).toBe(4);
    update(1.01);
    expect(source.hasTag('HASHEATER')).toBe(false);
    expect(FindEntities(star.position, 1, ['HASHEATER'])).toEqual([]);
    updates.update(1);
    expect(temperature.GetCurrent()).toBeCloseTo(4.2);
  } finally { stone.destroy(); updates.dispose(); }
});

it('spawns world lights through console definitions and saves and reloads their identity, position and settled lifetime', async () => {
  const position = new THREE.Vector3(6, 7, 9), scheduler = new GameTimeScheduler();
  const createRegistry = () => {
    const registry = new EntityRegistry();
    for (const definition of [PREFAB_DEFINITIONS.dwarfStars, PREFAB_DEFINITIONS.polarLights]) {
      const manager = new DwarfStarManager(new PrefabDisplayGroup(new THREE.Scene()), '/dst/data/anim', { scheduler }, definition.prefabIds[0]);
      managers.push(manager);
      registry.register(definition, {
        restore: (_, record) => manager.spawn(new THREE.Vector3(...record.transform.position), {
          id: record.id, remainingSeconds: record.components.timer!.remainingSeconds,
        }),
        debugSpawn: () => manager.spawn(position.clone()),
        exportRecords: () => manager.exportRecords().map(record => ({ prefabId: manager.prefabId, record })),
        update: (dt, quaternion) => { manager.update(dt, quaternion); },
        dispose: () => manager.dispose(),
      });
    }
    return registry;
  };
  const registry = createRegistry();
  const inventory = new InventoryStore([], SAVE_CATALOG.items);
  const template = deserializeSave(await readFile(new URL('../../../public/saves/initial-world.json', import.meta.url), 'utf8'), SAVE_CATALOG);
  const spawn = await executeDebugCommand('c_spawn("stafflight"); c_spawn("staffcoldlight")', inventory,
    prefab => registry.spawn(prefab));
  expect(spawn.ok).toBe(true);
  scheduler.advance(0.25);
  let exported = '';
  const save = await executeDebugCommand('c_save()', inventory, undefined, () => {
    exported = serializeSave(template, {
      entities: { ...template.world.entities, ...registry.exportRecords() }, inventory: inventory.exportState(),
      playerTransform: { position: [6, 0, 9], rotationY: 0 }, elapsedSeconds: 0.25,
    }, SAVE_CATALOG);
  });
  expect(save.ok).toBe(true);
  const saved = deserializeSave(exported, SAVE_CATALOG);
  const records = { stafflight: saved.world.entities.stafflight, staffcoldlight: saved.world.entities.staffcoldlight };
  expect(records.stafflight[0].transform.position).toEqual([6, 0, 9]);
  expect(records.stafflight[0].components.timer!.remainingSeconds).toBe(DWARF_STAR_DURATION - 0.25);
  expect(records.staffcoldlight[0].components.timer!.remainingSeconds).toBe(960 - 0.25);
  expect(exported).not.toContain('staffLightState');
  const soundsBeforeRestore = vi.mocked(PlaySound).mock.calls.length;
  const restored = createRegistry();
  await restored.restoreAll(records);
  expect(restored.exportRecords()).toEqual(records);
  expect(vi.mocked(PlaySound).mock.calls.slice(soundsBeforeRestore).map(([event]) => event))
    .toEqual(['dontstarve/common/staff_star_LP', 'dontstarve/common/staff_star_create', 'dontstarve/common/staff_coldlight_LP', 'dontstarve/common/staff_star_create']);
  for (const entity of restored.byEntityId.values()) {
    const star = entity as PrefabInstance;
    expect(star.persists).toBe(true);
    const heater = star.components.heater!;
    expect(FindEntities(star.position, 1, ['HASHEATER']).map(found => found.components.heater)).toContain(heater);
    expect(heater.GetHeat()).toBe(star.prefab === 'stafflight' ? 100 : -100);
    expect(heater.IsEndothermic()).toBe(star.prefab === 'staffcoldlight');
  }
  const stars = [...registry.byEntityId.values(), ...restored.byEntityId.values()] as PrefabInstance[];
  registry.dispose(); restored.dispose(); inventory.dispose();
  for (const star of stars) expect(star.hasTag('HASHEATER')).toBe(false);
});
