import { onSignalChange } from '../../signals/tests/signalChanges';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { LANTERN_FUEL } from '../src/lantern';
import { inventoryItemEquipmentKind, inventoryItemMaxStack } from '../../inventory/src/slots';
import { equipmentSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { ItemWorldFixture } from '../../../tests/fixtures/itemWorldFixture';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { loadSavedInventory } from '../../../src/save/inventoryState';
import { createPickupInventory } from '../../../tests/fixtures/pickupFixture';
import { EventEmitter } from '@dontstarve-web/signals';
import { AnimState, type AnimStateArt } from '../../animation/src/animState';
import { SpriteState } from '@dontstarve-web/display';
import { declaredAnimState, element } from '../../../tests/fixtures/animStateFixture';
import { createEquipmentViews } from '../src/equipmentVisual';
import { createEmptyEntity, prefabInstance } from '../src/prefabInstance';
import type { LightParent } from '../src/localLight';
import { createPerishWorld } from '../../../tests/fixtures/perishWorldFixture';
import { sceneActions } from '../../../tests/fixtures/sceneActions';

/** The lanternlight entity parented to `owner`, by the light signal it declares there. */
const lightSlot = (owner: LightParent) =>
  [...owner.light.slots.value].find(([key]) => key.startsWith('lanternlight:'))?.[1];
const lightAt = (owner: LightParent) => lightSlot(owner)?.value;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** An inventory whose actor opens equipment views on a holder sprite whose own AnimState hides LANTERN_OVERLAY, as the player's does. */
function lanternOwner() {
  const inventory = createPickupInventory();
  const player = createEmptyEntity('wilson').instance;
  const events = new EventEmitter<Record<string, unknown>>();
  const pushed = vi.fn();
  const owner: import('../../signals/src').EquipmentOwner & { hasTag(): boolean; getPosition(): THREE.Vector3 } = {
    hasTag: () => true,
    getPosition: () => player.getPosition(),
    PushEvent: (name: string, data?: unknown) => {
      pushed(name, data);
      events.emit(name, data);
    },
    ListenForEvent: (name: string, listener: (inst: unknown, data: unknown) => void) =>
      events.on(name, data => listener(owner, data)),
  };
  inventory.bindActor(owner);
  const world = createPerishWorld();
  inventory.entities.bindPerishWorld(world);
  const sprite = new SpriteState({ name: 'idle' }),
    own = new AnimState();
  own.Hide('LANTERN_OVERLAY');
  sprite.setAnimState(own.json);
  const overlay = () => declaredAnimState(sprite).IsVisible(element('lantern_overlay', 'LANTERN_OVERLAY'));
  // equippable:Equip opens the owner's view: the lantern's slot of its sprite, and AttachLightTo(owner).
  // No animation assets or player controller are needed to create the light.
  owner.OpenEquipmentView = createEquipmentViews(owner, {
    sprite: { sprite, art: {} as AnimStateArt },
    assets: {} as never,
    hats: {} as never,
    lightParent: player,
  });
  return { inventory, player, owner, pushed, world, overlay };
}

describe('lantern fuel', () => {
  it('consumes only while on, settles on its game-time period and stays as an empty unlit item', () => {
    const { inventory, pushed, world, overlay } = lanternOwner();
    const slot = inventorySlotAddress(0),
      hand = equipmentSlotAddress('hand');
    expect(inventoryItemEquipmentKind('lantern')).toBe('hand');
    expect(inventoryItemMaxStack('lantern')).toBe(1);
    expect(inventory.add('lantern', 1)).toBe(true);
    const entity = inventory.getEntity(slot)!,
      ison = () => entity.components.machine!.IsOn();
    try {
      expect(ison()).toBe(false);
      expect(inventory.transfer(slot, hand, 1)).toBe(true);
      expect(ison()).toBe(true);
      expect(overlay()).toBe(true);
      // Fuel and its percent change once per one-second period of game time, plus the full-fuel first period.
      const fuelChanges: unknown[] = [];
      const stop = onSignalChange(entity.components.fueled!.fuel, fuel => fuelChanges.push(fuel));
      world.advance(0.5);
      expect(fuelChanges).toEqual([LANTERN_FUEL - 1 / 60]);
      world.advance(0.5);
      expect(fuelChanges).toEqual([LANTERN_FUEL - 1 / 60, LANTERN_FUEL - 1 - 1 / 60]);
      stop();
      expect(entity.components.fueled!.percent.value).toBeCloseTo((LANTERN_FUEL - 1 - 1 / 60) / LANTERN_FUEL, 9);

      // Unequipping keeps it on and clears the overlay; entering inventory settles the elapsed part and stops consumption.
      world.advance(9.5);
      const detached = inventory.Unequip('hand')!;
      expect(ison()).toBe(true);
      expect(overlay()).toBe(false);
      inventory.GiveItem(detached);
      expect(ison()).toBe(false);
      expect(entity.components.fueled!.currentfuel).toBeCloseTo(LANTERN_FUEL - 10.5 - 1 / 60, 9);
      world.advance(100);
      expect(entity.components.fueled!.currentfuel).toBeCloseTo(LANTERN_FUEL - 10.5 - 1 / 60, 9);

      // A partial lantern pays TURNON_FUELED_CONSUMPTION; running out only turns it off.
      expect(inventory.transfer(slot, hand, 1)).toBe(true);
      world.advance(LANTERN_FUEL);
      expect(entity.isRemoved).toBe(false);
      expect(entity.components.fueled!.currentfuel).toBe(0);
      expect(ison()).toBe(false);
      expect(pushed.mock.calls.filter(([name]) => name === 'torchranout')).toEqual([
        ['torchranout', { prefab: 'lantern', equipslot: 'HANDS' }],
      ]);
      expect(overlay()).toBe(false);
      expect(entity.tile.value.durabilityPercent).toBe(0);
      expect(inventory.transfer(hand, slot, 1)).toBe(true);
      expect(inventory.transfer(slot, hand, 1)).toBe(true);
      expect(ison()).toBe(false);
      expect(overlay()).toBe(false);
      expect(inventory.get(hand)).toMatchObject({ itemId: 'lantern', remainingFuel: 0 });
    } finally {
      inventory.dispose();
    }
  });

  it('owns a child light independently of worn art, pockets it through inventory hooks and releases old-owner listeners', async () => {
    const { inventory, player, owner, world, overlay } = lanternOwner();
    try {
      inventory.add('lantern', 1);
      const slot = inventorySlotAddress(0),
        hand = equipmentSlotAddress('hand');
      const entity = inventory.getEntity(slot)!,
        ison = () => entity.components.machine!.IsOn();
      expect(inventory.transfer(slot, hand, 1)).toBe(true);
      const node = lightSlot(player)!;
      expect(node).toBeDefined();
      expect(player.light.peek()).toBeUndefined();
      expect(lightAt(player)).toMatchObject({ radius: 15, intensity: 0.6 });
      expect(overlay()).toBe(true);
      // fueled:SetUpdateFn(fuelupdate): the light follows the fuel on fueled's updates.
      entity.setRemainingFuel(LANTERN_FUEL / 2 + 1 + 1 / 60);
      expect(lightAt(player)).toMatchObject({ radius: 15, intensity: 0.6 });
      world.advance(1);
      expect(lightSlot(player)).toBe(node);
      expect(lightAt(player)!.radius).toBeCloseTo(12, 9);
      expect(lightAt(player)!.intensity).toBeCloseTo(0.5, 9);
      expect(inventory.transfer(hand, slot, 1)).toBe(true);
      expect(ison()).toBe(false);
      expect(lightAt(player)).toBeUndefined();
      expect(overlay()).toBe(false);

      inventory.transfer(slot, hand, 1);
      const detached = inventory.Unequip('hand')!;
      expect(ison()).toBe(true);
      owner.PushEvent('equip', { item: { hasTag: () => false }, eslot: 'HEAD' });
      expect(ison()).toBe(true);
      owner.PushEvent('equip', { item: {}, eslot: 'HANDS' });
      expect(ison()).toBe(false);
      expect(lightAt(player)).toBeUndefined();
      inventory.GiveItem(detached);
      inventory.transfer(slot, hand, 1);
      // starttrackingowner: the unequip while on listens for the owner's next equip; removal stops listening.
      const listen = owner.ListenForEvent!,
        stops: ReturnType<typeof vi.fn>[] = [];
      vi.spyOn(owner, 'ListenForEvent').mockImplementation((name, listener) => {
        const stop = vi.fn(listen(name, listener));
        stops.push(stop);
        return stop;
      });
      inventory.Unequip('hand');
      expect(stops).toHaveLength(1);
      entity.destroy();
      expect(stops[0]).toHaveBeenCalledOnce();
      owner.PushEvent('equip', { item: {}, eslot: 'HANDS' });
      expect(entity.setRemainingFuel(1)).toBe(false);
      world.advance(1);
      expect(lightAt(player)).toBeUndefined();
    } finally {
      inventory.dispose();
    }
  });

  it('spawns/gives lanterns, then saves and reloads ground switch state and fuel, including an empty lantern', async () => {
    vi.stubGlobal(
      'fetch',
      async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
    );
    const inventory = createPickupInventory(),
      restoredInventory = createPickupInventory();
    const world = createPerishWorld();
    const player = new THREE.Group();
    player.position.set(4, 0, -2);
    const createManager = (store: typeof inventory) =>
      new ItemWorldFixture(
        new THREE.Scene(),
        new THREE.PerspectiveCamera(),
        { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer,
        '/dst/data/databundles/images.zip',
        store,
        '/dst/data/anim',
        player,
      );
    const manager = createManager(inventory);
    manager.entities.bindPerishWorld(world);
    const registry = new EntityRegistry();
    registry.register(
      PREFAB_DEFINITIONS.groundItems,
      manager.registration(
        () => player.position,
        id => `spawn:${id}`,
      ),
    );
    let restored: ItemWorldFixture | undefined;
    try {
      expect((await executeDebugCommand('c_spawn("lantern")', inventory, prefab => registry.spawn(prefab))).ok).toBe(
        true,
      );
      expect((await executeDebugCommand('c_give("lantern", 2)', inventory)).ok).toBe(true);
      const ground = manager.entities.get('spawn:lantern')!;
      const model = manager.reskinTargets[0].transform.model;
      // SpawnPrefab leaves machine.ison false; only ondropped turns a lantern on. The player's TURNON lights it.
      expect(ground.components.machine!.IsOn()).toBe(false);
      ground.components.machine!.TurnOn();
      expect(ground.components.machine!.IsOn()).toBe(true);
      expect(lightAt(prefabInstance(model)!)).toMatchObject({ radius: 15 });
      // A lit ground lantern consumes on its world's game time; frames play no part.
      manager.update(1, new THREE.Quaternion());
      world.advance(120);
      expect(ground.components.fueled!.currentfuel).toBeCloseTo(LANTERN_FUEL - 120 - 1 / 60, 6);
      // componentactions.lua SCENE.machine: RMB offers TURNOFF (priority 2, over the inventoryitem's PICKUP); off, it removes the light and stops fuel.
      expect(sceneActions(model!, undefined, true)).toEqual(['PICKUP', 'LOOKAT', 'TURNOFF']);
      ground.components.machine!.TurnOff();
      const off = ground.components.fueled!.currentfuel;
      world.advance(60);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(lightAt(prefabInstance(model)!)).toBeUndefined();
      expect(ground.components.fueled!.currentfuel).toBe(off);
      expect(sceneActions(model!, undefined, true)).toEqual(['PICKUP', 'LOOKAT', 'TURNON']);
      ground.components.machine!.TurnOn();
      expect(lightAt(prefabInstance(model)!)).toMatchObject({ radius: expect.any(Number) });
      expect(inventory.setRemainingFuel(inventorySlotAddress(1), 0)).toBe(true);

      const before = registry.exportRecords();
      expect(before.lantern[0].components.machine).toEqual({ ison: true });
      let json = '';
      expect(
        (
          await executeDebugCommand('c_save()', inventory, undefined, () => {
            const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
            json = serializeSave(
              template,
              {
                entities: before,
                inventory: inventory.exportSaved(),
                elapsedSeconds: 20,
                playerTransform: { position: [4, 0, -2], rotationY: 0 },
              },
              SAVE_CATALOG,
            );
          })
        ).ok,
      ).toBe(true);
      const saved = deserializeSave(json, SAVE_CATALOG);
      expect(saved.world.entities).toEqual(before);
      // The world's SpawnPrefab is bound before the save loads, so held items are that world's insts.
      restored = createManager(restoredInventory);
      loadSavedInventory(restoredInventory, saved, SAVE_CATALOG.recipes);
      restored.restoreEntities(saved.world.entities);
      const loaded = restored.entities.get('spawn:lantern')!;
      // machine:OnLoad turns it on again; StartConsuming charges a new first period on the next settlement.
      expect(loaded.components.machine!.IsOn()).toBe(true);
      expect(loaded.components.fueled!.currentfuel).toBe(ground.components.fueled!.currentfuel);
      for (const index of [0, 1]) {
        expect(restoredInventory.getEntity(inventorySlotAddress(index))!.snapshot()).toEqual(
          inventory.getEntity(inventorySlotAddress(index))!.snapshot(),
        );
      }
      expect(restoredInventory.get(inventorySlotAddress(1))).toMatchObject({ itemId: 'lantern', remainingFuel: 0 });

      // An empty lantern dropped on the ground stays there, unlit, and saves ison = false.
      const empty = restoredInventory.getEntity(inventorySlotAddress(1))!;
      restoredInventory.DropItem(empty, { x: 8, y: 0, z: 8 });
      await vi.waitFor(() =>
        expect(restored!.exportRecords().find(record => record.id === empty.id)?.components.machine).toBeDefined(),
      );
      expect(empty.components.machine!.IsOn()).toBe(false);
      expect(restored.exportRecords().find(record => record.id === empty.id)!.components).toEqual({
        fueled: { fuel: 0 },
        machine: { ison: false },
      });
    } finally {
      registry.dispose();
      restored?.dispose();
      inventory.dispose();
      restoredInventory.dispose();
    }
  });
});
