import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { createTestWorldSources } from './worldContentFixture';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal, getWatchWorldContent, type WorldPhase, type WorldContentEnvironment, type GetWatchWorldContent } from '../../signals/src';
import { ItemEntity } from '../../inventory/src/entity';
import type { InventoryStack } from '../../inventory/src/types';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { loadAnim } from '../src/animationAssets';
import { Mole, configureMoleEntity } from '../../prefab/src/mole';
import { createMoleHabitat, molehillPrefabs, MOLEHILL_ID, type MolehillInstance } from '../../prefab/src/molehill';
import { configureMoleBaitEntity, MoleBait } from '../../prefab/src/molebait';
import { createMoleAction } from '../../stategraphs/src/moleactions';
import { Combat } from '../../componets/src/combat';
import { Weapon } from '../../componets/src/weapon';
import { createInventoryStore } from '../../../src/inventory';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

async function fixture(daytime = false) {
  const scheduler = new GameTimeScheduler(), cycle = createSignal<WorldPhase>(daytime ? 'day' : 'dusk'), heading = createSignal(0), awake = createSignal(true);
  const items: ItemEntity[] = [], baits: MoleBait[] = [], drops: { entity?: ItemEntity; prefab: string; position: THREE.Vector3 }[] = [];
  const spawnItem = (state: InventoryStack) => { const item = new ItemEntity(state); items.push(item); if (state.itemId === 'mole') configureMoleEntity(item); else configureMoleBaitEntity(item); return item; };
  const sources: WorldContentEnvironment = { ...createTestWorldSources(scheduler), playerpositions: createSignal<import('three').Vector3[]>([]), snowLevel: createSignal(0), wind: createSignal({ angle: 0, velocity: 1 }), perishTick: createSignal({ time: 0, total: 0 }), scheduler, temperature: createSignal(30), cycle, season: createSignal({ season: 'spring', progress: .5 }) };
  const requests = vi.fn();
  const watch: GetWatchWorldContent = (key, register) => {
    requests(key); return getWatchWorldContent(key, register, sources);
  };
  const displays = new PrefabDisplayGroup(new THREE.Scene());
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { tickingarea: () => createMemo(() => awake.get()) });
  const fx = vi.fn();
  const habitat = createMoleHabitat({
    getWatchWorldContent: watch, cameraHeading: heading, isWalkable: () => true,
    spawnPrefab: (prefab, position) => prefabs.spawn(prefab, position) as MolehillInstance, fx: { spawn: fx },
    spawnItem, dropItem: (entity, position) => { entity.transform.copyPosition(position); entity.PushEvent('ondropped', undefined); drops.push({ entity, prefab: entity.prefab, position: position.clone() }); },
    showMole: () => undefined, dropLoot: (prefab, position) => drops.push({ prefab, position }),
    getEntities: () => [...baits, ...habitat.getMoles()],
  });
  prefabs.register(molehillPrefabs(habitat) as never);
  const hills = () => prefabs.exportRecords().map(({ record }) => record);
  const spawnHill = (position: THREE.Vector3, saved?: Parameters<typeof prefabs.spawn>[2]) => prefabs.spawn(MOLEHILL_ID, position, saved) as MolehillInstance;
  const bank = await loadAnim('mole_basic.zip', '/dst/data/anim');
  const lengths = new Map(bank.animations.map(clip => [clip.name, clip.frames.length / clip.frameRate]));
  const mole = (position = new THREE.Vector3(), entityId?: string) => {
    const entity = spawnItem({ itemId: 'mole', count: 1, ...(entityId ? { entityId } : {}) }); entity.getPosition().copy(position);
    const runtime = entity.getComponent<Mole>('mole')!; runtime.bindWorld(habitat, lengths); return runtime;
  };
  const bait = (id: string, position = new THREE.Vector3(3, 0, 0), count = 1) => {
    const entity = spawnItem({ itemId: id, count }); entity.getPosition().copy(position);
    const target = new MoleBait(entity, scheduler, () => true); baits.push(target); return target;
  };
  const advance = async (seconds: number, runBrain = true) => {
    for (let i = 0; i < Math.ceil(seconds * 30); i++) {
      scheduler.advance(1 / 30); if (runBrain) for (const runtime of habitat.getMoles()) runtime.update(1 / 30);
    }
    await settle();
  };
  const dispose = () => { prefabs.dispose(); displays.dispose(); baits.forEach(b => b.dispose()); items.forEach(e => e.destroy()); scheduler.dispose(); };
  return { scheduler, cycle, awake, watch: requests, prefabs, habitat, hills, spawnHill, fx, lengths, mole, bait, advance, drops, items, dispose };
}

