import { wilsonPlayer } from '../../../tests/fixtures/wilsonPlayer';
import { testPlayer } from '../../../tests/fixtures/testPlayer';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cursorSlotAddress, inventorySlotAddress, InventorySlot } from '../../inventory/src';
import { createEmptyEntity } from '../../prefab/src/prefabInstance';
import { Locomotor } from '../../prefab/src/locomotor';
import { farmFixture } from '../../../tests/fixtures/farmFixture';
import { TurfMap } from '../../prefab/src/turfMap';
import { PlayerController } from '../src/playercontroller';
import { PlayerActionPicker } from '../src/playeractionpicker';
import { PointerRaycaster } from '../src/pointerRaycaster';
import type { ActionWorldContext } from '../src/actionContext';
import type { WorldContext } from '../../prefab/src/worldContext';
import { createPickupInventory } from '../../../tests/fixtures/pickupFixture';
import { Trader } from '../../componets/src/trader';

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop() {} })),
}));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  const inventory = createPickupInventory(),
    { instance, display } = createEmptyEntity('wilson');
  inventory.registerSlots([{ address: cursorSlotAddress(), slot: new InventorySlot() }]);
  const scene = new THREE.Scene();
  display.mount(scene);
  instance.setPosition(100, 0, 100);
  // The player inst owns the inventory.
  testPlayer({ model: display.model, inventory });
  const canvas = new EventTarget();
  const world = {
    scene,
    player: display.model,
    camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(),
    renderer: { domElement: canvas },
  } as unknown as ActionWorldContext;
  world.mouseActions = new PlayerActionPicker(new PointerRaycaster(world));
  const graph = wilsonPlayer(() => 1).sg;
  const locomotor = new Locomotor({ position: instance.position, velocity: new THREE.Vector3() });
  const controller = new PlayerController(world, graph, locomotor, inventory.handEquipment, instance as never);
  const use = (target: ReturnType<typeof inventory.getEntity>) => {
    const action = controller.GetItemUseAction(inventory.GetActiveItem()!, target!);
    expect(action).toBeDefined();
    expect(controller.DoAction(action!)).toBe(true);
    return action!;
  };
  return {
    inventory,
    instance,
    world,
    graph,
    controller,
    use,
    dispose() {
      controller.dispose();
      graph.dispose();
      world.mouseActions!.dispose();
      display.dispose();
      inventory.dispose();
    },
  };
}

it('gives one item from a stack through the shared action and passes the detached inst to the trader', () => {
  const s = setup(),
    target = createEmptyEntity('trader');
  const trader = new Trader(target.instance),
    accepted = vi.fn();
  target.instance.components.trader = trader;
  target.instance.copyPosition(s.instance.position);
  trader.SetOnAccept((_inst, _giver, item) => accepted(item));
  try {
    s.inventory.add('twigs', 2);
    s.inventory.transfer(inventorySlotAddress(0), cursorSlotAddress(), 2);
    const source = s.inventory.GetActiveItem()!;
    const description = s.world.mouseActions!.GetUseItemActions(target.instance, source, false)[0];
    const action = s.controller.createAction(description)!;
    expect(action.invobject).toBe(source);
    expect(action.target).toBe(target.instance);
    expect(s.controller.DoAction(action)).toBe(true);
    s.graph.update(13 / 30);
    expect(source.components.stackable.count).toBe(1);
    expect(accepted).toHaveBeenCalledOnce();
    const taken = accepted.mock.calls[0][0];
    expect(taken).not.toBe(source);
    expect(taken.components.stackable.count).toBe(1);
    expect(taken.isRemoved).toBe(true);
  } finally {
    trader.dispose();
    target.instance.remove();
    target.display.dispose();
    s.dispose();
  }
});

