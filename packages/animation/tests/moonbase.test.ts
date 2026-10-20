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
import { getItemUseActions, ItemUseActionController, type ItemUseTarget } from '../../stategraphs/src/itemuse';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import type { ActionAnimationController } from '../../stategraphs/src/actionContext';
import { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';
import type { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { findImage, smallHash } from '../src/animationAssets';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Timer } from '../../componets/src/timer';
import { createSignal } from '../../signals/src';
import { getPickActions } from '../../stategraphs/src/pick';
import { bindTestWorld } from './worldContentFixture';

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
  const placement = new PlaceableBuildingPlacement(world, consume);
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
  expect(model.userData.animationController.currentAnimation).toBe('med');
  const mesh = model.children[0].children[0] as THREE.Mesh;
  expect(mesh.isMesh).toBe(true);
  expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(4);
  expect(mesh.geometry.groups.length).toBeGreaterThan(0);
  expect(placement.hammerTargets).toEqual([]);
  placement.update(1 / 30);

  const [{ prefabId, record }] = placement.exportRecords();
  expect(prefabId).toBe('moonbase');
  expect(record.transform.position).toEqual([30, 0, 30]);
  expect(record.components).toEqual({ building: { state: 'idle' }, workable: { workleft: 4, maxwork: 6 } });
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
  expect(restored.userData.entityId).toBe(record.id);
  expect(restored.userData.animationController.currentAnimation).toBe('hit_med');
  expect(placement.exportRecords()[1]).toEqual({ prefabId, record });
  placement.dispose();
});

async function createMoonbase(options: Partial<WorldContext> = {}, saved?: Parameters<PlaceableBuildingPlacement['spawnFromSave']>[1]) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const world = { scene: new THREE.Scene(), player: new THREE.Group(), ground: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(), cameraFacing: createSignal(8), cameraHeading: createSignal(45), renderer: { domElement: new EventTarget() },
    createCursorLabel: () => ({ show() {}, hide() {}, update() {} }), ...options } as unknown as WorldContext;
  const placement = new PlaceableBuildingPlacement(world, () => false);
  if (saved) await placement.spawnFromSave('moonbase', saved); else await placement.spawn('moonbase');
  return { placement, world, model: world.scene.children[0] as THREE.Group };
}