it('uses the Lua brain to steal minerals, build a home and deposit the same item entities', async () => {
  const f = await fixture(), mole = f.mole();
  const bait = f.bait('rocks', new THREE.Vector3(3, 0, 0), 7), id = bait.entity.id;
  await f.advance(10);
  expect(mole.components.inventory!.GetItems().map(e => e.id)).toContain(id);
  expect(bait.entity.snapshot().count).toBe(7);
  expect(bait.entity.components.inventoryitem.owner).not.toBeNull();
  // SGmole's SpawnMoveFx goes through world_fx's mole_move_fx.
  expect(f.fx).toHaveBeenCalledWith('mole_move_fx', expect.any(THREE.Vector3));
  // The source tests for a missing home after its first delay, then waits another make_home_delay.
  await f.advance(25);
  expect(f.hills()).toHaveLength(1);
  const hill = mole.home!;
  expect(hill.getPosition().distanceToSquared(mole.getPosition())).toBeLessThan((20 * 3) ** 2);
  f.cycle.set('day'); await settle();
  await f.advance(25);
  const record = f.hills()[0];
  expect(record.components.molehill!.items.map(e => e.entityId)).toContain(id);
  expect(record.components.molehill!.child?.entityId).toBe(mole.id);
  expect(record.components.molehill!.child?.mole?.health).toBe(30);
  expect(mole.hasTag('INLIMBO')).toBe(true);
  f.dispose();
});

it('revalidates stolen bait at frame 12 and cancels a stolen target that moved into an inventory', async () => {
  const f = await fixture(), mole = f.mole(), bait = f.bait('flint'); mole.brain.Stop();
  expect(bait.reserve()).toBe(true); expect(bait.reserve()).toBe(false);
  mole.PushBufferedAction(createMoleAction(mole, 'STEALMOLEBAIT', bait));
  f.scheduler.advanceTo(f.lengths.get('enter')! + f.lengths.get('idle')!); await settle();
  expect(mole.sg.stateName).toBe('steal');
  f.scheduler.advance(11 / 30); await settle(); expect(mole.inventoryFull()).toBe(false); expect(mole.components.inventory!.GetItems()).toHaveLength(0);
  bait.entity.components.inventoryitem.owner = { address: { containerId: 'player:inventory', slotKey: '0' }, changed() {}, remove: () => true, replace: () => false, PushEvent() {} };
  f.scheduler.advance(1 / 30); await settle();
  expect(mole.components.inventory!.GetItems()).toHaveLength(0);
  expect(mole.bufferedaction).toBeUndefined();
  f.dispose();
});

it('hammer attacks stun above ground, drop stolen inventory, allow pickup and detach the home child', async () => {
  const f = await fixture(), mole = f.mole(); mole.brain.Stop();
  const bait = f.bait('nitre', new THREE.Vector3(), 3);
  expect(mole.components.inventory!.GiveItem(bait.entity)).toBe(true);
  const hill = f.spawnHill(new THREE.Vector3(15, 0, 0)); hill.components.spawner.TakeOwnership(mole);
  mole.setAbove(); mole.sg.goToState('idle');
  const attacker = { components: {}, getPosition: () => new THREE.Vector3(), getPhysicsRadius: () => 1, hasTag: () => true };
  const hammer = new Weapon({ hasTag: (tag: string) => tag === 'hammer' }); hammer.SetDamage(17);
  const combat = new Combat(attacker, () => f.scheduler.now, () => hammer);
  expect(combat.CanTarget(mole)).toBe(true); combat.DoAttack(mole);
  expect(mole.sg.stateName).toBe('stunned'); expect(mole.components.health.currenthealth).toBe(13);
  expect(mole.entity.components.inventoryitem.canbepickedup).toBe(true);
  expect(f.drops[0].entity).toBe(bait.entity); expect(f.drops[0].entity!.snapshot().count).toBe(3);
  mole.entity.components.inventoryitem.owner = { address: { containerId: 'player:inventory', slotKey: '0' }, changed() {}, remove: () => true, replace: () => false, PushEvent() {} };
  mole.entity.PushEvent('onputininventory', mole.entity.components.inventoryitem.owner);
  expect(hill.components.spawner.child).toBeUndefined(); expect(mole.home).toBeUndefined();
  expect(mole.entity.snapshot().mole?.health).toBe(13);
  mole.entity.components.perishable.SetPercent(.25);
  const food = f.bait('rocks', new THREE.Vector3(), 2).entity;
  expect(mole.entity.components.eater!.Eat(food)).toBe(true);
  expect(mole.components.health.currenthealth).toBe(23);
  expect(mole.entity.components.perishable.GetPercent()).toBe(1);
  expect(food.components.stackable.count).toBe(1);
  expect(mole.brain.stopped).toBe(true);
  mole.entity.components.inventoryitem.owner = null; mole.entity.PushEvent('ondropped', undefined);
  expect(mole.sg.stateName).toBe('stunned');
  await f.advance(10);
  expect(mole.entity.components.inventoryitem.canbepickedup).toBe(false);
  f.dispose();
});

