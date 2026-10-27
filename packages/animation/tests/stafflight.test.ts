import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { DwarfStarManager, dwarfStarLight, DWARF_STAR_DURATION, STAFF_LIGHT_ACTIVE_RADIUS, getStaffLightState, type StaffLightId } from '../../prefab/src/stafflight';
import { PlaySound } from '../../prefab/src/sound';
import type { SpriteAnimationController } from '../src/sprite';
import { SpriteState } from '@dontstarve-web/display';
import { setSpriteEntityRenderOrder } from '../src/renderOrder';
import { clockstate, seasonstate, createSignal } from '@dontstarve-web/signals';
import { InventoryStore, ItemEntity } from '../../inventory/src';
import { ComponentUpdates } from '../../componets/src/componentUpdates';
import { configureHeatRockEntity, type HeatRock } from '../../prefab/src/heatrock';
import { FindEntities } from '../../prefab/src/actionEntity';
import { TILE_SIZE } from '../../prefab/src/tile';
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';

/** The inst.Light an entity's model declares. */
const declaredLight = (model: THREE.Object3D) => prefabInstance(model)?.light.peek();

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
/** The factory sprite the star's display has drawn, if any. */
const drawn = (model: THREE.Object3D) => model.children.find(child => child.userData.animationController);
/** A star exists as soon as it is spawned; its display then loads the art and the presentation starts in a later task. */
async function artLoaded<T extends THREE.Object3D>(model: T): Promise<T> {
  await model.userData.display.artLoaded();
  await settle();
  return model;
}

function setup(prefab: StaffLightId = 'stafflight') {
  const scene = new THREE.Scene(), player = new THREE.Vector3();
  const manager = new DwarfStarManager(scene, '/dst/data/anim', prefab, () => player);
  managers.push(manager);
  const update = (dt: number) => manager.update(dt, new THREE.Quaternion());
  return { manager, scene, player, update };
}

it('heats nearby thermal stones with distance falloff until permanent removal', async () => {
  const { manager, update } = setup();
  const model = await manager.spawn(new THREE.Vector3());
  const source = FindEntities(model.position, 1, ['HASHEATER'])[0];
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
    manager.haunt(model);
    updates.update(1);
    expect(temperature.GetCurrent()).toBeCloseTo(38.3); // Lua keeps heater during disappearance.
    update(1.01);
    expect(source.hasTag('HASHEATER')).toBe(false);
    expect(source.components.heater).toBeUndefined();
    expect(FindEntities(model.position, 1, ['HASHEATER'])).toEqual([]);
    updates.update(1);
    expect(temperature.GetCurrent()).toBeCloseTo(38.1);
  } finally { stone.destroy(); updates.dispose(); }
});

it('cools nearby thermal stones with endothermic falloff until permanent removal', async () => {
  const { manager, update, player } = setup('staffcoldlight');
  const model = await manager.spawn(new THREE.Vector3());
  const source = FindEntities(model.position, 1, ['HASHEATER'])[0];
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
    player.set(STAFF_LIGHT_ACTIVE_RADIUS + 1, 0, 0);
    update(.1); await settle();
    expect(model.parent).toBeNull();
    expect(source.components.heater).toBe(heater);
    player.set(0, 0, 0);
    update(.1);
    expect(FindEntities(model.position, 1, ['HASHEATER'])[0].components.heater).toBe(heater);
    stone.transform.position.set(0, 0, 0);
    temperature.SetTemperature(5);
    manager.haunt(model);
    updates.update(1);
    expect(temperature.GetCurrent()).toBe(4);
    update(1.01);
    expect(source.hasTag('HASHEATER')).toBe(false);
    expect(source.components.heater).toBeUndefined();
    expect(FindEntities(model.position, 1, ['HASHEATER'])).toEqual([]);
    updates.update(1);
    expect(temperature.GetCurrent()).toBeCloseTo(4.2);
  } finally { stone.destroy(); updates.dispose(); }
});

