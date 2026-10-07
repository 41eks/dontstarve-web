import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { PhonographController } from '../../prefab/src/phonograph';
import { PlaySound } from '../../prefab/src/sound';
import { GroundItemManager } from '../../../src/groundItems';
import { InventoryStore, InventorySlot, inventorySlotAddress, inventoryItemMaxStack, inventoryItemEquipmentKind } from '../../inventory/src';
import { INVENTORY_ITEM_DISPLAY_SPECS } from '../../ui/src/inventory-items';
import { INVENTORY_SKIN_SPECS, INVENTORY_RECIPES, INVENTORY_RECIPE_SKINS } from '../../ui/src/categories/shared';
import definitions from '../../prefab/src/definitions.json' with { type: 'json' };
import { deserializeSave } from '../../../src/save/deserialize';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

const INVENTORY_ITEM_SPECS = Object.fromEntries(Object.entries(INVENTORY_ITEM_DISPLAY_SPECS).map(([id, spec]) =>
  [id, { ...spec, maxStack: inventoryItemMaxStack(id), equippable: inventoryItemEquipmentKind(id) }]));
const SAVE_CATALOG = { items: INVENTORY_ITEM_SPECS, skins: INVENTORY_SKIN_SPECS, recipes: INVENTORY_RECIPES,
  recipeSkins: INVENTORY_RECIPE_SKINS, buildings: definitions.animatedBuildings, walls: Object.keys(definitions.walls) };

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop: vi.fn() })),
}));
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('runs a ground-only record for 64 seconds and releases each machine sound independently', () => {
  const sprite = { start: vi.fn(), playOnce: vi.fn(), setAnimation: vi.fn() };
  const first = new PhonographController(sprite, new THREE.Vector3());
  const second = new PhonographController(sprite, new THREE.Vector3(12, 0, 0), 'record_efs');
  expect(first.play()).toBe(false);
  first.insert('record'); second.play();
  const handles = vi.mocked(PlaySound).mock.results.map(({ value }) => value);
  expect(sprite.playOnce).toHaveBeenCalledWith('open', expect.any(Function));
  sprite.playOnce.mock.calls[0][1]();
  expect(sprite.start).toHaveBeenCalledWith('play_loop');
  first.update(63.9); expect(first.isPlaying).toBe(true);
  first.update(0.1); expect(first.isPlaying).toBe(false);
  expect(first.record).toBe('record');
  expect(PlaySound).toHaveBeenLastCalledWith('dontstarve/music/gramaphone_end', expect.any(THREE.Vector3));
  expect(handles[0].stop).toHaveBeenCalledOnce();
  expect(handles[1].stop).not.toHaveBeenCalled();
  expect(second.isPlaying).toBe(true);
  second.dispose(); expect(handles[1].stop).toHaveBeenCalledOnce();
  expect(second.play()).toBe(false);
  first.dispose();
});