it('saves an occupied molehill with its stored items and releases the same child when dug up after reload', async () => {
  const f = await fixture(true), mole = f.mole(new THREE.Vector3(9, 0, 15)); mole.brain.Stop();
  const bait = f.bait('goldnugget', new THREE.Vector3(), 4); mole.components.inventory!.GiveItem(bait.entity);
  const extra = f.bait('goldnugget', new THREE.Vector3(), 1); mole.components.inventory!.GiveItem(extra.entity);
  expect(extra.entity.isRemoved).toBe(true); expect(bait.entity.components.stackable.count).toBe(5);
  const hill = f.spawnHill(new THREE.Vector3(9, 0, 15)), model = hill.transform.model;
  hill.components.spawner.TakeOwnership(mole); expect(mole.wentHome(hill)).toBe(true);
  const record = f.hills()[0], moleId = mole.id, baitId = bait.entity.id;
  f.awake.set(false); await settle();
  expect(hill.status.peek()).toBe('asleep');
  expect(hill.sprite.loaded).toBe(false);
  expect(model.parent).toBeNull();
  expect(f.hills()).toEqual([record]);
  f.dispose();
  const restored = await fixture(true);
  restored.awake.set(false);
  const loaded = restored.spawnHill(new THREE.Vector3(...record.transform.position), record), hillModel = loaded.transform.model;
  await settle();
  expect(loaded.status.peek()).toBe('asleep');
  expect(loaded.components.spawner.IsOccupied()).toBe(true);
  expect(loaded.components.spawner.child!.id).toBe(moleId);
  expect(loaded.components.inventory.GetItems()[0].id).toBe(baitId);
  expect(loaded.components.inventory.GetItems()[0].snapshot().count).toBe(5);
  restored.awake.set(true); await settle();
  // Restored asleep, the hill's display loads its art once the tile wakes.
  await prefabDisplay(hillModel)!.artLoaded();
  expect(loaded.sprite.loaded).toBe(true);
  expect(loaded.sprite.currentAnimation).toBe('mound_idle');
  expect(loaded.position).toBe(hillModel.position);
  // mound_idle stays upright in LAYER_BACKGROUND, including after reload.
  expect(hillModel.children[0].children[0].rotation.x).toBe(0);
  expect(hillModel.children[0].children[0].renderOrder).toBe(-.5);
  loaded.components.workable.WorkedBy({}, 1);
  expect(loaded.isValid()).toBe(false);
  expect(loaded.status.peek()).toBe('removed');
  expect(loaded.components.spawner.child!.sg.stateName).toBe('stunned');
  expect(restored.drops.some(d => d.entity?.id === baitId)).toBe(true);
  expect(loaded.components.spawner.timer.peek().status).toBe('stopped');
  restored.dispose();
});


