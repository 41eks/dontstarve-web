import { findActionEntity } from '../../prefab/src/actionEntity';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { executeDebugCommand } from '../../../src/debugCommands';
import type { InventoryStore } from '../../../src/inventory';
import { isPlaceableBuildingId, PlaceableBuildingPlacement } from '../../../src/placeableBuilding';
import { deserializeSave } from '../../../src/save/deserialize';
import type { SaveDocument } from '../../../src/save/types';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import definitions from '../../prefab/src/definitions.json' with { type: 'json' };
import type { WorldContext } from '../../prefab/src/worldContext';
import { ItemEntity } from '../../inventory/src/entity';
import { configureMoonrockNugget } from '../../prefab/src/moonrocknugget';
import { getMoonbaseState, MOONBASE_CHARGE_DURATION } from '../../prefab/src/moonbase';
import * as sound from '../../prefab/src/sound';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { activeItemUse } from './inventoryUseFixture';
import { createInventoryStore } from '../../../src/inventory';
import { cursorSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import { smallHash } from '../src/animationAssets';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Timer } from '../../componets/src/timer';
import { createSignal } from '../../signals/src';
import { bindTestWorld } from './worldContentFixture';
import { importedSave } from './importedSave';
import { workTargets } from './workTargets';
import { canDoSceneAction } from './sceneActions';

const worldCleanups: (() => void)[] = [];
function moonWorld(scheduler: GameTimeScheduler, full: boolean) {
  const world = bindTestWorld(scheduler);
  world.cycle.set('night');
  world.moon.set({ phase: full ? 'full' : 'new', waxing: true });
  worldCleanups.push(world.unbind);
  return world;
}