it('preserves a loaded skinned record across reskin, pickup, inventory transfer, drop and save/load; rejects failed trades', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(
    new URL(`../../../public/dst/data/${url.slice('/dst/data/'.length)}`, import.meta.url))));
  const scene = new THREE.Scene(), player = new THREE.Group();
  const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
  const from = inventorySlotAddress(0), to = inventorySlotAddress(1);
  const inventory = new InventoryStore([{ address: from, slot: new InventorySlot() },
    { address: to, slot: new InventorySlot() }], INVENTORY_ITEM_SPECS, INVENTORY_SKIN_SPECS);
  const pickup = vi.fn((item) => inventory.add(item.itemId, item.count, item.skinId, undefined, undefined, item.phonographRecord));
  const manager = new GroundItemManager(scene, new THREE.PerspectiveCamera(),
    { domElement: canvas } as unknown as THREE.WebGLRenderer, '/dst/data/databundles/images.zip', pickup, '/dst/data/anim', player);
  const spec = INVENTORY_ITEM_SPECS.phonograph;
  try {
    const position = new THREE.Vector3(3, 0, 4);
    player.position.copy(position);
    let model = await manager.spawnFromSave('phonograph:test', { ...spec, itemId: 'phonograph', count: 1 }, position);
    const take = vi.fn(() => false);
    expect(await manager.insertPhonographRecord(model, { take })).toBe(false);
    expect(model.userData.phonograph.record).toBeUndefined();
    take.mockReturnValue(true);
    expect(await manager.insertPhonographRecord(model, { skinId: 'record_creepyforest', take })).toBe(true);
    manager.update(8, new THREE.Quaternion());
    const target = manager.reskinTargets.find(({ prefabId }) => prefabId === 'phonograph')!;
    const skin = await target.prepareNextSkin();
    // Playback advances during the asynchronous preparation.
    manager.update(2, new THREE.Quaternion());
    expect(skin.apply()).toBe(true); skin.dispose();
    model = manager.renderEntities.find(({ object }) => object.userData.itemId === 'phonograph')!.object;
    expect(model.userData.entityId).toBe('phonograph:test'); expect(model.position).toEqual(position);
    expect(model.userData.phonograph.snapshot()).toEqual({ phonographRecord: 'record_creepyforest', playbackRemaining: 54 });
    expect(PlaySound).toHaveBeenLastCalledWith('dontstarve/music/gramaphone_creepyforest', model.position, 10);
    const data = structuredClone(initialWorld) as any;
    data.players.local.inventory.containers['player:equipment'].slots = [];
    data.world.entities.ground_item = manager.exportRecords();
    expect(deserializeSave(JSON.stringify(data), SAVE_CATALOG).world.entities.ground_item).toEqual(manager.exportRecords());
    data.world.entities.ground_item[0].components.phonograph.remainingSeconds = 65;
    expect(() => deserializeSave(JSON.stringify(data), SAVE_CATALOG)).toThrow('remainingSeconds');
    const saved = manager.exportRecords();
    const restored = await manager.spawnFromSave('restored', {
      ...spec, ...saved[0].components.stack!, playbackRemaining: saved[0].components.phonograph!.remainingSeconds,
    }, position.clone().setX(6));
    expect(restored.userData.phonograph.remainingSeconds).toBe(54);
    // A full inventory or canceled trade never ejects the old record or stops music.
    const before = manager.exportRecords();
    take.mockReturnValue(false);
    expect(await manager.insertPhonographRecord(model, { take })).toBe(false);
    expect(manager.exportRecords()).toEqual(before);
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([{ object: model } as unknown as THREE.Intersection]);
    canvas.dispatchEvent(Object.assign(new Event('pointerdown', { cancelable: true }), { button: 0, clientX: 50, clientY: 50 }));
    expect(model.userData.phonograph.isPlaying).toBe(false);
    const item = inventory.get(from)!;
    expect(item.phonographRecord).toBe('record_creepyforest');
    expect(item.skinId).toBe('decor_phonograph_cawnival');
    expect(inventory.applySlotChanges([{ slot: from, itemId: item.itemId, skinId: item.skinId, delta: -1 },
      { slot: to, itemId: item.itemId, skinId: item.skinId, phonographRecord: item.phonographRecord, delta: 1 }])).toBe(true);
    const state = inventory.exportState(); inventory.replaceState(state, {});
    expect(inventory.get(to)).toEqual(item);
    expect(await manager.drop({ ...spec, ...item }, position, () => inventory.applySlotChanges([
      { slot: to, itemId: item.itemId, skinId: item.skinId, delta: -1 },
    ]))).toBe(true);
    const dropped = manager.renderEntities.find(({ object }) => object.userData.entityId !== 'restored')!.object;
    expect(dropped.userData.phonograph.record).toBe('record_creepyforest');
    expect(dropped.userData.phonograph.isPlaying).toBe(false);
    const droppedRecord = manager.exportRecords().find(({ id }) => id !== 'restored')!;
    expect(droppedRecord.components.phonograph).toBeUndefined();
    // Replacing the record ejects its original skin; one hammer hit ejects the new record.
    take.mockReturnValue(true);
    expect(await manager.insertPhonographRecord(dropped, { take })).toBe(true);
    expect(manager.exportRecords().some(({ components }) => components.stack?.skinId === 'record_creepyforest')).toBe(true);
    manager.hammerTargets.find(({ model }) => model === dropped)!.playHit();
    await vi.waitFor(() => expect(manager.exportRecords().filter(({ components }) => components.stack?.itemId === 'record')).toHaveLength(2));
    expect(manager.exportRecords().some(({ id }) => id === droppedRecord.id)).toBe(false);
  } finally { manager.dispose(); }
}, 30_000);