it('settles lifetime at frame 60 using actual dt and releases light, sound and geometry after disappearance', async () => {
  const { manager, scene, update } = setup();
  const model = await artLoaded(manager.spawn(new THREE.Vector3(), { id: 'e_star', remainingSeconds: 0.8 }));
  const state = getStaffLightState(model)!;
  const remainingChanges: number[] = [], phases: string[] = [];
  state.remaining.subscribe(value => remainingChanges.push(value));
  state.phase.subscribe(value => phases.push(value));
  expect(state.phase.peek()).toBe('active');
  expect(state.removed.peek()).toBe(false);
  expect('set' in state.remaining).toBe(false);
  expect('set' in state.removed).toBe(false);
  expect('dispose' in state.phase).toBe(false);
  const controller = model.userData.animationController as SpriteAnimationController;
  const play = vi.spyOn(controller, 'playOnce');
  const loop = vi.mocked(PlaySound).mock.results[0].value;
  for (let frame = 0; frame < 59; frame++) update(0.01);
  for (const dt of [0, -1, NaN, Infinity]) update(dt);
  expect(play).not.toHaveBeenCalled();
  expect(remainingChanges).toEqual([]);
  // One long frame counts once, but its whole duration is consumed.
  update(0.31);
  expect(state.remaining.peek()).toBe(0);
  expect(state.phase.peek()).toBe('disappearing');
  expect(state.removed.peek()).toBe(false);
  expect(model.userData.instance?.persists).toBe(false);
  expect(manager.exportRecords()).toEqual([]); // Domain state commits before the effect.
  expect(play).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(play).toHaveBeenCalledExactlyOnceWith('disappear', expect.any(Function));
  expect(loop.stop).not.toHaveBeenCalled();
  expect(model.parent).toBe(scene);
  // animover stops the loop, while the domain removal deadline owns entity removal.
  play.mock.calls[0][1]!();
  expect(loop.stop).toHaveBeenCalledOnce();
  expect(model.parent).toBe(scene);
  update(0.89);
  expect(model.parent).toBe(scene);
  update(0.02); // Past expiry + 1, but before settlement time + 1.
  await Promise.resolve();
  expect(model.parent).toBeNull();
  expect(declaredLight(model)).toBeUndefined();
  expect(loop.stop).toHaveBeenCalled();
  expect(state.removed.peek()).toBe(true);
  expect(state.phase.peek()).toBe('removed');
  expect(remainingChanges).toEqual([0]);
  expect(phases).toEqual(['disappearing', 'removed']);
  expect(play).toHaveBeenCalledOnce();
  const stops = loop.stop.mock.calls.length;
  play.mock.calls[0][1]!(); // A late completion cannot act on a removed binding.
  expect(loop.stop).toHaveBeenCalledTimes(stops);
});

it('unloads outside the circular XZ range and rebuilds in place after catching up without replaying appearance', async () => {
  const { manager, scene, player, update } = setup();
  const position = new THREE.Vector3(4, 0, 6);
  const appearances = vi.spyOn(SpriteState.prototype, 'playOnce');
  const model = await artLoaded(manager.spawn(position));
  const instance = prefabInstance(model)!;
  const oldAppearDone = appearances.mock.calls.find(([clip]) => clip === 'appear')![1]!;
  const state = getStaffLightState(model)!;
  const controller = model.userData.animationController as SpriteAnimationController;
  const heater = model.userData.components.heater;
  const animationUpdate = vi.spyOn(controller, 'update');
  const oldSprite = drawn(model)!;
  const mesh = oldSprite.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
  const sharedMaterial = mesh.material[0];
  const disposeMaterial = vi.spyOn(sharedMaterial, 'dispose');
  const disposeTexture = vi.spyOn(sharedMaterial.map!, 'dispose');
  update(0.2);
  player.set(position.x + STAFF_LIGHT_ACTIVE_RADIUS, 500, position.z);
  update(0.1);
  expect(model.parent).toBe(scene);
  player.x += 0.001;
  update(0.1); await settle();
  expect(model.parent).toBeNull();
  expect(drawn(model)).toBeUndefined();
  expect(model.userData.animationController).toBe(controller);
  expect(disposeMaterial).not.toHaveBeenCalled();
  expect(disposeTexture).not.toHaveBeenCalled();
  expect(declaredLight(model)).toBeUndefined();
  expect(manager.renderEntities).toEqual([]);
  expect(state.removed.peek()).toBe(false);
  expect(state.phase.peek()).toBe('active');
  expect(model.userData.components.heater).toBe(heater);
  const oldLoop = vi.mocked(PlaySound).mock.results[1].value;
  expect(oldLoop.stop).toHaveBeenCalledOnce();
  animationUpdate.mockClear();
  for (let frame = 0; frame < 120; frame++) update(0.1);
  expect(animationUpdate).not.toHaveBeenCalled();
  player.copy(position);
  update(0.2); await settle();
  expect(model.parent).toBe(scene);
  const newSprite = drawn(model)!;
  expect(FindEntities(model.position, 1, ['HASHEATER'])[0].components.heater).toBe(heater);
  expect(newSprite).not.toBe(oldSprite);
  expect(prefabInstance(model)).toBe(instance);
  expect(newSprite.userData).not.toHaveProperty('entityId');
  expect(getStaffLightState(model)).toBe(state);
  const newIdle = vi.spyOn(model.userData.animationController as SpriteAnimationController, 'start');
  oldAppearDone(); // The old model cannot restart animation on the replacement.
  expect(newIdle).not.toHaveBeenCalled();
  const newMesh = newSprite.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
  expect(newMesh.material[0]).toBe(sharedMaterial);
  expect(newMesh.geometry).not.toBe(mesh.geometry);
  expect(manager.renderEntities[0].object).toBe(model);
  expect(manager.renderEntities[0].footPosition).toBe(model.position);
  setSpriteEntityRenderOrder(newSprite, 7);
  expect(newSprite.children[0].renderOrder).toBe(7);
  expect(PlaySound).toHaveBeenCalledTimes(3); // Creation, old loop, resumed loop.
  const record = manager.exportRecords()[0];
  expect(record.id).toBe(model.userData.instance?.entityId);
  expect(record.transform.position).toEqual(position.toArray());
  expect(record.components.timer.remainingSeconds).toBeCloseTo(DWARF_STAR_DURATION - 12.6);
  expect(declaredLight(model)!.radius).toBeCloseTo(dwarfStarLight(12.6).radius);
  // Moving the entity handle also updates proximity in the current frame.
  model.position.x = player.x + STAFF_LIGHT_ACTIVE_RADIUS + 1;
  update(0.1); await settle();
  expect(model.parent).toBeNull();
  player.copy(model.position);
  update(0.1); await settle();
  expect(model.parent).toBe(scene);
  expect(manager.exportRecords()[0].transform.position).toEqual(model.position.toArray());
});