afterEach(() => {
  worldCleanups.splice(0).forEach(stop => stop());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('spawns moonbase through the debug command using its source art and restores its saved position', async () => {
  const fetchAsset = vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('fetch', fetchAsset);
  vi.stubGlobal('window', new EventTarget());
  const world = {
    scene: new THREE.Scene(), player: new THREE.Object3D(), ground: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(), cameraFacing: createSignal(8), cameraHeading: createSignal(45), renderer: { domElement: new EventTarget() },
    createCursorLabel: () => ({ show() {}, hide() {}, update() {} }),
  } as unknown as WorldContext;
  world.player.position.set(30, 0, 40);
  const consume = vi.fn(() => false);
  const placement = new PlaceableBuildingPlacement(world, consume, undefined, { spawn: vi.fn(), register: vi.fn() });
  const result = await executeDebugCommand('c_spawn("moonbase")', {} as InventoryStore, async (prefabId) => {
    if (!isPlaceableBuildingId(prefabId)) return false;
    await placement.spawn(prefabId);
    return true;
  });
  expect(result).toEqual({ ok: true, message: '已生成 moonbase' });
  expect(fetchAsset.mock.calls.map(([url]) => url)).toContain('/dst/data/anim/moonbase.zip');
  expect(consume).not.toHaveBeenCalled();
  const model = world.scene.children[0];
  expect(model.name).toBe('MoonBase');
  expect(prefabInstance(model)!.sprite.currentAnimation).toBe('med');
  // The display loads the source art; a later moonbase of the same art is drawn at once.
  await vi.waitFor(() => expect(prefabInstance(model)!.sprite.loaded).toBe(true));
  const mesh = model.children[0].children[0].children[0] as THREE.Mesh;
  expect(mesh.isMesh).toBe(true);
  expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(4);
  expect(mesh.geometry.groups.length).toBeGreaterThan(0);
  expect(workTargets('HAMMER')).toEqual([]);
  placement.update(1 / 30);

  const [{ prefabId, record }] = placement.exportRecords();
  expect(prefabId).toBe('moonbase');
  expect(record.transform.position).toEqual([30, 0, 30]);
  expect(record.components).toEqual({ building: {}, workable: { workleft: 4, maxwork: 6 } });
  // The save parser uses the same building catalog as the application.
  const save = structuredClone(initialWorld) as unknown as SaveDocument;
  save.world.entities = { moonbase: [{
    ...record, transform: { ...record.transform, position: [...record.transform.position] },
  }] };
  save.players.local.inventory.containers = {
    'player:inventory': { slotCount: 15, slots: [] },
    'player:equipment': { slotCount: 3, slots: [] },
  };
  save.players.local.inventory.bufferedBuilds = [];
  const parsed = deserializeSave(JSON.stringify(save), {
    items: {}, skins: {}, recipes: {}, recipeSkins: {},
    buildings: definitions.animatedBuildings, walls: Object.keys(definitions.walls),
  });
  const restored = await placement.spawnFromSave('moonbase', parsed.world.entities.moonbase[0]);
  expect(restored.position.toArray()).toEqual(model.position.toArray());
  expect(lookupPrefabInstance(restored)?.entityId).toBe(record.id);
  expect(prefabInstance(restored)!.sprite.currentAnimation).toBe('hit_med');
  expect(placement.exportRecords()[1]).toEqual({ prefabId, record });
  placement.dispose();
});

async function createMoonbase(options: Partial<WorldContext> = {}, saved?: Parameters<PlaceableBuildingPlacement['spawnFromSave']>[1]) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const world = { scene: new THREE.Scene(), player: new THREE.Group(), ground: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(), cameraFacing: createSignal(8), cameraHeading: createSignal(45), renderer: { domElement: new EventTarget() },
    createCursorLabel: () => ({ show() {}, hide() {}, update() {} }), ...options } as unknown as WorldContext;
  const placement = new PlaceableBuildingPlacement(world, () => false, undefined, { spawn: vi.fn(), register: vi.fn() });
  if (saved) placement.spawnFromSave('moonbase', saved); else await placement.spawn('moonbase');
  const model = world.scene.children[0] as THREE.Group;
  // One-shot clips such as fix_full play out only once the display has drawn the moonbase.
  await vi.waitFor(() => expect(prefabInstance(model)!.sprite.loaded).toBe(true));
  return { placement, world, model };
}

it('restores the converted native moonbase as repaired and preserves its identity, position and work on export', async () => {
  const save = importedSave('Master');
  expect(save.world.entities.moonbase).toHaveLength(1);
  const [record] = save.world.entities.moonbase;
  expect(record.components.workable).toEqual({ maxwork: 6, workleft: 6 });
  const { placement, model } = await createMoonbase({}, record);
  try {
    expect(prefabInstance(model)!.entityId).toBe(record.id);
    expect(model.position.toArray()).toEqual(record.transform.position);
    expect(getMoonbaseState(model).workleft.peek()).toBe(6);
    expect(prefabInstance(model)!.components.repairable).toBeUndefined();
    expect(prefabInstance(model)!.components.trader!.isEnabled).toBe(true);
    expect(placement.exportRecords()).toEqual([{ prefabId: 'moonbase', record }]);
    save.world.entities = { moonbase: placement.exportRecords().map(({ record }) => record) };
    expect(deserializeSave(JSON.stringify(save), SAVE_CATALOG).world.entities.moonbase).toEqual([record]);
  } finally { placement.dispose(); }
});

it('repairs with one moonrock and preserves a skinned, partly used staff through insertion, save/load and PICK', async () => {
  const play = vi.spyOn(sound, 'PlaySound');
  const { placement, model } = await createMoonbase();
  const staff = new ItemEntity({ entityId: 'test_moonbase_staff', itemId: 'yellowstaff', count: 1,
    skinId: 'starstaff_crystal', remainingUses: 7 });
  const rock = new ItemEntity({ itemId: 'moonrocknugget', count: 2 }); configureMoonrockNugget(rock);
  const { trader, workable } = (findActionEntity(model)?.components ?? prefabInstance(model)!.components);
  const staffSymbol = () => {
    const declared = prefabInstance(model)!.sprite.sprite.peek().appearance.get('anim-state');
    return declared?.kind === 'anim-state' ? declared.state.peek().overrides.get(smallHash('swap_staffs'))?.sources : undefined;
  };
  try {
    expect(workable.GetWorkAction()).toBeUndefined();
    expect(trader.AcceptGift(staff, () => true)).toBe(false);
    const repairable = (findActionEntity(model)?.components ?? prefabInstance(model)!.components).repairable;
    expect(findActionEntity(model).hasTag('workrepairable')).toBe(true);
    expect(repairable.Repair(undefined, staff)).toBe(false);
    // repairable.lua removes one of the repair item's stack.
    expect(repairable.Repair(undefined, rock)).toBe(true);
    expect(rock.components.stackable.count).toBe(1);
    expect(workable.workleft.peek()).toBe(6);
    expect(getMoonbaseState(model).phase.peek()).toBe('full');
    expect((findActionEntity(model)?.components ?? prefabInstance(model)!.components).repairable).toBeUndefined();
    expect(prefabInstance(model)!.sprite.currentAnimation).toBe('fix_full');
    expect(play).toHaveBeenLastCalledWith('dontstarve/common/together/moonbase/repair', model.position);
    expect(repairable.Repair(undefined, rock)).toBe(false);
    expect(rock.components.stackable.count).toBe(1);

    const take = vi.fn(() => true);
    expect(trader.AcceptGift(staff, take)).toBe(true);
    expect(take).toHaveBeenCalledWith(false);
    expect(getMoonbaseState(model).staff.peek()).toBe(staff);
    expect(staff.isRemoved).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    // OverrideItemSkinSymbol("swap_staffs", skin_build, "yellowstaff", item.GUID, "staffs")
    expect(staffSymbol()).toEqual([{ archive: 'dynamic/starstaff_crystal.zip', symbol: smallHash('yellowstaff') },
      { archive: 'staffs.zip', symbol: smallHash('yellowstaff') }]);
    expect((findActionEntity(model)?.components ?? prefabInstance(model)!.components).pickable.productEntity).toBe(staff);
    expect(trader.isEnabled).toBe(false);
    expect(trader.AcceptGift(staff, take)).toBe(false);
    expect(play).toHaveBeenLastCalledWith('dontstarve/common/together/moonbase/moonstaff_place', model.position);

    const [{ record }] = placement.exportRecords();
    expect(record.components.moonbase?.staff).toEqual(staff.snapshot());
    const save = structuredClone(initialWorld) as unknown as SaveDocument;
    save.world.entities = { moonbase: [{ ...record, transform: { ...record.transform, position: [...record.transform.position] } }] };
    for (const container of Object.values(save.players.local.inventory.containers)) container.slots = [];
    save.players.local.inventory.bufferedBuilds = [];
    const parsed = deserializeSave(JSON.stringify(save), SAVE_CATALOG);
    const restored = await placement.spawnFromSave('moonbase', parsed.world.entities.moonbase[0]);
    expect((findActionEntity(restored)?.components ?? prefabInstance(restored)!.components).repairable).toBeUndefined();
    const held = getMoonbaseState(restored).staff.peek()!;
    expect(held.snapshot()).toEqual(staff.snapshot());
    const pickable = (findActionEntity(restored)?.components ?? prefabInstance(restored)!.components).pickable;
    expect(pickable.pick({ giveItem: () => true, giveEntity: () => false })).toBe(false);
    expect(getMoonbaseState(restored).staff.peek()).toBe(held);
    const giveEntity = vi.fn(() => true);
    expect(pickable.pick({ giveItem: vi.fn(), giveEntity })).toBe(true);
    expect(giveEntity).toHaveBeenCalledWith(held, restored.position);
    expect(getMoonbaseState(restored).staff.peek()).toBeUndefined();
    expect(held.snapshot()).toEqual(staff.snapshot());
    expect((findActionEntity(restored)?.components ?? prefabInstance(restored)!.components).trader.isEnabled).toBe(true);
    expect(placement.exportRecords()[1].record.components.moonbase).toBeUndefined();
    held.destroy();
  } finally { placement.dispose(); rock.destroy(); }
});

it('charges through three source stages, restores the remaining timers and morphs a skinned staff at full durability', async () => {
  const scheduler = new GameTimeScheduler();
  const { moon, getWatchWorldContent } = moonWorld(scheduler, false);
  const { placement, model } = await createMoonbase({ getWatchWorldContent, scheduler });
  const rock = new ItemEntity({ itemId: 'moonrocknugget', count: 1 }); configureMoonrockNugget(rock);
  (findActionEntity(model)?.components ?? prefabInstance(model)!.components).repairable.Repair(undefined, rock);
  scheduler.advance(0);
  const original = new ItemEntity({ entityId: 'charging_staff', itemId: 'yellowstaff', count: 1, skinId: 'starstaff_crystal', remainingUses: 7 });
  (findActionEntity(model)?.components ?? prefabInstance(model)!.components).trader.AcceptGift(original, () => true);
  const state = getMoonbaseState(model), changed = vi.fn();
  const stop = state.timers.mooncharge.subscribe(changed);
  moon.set({ phase: 'full', waxing: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(state.charge.peek()).toBe('preparing');
  scheduler.advance(9.99); expect(state.charge.peek()).toBe('preparing');
  scheduler.advance(.01); expect(state.charge.peek()).toBe('charging_1');
  const start = scheduler.now, deadline = state.timers.mooncharge.peek();
  scheduler.advance(5);
  expect(state.timers.mooncharge.peek()).toBe(deadline); expect(changed).toHaveBeenCalledTimes(1);
  scheduler.advanceTo(start + 18.7);
  expect(state.charge.peek()).toBe('charging_2');
  expect(findActionEntity(model).hasTag('intense')).toBe(true);
  expect(canDoSceneAction('PICK', model)).toBe(false);
  const [{ record }] = placement.exportRecords();
  expect(record.components.moonbase?.timer?.timers.mooncharge.timeleft).toBeCloseTo(MOONBASE_CHARGE_DURATION - 18.7);
  expect(record.components.moonbase?.timer?.timers).not.toHaveProperty('mooncharge2');
  const save = structuredClone(initialWorld) as unknown as SaveDocument;
  save.world.entities = { moonbase: [{ ...record, transform: { ...record.transform, position: [...record.transform.position] } }] };
  for (const container of Object.values(save.players.local.inventory.containers)) container.slots = [];
  save.players.local.inventory.bufferedBuilds = [];
  const parsed = deserializeSave(JSON.stringify(save), SAVE_CATALOG);
  stop(); placement.dispose(); scheduler.dispose(); rock.destroy();

  const restoredScheduler = new GameTimeScheduler(1000);
  const restoredWorld = moonWorld(restoredScheduler, true);
  const restored = await createMoonbase({ getWatchWorldContent: restoredWorld.getWatchWorldContent, scheduler: restoredScheduler }, parsed.world.entities.moonbase[0]);
  const next = getMoonbaseState(restored.model);
  try {
    restoredScheduler.advance(0);
    expect(next.charge.peek()).toBe('charging_2');
    expect(findActionEntity(restored.model).hasTag('intense')).toBe(true);
    expect(next.staff.peek()?.snapshot()).toEqual(record.components.moonbase?.staff);
    expect(restored.placement.renderEntities.filter(entry => lookupPrefabInstance(entry.object)?.prefab?.startsWith('positron')).map(entry => 'sortLayer' in entry ? entry.sortLayer : undefined).sort()).toEqual([0, 2, 3]);
    restoredScheduler.advance(18.7);
    expect(next.charge.peek()).toBe('charging_3');
    restoredScheduler.advance(MOONBASE_CHARGE_DURATION - 37.4);
    expect(next.charge.peek()).toBe('complete');
    const opal = next.staff.peek()!;
    expect(opal.snapshot()).toMatchObject({ itemId: 'opalstaff', skinId: 'moonstaff_crystal', remainingUses: 50, count: 1 });
    expect(opal.id).not.toBe(original.id);
    expect(next.timers.mooncharge.peek().status).toBe('expired');
    expect(findActionEntity(restored.model).hasTag('intense')).toBe(false);
    expect(canDoSceneAction('PICK', restored.model)).toBe(true);
    expect(restored.placement.renderEntities.some(entry => entry.object.name === 'staffcoldlightfx')).toBe(true);
    const giveEntity = vi.fn(() => true);
    expect((findActionEntity(restored.model)?.components ?? prefabInstance(restored.model)!.components).pickable.pick({ giveItem: vi.fn(), giveEntity })).toBe(true);
    expect(giveEntity).toHaveBeenCalledWith(opal, restored.model.position);
    expect(restored.placement.renderEntities.some(entry => entry.object.name === 'staffcoldlightfx')).toBe(false);
    opal.destroy();
  } finally { restored.placement.dispose(); restoredScheduler.dispose(); }
});

it('cancels charge on early retrieval or moonset, then starts fresh and releases pending tasks on removal', async () => {
  const scheduler = new GameTimeScheduler();
  const { cycle, getWatchWorldContent } = moonWorld(scheduler, true);
  const { placement, model } = await createMoonbase({ getWatchWorldContent, scheduler });
  const rock = new ItemEntity({ itemId: 'moonrocknugget', count: 1 }); configureMoonrockNugget(rock);
  (findActionEntity(model)?.components ?? prefabInstance(model)!.components).repairable.Repair(undefined, rock);
  scheduler.advance(0);
  const staff = new ItemEntity({ itemId: 'yellowstaff', count: 1 });
  const { trader, pickable } = (findActionEntity(model)?.components ?? prefabInstance(model)!.components);
  const state = getMoonbaseState(model);
  trader.AcceptGift(staff, () => true);
  scheduler.advance(1); expect(state.charge.peek()).toBe('charging_1');
  scheduler.advance(5);
  expect(pickable.pick({ giveItem: () => true, giveEntity: () => true })).toBe(true);
  expect(state.timers.mooncharge.peek().status).toBe('stopped');
  expect(state.charge.peek()).toBe('idle');
  trader.AcceptGift(staff, () => true); scheduler.advance(1);
  expect((findActionEntity(model)?.components ?? prefabInstance(model)!.components).timer.GetTimeLeft('mooncharge')).toBeCloseTo(MOONBASE_CHARGE_DURATION);
  scheduler.advance(19); expect(state.charge.peek()).toBe('charging_2');
  cycle.set('day');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(state.charge.peek()).toBe('idle');
  expect(findActionEntity(model).hasTag('intense')).toBe(false);
  expect(state.staff.peek()).toBe(staff);
  cycle.set('night');
  await new Promise(resolve => setTimeout(resolve, 0)); scheduler.advance(10);
  expect(state.charge.peek()).toBe('charging_1');
  placement.dispose();
  expect(state.timers.mooncharge.peek().status).toBe('stopped');
  scheduler.advance(200); cycle.set('day');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(staff.isRemoved).toBe(true); expect(placement.renderEntities).toEqual([]);
  rock.destroy(); scheduler.dispose();
});

it('persists paused named timers without ticking their snapshots and keeps expiry distinct from cancellation', () => {
  const scheduler = new GameTimeScheduler(), done = vi.fn();
  const timer = new Timer(scheduler, done, ['charge']);
  timer.StartTimer('charge', 10); scheduler.advance(3); timer.PauseTimer('charge');
  expect(timer.snapshot('charge').peek()).toEqual({ status: 'paused', remainingSeconds: 7 });
  scheduler.advance(100); expect(done).not.toHaveBeenCalled();
  const restored = new Timer(scheduler, done, ['charge']); restored.OnLoad(timer.OnSave());
  expect(restored.GetTimeLeft('charge')).toBe(7);
  restored.ResumeTimer('charge'); scheduler.advance(7);
  expect(done).toHaveBeenCalledExactlyOnceWith('charge');
  restored.StopTimer('charge'); expect(restored.snapshot('charge').peek().status).toBe('expired');
  timer.StopTimer('charge'); expect(timer.snapshot('charge').peek().status).toBe('stopped');
  timer.dispose(); restored.dispose(); scheduler.dispose();
});

it('walks to the moonbase through the player controller, cancels before consumption, and commits REPAIR and GIVE at their source times', async () => {
  const { placement, world, model } = await createMoonbase();
  const graph = new WilsonStateGraph({ playAnimation: () => .8, playSound() {}, stopSound() {}, onStateChanged() {} });
  const inventory = createInventoryStore([]);
  inventory.add('moonrocknugget', 1); inventory.add('yellowstaff', 1);
  let manual = false;
  const use = activeItemUse(world, graph, inventory, () => manual);
  const target = findActionEntity(model)!, workable = (target.components ?? prefabInstance(model)!.components).workable!;
  try {
    expect(inventory.transfer(inventorySlotAddress(0), cursorSlotAddress(), 1)).toBe(true);
    // componentactions.lua USEITEM.repairer is a right-click action.
    expect(use.actions(target, true)).toEqual(['REPAIR']);
    expect(use.actions(target)).not.toContain('REPAIR');
    expect(use.useOn(target)).toBe(true); expect(use.walking).toBe(true);
    use.arrive(); expect(graph.stateName).toBe('dolongaction');
    graph.update(.5); manual = true; use.controller.update(); graph.update(1);
    expect(inventory.GetActiveItem()?.prefab).toBe('moonrocknugget'); expect(workable.GetWorkLeft()).toBe(4);
    manual = false; expect(use.useOn(target)).toBe(true); use.arrive();
    graph.update(.99); expect(inventory.GetActiveItem()).not.toBeNull();
    graph.update(.01); expect(inventory.GetActiveItem()).toBeNull(); expect(workable.GetWorkLeft()).toBe(6);
    graph.finish(); use.controller.update();
    // The trader's tag effect follows its Enable on the repaired moonbase.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(inventory.transfer(inventorySlotAddress(1), cursorSlotAddress(), 1)).toBe(true);
    const staff = inventory.GetActiveItem()!;
    expect(use.useOn(target)).toBe(true); use.arrive();
    expect(graph.stateName).toBe('give'); graph.update(12 / 30);
    expect(inventory.GetActiveItem()).toBe(staff);
    graph.update(1 / 30); expect(inventory.GetActiveItem()).toBeNull();
    expect(getMoonbaseState(model).staff.peek()).toBe(staff);
  } finally { use.dispose(); graph.dispose(); placement.dispose(); inventory.dispose(); }
});
