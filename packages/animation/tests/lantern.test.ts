import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { LANTERN_FUEL, LanternLightController, createLanternHandLifecycle, getLanternController } from '../../prefab/src/lantern';
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
import { AnimState, type AnimStateArt } from '../src/animState';
import { SpriteState } from '@dontstarve-web/display';
import { declaredAnimState, element } from './animStateFixture';
import { bindPlayerHandEquipment } from '../../../src/playerHandEquipment';
import { createEmptyEntity, prefabInstance } from '../../prefab/src/prefabInstance';
import type { LightParent } from '../../prefab/src/localLight';
import { createPerishWorld } from './perishWorldFixture';
import { getMachineActions } from '../../stategraphs/src/turnon';

/** The lanternlight entity parented to `owner`, by the light signal it declares there. */
const lightSlot = (owner: LightParent) => [...owner.light.slots.peek()].find(([key]) => key.startsWith('lanternlight:'))?.[1];
const lightAt = (owner: LightParent) => lightSlot(owner)?.peek();

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('lantern light lifecycle', () => {
  it('uses source fuel-dependent lighting and clears the owner when extinguished', () => {
    const owner = createEmptyEntity('wilson').instance;
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
    const light = new LanternLightController(createEmptyEntity('wilson').instance);
    light.setLit(true);
    expect(() => light.setFuelPercent(NaN)).toThrow(RangeError);
    expect(light.isLit).toBe(true);
  });
});

