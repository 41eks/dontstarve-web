import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { LANTERN_FUEL, LanternLightController, createLanternHandLifecycle, getLanternController } from '../../prefab/src/lantern';
import { getPrefabLocalLight } from '../../prefab/src/localLight';
import { inventoryItemEquipmentKind, inventoryItemMaxStack } from '../../inventory/src/slots';
import { equipmentSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { GroundItemManager } from '../../../src/groundItems';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';
import type { SavedEntity } from '../../../src/save/types';
import { createPickupInventory } from './pickupFixture';
import { EventEmitter } from '@dontstarve-web/signals';
import { AnimState } from '../src/animState';
import { bindPlayerHandEquipment } from '../../../src/playerHandEquipment';

const lightAt = (owner: THREE.Object3D) => {
  const node = owner.getObjectByName('lanternlight');
  return node && getPrefabLocalLight(node);
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('lantern light lifecycle', () => {
  it('uses source fuel-dependent lighting and clears the owner when extinguished', () => {
    const owner = new THREE.Group();
    const light = new LanternLightController(owner);
    expect(lightAt(owner)).toBeUndefined();
    light.setLit(true);
    expect(lightAt(owner)).toMatchObject({ radius: 15, intensity: 0.6, falloff: 0.9 });
    light.setFuelPercent(0.5);
    expect(lightAt(owner)).toMatchObject({ radius: 12, intensity: 0.5 });
    light.setFuelPercent(0);
    expect(light.isLit).toBe(false);
    expect(lightAt(owner)).toBeUndefined();
    light.setLit(false);
    light.setFuelPercent(1);
    expect(lightAt(owner)).toBeUndefined();
    light.setLit(true);
    light.dispose();
    expect(lightAt(owner)).toBeUndefined();
    expect(inventoryItemEquipmentKind('lantern')).toBe('hand');
    expect(inventoryItemMaxStack('lantern')).toBe(1);
  });

  it('rejects invalid fuel without losing an existing light', () => {
    const light = new LanternLightController(new THREE.Group());
    light.setLit(true);
    expect(() => light.setFuelPercent(NaN)).toThrow(RangeError);
    expect(light.isLit).toBe(true);
  });
});

describe('lantern fuel', () => {
  it('consumes only while on, settles every 60 frames and stays as an empty unlit item', () => {
    const inventory = createPickupInventory();
    const hand = equipmentSlotAddress('hand');
    expect(inventory.add('lantern', 1)).toBe(true);
    const entity = inventory.getEntity(inventorySlotAddress(0))!;
    const controller = getLanternController(entity);
    const light = vi.fn();
    const owner = { PushEvent: vi.fn() };
    const lifecycle = createLanternHandLifecycle(entity, { lightParent: new THREE.Group(), AnimState: { Show: () => light(true), Hide: () => light(false) } });
    try {
      expect(controller.isOn).toBe(false);
      lifecycle.onequip(owner);
      expect(controller.isOn).toBe(true);
      expect(light).toHaveBeenLastCalledWith(true);
      // Frames only accumulate; fuel and its percent change once per settlement, plus the full-fuel first period.
      const fuelChanges: unknown[] = [];
      const stop = entity.components.fueled.fuel.subscribe(fuel => fuelChanges.push(fuel));
      for (let frame = 0; frame < 59; frame++) lifecycle.onFrame!(1);
      expect(fuelChanges).toEqual([]);
      lifecycle.onFrame!(1);
      expect(fuelChanges).toEqual([LANTERN_FUEL - 60 - 1 / 60]);
      stop();
      expect(controller.fuelPercent.peek()).toBeCloseTo((LANTERN_FUEL - 60 - 1 / 60) / LANTERN_FUEL, 9);

      // Unequipping clears the overlay; entering inventory stops consumption.
      for (let frame = 0; frame < 10; frame++) lifecycle.onFrame!(1);
      lifecycle.onunequip();
      expect(controller.isOn).toBe(true);
      entity.components.inventoryitem.OnPutInInventory({ hasTag: () => true, GetPosition: () => new THREE.Vector3(), PushEvent() {} });
      expect(controller.isOn).toBe(false);
      expect(entity.components.fueled.remaining).toBeCloseTo(LANTERN_FUEL - 70 - 1 / 60, 9);
      expect(light).toHaveBeenLastCalledWith(false);
      lifecycle.onFrame!(100);
      expect(entity.components.fueled.remaining).toBeCloseTo(LANTERN_FUEL - 70 - 1 / 60, 9);

      // A partial lantern pays TURNON_FUELED_CONSUMPTION; running out only turns it off.
      lifecycle.onequip(owner);
      for (let frame = 0; frame < 60; frame++) lifecycle.onFrame!(LANTERN_FUEL / 60);
      expect(entity.isRemoved).toBe(false);
      expect(entity.components.fueled.remaining).toBe(0);
      expect(controller.isOn).toBe(false);
      expect(owner.PushEvent).toHaveBeenCalledExactlyOnceWith('torchranout', { prefab: 'lantern', equipslot: 'HANDS' });
      expect(light).toHaveBeenLastCalledWith(false);
      expect(entity.signals.durabilityPercent.peek()).toBe(0);
      expect(inventory.transfer(inventorySlotAddress(0), hand, 1)).toBe(true);
      lifecycle.onunequip();
      lifecycle.onequip(owner);
      expect(controller.isOn).toBe(false);
      expect(inventory.get(hand)).toMatchObject({ itemId: 'lantern', remainingFuel: 0 });
    } finally { lifecycle.onunequip(); inventory.dispose(); }
  });

  it('owns a child light independently of worn art, pockets it through inventory hooks and releases old-owner listeners', async () => {
    const inventory = createPickupInventory();
    const player = new THREE.Group();
    const events = new EventEmitter<Record<string, unknown>>();
    const owner = {
      hasTag: () => true, GetPosition: () => player.position,
      PushEvent: (name: string, data?: unknown) => events.emit(name, data),
      ListenForEvent: (name: string, listener: (data: unknown) => void) => events.on(name, listener),
    };
    inventory.bindActor(owner);
    const anim = new AnimState(() => {});
    const show = vi.spyOn(anim, 'Show');
    const hide = vi.spyOn(anim, 'Hide');
    const binding = await bindPlayerHandEquipment({
      handEquipmentExistenceState: inventory.handEquipmentExistenceState,
      owner, lightParent: player, AnimState: anim, setHandAction() {},
      // No animation assets or player controller are needed to create the light.
    });
    try {
      inventory.add('lantern', 1);
      const slot = inventorySlotAddress(0), hand = equipmentSlotAddress('hand');
      const entity = inventory.getEntity(slot)!, controller = getLanternController(entity);
      expect(inventory.transfer(slot, hand, 1)).toBe(true);
      const node = player.getObjectByName('lanternlight')!;
      expect(node).toBeDefined();
      expect(getPrefabLocalLight(player)).toBeUndefined();
      expect(lightAt(player)).toMatchObject({ radius: 15, intensity: .6 });
      expect(show).toHaveBeenLastCalledWith('LANTERN_OVERLAY');
      entity.setRemainingFuel(LANTERN_FUEL / 2);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(player.getObjectByName('lanternlight')).toBe(node);
      expect(lightAt(player)).toMatchObject({ radius: 12, intensity: .5 });
      expect(inventory.transfer(hand, slot, 1)).toBe(true);
      expect(controller.isOn).toBe(false);
      expect(lightAt(player)).toBeUndefined();
      expect(hide).toHaveBeenLastCalledWith('LANTERN_OVERLAY');

      inventory.transfer(slot, hand, 1);
      const detached = inventory.Unequip('hand')!;
      expect(controller.isOn).toBe(true);
      owner.PushEvent('equip', { item: { hasTag: () => false }, eslot: 'HEAD' });
      expect(controller.isOn).toBe(true);
      owner.PushEvent('equip', { item: {}, eslot: 'HANDS' });
      expect(controller.isOn).toBe(false);
      expect(lightAt(player)).toBeUndefined();
      inventory.GiveItem(detached);
      inventory.transfer(slot, hand, 1);
      const fuelRead = vi.spyOn(entity.components.fueled.fuel, 'get');
      inventory.Unequip('hand');
      const turnoff = vi.spyOn(controller, 'TurnOff');
      entity.destroy();
      turnoff.mockClear(); fuelRead.mockClear();
      owner.PushEvent('equip', { item: {}, eslot: 'HANDS' });
      entity.components.fueled.remaining = 1;
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(turnoff).not.toHaveBeenCalled();
      expect(fuelRead).not.toHaveBeenCalled();
      expect(lightAt(player)).toBeUndefined();
    } finally { binding.dispose(); inventory.dispose(); }
  });

  it('spawns/gives lanterns, then saves and reloads ground switch state and fuel, including an empty lantern', async () => {
    vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
    const inventory = createPickupInventory(), restoredInventory = createPickupInventory();
    const player = new THREE.Group();
    player.position.set(4, 0, -2);
    const createManager = (store: typeof inventory) => new GroundItemManager(new THREE.Scene(), new THREE.PerspectiveCamera(),
      { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer, '/dst/data/databundles/images.zip',
      store, '/dst/data/anim', player);
    const manager = createManager(inventory);
    const restoreGround = (target: GroundItemManager, record: SavedEntity) => target.spawnFromSave(record.id, {
      ...SAVE_CATALOG.items[record.components.stack!.itemId], ...record.components.stack!,
      ...(record.components.lantern ? { lanternOn: record.components.lantern.ison } : {}),
    }, new THREE.Vector3(...record.transform.position));
    const registry = new EntityRegistry();
    registry.register(PREFAB_DEFINITIONS.groundItems, {
      debugSpawn: id => manager.spawnFromSave(`spawn:${id}`, { ...SAVE_CATALOG.items[id], itemId: id, count: 1 }, player.position),
      restore: (_prefab, record) => restoreGround(manager, record),
      exportRecords: () => manager.exportRecords().map(record => ({ prefabId: 'ground_item', record })),
      dispose: () => manager.dispose(),
    });
    let restored: GroundItemManager | undefined;
    try {
      expect((await executeDebugCommand('c_spawn("lantern")', inventory, prefab => registry.spawn(prefab))).ok).toBe(true);
      expect((await executeDebugCommand('c_give("lantern", 2)', inventory)).ok).toBe(true);
      const ground = manager.entities.get('spawn:lantern')!;
      const model = manager.reskinTargets[0].model;
      expect(getLanternController(ground).isOn).toBe(true);
      expect(lightAt(model)).toMatchObject({ radius: 15 });
      manager.update(1, new THREE.Quaternion());
      for (let frame = 0; frame < 60; frame++) manager.update(2, new THREE.Quaternion());
      expect(ground.components.fueled.remaining).toBeCloseTo(LANTERN_FUEL - 119 - 1 / 60, 6);
      expect(inventory.setRemainingFuel(inventorySlotAddress(1), 0)).toBe(true);

      const before = registry.exportRecords(), held = inventory.exportState();
      expect(before.ground_item[0].components.lantern).toEqual({ ison: true });
      let json = '';
      expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
        const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
        json = serializeSave(template, { entities: before, inventory: held, elapsedSeconds: 20,
          playerTransform: { position: [4, 0, -2], rotationY: 0 } }, SAVE_CATALOG);
      })).ok).toBe(true);
      const saved = deserializeSave(json, SAVE_CATALOG);
      expect(saved.world.entities).toEqual(before);
      restoredInventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
      restored = createManager(restoredInventory);
      for (const record of saved.world.entities.ground_item) await restoreGround(restored, record);
      const loaded = restored.entities.get('spawn:lantern')!;
      // machine:OnLoad turns it on again; StartConsuming charges a new first period on the next settlement.
      expect(getLanternController(loaded).isOn).toBe(true);
      expect(loaded.components.fueled.remaining).toBe(ground.components.fueled.remaining);
      for (const index of [0, 1]) {
        expect(restoredInventory.getEntity(inventorySlotAddress(index))!.snapshot())
          .toEqual(inventory.getEntity(inventorySlotAddress(index))!.snapshot());
      }
      expect(restoredInventory.get(inventorySlotAddress(1))).toMatchObject({ itemId: 'lantern', remainingFuel: 0 });

      // An empty lantern dropped on the ground stays there, unlit, and saves ison = false.
      const empty = restoredInventory.getEntity(inventorySlotAddress(1))!;
      restoredInventory.DropItem(empty, { x: 8, y: 0, z: 8 });
      await vi.waitFor(() => expect(restored!.exportRecords().find(record => record.id === empty.id)?.components.lantern).toBeDefined());
      expect(getLanternController(empty).isOn).toBe(false);
      expect(restored.exportRecords().find(record => record.id === empty.id)!.components)
        .toMatchObject({ stack: { itemId: 'lantern', remainingFuel: 0 }, lantern: { ison: false } });
    } finally { registry.dispose(); restored?.dispose(); inventory.dispose(); restoredInventory.dispose(); }
  });
});
