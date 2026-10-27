import { createPickupDoer, performPickupAction } from '../../stategraphs/src/pickup';
import { bindPlayerHandEquipment } from '../../../src/playerHandEquipment';
import { ItemEntity, InventoryStore, InventorySlot, HandSlot, inventorySlotAddress, equipmentSlotAddress } from '@dontstarve-web/inventory';
import { GroundItemManager } from '../../../src/groundItems';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createEquipmentExistenceState } from '@dontstarve-web/signals';
import { OnItemRanOut } from '../../prefab/src/player_common';
import { TORCH_FUEL, TORCH_SOUNDS, TURNON_FUELED_CONSUMPTION, TURNON_FULL_FUELED_CONSUMPTION, TorchController, configureTorchEntity,
  getTorchController, createTorchGroundFactory } from '../../prefab/src/torch';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { PlaySound, PreloadSounds } from '../../prefab/src/sound';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { createPerishWorld } from './perishWorldFixture';

/** The inst.Light an entity's model declares. */
const declaredLight = (model: THREE.Object3D) => prefabInstance(model)?.light.peek();

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop: vi.fn() })),
}));
let handEquipmentExistenceState: ReturnType<typeof createEquipmentExistenceState>;
beforeEach(() => { handEquipmentExistenceState = createEquipmentExistenceState('HANDS'); });
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** torch.lua's prefab fn adds fueled before the saved fuel loads. */
const torchSpec = { maxFuel: TORCH_FUEL, configureEntity: configureTorchEntity };
const specs = { torch: { name: 'torch', icon: 'torch.tex', maxStack: 1, equippable: 'hand' as const, ...torchSpec } };
/** SetFirstPeriod(TURNON_FUELED_CONSUMPTION, TURNON_FULL_FUELED_CONSUMPTION), charged on the next update. */
const FULL_FIRST_PERIOD = TURNON_FULL_FUELED_CONSUMPTION, FIRST_PERIOD = TURNON_FUELED_CONSUMPTION;

function fixture(initialFuel = TORCH_FUEL) {
  const entity = new ItemEntity({ itemId: 'torch', count: 1, remainingFuel: initialFuel });
  entity.configure(torchSpec);
  // The item's world: fueled consumes on its game time.
  const world = createPerishWorld();
  entity.BindPerishWorld(world);
  const fuel = () => entity.isRemoved ? null : entity.components.fueled!.currentfuel;
  const remove = vi.spyOn(entity, 'remove');
  const onBurningChange = vi.fn();
  const torch = getTorchController(entity);
  torch.burning.subscribe((burning) => onBurningChange(burning));
  return { entity, torch, fuel, remove, onBurningChange, world };
}