it('repairs with one moonrock and preserves a skinned, partly used staff through insertion, save/load and PICK', async () => {
  const play = vi.spyOn(sound, 'PlaySound');
  const { placement, model } = await createMoonbase();
  const staff = new ItemEntity({ entityId: 'test_moonbase_staff', itemId: 'yellowstaff', count: 1,
    skinId: 'starstaff_crystal', remainingUses: 7 });
  const rock = new ItemEntity({ itemId: 'moonrocknugget', count: 2 }); configureMoonrockNugget(rock);
  const { trader, workable } = model.userData.components;
  const override = vi.spyOn(model.userData.animationController, 'overrideSymbol');
  try {
    expect(workable.GetWorkAction()).toBeUndefined();
    expect(trader.AcceptGift(staff, () => true)).toBe(false);
    const repairable = model.userData.components.repairable;
    expect(model.userData.actionEntity.hasTag('workrepairable')).toBe(true);
    expect(repairable.Repair(staff, () => true)).toBe(false);
    const consume = vi.fn(() => { rock.components.stackable.count--; return true; });
    expect(repairable.Repair(rock, consume)).toBe(true);
    expect(consume).toHaveBeenCalledOnce();
    expect(rock.components.stackable.count).toBe(1);
    expect(workable.workleft.peek()).toBe(6);
    expect(getMoonbaseState(model).phase.peek()).toBe('full');
    expect(model.userData.components.repairable).toBeUndefined();
    expect(model.userData.animationController.currentAnimation).toBe('fix_full');
    expect(play).toHaveBeenLastCalledWith('dontstarve/common/together/moonbase/repair', model.position);
    expect(repairable.Repair(rock, consume)).toBe(false);
    expect(consume).toHaveBeenCalledOnce();

    const take = vi.fn(() => true);
    expect(trader.AcceptGift(staff, take)).toBe(true);
    expect(take).toHaveBeenCalledWith(false);
    expect(getMoonbaseState(model).staff.peek()).toBe(staff);
    expect(staff.isRemoved).toBe(false);
    const art = override.mock.calls.at(-1)![1] as { build: Parameters<typeof findImage>[0]; symbolHash: number };
    expect(override).toHaveBeenLastCalledWith('swap_staffs', expect.anything());
    expect(art.symbolHash).toBe(smallHash('yellowstaff'));
    expect(findImage(art.build, art.symbolHash, 0)).toBeDefined();
    expect(model.userData.components.pickable.productEntity).toBe(staff);
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
    expect(restored.userData.components.repairable).toBeUndefined();
    const held = getMoonbaseState(restored).staff.peek()!;
    expect(held.snapshot()).toEqual(staff.snapshot());
    const pickable = restored.userData.components.pickable;
    expect(pickable.pick({ giveItem: () => true, giveEntity: () => false })).toBe(false);
    expect(getMoonbaseState(restored).staff.peek()).toBe(held);
    const giveEntity = vi.fn(() => true);
    expect(pickable.pick({ giveItem: vi.fn(), giveEntity })).toBe(true);
    expect(giveEntity).toHaveBeenCalledWith(held, restored.position);
    expect(getMoonbaseState(restored).staff.peek()).toBeUndefined();
    expect(held.snapshot()).toEqual(staff.snapshot());
    expect(restored.userData.components.trader.isEnabled).toBe(true);
    expect(placement.exportRecords()[1].record.components.moonbase).toBeUndefined();
    held.destroy();
  } finally { placement.dispose(); rock.destroy(); }
});

