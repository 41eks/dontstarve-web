import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { ItemEntity, InventorySlot, InventoryStore, cursorSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { INVENTORY_ITEM_SPECS } from '../../../src/inventoryItems';
import { PERISH_FAST } from '../../componets/src/perishable';
import { getFoodEffects } from '../../prefab/src/food';
import { getLanternController, LANTERN_FUEL } from '../../prefab/src/lantern';
import { createBufferedAction } from '../../stategraphs/src/actionfns';
import { createPickupDoer } from '../../stategraphs/src/pickup';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import { createPickupInventory } from './pickupFixture';
import { createPerishWorld } from './perishWorldFixture';

afterEach(() => vi.unstubAllGlobals());

it('settles lightbulb freshness in batches, applies spoilage to eating, and replaces the whole rotten stack', () => {
  const inventory = createPickupInventory(), slot = inventorySlotAddress(0);
  const world = createPerishWorld();
  inventory.entities.bindPerishWorld(world);
  try {
    inventory.add('lightbulb', 3);
    const entity = inventory.getEntity(slot)!, perish = entity.components.perishable;
    expect(perish.timer.peek()).toEqual({ status: 'perishing', remainingSeconds: PERISH_FAST });
    expect(getFoodEffects(entity)).toEqual({ health: 1, hunger: 0, sanity: 0 });
    const changes: unknown[] = [], stop = perish.timer.subscribe(timer => changes.push(timer));
    for (let frame = 0; frame < 79; frame++) world.advance(.125);
    expect(changes).toEqual([]);
    world.advance(.125);
    expect(changes).toEqual([{ status: 'perishing', remainingSeconds: PERISH_FAST - 10 }]);
    stop();
    perish.SetPercent(.3);
    expect(getFoodEffects(entity)).toEqual({ health: .333, hunger: 0, sanity: 0 });
    perish.SetPercent(.1);
    expect(getFoodEffects(entity)).toEqual({ health: 0, hunger: 0, sanity: -10 });
    world.advance(PERISH_FAST);
    entity.flush();
    expect(entity.isRemoved).toBe(true);
    expect(inventory.get(slot)).toMatchObject({ itemId: 'spoiled_food', count: 3 });
  } finally { inventory.dispose(); }
});

it('accepts cave fuel, settles pending consumption, applies wet penalties and relights only equipped lanterns', () => {
  const inventory = createPickupInventory();
  const world = createPerishWorld();
  inventory.entities.bindPerishWorld(world);
  const dry = new ItemEntity({ itemId: 'lightbulb', count: 1 }), wet = new ItemEntity({ itemId: 'lightbulb', count: 1, wet: true });
  try {
    inventory.add('lantern', 1);
    const lantern = inventory.getEntity(inventorySlotAddress(0))!, fueled = lantern.components.fueled!;
    const controller = getLanternController(lantern);
    inventory.configureItem(dry); inventory.configureItem(wet);
    const taken = vi.fn(), added = vi.fn();
    dry.ListenForEvent('fueltaken', taken); lantern.ListenForEvent('takefuel', added);
    lantern.setRemainingFuel(10);
    expect(fueled.CanAcceptFuelItem({ components: {} })).toBe(false);
    expect(fueled.TakeFuelItem(dry)).toBe(true);
    expect(dry.isRemoved).toBe(true);
    expect(taken).toHaveBeenCalledExactlyOnceWith({ taker: lantern });
    expect(added).toHaveBeenCalledExactlyOnceWith({ fuelvalue: 90 });
    expect(fueled.currentfuel).toBe(100);
    expect(controller.isOn).toBe(false);
    controller.onequip();
    world.advance(30);
    expect(fueled.TakeFuelItem(wet)).toBe(true);
    expect(fueled.currentfuel).toBeCloseTo(100 - 30 - .5 + 67.5);
    lantern.setRemainingFuel(0); controller.TurnOff();
    const relight = new ItemEntity({ itemId: 'lightbulb', count: 1 }); inventory.configureItem(relight);
    fueled.TakeFuelItem(relight);
    expect(controller.isOn).toBe(true);
    controller.onunequip();
    controller.OnPutInInventory();
    lantern.setRemainingFuel(LANTERN_FUEL - 1);
    const clamp = new ItemEntity({ itemId: 'lightbulb', count: 1 }); inventory.configureItem(clamp);
    fueled.TakeFuelItem(clamp);
    expect(fueled.currentfuel).toBe(LANTERN_FUEL);
    expect(controller.isOn).toBe(false);
  } finally { dry.destroy(); wet.destroy(); inventory.dispose(); }
});

it('buffers one fuel item until frame six, preserves it on cancellation and returns rejected fuel to inventory', () => {
  vi.stubGlobal('window', new EventTarget());
  const cursor = cursorSlotAddress();
  const inventory = new InventoryStore([inventorySlotAddress(0), inventorySlotAddress(1), cursor]
    .map(address => ({ address, slot: new InventorySlot() })), INVENTORY_ITEM_SPECS);
  inventory.add('lantern', 1); inventory.add('lightbulb', 2);
  const lantern = inventory.getEntity(inventorySlotAddress(0))!;
  lantern.setRemainingFuel(0);
  inventory.transfer(inventorySlotAddress(1), cursor, 2);
  const original = inventory.getEntity(cursor)!;
  const doer = createPickupDoer(new THREE.Group(), inventory);
  const graph = new WilsonStateGraph({ playAnimation: () => 1, playSound() {}, setCasting() {}, onStateChanged() {} });
  const request = () => graph.pushBufferedAction(createBufferedAction('ADDFUEL', { doer, target: lantern, invobject: original }));
  try {
    expect(request()).toBe(true); graph.update(5 / 30);
    expect(inventory.get(cursor)?.count).toBe(2); expect(lantern.components.fueled!.currentfuel).toBe(0);
    graph.cancelAction('ADDFUEL'); graph.update(1);
    expect(inventory.getEntity(cursor)).toBe(original);
    expect(request()).toBe(true); graph.update(6 / 30);
    expect(inventory.get(cursor)?.count).toBe(1); expect(lantern.components.fueled!.currentfuel).toBe(90);
    graph.update(1);
    vi.spyOn(lantern.components.fueled!, 'TakeFuelItem').mockReturnValueOnce(false);
    expect(request()).toBe(true); graph.update(6 / 30);
    expect(inventory.getEntity(cursor)).toBeNull();
    expect(inventory.getEntity(inventorySlotAddress(1))).toBe(original);
    expect(lantern.components.fueled!.currentfuel).toBe(90);
  } finally { graph.dispose(); inventory.dispose(); }
});