it('c_spawn and c_save keep a hill whose child is outside, which reclaims that mole when it rejoins the world', async () => {
  const f = await fixture(true), inventory = createInventoryStore([]);
  const registry = new EntityRegistry([], f.prefabs, () => new THREE.Vector3(6, 0, 3));
  registry.registerPrefabs(PREFAB_DEFINITIONS.molehills);
  expect((await executeDebugCommand('c_spawn("molehill")', inventory, id => registry.spawn(id))).ok).toBe(true);
  const [{ record: { id } }] = f.prefabs.exportRecords();
  const hill = f.prefabs.get(id) as MolehillInstance, mole = f.mole(new THREE.Vector3(9, 0, 3)); mole.brain.Stop();
  hill.components.spawner.TakeOwnership(mole);
  expect(mole.home).toBe(hill);
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  let json = '';
  expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
    json = serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportState(), elapsedSeconds: 0,
      playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
  })).ok).toBe(true);
  const { entities } = deserializeSave(json, SAVE_CATALOG).world, moleId = mole.id;
  expect(entities.molehill).toEqual([expect.objectContaining({ id, components: { molehill: { items: [], childid: moleId } } })]);
  registry.dispose(); f.dispose(); inventory.dispose();

  const restored = await fixture(true), restoredRegistry = new EntityRegistry([], restored.prefabs, () => new THREE.Vector3());
  restoredRegistry.registerPrefabs(PREFAB_DEFINITIONS.molehills);
  await restoredRegistry.restoreAll({ molehill: entities.molehill });
  const loaded = restored.prefabs.get(id) as MolehillInstance;
  expect(loaded.position.toArray()).toEqual([6, 0, 3]);
  expect(loaded.components.spawner.child).toBeUndefined();
  // The saved childid is kept until the mole joins, as OnLoadPostPass's newents lookup.
  expect(restored.hills()[0].components.molehill).toEqual({ items: [], childid: moleId });
  const child = restored.mole(new THREE.Vector3(9, 0, 3), moleId);
  expect(loaded.components.spawner.child).toBe(child);
  expect(child.home).toBe(loaded);
  expect(loaded.components.spawner.timer.peek().status).toBe('stopped');
  restoredRegistry.dispose(); restored.dispose();
});

it('day sleep clears sniff at frame 1, plays only the sleep event and keeps captured moles silent', async () => {
  const f = await fixture(true), mole = f.mole(); mole.brain.Stop(); mole.setAbove(); mole.sg.goToState('idle');
  const played = vi.spyOn(mole, 'playSound'), stopped = vi.spyOn(mole, 'killSound');
  f.scheduler.advance(1 / 30); expect(played).toHaveBeenCalledWith('sniff', 'sniff');
  mole.PushEvent('gotosleep'); f.scheduler.advance(1 / 30);
  expect(stopped).toHaveBeenCalledWith('sniff'); expect(stopped).toHaveBeenCalledWith('stunned');
  played.mockClear();
  f.scheduler.advance(f.lengths.get('sleep_pre')!); expect(mole.sg.stateName).toBe('sleeping');
  f.scheduler.advance(28 / 30); expect(played.mock.calls.map(call => call[0])).toEqual(['sleep']);
  const owner = { address: { containerId: 'player:inventory', slotKey: '0' }, changed() {}, remove: () => true, replace: () => false, PushEvent() {} };
  mole.entity.components.inventoryitem.owner = owner; mole.entity.PushEvent('onputininventory', owner);
  played.mockClear(); f.scheduler.advance(10);
  expect(played).not.toHaveBeenCalled();
  expect(mole.sg.sg.timelineSnapshot!.peek().status).toBe('paused');
  mole.entity.components.inventoryitem.owner = null; mole.entity.PushEvent('ondropped', undefined);
  expect(mole.sg.stateName).toBe('stunned');
  f.dispose();
});

it('passes the world watcher to sleeper and keeps both cycle consumers independent through removal', async () => {
  const f = await fixture(), mole = f.mole();
  mole.brain.Stop(); mole.setAbove(); mole.sg.goToState('idle');
  const sleeper = mole.components.sleeper!;
  expect(f.watch).toHaveBeenCalledTimes(2);
  try {
    f.cycle.set('day');
    await settle();
    expect(mole.world.isDay).toBe(true);
    expect(sleeper.IsAsleep()).toBe(true);
    f.cycle.set('dusk');
    await settle();
    expect(mole.world.isDay).toBe(false);
    expect(sleeper.IsAsleep()).toBe(false);
    f.cycle.set('night');
    await settle();
    expect(mole.world.isDay).toBe(false);
    expect(sleeper.IsAsleep()).toBe(false);

    sleeper.dispose();
    const force = vi.spyOn(mole.brain, 'ForceUpdate');
    f.cycle.set('day');
    await settle();
    expect(mole.world.isDay).toBe(true);
    expect(force).toHaveBeenCalledOnce();
    f.cycle.set('dusk');
    mole.remove();
    await settle();
    expect(force).toHaveBeenCalledOnce();
    expect(mole.world.isDay).toBe(false);
  } finally { f.dispose(); }
});