it('keeps active presentation stable and cancels queued disappearance on explicit removal', async () => {
  const { manager, update } = setup();
  const model = await manager.spawn(new THREE.Vector3(), { id: 'e_cancelled', remainingSeconds: 100 });
  const state = getStaffLightState(model)!;
  const animation = model.userData.animationController as SpriteAnimationController;
  const play = vi.spyOn(animation, 'playOnce');
  const idle = vi.spyOn(animation, 'start');
  const oldLoop = vi.mocked(PlaySound).mock.results[0].value;
  for (let frame = 0; frame < 60; frame++) update(0.01);
  await Promise.resolve();
  expect(state.remaining.peek()).toBeCloseTo(99.4);
  expect(play).not.toHaveBeenCalled();
  idle.mockClear();
  clockstate.set({ phase: 'dusk', timeinphase: 0.5 });
  seasonstate.set({ season: 'winter', progress: 0.5 });
  await Promise.resolve();
  expect(play).not.toHaveBeenCalled();
  expect(idle).not.toHaveBeenCalled();
  expect(manager.haunt(model)).toBe(true);
  expect(state.phase.peek()).toBe('disappearing');
  expect(manager.haunt(model)).toBe(true); // Does not register another disappearance.
  expect(manager.remove(model)).toBe(true);
  expect(manager.remove(model)).toBe(false);
  expect(state.phase.peek()).toBe('removed');
  expect(model.parent).toBeNull();
  expect(declaredLight(model)).toBeUndefined();
  expect(oldLoop.stop).toHaveBeenCalledOnce();
  await Promise.resolve();
  update(10);
  expect(play).not.toHaveBeenCalled();
  expect(manager.renderEntities).toEqual([]);
  expect(manager.exportRecords()).toEqual([]);
});

it('haunting starts disappearance once and keeps the original one-second removal deadline', async () => {
  const { manager, scene, update } = setup();
  const model = await manager.spawn(new THREE.Vector3(), { id: 'e_haunted', remainingSeconds: 100 });
  const state = getStaffLightState(model)!;
  const play = vi.spyOn(model.userData.animationController as SpriteAnimationController, 'playOnce');
  expect(manager.haunt(model)).toBe(true);
  expect(state.remaining.peek()).toBe(0);
  expect(model.userData.instance?.persists).toBe(false);
  await Promise.resolve();
  expect(play).toHaveBeenCalledExactlyOnceWith('disappear', expect.any(Function));
  update(0.6);
  expect(manager.haunt(model)).toBe(true);
  expect(model.parent).toBe(scene);
  update(0.41);
  expect(state.phase.peek()).toBe('removed');
  expect(manager.haunt(model)).toBe(false);
  await Promise.resolve();
  expect(play).toHaveBeenCalledOnce();
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
  // SpawnPrefab is synchronous: the star, its light and its loop exist before the art.
  const model = manager.spawn(new THREE.Vector3());
  expect(model.parent).toBe(scene);
  expect(drawn(model)).toBeUndefined();
  const loop = vi.mocked(PlaySound).mock.results.at(-1)!.value;
  manager.dispose();
  expect(loop.stop).toHaveBeenCalled();
  expect(getStaffLightState(model)!.removed.peek()).toBe(true);
  finishLoading();
  await settle(); await settle();
  expect(scene.children).toEqual([]);
  expect(drawn(model)).toBeUndefined();
  expect(manager.exportRecords()).toEqual([]);
});

