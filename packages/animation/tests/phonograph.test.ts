import { findActionEntity } from '../../prefab/src/actionEntity';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import { createPickupDoer, performPickupAction } from '../../stategraphs/src/pickup';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { afterEach, expect, it, vi } from 'vitest';
import { configurePhonographEntity } from '../../prefab/src/phonograph';
import { PlayerController } from '../../stategraphs/src/playercontroller';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import { Locomotor } from '../../prefab/src/locomotor';
import type { ActionWorldContext } from '../../stategraphs/src/actionContext';
import type * as CANNON from 'cannon-es';
import { playerDoer } from './playerDoer';
import { PlaySound } from '../../prefab/src/sound';
import { GroundItemManager } from '../../prefab/src/groundItemManager';
import { InventoryStore, InventorySlot, ItemEntity, inventorySlotAddress, cursorSlotAddress } from '../../inventory/src';
import { INVENTORY_ITEM_SPECS } from '../../../src/inventoryItems';
import { INVENTORY_SKIN_SPECS, INVENTORY_RECIPES, INVENTORY_RECIPE_SKINS } from '../../ui/src/categories/shared';
import definitions from '../../prefab/src/definitions.json' with { type: 'json' };
import { deserializeSave } from '../../../src/save/deserialize';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { reskinEntity } from '../../prefab/src/reskin_tool';
import { workTargets } from './workTargets';

const SAVE_CATALOG = { items: INVENTORY_ITEM_SPECS, skins: INVENTORY_SKIN_SPECS, recipes: INVENTORY_RECIPES,
  recipeSkins: INVENTORY_RECIPE_SKINS, buildings: definitions.animatedBuildings, walls: Object.keys(definitions.walls) };

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop: vi.fn() })),
}));
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('runs a ground-only record for 64 seconds through its machine and releases each machine sound independently', () => {
  const scheduler = new GameTimeScheduler();
  const firstInst = new ItemEntity({ itemId: 'phonograph', count: 1 }), secondInst = new ItemEntity({ itemId: 'phonograph', count: 1, phonographRecord: 'record_efs' });
  configurePhonographEntity(firstInst, scheduler); configurePhonographEntity(secondInst);
  const first = firstInst.components.phonograph!, second = secondInst.components.phonograph!;
  const sprite = { start: vi.spyOn(firstInst.sprite, 'start'), playOnce: vi.spyOn(firstInst.sprite, 'playOnce') };
  const incoming = new ItemEntity({ itemId: 'record', count: 1 }); incoming.configure(INVENTORY_ITEM_SPECS.record);
  const machine = firstInst.components.machine!;
  // phonograph.lua: an empty phonograph's machine is disabled, so componentactions offers no TURNON.
  expect(machine.enabled).toBe(false);
  expect(firstInst.hasTag('groundonlymachine')).toBe(true);
  expect(first.play()).toBe(false);
  expect(firstInst.components.trader!.AcceptGift(incoming, () => incoming)).toBe(true);
  second.OnDropped(); secondInst.components.machine!.TurnOn();
  expect(machine.IsOn()).toBe(true);
  expect(firstInst.hasTag('turnedon')).toBe(true);
  expect(firstInst.hasTag('enabled')).toBe(true);
  const handles = vi.mocked(PlaySound).mock.results.map(({ value }) => value);
  expect(sprite.playOnce).toHaveBeenCalledWith('open', expect.any(Function));
  sprite.playOnce.mock.calls.find(([name]) => name === 'open')![1]!();
  expect(sprite.start).toHaveBeenCalledWith('play_loop');
  // The logical task expires even without updating the visual.
  const scheduled = first.timer.peek();
  scheduler.advance(63.9); expect(first.isPlaying).toBe(true);
  expect(first.timer.peek()).toBe(scheduled);
  scheduler.advance(0.1); expect(first.isPlaying).toBe(false);
  // play_song's task turns the machine off; it stays enabled with its record.
  expect(machine.IsOn()).toBe(false);
  expect(firstInst.hasTag('turnedon')).toBe(false);
  expect(machine.enabled).toBe(true);
  expect(first.timer.peek()).toEqual({ status: 'expired' });
  expect(first.record).toBe('record');
  expect(PlaySound).toHaveBeenLastCalledWith('dontstarve/music/gramaphone_end', expect.any(THREE.Vector3));
  expect(handles[0].stop).toHaveBeenCalledOnce();
  expect(handles[1].stop).not.toHaveBeenCalled();
  expect(second.isPlaying).toBe(true);
  second.dispose(); expect(handles[1].stop).toHaveBeenCalledOnce();
  expect(second.timer.peek()).toEqual({ status: 'stopped' });
  expect(second.play()).toBe(false);
  // TURNOFF stops the song; machine.lua's 3 second cooldown then blocks switching again.
  machine.TurnOn(); expect(first.isPlaying).toBe(true);
  scheduler.advance(3);
  machine.TurnOff();
  expect(first.isPlaying).toBe(false);
  expect(firstInst.hasTag('cooldown')).toBe(true);
  scheduler.advance(3); expect(firstInst.hasTag('cooldown')).toBe(false);
  // An inst created before the world's scheduler is bound keeps the song's remaining time.
  machine.TurnOn(); scheduler.advance(10);
  const worldScheduler = new GameTimeScheduler(1000);
  first.BindScheduler(worldScheduler);
  expect(first.remainingSeconds).toBe(54);
  scheduler.advance(64); expect(first.isPlaying).toBe(true);
  worldScheduler.advance(54); expect(first.isPlaying).toBe(false);
  worldScheduler.dispose();
  first.dispose(); scheduler.dispose(); firstInst.destroy(); secondInst.destroy();
});