describe('torch prefab burning lifecycle', () => {
  it('consumes fuel on its game-time period while burning and settles the elapsed part on unequip', () => {
    const { entity, torch, fuel, remove, world } = fixture();
    const settled = vi.fn();
    entity.ListenForEvent('percentusedchange', settled);
    torch.onequip();
    world.advance(0.6);
    // Only the full torch's first period is charged before fueled.lua's DoPeriodicTask(1) runs.
    expect(fuel()).toBeCloseTo(TORCH_FUEL - FULL_FIRST_PERIOD, 9);
    world.advance(0.6);
    expect(fuel()).toBeCloseTo(TORCH_FUEL - FULL_FIRST_PERIOD - 1, 9);
    expect(settled).toHaveBeenCalledTimes(2);
    world.advance(0.3);
    torch.onunequip();
    expect(fuel()).toBeCloseTo(TORCH_FUEL - FULL_FIRST_PERIOD - 1.5, 9);
    world.advance(60);
    expect(fuel()).toBeCloseTo(TORCH_FUEL - FULL_FIRST_PERIOD - 1.5, 9);
    // Relighting a partly used torch charges the regular first period.
    torch.onequip();
    world.advance(0.5);
    entity.flush();
    expect(fuel()).toBeCloseTo(TORCH_FUEL - FULL_FIRST_PERIOD - 2.5, 9);
    torch.dispose();
    const left = fuel();
    world.advance(5);
    expect(fuel()).toBe(left);
    expect(remove).not.toHaveBeenCalled();
  });

  it('starts consuming once a torch lit before its world was bound joins that world', () => {
    const entity = new ItemEntity({ itemId: 'torch', count: 1 });
    entity.configure(torchSpec);
    const torch = getTorchController(entity);
    // A restored inventory equips before the scene binds its world.
    torch.onequip();
    expect(torch.isBurning).toBe(true);
    const world = createPerishWorld();
    entity.BindPerishWorld(world);
    world.advance(2);
    expect(entity.components.fueled!.currentfuel).toBeCloseTo(TORCH_FUEL - FULL_FIRST_PERIOD - 2, 9);
    torch.dispose(); entity.destroy();
  });

  it('ignites once per equip, keeps fuel while unlit and burns independently of other torches', () => {
    const { torch, fuel, onBurningChange, world } = fixture(60);
    const spare = fixture(60);
    world.advance(10);
    expect(fuel()).toBe(60);
    torch.onequip(); torch.onequip();
    expect(PlaySound).toHaveBeenCalledExactlyOnceWith('dontstarve/wilson/torch_swing', undefined);
    world.advance(10); spare.world.advance(10);
    expect(fuel()).toBeCloseTo(60 - FIRST_PERIOD - 10, 9);
    expect(spare.fuel()).toBe(60);
    torch.onunequip();
    expect(PlaySound).toHaveBeenLastCalledWith('dontstarve/common/fireOut', undefined);
    world.advance(20);
    expect(torch.isBurning).toBe(false);
    expect(fuel()).toBeCloseTo(60 - FIRST_PERIOD - 10, 9);
    // A saved fuel value restores an unlit torch; equip starts its lifecycle.
    const restored = fixture(fuel()!);
    expect(restored.entity.snapshot().remainingFuel).toBe(fuel());
    torch.dispose(); torch.onequip();
    expect(torch.isBurning).toBe(false);
    expect(onBurningChange.mock.calls).toEqual([[true], [false]]);
  });

  it('removes an exhausted torch and extinguishes once', () => {
    const { torch, fuel, remove, onBurningChange, world } = fixture(0.125);
    torch.onequip();
    expect(torch.isBurning).toBe(true);
    // The first period exceeds what is left, so the torch burns out on the next update.
    world.advance(0.01);
    expect(torch.isBurning).toBe(false);
    expect(fuel()).toBeNull();
    expect(remove).toHaveBeenCalledOnce();
    world.advance(1); torch.onequip(); torch.dispose();
    expect(remove).toHaveBeenCalledOnce();
    expect(onBurningChange.mock.calls).toEqual([[true], [false]]);
  });

  it('removes the depleted item through its inventory owner, then pushes itemranout so the next torch is equipped', async () => {
    const hand = equipmentSlotAddress('hand'), bag = inventorySlotAddress(0), bag2 = inventorySlotAddress(1);
    const store = new InventoryStore([{ address: bag, slot: new InventorySlot() }, { address: bag2, slot: new InventorySlot() },
      { address: hand, slot: new HandSlot() }], specs, {});
    const world = createPerishWorld();
    store.entities.bindPerishWorld(world);
    const pushed: unknown[] = [];
    const owner = { PushEvent: (name: string, data?: unknown) => {
      pushed.push({ name, slotEmpty: store.getEntity(hand) == null });
      if (name === 'itemranout') OnItemRanOut(store, data);
    } };
    const binding = await bindPlayerHandEquipment({ handEquipmentExistenceState: store.handEquipmentExistenceState, owner, lightParent: new THREE.Group(), setHandAction() {} });
    try {
      store.add('torch', 2);
      store.applySlotChanges([{ slot: bag, itemId: 'torch', delta: -1 }, { slot: hand, itemId: 'torch', delta: 1 }]);
      const first = store.getEntity(hand)!, second = store.getEntity(bag) ?? store.getEntity(bag2)!;
      expect(getTorchController(first).isBurning).toBe(true);
      expect(store.setRemainingFuel(hand, 1)).toBe(true);
      world.advance(1);
      expect(first.isRemoved).toBe(true);
      expect(pushed).toEqual([{ name: 'itemranout', slotEmpty: true }]);
      expect(store.getEntity(hand)).toBe(second);
      expect(getTorchController(second).isBurning).toBe(true);
    } finally { binding.dispose(); store.entities.dispose(); }
  });

  it('keeps one entity and controller through equip, asynchronous drop, reskin, pickup and save restoration', async () => {
    vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
    const slot = inventorySlotAddress(0), hand = equipmentSlotAddress('hand');
    const store = new InventoryStore([{ address: slot, slot: new InventorySlot() }, { address: hand, slot: new HandSlot() }], specs,
      { torch_barber: { itemId: 'torch', name: 'torch', icon: 'torch_barber.tex', atlas: 'images/inventoryimages.xml' } });
    const world = createPerishWorld();
    store.entities.bindPerishWorld(world);
    store.add('torch', 1);
    const entity = store.getEntity(slot)!;
    const controller = getTorchController(entity);
    const equip = vi.spyOn(controller, 'onequip');
    const binding = await bindPlayerHandEquipment({ handEquipmentExistenceState: store.handEquipmentExistenceState, lightParent: new THREE.Group(), setHandAction() {} });
    const scene = new THREE.Scene(), player = new THREE.Group();
    const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
    const manager = new GroundItemManager(scene, new THREE.PerspectiveCamera(),
      { domElement: canvas } as unknown as THREE.WebGLRenderer, '', store,
      '/dst/data/anim', player, undefined, undefined, undefined, store.entities);
    try {
      store.applySlotChanges([{ slot, itemId: 'torch', delta: -1 }, { slot: hand, itemId: 'torch', delta: 1 }]);
      expect(equip).toHaveBeenCalledOnce();
      world.advance(0.5);
      const definition = { ...GROUND_ITEM_DEFINITIONS.torch, itemId: 'torch', count: 1 };
      expect(await manager.drop(definition, new THREE.Vector3(), () => {
        world.advance(0.25);
        return store.extract(hand, 1, entity) ?? false;
      })).toBe(true);
      let model = scene.children[0] as THREE.Group;
      expect(model.userData.instance?.entityId).toBe(entity.id);
      expect(model.userData.torch).toBe(controller);
      expect(controller.isBurning).toBe(false);
      expect(entity.components.fueled!.currentfuel).toBeCloseTo(TORCH_FUEL - FULL_FIRST_PERIOD - .75, 9);
      expect(entity.components.inventoryitem.owner).toBeNull();
      controller.ignite();
      const cancelled = await manager.reskinTargets[0].prepareNextSkin();
      cancelled.dispose();
      expect(controller.isBurning).toBe(true);
      expect(entity.skinId).toBeUndefined();
      const prepared = await manager.reskinTargets[0].prepareNextSkin();
      world.advance(0.375);
      expect(prepared.apply()).toBe(true);
      model = scene.children[0] as THREE.Group;
      expect(entity.skinId).toBe('torch_barber');
      expect(model.userData.torch).toBe(controller);
      expect(controller.isBurning).toBe(true);
      const [record] = manager.exportRecords();
      expect(record.id).toBe(entity.id);
      // Relit on the ground, the partly used torch charges its first period.
      expect(record.components.stack?.remainingFuel).toBeCloseTo(TORCH_FUEL - FULL_FIRST_PERIOD - .75 - FIRST_PERIOD - .375, 9);
      expect(record.components.torch).toEqual({ lit: true });
      vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([{ object: model } as unknown as THREE.Intersection]);
      world.advance(0.125);
      performPickupAction(model.userData.pickupTarget, createPickupDoer(player, store));
      expect(manager.exportRecords()).toEqual([]);
      expect(store.getEntity(hand)).toBe(entity);
      expect(getTorchController(entity)).toBe(controller);
      expect(controller.isBurning).toBe(true);
      expect(entity.components.fueled!.currentfuel).toBeCloseTo(TORCH_FUEL - FULL_FIRST_PERIOD - .75 - FIRST_PERIOD - .5, 9);
      const saved = store.exportState();
      store.replaceState(saved, {});
      const restored = store.getEntity(hand)!;
      expect(restored).not.toBe(entity);
      expect(restored.id).toBe(entity.id);
      expect(restored.snapshot()).toEqual(entity.snapshot());
      expect(getTorchController(restored)).not.toBe(controller);
      expect(getTorchController(restored).isBurning).toBe(true);
    } finally { binding.dispose(); manager.dispose(); store.entities.dispose(); }
  });

  it('restores a lit ground torch silently, extinguishes through its event and picks it up without affecting held equipment', async () => {
    vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
    const assets = new GroundItemAssets();
    const owner = new THREE.Vector3(12, 0, 0);
    const factory = createTorchGroundFactory({ scene: new THREE.Scene(), assets, animationBaseUrl: '/dst/data/anim', inventoryOwnerPosition: owner,
      bernieWorld: { getSanityPercent: () => 1 }, butterflyWorld: { getThreatPositions: () => [], getFlowers: () => [] },
      firefliesWorld: {} });
    const definition = { ...GROUND_ITEM_DEFINITIONS.torch, itemId: 'torch', count: 1, remainingFuel: 20, torchLit: true };
    const entity = new ItemEntity({ itemId: 'torch', count: 1, remainingFuel: 18 });
    entity.configure(torchSpec);
    const world = createPerishWorld();
    entity.BindPerishWorld(world);
    entity.transform.position.set(4, 0, 6);
    const visual = await factory.create(definition);
    try {
      const held = { itemId: 'hammer', EQUIPSLOTS: 'HANDS' as const };
      handEquipmentExistenceState.set(held);
      visual.model.position.copy(entity.transform.position);
      // Prepared visual receives the actual state committed after an asynchronous drop.
      visual.setDefinition?.({ ...definition, remainingFuel: 18, entity });
      visual.model.dispatchEvent({ type: 'onload' });
      const controller = visual.model.userData.torch as TorchController;
      expect(PreloadSounds).toHaveBeenCalledWith(...TORCH_SOUNDS);
      expect(controller.isBurning).toBe(true);
      expect(PlaySound).not.toHaveBeenCalled();
      expect(declaredLight(visual.model)).toBeDefined();
      // A lit ground torch keeps consuming on its world's game time.
      world.advance(0.5);
      expect(visual.getDefinition?.()).toEqual({ remainingFuel: 18 - FIRST_PERIOD - .5, torchLit: true });
      visual.model.dispatchEvent({ type: 'onextinguish' });
      expect(controller.isBurning).toBe(false);
      expect(declaredLight(visual.model)).toBeUndefined();
      expect(handEquipmentExistenceState.peek()).toBe(held);
      expect(PlaySound).toHaveBeenLastCalledWith('dontstarve/common/fireOut', visual.model.position);
      const before = visual.model.position.clone();
      visual.update?.(0.1);
      expect(entity.transform.position.clone().distanceTo(before)).toBeLessThan(1);
      visual.model.position.copy(entity.transform.position);
      expect(visual.model.position.y).toBe(0);
      expect(visual.model.children[0].position.y).toBeGreaterThan(0);
      expect(visual.model.position.distanceTo(before)).toBeLessThan(1);
      controller.ignite();
      const groundSounds = vi.mocked(PlaySound).mock.results.map(({ value }) => value);
      visual.model.dispatchEvent({ type: 'onputininventory' });
      expect(PlaySound).toHaveBeenLastCalledWith('dontstarve/common/fireOut', owner);
      expect(controller.isBurning).toBe(false);
      // Pocketed before the next update, the relit torch's first period is cancelled uncharged.
      expect(visual.getDefinition?.()).toEqual({ remainingFuel: 18 - FIRST_PERIOD - .5, torchLit: false });
      expect(handEquipmentExistenceState.peek()).toBe(held);
      groundSounds.forEach((sound) => expect(sound.stop).toHaveBeenCalledOnce());
      const calls = vi.mocked(PlaySound).mock.calls.length;
      visual.model.dispatchEvent({ type: 'onputininventory' });
      controller.OnExtinguish();
      expect(PlaySound).toHaveBeenCalledTimes(calls);
    } finally { visual.dispose(); entity.destroy(); assets.dispose(); }
  });
});