it('flushes partial and sleeping time for saves, restores identity and removes expired sleepers before waking', async () => {
  const { manager, player, update } = setup();
  const near = await manager.spawn(new THREE.Vector3(1, 0, 2), { id: 'e_near', remainingSeconds: 100 });
  const far = await manager.spawn(new THREE.Vector3(STAFF_LIGHT_ACTIVE_RADIUS + 5, 0, 0),
    { id: 'e_far', remainingSeconds: 100 });
  const expired = await manager.spawn(far.position.clone(), { id: 'e_expired', remainingSeconds: 0.5 });
  expect(far.parent).toBeNull();
  await settle();
  expect(drawn(far)).toBeUndefined();
  expect(drawn(expired)).toBeUndefined();
  expect(getStaffLightState(expired)!.phase.peek()).toBe('active');
  expect(PlaySound).toHaveBeenCalledTimes(1);
  update(0.2); update(0.3);
  const records = manager.exportRecords();
  expect(records.map(({ id }) => id)).toEqual(['e_near', 'e_far']);
  expect(records.every(({ components }) => components.timer.remainingSeconds === 99.5)).toBe(true);
  expect(expired.parent).toBeNull();
  expect(getStaffLightState(expired)!.phase.peek()).toBe('removed');
  update(0.4);
  expect(manager.exportRecords().every(({ components }) => components.timer.remainingSeconds === 99.1)).toBe(true);
  const restored = setup();
  for (const record of manager.exportRecords()) await restored.manager.spawn(new THREE.Vector3(...record.transform.position), {
    id: record.id, remainingSeconds: record.components.timer.remainingSeconds,
  });
  expect(restored.manager.exportRecords()).toEqual(manager.exportRecords());
  const sounds = vi.mocked(PlaySound).mock.calls.length;
  update(100);
  player.copy(far.position);
  update(0.1);
  expect(far.parent).toBeNull();
  await settle();
  expect(drawn(far)).toBeUndefined();
  expect(PlaySound).toHaveBeenCalledTimes(sounds);
  manager.dispose();
  expect(near.parent).toBeNull();
  expect(getStaffLightState(near)!.phase.peek()).toBe('removed');
});

it('spawns world lights through console definitions and saves and reloads their identity, position and settled lifetime', async () => {
  const position = new THREE.Vector3(6, 7, 9);
  const createRegistry = () => {
    const registry = new EntityRegistry();
    for (const definition of [PREFAB_DEFINITIONS.dwarfStars, PREFAB_DEFINITIONS.polarLights]) {
      const manager = new DwarfStarManager(new THREE.Scene(), '/dst/data/anim', definition.prefabIds[0]);
      managers.push(manager);
      registry.register(definition, {
        restore: (_, record) => manager.spawn(new THREE.Vector3(...record.transform.position), {
          id: record.id, remainingSeconds: record.components.timer!.remainingSeconds,
        }),
        debugSpawn: () => manager.spawn(position.clone()),
        exportRecords: () => manager.exportRecords().map(record => ({ prefabId: manager.prefabId, record })),
        update: (dt, quaternion) => manager.update(dt, quaternion),
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
  registry.update(0.25, new THREE.Quaternion());
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
    .toEqual(['dontstarve/common/staff_star_LP', 'dontstarve/common/staff_coldlight_LP']);
  for (const entity of restored.byEntityId.values()) {
    const model = entity as THREE.Object3D;
    expect(getStaffLightState(model)!.phase.peek()).toBe('active');
    const heater = FindEntities(model.position, 1, ['HASHEATER']).find(entity => entity === model.userData.actionEntity)!.components.heater!;
    expect(heater.GetHeat()).toBe(model.name === 'stafflight' ? 100 : -100);
    expect(heater.IsEndothermic()).toBe(model.name === 'staffcoldlight');
  }
  const models = [...registry.byEntityId.values(), ...restored.byEntityId.values()] as THREE.Object3D[];
  registry.dispose(); restored.dispose(); inventory.dispose();
  for (const model of models) expect(model.userData.components?.heater).toBeUndefined();
});
