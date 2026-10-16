import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { ItemEntity, InventorySlot, InventoryStore, cursorSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { INVENTORY_ITEM_SPECS } from '../../../src/inventoryItems';
import { PERISH_FAST } from '../../componets/src/perishable';
import { getFoodEffects } from '../../prefab/src/food';
import { getLanternController, LANTERN_FUEL } from '../../prefab/src/lantern';
import { ItemUseActionController, type ItemUseSource, type ItemUseTarget } from '../../stategraphs/src/itemuse';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import type { ActionAnimationController } from '../../stategraphs/src/actionContext';
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
  const dry = new ItemEntity({ itemId: 'lightbulb', count: 1 }), wet = new ItemEntity({ itemId: 'lightbulb', count: 1, wet: true });
  try {
    inventory.add('lantern', 1);
    const lantern = inventory.getEntity(inventorySlotAddress(0))!, fueled = lantern.components.fueled;
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
    expect(fueled.remaining).toBe(100);
    expect(controller.isOn).toBe(false);
    controller.onequip();
    for (let frame = 0; frame < 30; frame++) controller.onFrame(1);
    expect(fueled.TakeFuelItem(wet)).toBe(true);
    expect(fueled.remaining).toBeCloseTo(100 - 30 - .5 + 67.5);
    lantern.setRemainingFuel(0); controller.TurnOff();
    const relight = new ItemEntity({ itemId: 'lightbulb', count: 1 }); inventory.configureItem(relight);
    fueled.TakeFuelItem(relight);
    expect(controller.isOn).toBe(true);
    controller.onunequip();
    controller.OnPutInInventory();
    lantern.setRemainingFuel(LANTERN_FUEL - 1);
    const clamp = new ItemEntity({ itemId: 'lightbulb', count: 1 }); inventory.configureItem(clamp);
    fueled.TakeFuelItem(clamp);
    expect(fueled.remaining).toBe(LANTERN_FUEL);
    expect(controller.isOn).toBe(false);
  } finally { dry.destroy(); wet.destroy(); inventory.dispose(); }
});

it('buffers one fuel item until frame six, preserves it on cancellation and returns a rejected item to the cursor', () => {
  vi.stubGlobal('window', new EventTarget());
  const cursor = cursorSlotAddress();
  const inventory = new InventoryStore([inventorySlotAddress(0), inventorySlotAddress(1), cursor]
    .map(address => ({ address, slot: new InventorySlot() })), INVENTORY_ITEM_SPECS);
  inventory.add('lantern', 1); inventory.add('lightbulb', 2);
  const lantern = inventory.getEntity(inventorySlotAddress(0))!;
  lantern.setRemainingFuel(0);
  inventory.transfer(inventorySlotAddress(1), cursor, 2);
  const original = inventory.getEntity(cursor)!;
  let reject = false;
  const source: ItemUseSource = {
    entity: original, isValid: () => inventory.getEntity(cursor) === original && !original.isRemoved,
    take: () => false,
    extractFuel: () => {
      const item = inventory.extract(cursor, 1, original);
      if (item) inventory.configureItem(item);
      if (reject) lantern.components.fueled.accepting = false;
      return item;
    },
    returnFuel: item => { expect(inventory.receiveAt(cursor, item as ItemEntity)).toBe(true); },
  };
  const graph = new WilsonStateGraph({ playAnimation: () => 1, playSound() {}, setCasting() {}, onStateChanged() {} });
  const controller = new ItemUseActionController({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
    renderer: { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer, ground: new THREE.Group(), player: new THREE.Group() },
  { stategraph: graph, cancelEmote() {}, setFacing() {} } as unknown as ActionAnimationController,
  { destination: undefined, goToPoint: () => true, stop() {} }, () => source);
  const target: ItemUseTarget = Object.assign(lantern, { model: new THREE.Group() });
  try {
    controller.request('ADDFUEL', target); controller.update(); graph.update(5 / 30);
    expect(inventory.get(cursor)?.count).toBe(2); expect(lantern.components.fueled.remaining).toBe(0);
    controller.cancel(); graph.update(1);
    expect(inventory.getEntity(cursor)).toBe(original);
    controller.request('ADDFUEL', target); controller.update(); graph.update(6 / 30);
    expect(inventory.get(cursor)?.count).toBe(1); expect(lantern.components.fueled.remaining).toBe(90);
    graph.update(1); controller.update();
    reject = true;
    controller.request('ADDFUEL', target); controller.update(); graph.update(6 / 30);
    expect(inventory.getEntity(cursor)).toBe(original);
    expect(inventory.get(cursor)?.count).toBe(1);
    expect(lantern.components.fueled.remaining).toBe(90);
  } finally { controller.dispose(); inventory.dispose(); }
});