it('feeds the original held animal at the Lua long-action timeout, preserving identity across slot moves and cancellation', () => {
  const s = setup(),
    cursor = cursorSlotAddress();
  try {
    s.inventory.add('lightflier', 1);
    s.inventory.add('carrot', 2);
    const livestock = s.inventory.getEntity(inventorySlotAddress(0))!;
    s.inventory.transfer(inventorySlotAddress(1), cursor, 2);
    const food = s.inventory.GetActiveItem()!,
      eat = vi.spyOn(livestock.components.eater!, 'Eat');
    const action = s.use(livestock);
    expect(action.target).toBe(livestock);
    expect(action.invobject).toBe(food);
    expect(action.doer).toBe(s.instance);
    expect(s.graph.stateName).toBe('dolongaction');
    expect(s.inventory.transfer(inventorySlotAddress(0), inventorySlotAddress(5), 1)).toBe(true);
    expect(action.isValid()).toBe(true);
    s.graph.update(0.9);
    s.controller.cancel();
    s.graph.update(1);
    expect(eat).not.toHaveBeenCalled();
    expect(food.components.stackable.count).toBe(2);
    s.use(livestock);
    s.graph.update(1);
    expect(eat).toHaveBeenCalledExactlyOnceWith(food, s.instance);
    expect(food.components.stackable.count).toBe(1);
    expect(s.inventory.getEntity(inventorySlotAddress(5))).toBe(livestock);
  } finally {
    s.dispose();
  }
});

it('selects wet fuel from the real active item and rejects an item detached before the commit frame', () => {
  const s = setup(),
    cursor = cursorSlotAddress();
  try {
    s.inventory.add('lantern', 1);
    s.inventory.add('lightbulb', 2);
    const lantern = s.inventory.getEntity(inventorySlotAddress(0))!;
    lantern.setRemainingFuel(0);
    const takeFuel = vi.spyOn(lantern.components.fueled!, 'TakeFuelItem');
    s.inventory.transfer(inventorySlotAddress(1), cursor, 2);
    const fuel = s.inventory.GetActiveItem()!;
    fuel.setWet(true);
    const action = s.use(lantern);
    expect(action.action).toBe('ADDWETFUEL');
    expect(action.target).toBe(lantern);
    expect(action.invobject).toBe(fuel);
    s.graph.update(5 / 30);
    const detached = s.inventory.extract(cursor, 2, fuel)!;
    s.graph.update(1 / 30);
    expect(lantern.components.fueled!.currentfuel).toBe(0);
    expect(detached.components.stackable.count).toBe(2);
    s.graph.update(1);
    expect(s.inventory.receiveAt(cursor, detached)).toBe(true);
    s.use(lantern);
    s.graph.update(6 / 30);
    expect(s.inventory.GetActiveItem()).toBe(fuel);
    expect(fuel.components.stackable.count).toBe(1);
    expect(lantern.components.fueled!.currentfuel).toBeGreaterThan(0);
    expect(takeFuel).toHaveBeenCalledWith(expect.anything(), s.instance);
  } finally {
    s.dispose();
  }
});

it('uses active seeds on the real soil instance through PLANTSOIL and the Lua long action', () => {
  const s = setup(),
    turf = new TurfMap(96);
  const farm = farmFixture((s.world as WorldContext).scene, turf);
  const position = new THREE.Vector3(3, 0, 3);
  try {
    s.instance.copyPosition(position);
    turf.plow(position);
    const soil = farm.spawn('farm_soil', position, { farmSoil: { broken: false } }, 'soil'),
      model = soil.transform.model;
    s.inventory.add('seeds', 2);
    expect(s.inventory.transfer(inventorySlotAddress(0), cursorSlotAddress(), 2)).toBe(true);
    const seeds = s.inventory.GetActiveItem()!;
    vi.spyOn(PointerRaycaster.prototype, 'trackPointer').mockImplementation(() => {});
    vi.spyOn(PointerRaycaster.prototype, 'pickMouseTarget').mockReturnValue({
      object: model,
      point: position,
      distance: 0,
    });
    s.world.mouseActions!.pointer.updateHover();
    const action = s.world.mouseActions!.getMouseActions().left!;
    expect(action).toMatchObject({ action: 'PLANTSOIL', target: soil, invobject: seeds });
    const click = () => s.controller.OnControl('PRIMARY', true, { clientX: 0, clientY: 0 });
    click();
    expect(s.graph.stateName).toBe('dolongaction');
    s.graph.update(0.9);
    s.controller.cancel();
    expect(seeds.components.stackable.count).toBe(2);
    expect(soil.isRemoved).toBe(false);
    click();
    s.graph.update(1);
    expect(soil.isRemoved).toBe(true);
    expect(seeds.components.stackable.count).toBe(1);
    expect(farm.decor()).toEqual([]);
    expect(farm.seeds()).toMatchObject([
      { prefabId: 'farm_plant_randomseed', record: { transform: { position: position.toArray() } } },
    ]);
  } finally {
    farm.dispose();
    s.dispose();
  }
});