it('preserves a loaded skinned record across reskin, pickup, inventory transfer, drop and save/load; rejects failed trades', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(
    new URL(`../../../public/dst/data/${url.slice('/dst/data/'.length)}`, import.meta.url))));
  const scene = new THREE.Scene(), player = new THREE.Group();
  const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
  vi.stubGlobal('window', new EventTarget());
  const from = inventorySlotAddress(0), to = inventorySlotAddress(1), cursor = cursorSlotAddress();
  const inventory = new InventoryStore([{ address: from, slot: new InventorySlot() },
    { address: to, slot: new InventorySlot() }, { address: cursor, slot: new InventorySlot() }], INVENTORY_ITEM_SPECS, INVENTORY_SKIN_SPECS);
  const manager = new GroundItemManager(scene, new THREE.PerspectiveCamera(),
    { domElement: canvas } as unknown as THREE.WebGLRenderer, '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', player);
  const spec = INVENTORY_ITEM_SPECS.phonograph;
  const graph = new WilsonStateGraph({ playAnimation: () => 1, playSound() {}, onStateChanged() {} });
  const world = { player, scene, camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(), renderer: { domElement: canvas } } as unknown as ActionWorldContext;
  const locomotor = new Locomotor({ position: player.position, velocity: new THREE.Vector3() } as unknown as CANNON.Body);
  const controller = new PlayerController(world, graph, locomotor, inventory.handEquipment, playerDoer(player, { inventory }));
  const give = (model: THREE.Group, item: ItemEntity, cancel = false) => {
    const active = inventory.GetActiveItem();
    if (active) inventory.extract(cursor, 1, active);
    expect(inventory.receiveAt(cursor, item)).toBe(true);
    const target = manager.entities.get(lookupPrefabInstance(model)!.entityId!)!;
    const action = controller.GetItemUseAction(item, target)!;
    expect(action).toMatchObject({ action: 'GIVE' });
    expect(action.invobject).toBe(item); expect(action.target).toBe(target);
    const perform = vi.spyOn(action, 'do');
    expect(controller.DoAction(action)).toBe(true);
    graph.update(12 / 30);
    expect(inventory.GetActiveItem()).toBe(item);
    if (cancel) controller.cancel();
    graph.update(1 / 30);
    return perform.mock.results.at(-1)?.value ?? false;
  };
  try {
    const position = new THREE.Vector3(3, 0, 4);
    player.position.copy(position);
    let model = await manager.spawnFromSave('phonograph:test', { ...spec, itemId: 'phonograph', count: 1 }, position);
    let plain = new ItemEntity({ itemId: 'record', count: 1 });
    plain.configure(INVENTORY_ITEM_SPECS.record);
    let skinned = new ItemEntity({ itemId: 'record', count: 1, skinId: 'record_creepyforest' });
    skinned.configure(INVENTORY_ITEM_SPECS.record);
    expect(plain.hasTag('cattoy')).toBe(true);
    const invalid = new ItemEntity({ itemId: 'twigs', count: 1 });
    expect(give(model, invalid)).toBe(false);
    expect(inventory.GetActiveItem()).toBe(invalid);
    inventory.extract(cursor, 1, invalid); invalid.destroy();
    expect(give(model, plain, true)).toBe(false);
    expect(prefabInstance(model)!.components.phonograph.record).toBeUndefined();
    skinned.setWet(true);
    expect(give(model, skinned)).toBe(true);
    expect(manager.entities.get('phonograph:test')!.components.inventory!.GetItems()).toEqual([skinned]);
    // Inventory transfers must see the loaded record immediately, before any save projection.
    expect(manager.entities.get('phonograph:test')!.phonographRecord).toBe('record_creepyforest');
    manager.update(8, new THREE.Quaternion());
    const playingSound = vi.mocked(PlaySound).mock.results.at(-1)!.value;
    const soundCalls = vi.mocked(PlaySound).mock.calls.length;
    const target = manager.reskinTargets.find(({ prefabId }) => prefabId === 'phonograph')!;
    // Playback advances during the asynchronous preparation.
    manager.update(2, new THREE.Quaternion());
    expect(reskinEntity(target)).toBe(true);
    model = manager.reskinTargets.find(({ prefabId }) => prefabId === 'phonograph')!.model as THREE.Group;
    expect(lookupPrefabInstance(model)?.entityId).toBe('phonograph:test'); expect(model.position).toEqual(position);
    expect(prefabInstance(model)!.components.phonograph.snapshot()).toEqual({ phonographRecord: 'record_creepyforest', playbackRemaining: 54 });
    expect(PlaySound).toHaveBeenCalledTimes(soundCalls);
    expect(playingSound.stop).not.toHaveBeenCalled();
    const data = structuredClone(initialWorld) as any;
    data.players.local.inventory.containers['player:equipment'].slots = [];
    data.world.entities.ground_item = manager.exportRecords();
    expect(deserializeSave(JSON.stringify(data), SAVE_CATALOG).world.entities.ground_item).toEqual(manager.exportRecords());
    data.world.entities.ground_item[0].components.phonograph.remainingSeconds = 65;
    expect(() => deserializeSave(JSON.stringify(data), SAVE_CATALOG)).toThrow('remainingSeconds');
    const saved = manager.exportRecords();
    const restoredInventory = new InventoryStore([], INVENTORY_ITEM_SPECS, INVENTORY_SKIN_SPECS);
    const restoredManager = new GroundItemManager(new THREE.Scene(), world.camera,
      { domElement: canvas } as unknown as THREE.WebGLRenderer, '/dst/data/databundles/images.zip', restoredInventory, '/dst/data/anim', player);
    try {
      const restored = await restoredManager.spawnFromSave(saved[0].id, {
        ...spec, ...saved[0].components.stack!, playbackRemaining: saved[0].components.phonograph!.remainingSeconds,
      }, position);
      const restoredEntity = restoredManager.entities.get(saved[0].id)!;
      expect(prefabInstance(restored)!.components.phonograph.remainingSeconds).toBe(54);
      expect(restoredEntity.components.inventory!.GetItems()[0].snapshot()).toEqual(skinned.snapshot());
    } finally { restoredManager.dispose(); restoredInventory.dispose(); }
    // Cancelling before frame 13 never ejects the old record or stops music.
    const before = manager.exportRecords();
    expect(give(model, plain, true)).toBe(false);
    expect(manager.exportRecords()).toEqual(before);
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([{ object: model } as unknown as THREE.Intersection]);
    performPickupAction(findActionEntity(model)!.pickupTarget, createPickupDoer(player, inventory));
    expect(prefabInstance(model)!.components.phonograph.isPlaying).toBe(false);
    const item = inventory.get(from)!;
    expect(item.phonographRecord).toBe('record_creepyforest');
    expect(item.skinId).toBe('decor_phonograph_cawnival');
    expect(inventory.applySlotChanges([{ slot: from, itemId: item.itemId, skinId: item.skinId, delta: -1 },
      { slot: to, itemId: item.itemId, skinId: item.skinId, phonographRecord: item.phonographRecord, delta: 1 }])).toBe(true);
    const contents = skinned.snapshot();
    const state = inventory.exportState(); inventory.replaceState(state, {});
    expect(inventory.get(to)).toEqual(item);
    plain = inventory.GetActiveItem()!;
    const loaded = inventory.getEntity(to)!;
    skinned = loaded.components.inventory!.GetItems()[0];
    expect(skinned.snapshot()).toEqual(contents);
    expect(await manager.drop({ ...spec, ...item, entity: loaded }, position, () => inventory.extract(to, 1, loaded) ?? false)).toBe(true);
    const dropped = manager.reskinTargets.find(({ model }) => lookupPrefabInstance(model)?.entityId !== 'restored')!.model as THREE.Group;
    expect(prefabInstance(dropped)!.components.phonograph.record).toBe('record_creepyforest');
    expect(prefabInstance(dropped)!.components.phonograph.isPlaying).toBe(false);
    const droppedRecord = manager.exportRecords().find(({ id }) => id !== 'restored')!;
    expect(droppedRecord.components.phonograph).toBeUndefined();
    // Replacing the record ejects its original skin; one hammer hit ejects the new record.
    expect(give(dropped, plain)).toBe(true);
    expect(manager.exportRecords().some(({ components }) => components.stack?.skinId === 'record_creepyforest')).toBe(true);
    const ejected = manager.reskinTargets.find(({ prefabId }) => prefabId === 'record')!.model;
    expect(manager.reskinTargets.find(target => target.model === ejected)!.hasTag('phonograph_record')).toBe(true);
    expect(manager.entities.get(skinned.id)).toBe(skinned);
    expect(skinned.GetIsWet()).toBe(true);
    workTargets('HAMMER').find(({ model }) => model === dropped)!.work();
    await vi.waitFor(() => expect(manager.exportRecords().filter(({ components }) => components.stack?.itemId === 'record')).toHaveLength(2));
    expect(manager.exportRecords().some(({ id }) => id === droppedRecord.id)).toBe(false);
    plain.destroy(); skinned.destroy();
  } finally { controller.dispose(); graph.dispose(); manager.dispose(); inventory.dispose(); }
}, 30_000);