it('charges through three source stages, restores the remaining timers and morphs a skinned staff at full durability', async () => {
  const scheduler = new GameTimeScheduler();
  const { moon, getWatchWorldContent } = moonWorld(scheduler, false);
  const { placement, model } = await createMoonbase({ getWatchWorldContent, scheduler });
  const rock = new ItemEntity({ itemId: 'moonrocknugget', count: 1 }); configureMoonrockNugget(rock);
  model.userData.components.repairable.Repair(rock, () => true);
  scheduler.advance(0);
  const original = new ItemEntity({ entityId: 'charging_staff', itemId: 'yellowstaff', count: 1, skinId: 'starstaff_crystal', remainingUses: 7 });
  model.userData.components.trader.AcceptGift(original, () => true);
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
  expect(model.userData.actionEntity.hasTag('intense')).toBe(true);
  expect(getPickActions(model).find(action => action.model === model)?.available).toBe(false);
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
    expect(restored.model.userData.actionEntity.hasTag('intense')).toBe(true);
    expect(next.staff.peek()?.snapshot()).toEqual(record.components.moonbase?.staff);
    expect(restored.placement.renderEntities.filter(entry => entry.object.userData.prefab?.startsWith('positron')).map(entry => 'sortLayer' in entry ? entry.sortLayer : undefined).sort()).toEqual([0, 2, 3]);
    restoredScheduler.advance(18.7);
    expect(next.charge.peek()).toBe('charging_3');
    restoredScheduler.advance(MOONBASE_CHARGE_DURATION - 37.4);
    expect(next.charge.peek()).toBe('complete');
    const opal = next.staff.peek()!;
    expect(opal.snapshot()).toMatchObject({ itemId: 'opalstaff', skinId: 'moonstaff_crystal', remainingUses: 50, count: 1 });
    expect(opal.id).not.toBe(original.id);
    expect(next.timers.mooncharge.peek().status).toBe('expired');
    expect(restored.model.userData.actionEntity.hasTag('intense')).toBe(false);
    expect(getPickActions(restored.model).find(action => action.model === restored.model)?.available).toBe(true);
    expect(restored.placement.renderEntities.some(entry => entry.object.name === 'staffcoldlightfx')).toBe(true);
    const giveEntity = vi.fn(() => true);
    expect(restored.model.userData.components.pickable.pick({ giveItem: vi.fn(), giveEntity })).toBe(true);
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
  model.userData.components.repairable.Repair(rock, () => true);
  scheduler.advance(0);
  const staff = new ItemEntity({ itemId: 'yellowstaff', count: 1 });
  const { trader, pickable } = model.userData.components;
  const state = getMoonbaseState(model);
  trader.AcceptGift(staff, () => true);
  scheduler.advance(1); expect(state.charge.peek()).toBe('charging_1');
  scheduler.advance(5);
  expect(pickable.pick({ giveItem: () => true, giveEntity: () => true })).toBe(true);
  expect(state.timers.mooncharge.peek().status).toBe('stopped');
  expect(state.charge.peek()).toBe('idle');
  trader.AcceptGift(staff, () => true); scheduler.advance(1);
  expect(model.userData.components.timer.GetTimeLeft('mooncharge')).toBeCloseTo(MOONBASE_CHARGE_DURATION);
  scheduler.advance(19); expect(state.charge.peek()).toBe('charging_2');
  cycle.set('day');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(state.charge.peek()).toBe('idle');
  expect(model.userData.actionEntity.hasTag('intense')).toBe(false);
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

it('walks to repair range, cancels before consumption, and commits REPAIR and GIVE at their source times', async () => {
  const { placement, world, model } = await createMoonbase();
  const pointer = { trackPointer() {}, beginFrame() {}, endFrame() {}, raycastPointer: () => ({ object: model }), dispose() {} } as unknown as PointerRaycaster;
  world.mouseActions = new PlayerActionPicker(pointer);
  const graph = new WilsonStateGraph({ playAnimation: () => .8, playSound() {}, stopSound() {}, setCasting() {}, onStateChanged() {} });
  const animation = { stategraph: graph, cancelEmote() {}, setFacing() {} } as unknown as ActionAnimationController;
  const locomotor = { destination: undefined, goToPoint: vi.fn(() => true), stop: vi.fn() };
  const rock = new ItemEntity({ itemId: 'moonrocknugget', count: 1 }); configureMoonrockNugget(rock);
  const staff = new ItemEntity({ itemId: 'yellowstaff', count: 1 });
  let current = rock;
  const take = vi.fn(() => true);
  const source = () => { const entity = current; return { entity, isValid: () => current === entity, take }; };
  let manual = false;
  const controller = new ItemUseActionController(world, animation, locomotor, source, () => manual);
  const target = model.userData.actionEntity as ItemUseTarget;
  try {
    expect(getItemUseActions(model, source()).find(action => action.available)?.action.action).toBe('REPAIR');
    expect(controller.request('REPAIR', target)).toBe(true);
    controller.update(); expect(locomotor.goToPoint).toHaveBeenCalled();
    expect(take).not.toHaveBeenCalled();
    world.player.position.copy(model.position);
    controller.update(); expect(graph.stateName).toBe('dolongaction');
    graph.update(.5); manual = true; controller.update(); graph.update(1);
    expect(take).not.toHaveBeenCalled(); expect(model.userData.components.workable.GetWorkLeft()).toBe(4);
    manual = false; expect(controller.request('REPAIR', target)).toBe(true); controller.update();
    graph.update(.99); expect(take).not.toHaveBeenCalled();
    graph.update(.01); expect(take).toHaveBeenCalledWith(true);
    graph.finish(); controller.update(); current = staff;
    expect(controller.request('GIVE', target)).toBe(true); controller.update();
    expect(graph.stateName).toBe('give'); graph.update(12 / 30);
    expect(take).toHaveBeenCalledTimes(1);
    graph.update(1 / 30); expect(take).toHaveBeenLastCalledWith(false);
    expect(getMoonbaseState(model).staff.peek()).toBe(staff);
  } finally { controller.dispose(); world.mouseActions.dispose(); placement.dispose(); rock.destroy(); }
});
