import { createTestWorldSources } from './worldContentFixture';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createSignal, getWatchWorldContent, type WorldPhase, type WorldContentEnvironment, type GetWatchWorldContent } from '../../signals/src';
import { ItemEntity } from '../../inventory/src/entity';
import type { InventoryStack } from '../../inventory/src/types';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { loadAnim } from '../src/animationAssets';
import { Mole, configureMoleEntity } from '../../prefab/src/mole';
import { MolehillManager } from '../../prefab/src/molehill';
import { configureMoleBaitEntity, MoleBait } from '../../prefab/src/molebait';
import { createMoleAction } from '../../stategraphs/src/moleactions';
import { Combat } from '../../componets/src/combat';
import { Weapon } from '../../componets/src/weapon';

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

async function fixture(daytime = false) {
  const scheduler = new GameTimeScheduler(), cycle = createSignal<WorldPhase>(daytime ? 'day' : 'dusk'), heading = createSignal(0);
  const items: ItemEntity[] = [], baits: MoleBait[] = [], drops: { entity?: ItemEntity; prefab: string; position: THREE.Vector3 }[] = [];
  const spawnItem = (state: InventoryStack) => { const item = new ItemEntity(state); items.push(item); if (state.itemId === 'mole') configureMoleEntity(item); else configureMoleBaitEntity(item); return item; };
  const sources: WorldContentEnvironment = { ...createTestWorldSources(scheduler), playerpositions: createSignal<import('three').Vector3[]>([]), snowLevel: createSignal(0), wind: createSignal({ angle: 0, velocity: 1 }), perishTick: createSignal({ time: 0, total: 0 }), scheduler, temperature: createSignal(30), cycle, season: createSignal({ season: 'spring', progress: .5 }) };
  const requests = vi.fn();
  const watch: GetWatchWorldContent = (key, register) => {
    requests(key); return getWatchWorldContent(key, register, sources);
  };
  const manager: MolehillManager = new MolehillManager(new THREE.Scene(), '/dst/data/anim', {
    getWatchWorldContent: watch, cameraHeading: heading, isWalkable: () => true,
    spawnItem, dropItem: (entity, position) => { entity.transform.position.copy(position); entity.PushEvent('ondropped', undefined); drops.push({ entity, prefab: entity.prefab, position: position.clone() }); },
    showMole: () => undefined, dropLoot: (prefab, position) => drops.push({ prefab, position }),
    getEntities: () => [...baits, ...manager.habitat.getMoles()],
  });
  await manager.prepare();
  const bank = await loadAnim('mole_basic.zip', '/dst/data/anim');
  const lengths = new Map(bank.animations.map(clip => [clip.name, clip.frames.length / clip.frameRate]));
  const mole = (position = new THREE.Vector3()) => {
    const entity = spawnItem({ itemId: 'mole', count: 1 }); entity.getPosition().copy(position);
    const runtime = entity.getComponent<Mole>('mole')!; runtime.bindWorld(manager.habitat, lengths); return runtime;
  };
  const bait = (id: string, position = new THREE.Vector3(3, 0, 0), count = 1) => {
    const entity = spawnItem({ itemId: id, count }); entity.getPosition().copy(position);
    const target = new MoleBait(entity, scheduler, () => true); baits.push(target); return target;
  };
  const advance = async (seconds: number, runBrain = true) => {
    for (let i = 0; i < Math.ceil(seconds * 30); i++) {
      scheduler.advance(1 / 30); if (runBrain) for (const runtime of manager.habitat.getMoles()) runtime.update(1 / 30);
    }
    await settle();
  };
  const dispose = () => { manager.dispose(); baits.forEach(b => b.dispose()); items.forEach(e => e.destroy()); scheduler.dispose(); };
  return { scheduler, cycle, watch: requests, manager, lengths, mole, bait, advance, drops, items, dispose };
}

it('uses the Lua brain to steal minerals, build a home and deposit the same item entities', async () => {
  const f = await fixture(), mole = f.mole();
  const bait = f.bait('rocks', new THREE.Vector3(3, 0, 0), 7), id = bait.entity.id;
  await f.advance(10);
  expect(mole.components.inventory!.GetItems().map(e => e.id)).toContain(id);
  expect(bait.entity.snapshot().count).toBe(7);
  expect(bait.entity.components.inventoryitem.owner).not.toBeNull();
  // The source tests for a missing home after its first delay, then waits another make_home_delay.
  await f.advance(25);
  expect(f.manager.exportRecords()).toHaveLength(1);
  const hill = mole.home!;
  expect(hill.getPosition().distanceToSquared(mole.getPosition())).toBeLessThan((20 * 3) ** 2);
  f.cycle.set('day'); await settle();
  await f.advance(25);
  const record = f.manager.exportRecords()[0];
  expect(record.components.molehill.items.map(e => e.entityId)).toContain(id);
  expect(record.components.molehill.child?.entityId).toBe(mole.id);
  expect(record.components.molehill.child?.mole?.health).toBe(30);
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
  const model = await f.manager.spawn(new THREE.Vector3(15, 0, 0));
  const hill = model.userData.molehill; hill.components.spawner.TakeOwnership(mole);
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
  expect(mole.entity.components.eater!.Eat(food, () => { food.components.stackable.count--; return true; })).toBe(true);
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
  const model = await f.manager.spawn(new THREE.Vector3(9, 0, 15)), hill = model.userData.molehill;
  hill.components.spawner.TakeOwnership(mole); expect(mole.wentHome(hill)).toBe(true);
  const record = f.manager.exportRecords()[0], moleId = mole.id, baitId = bait.entity.id;
  f.dispose();
  const restored = await fixture(true);
  const hillModel = await restored.manager.spawn(new THREE.Vector3(...record.transform.position), record), loaded = hillModel.userData.molehill;
  expect(loaded.components.spawner.IsOccupied()).toBe(true);
  expect(loaded.components.spawner.child.id).toBe(moleId);
  expect(loaded.components.inventory.GetItems()[0].id).toBe(baitId);
  expect(loaded.components.inventory.GetItems()[0].snapshot().count).toBe(5);
  loaded.components.workable.WorkedBy({}, 1);
  expect(loaded.isValid()).toBe(false);
  expect(loaded.components.spawner.child.sg.stateName).toBe('stunned');
  expect(restored.drops.some(d => d.entity?.id === baitId)).toBe(true);
  expect(loaded.components.spawner.timer.peek().status).toBe('stopped');
  restored.dispose();
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