describe('lantern fuel', () => {
  it('consumes only while on, settles on its game-time period and stays as an empty unlit item', () => {
    const inventory = createPickupInventory();
    const world = createPerishWorld();
    inventory.entities.bindPerishWorld(world);
    const hand = equipmentSlotAddress('hand');
    expect(inventory.add('lantern', 1)).toBe(true);
    const entity = inventory.getEntity(inventorySlotAddress(0))!;
    const controller = getLanternController(entity);
    const light = vi.fn();
    const owner = { PushEvent: vi.fn() };
    const lifecycle = createLanternHandLifecycle(entity, { lightParent: createEmptyEntity('wilson').instance, AnimState: { Show: () => light(true), Hide: () => light(false) } });
    try {
      expect(controller.isOn).toBe(false);
      lifecycle.onequip(owner);
      expect(controller.isOn).toBe(true);
      expect(light).toHaveBeenLastCalledWith(true);
      // Fuel and its percent change once per one-second period of game time, plus the full-fuel first period.
      const fuelChanges: unknown[] = [];
      const stop = entity.components.fueled!.fuel.subscribe(fuel => fuelChanges.push(fuel));
      world.advance(0.5);
      expect(fuelChanges).toEqual([LANTERN_FUEL - 1 / 60]);
      world.advance(0.5);
      expect(fuelChanges).toEqual([LANTERN_FUEL - 1 / 60, LANTERN_FUEL - 1 - 1 / 60]);
      stop();
      expect(entity.components.fueled!.percent.peek()).toBeCloseTo((LANTERN_FUEL - 1 - 1 / 60) / LANTERN_FUEL, 9);

      // Unequipping clears the overlay; entering inventory settles the elapsed part and stops consumption.
      world.advance(9.5);
      lifecycle.onunequip();
      expect(controller.isOn).toBe(true);
      entity.components.inventoryitem.OnPutInInventory({ hasTag: () => true, GetPosition: () => new THREE.Vector3(), PushEvent() {} });
      expect(controller.isOn).toBe(false);
      expect(entity.components.fueled!.currentfuel).toBeCloseTo(LANTERN_FUEL - 10.5 - 1 / 60, 9);
      expect(light).toHaveBeenLastCalledWith(false);
      world.advance(100);
      expect(entity.components.fueled!.currentfuel).toBeCloseTo(LANTERN_FUEL - 10.5 - 1 / 60, 9);

      // A partial lantern pays TURNON_FUELED_CONSUMPTION; running out only turns it off.
      lifecycle.onequip(owner);
      world.advance(LANTERN_FUEL);
      expect(entity.isRemoved).toBe(false);
      expect(entity.components.fueled!.currentfuel).toBe(0);
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
    const player = createEmptyEntity('wilson').instance;
    const events = new EventEmitter<Record<string, unknown>>();
    const owner = {
      hasTag: () => true, GetPosition: () => player.position,
      PushEvent: (name: string, data?: unknown) => events.emit(name, data),
      ListenForEvent: (name: string, listener: (data: unknown) => void) => events.on(name, listener),
    };
    inventory.bindActor(owner);
    const world = createPerishWorld();
    inventory.entities.bindPerishWorld(world);
    // The holder's own AnimState hides LANTERN_OVERLAY, as the player's does; the lantern's slot shows it while lit.
    const sprite = new SpriteState({ name: 'idle' }), own = new AnimState();
    own.Hide('LANTERN_OVERLAY');
    sprite.setAnimState(own.json);
    const overlay = () => declaredAnimState(sprite).IsVisible(element('lantern_overlay', 'LANTERN_OVERLAY'));
    const binding = await bindPlayerHandEquipment({
      handEquipmentExistenceState: inventory.handEquipmentExistenceState,
      owner, lightParent: player, sprite: { sprite, art: {} as AnimStateArt }, setHandAction() {},
      // No animation assets or player controller are needed to create the light.
    });
    try {
      inventory.add('lantern', 1);
      const slot = inventorySlotAddress(0), hand = equipmentSlotAddress('hand');
      const entity = inventory.getEntity(slot)!, controller = getLanternController(entity);
      expect(inventory.transfer(slot, hand, 1)).toBe(true);
      const node = lightSlot(player)!;
      expect(node).toBeDefined();
      expect(player.light.peek()).toBeUndefined();
      expect(lightAt(player)).toMatchObject({ radius: 15, intensity: .6 });
      expect(overlay()).toBe(true);
      // fueled:SetUpdateFn(fuelupdate): the light follows the fuel on fueled's updates.
      entity.setRemainingFuel(LANTERN_FUEL / 2 + 1 + 1 / 60);
      expect(lightAt(player)).toMatchObject({ radius: 15, intensity: .6 });
      world.advance(1);
      expect(lightSlot(player)).toBe(node);
      expect(lightAt(player)!.radius).toBeCloseTo(12, 9);
      expect(lightAt(player)!.intensity).toBeCloseTo(.5, 9);
      expect(inventory.transfer(hand, slot, 1)).toBe(true);
      expect(controller.isOn).toBe(false);
      expect(lightAt(player)).toBeUndefined();
      expect(overlay()).toBe(false);

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
      inventory.Unequip('hand');
      const turnoff = vi.spyOn(controller, 'TurnOff');
      entity.destroy();
      turnoff.mockClear();
      owner.PushEvent('equip', { item: {}, eslot: 'HANDS' });
      expect(entity.setRemainingFuel(1)).toBe(false);
      world.advance(1);
      expect(turnoff).not.toHaveBeenCalled();
      expect(lightAt(player)).toBeUndefined();
    } finally { binding.dispose(); inventory.dispose(); }
  });

  it('spawns/gives lanterns, then saves and reloads ground switch state and fuel, including an empty lantern', async () => {
    vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
    const inventory = createPickupInventory(), restoredInventory = createPickupInventory();
    const world = createPerishWorld();
    const player = new THREE.Group();
    player.position.set(4, 0, -2);
    const createManager = (store: typeof inventory) => new GroundItemManager(new THREE.Scene(), new THREE.PerspectiveCamera(),
      { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer, '/dst/data/databundles/images.zip',
      store, '/dst/data/anim', player);
    const manager = createManager(inventory);
    manager.entities.bindPerishWorld(world);
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
      expect(lightAt(prefabInstance(model)!)).toMatchObject({ radius: 15 });
      // A lit ground lantern consumes on its world's game time; frames play no part.
      manager.update(1, new THREE.Quaternion());
      world.advance(120);
      expect(ground.components.fueled!.currentfuel).toBeCloseTo(LANTERN_FUEL - 120 - 1 / 60, 6);
      // componentactions.lua SCENE.machine: RMB turns the lit ground lantern off, which removes its light and stops fuel.
      expect(getMachineActions(model).map(candidate => candidate.action.action)).toEqual(['TURNOFF']);
      ground.components.machine!.TurnOff();
      const off = ground.components.fueled!.currentfuel;
      world.advance(60);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(lightAt(prefabInstance(model)!)).toBeUndefined();
      expect(ground.components.fueled!.currentfuel).toBe(off);
      expect(getMachineActions(model).map(candidate => candidate.action.action)).toEqual(['TURNON']);
      ground.components.machine!.TurnOn();
      expect(lightAt(prefabInstance(model)!)).toMatchObject({ radius: expect.any(Number) });
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
      expect(loaded.components.fueled!.currentfuel).toBe(ground.components.fueled!.currentfuel);
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
