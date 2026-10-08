import { bindPlayerHandEquipment } from '../../../src/playerHandEquipment';
import { ItemEntity, InventoryStore, InventorySlot, HandSlot, inventorySlotAddress, equipmentSlotAddress } from '@dontstarve-web/inventory';
import { GroundItemManager } from '../../../src/groundItems';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createSignal, handEquipmentState, type HandEquipment } from '@dontstarve-web/signals';
import { TORCH_FUEL, TORCH_SOUNDS, TorchController, getTorchController, createTorchGroundFactory } from '../../prefab/src/torch';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { PlaySound, PreloadSounds } from '../../prefab/src/sound';
import { getPrefabLocalLight } from '../../prefab/src/localLight';

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop: vi.fn() })),
}));
afterEach(() => { handEquipmentState.set(null); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fixture(initialFuel = TORCH_FUEL) {
  const entity = new ItemEntity({ itemId: 'torch', count: 1, remainingFuel: initialFuel });
  const fuel = {
    getRemainingFuel: () => entity.isRemoved ? null : entity.components.fueled.remaining!,
    setRemainingFuel: vi.spyOn(entity, 'setRemainingFuel'),
    remove: vi.spyOn(entity, 'remove'),
  };
  const onBurningChange = vi.fn();
  const torch = new TorchController(entity);
  torch.burning.subscribe((burning) => onBurningChange(burning));
  return { torch, fuel, onBurningChange };
}

describe('torch prefab burning lifecycle', () => {
  it('updates fuel every 60 frames using accumulated dt and settles a partial batch on unequip', () => {
    const { torch, fuel } = fixture();
    const slot = createSignal<HandEquipment | null>(torch);
    const update = vi.spyOn(torch, 'update');
    torch.onequip(slot);
    for (const dt of [0, -1, NaN, Infinity]) torch.onFrame(dt);
    for (let frame = 0; frame < 59; frame++) torch.onFrame(frame % 2 === 0 ? 0.01 : 0.03);
    expect(update).not.toHaveBeenCalled();
    expect(fuel.setRemainingFuel).not.toHaveBeenCalled();
    expect(fuel.getRemainingFuel()).toBe(TORCH_FUEL);
    torch.onFrame(0.03);
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0][0]).toBeCloseTo(1.2);
    expect(fuel.getRemainingFuel()).toBeCloseTo(73.8);
    expect(fuel.setRemainingFuel).toHaveBeenCalledOnce();

    torch.onFrame(0.2);
    torch.onunequip();
    expect(fuel.getRemainingFuel()).toBeCloseTo(73.6);
    expect(update).toHaveBeenCalledTimes(2);
    expect(slot.peek()).toBe(torch);
    for (let frame = 0; frame < 60; frame++) torch.onFrame(1);
    torch.onequip(slot);
    for (let frame = 0; frame < 59; frame++) torch.onFrame(0.01);
    expect(update).toHaveBeenCalledTimes(2);
    torch.flushFuel();
    expect(fuel.getRemainingFuel()).toBeCloseTo(73.01);
    torch.dispose();
    expect(update).toHaveBeenCalledTimes(3);
    expect(fuel.remove).not.toHaveBeenCalled();
  });

  it('ignites on equip, pauses on unequip and resumes the same fuel independently of other torches', () => {
    const { torch, fuel, onBurningChange } = fixture();
    const spare = fixture();
    torch.update(10);
    expect(fuel.getRemainingFuel()).toBe(TORCH_FUEL);
    const equipment = torch;
    handEquipmentState.set(equipment);
    torch.onequip(handEquipmentState); torch.onequip(handEquipmentState);
    expect(PlaySound).toHaveBeenCalledExactlyOnceWith('dontstarve/wilson/torch_swing', undefined);
    expect(onBurningChange.mock.calls).toEqual([[true]]);
    torch.update(10.125); spare.torch.update(10.125);
    expect(fuel.getRemainingFuel()).toBe(64.875);
    expect(spare.fuel.getRemainingFuel()).toBe(TORCH_FUEL);
    torch.onunequip();
    expect(PlaySound).toHaveBeenLastCalledWith('dontstarve/common/fireOut', undefined);
    expect(handEquipmentState.peek()).toBe(equipment);
    torch.update(20);
    expect(torch.isBurning).toBe(false);
    expect(fuel.getRemainingFuel()).toBe(64.875);
    torch.onequip(handEquipmentState);
    torch.update(0.5);
    expect(fuel.getRemainingFuel()).toBe(64.375);
    // A saved fuel value restores an unlit torch; equip starts its lifecycle.
    const restored = fixture(fuel.getRemainingFuel()!);
    restored.torch.update(5);
    expect(restored.fuel.getRemainingFuel()).toBe(64.375);
    const restoredEquipment = restored.torch;
    handEquipmentState.set(restoredEquipment);
    restored.torch.onequip(handEquipmentState); restored.torch.update(0.125);
    expect(restored.fuel.getRemainingFuel()).toBe(64.25);
    torch.dispose(); torch.update(5); torch.onequip(handEquipmentState);
    expect(handEquipmentState.peek()).toBe(restoredEquipment);
    expect(torch.isBurning).toBe(false);
    expect(fuel.getRemainingFuel()).toBe(64.375);
    expect(onBurningChange.mock.calls).toEqual([[true], [false], [true], [false]]);
    expect(fuel.remove).not.toHaveBeenCalled();
  });

  it('removes an exhausted torch and extinguishes once without persisting zero fuel', () => {
    const { torch, fuel, onBurningChange } = fixture(0.125);
    handEquipmentState.set(torch);
    torch.onequip(handEquipmentState);
    for (const dt of [0, -1, NaN, Infinity]) torch.onFrame(dt);
    for (let frame = 0; frame < 59; frame++) torch.onFrame(0.001);
    expect(fuel.getRemainingFuel()).toBe(0.125);
    expect(torch.isBurning).toBe(true);
    torch.onFrame(0.125);
    expect(torch.isBurning).toBe(false);
    expect(fuel.getRemainingFuel()).toBeNull();
    expect(handEquipmentState.peek()).toBeNull();
    expect(fuel.remove).toHaveBeenCalledOnce();
    expect(fuel.setRemainingFuel).not.toHaveBeenCalled();
    torch.update(1); torch.onequip(handEquipmentState); torch.dispose();
    expect(fuel.remove).toHaveBeenCalledOnce();
    expect(onBurningChange.mock.calls).toEqual([[true], [false]]);
  });

  it('clears only its bound slot, unbinds on unequip and preserves a replacement', () => {
    const first = fixture(), next = fixture();
    const slot = createSignal<HandEquipment | null>(first.torch);
    const otherSlot = createSignal<HandEquipment | null>(next.torch);
    const stopSlot = slot.subscribe((value) => { if (value === null) first.torch.onunequip(); });
    const stopOther = otherSlot.subscribe((value) => { if (value === null) next.torch.onunequip(); });
    try {
      first.torch.onequip(slot);
      next.torch.onequip(otherSlot);
      first.torch.onunequip();
      first.torch.extinguish();
      expect(slot.peek()).toBe(first.torch);
      first.torch.onequip(slot);
      first.torch.extinguish();
      expect(slot.peek()).toBeNull();
      expect(otherSlot.peek()).toBe(next.torch);
      expect(next.torch.isBurning).toBe(true);
      expect(first.fuel.getRemainingFuel()).toBe(TORCH_FUEL);

      slot.set(first.torch);
      first.torch.onequip(slot);
      slot.set(next.torch);
      // Replacement without an unequip notification must also be protected.
      first.torch.extinguish();
      expect(slot.peek()).toBe(next.torch);
      first.torch.onunequip(); first.torch.dispose();
      next.torch.extinguish();
      expect(otherSlot.peek()).toBeNull();
      expect(slot.peek()).toBe(next.torch);
    } finally {
      stopSlot(); stopOther(); first.torch.dispose(); next.torch.dispose();
    }
  });

  it('keeps one entity and controller through equip, asynchronous drop, reskin, pickup and save restoration', async () => {
    vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
    const slot = inventorySlotAddress(0), hand = equipmentSlotAddress('hand');
    const specs = { torch: { name: 'torch', icon: 'torch.tex', maxStack: 1, maxFuel: TORCH_FUEL, equippable: 'hand' as const } };
    const store = new InventoryStore([{ address: slot, slot: new InventorySlot() }, { address: hand, slot: new HandSlot() }], specs,
      { torch_barber: { itemId: 'torch', name: 'torch', icon: 'torch_barber.tex', atlas: 'images/inventoryimages.xml' } });
    store.add('torch', 1);
    const entity = store.getEntity(slot)!;
    const controller = getTorchController(entity);
    const equip = vi.spyOn(controller, 'onequip');
    const binding = await bindPlayerHandEquipment({ setLightActive() {}, setHandAction() {} });
    const scene = new THREE.Scene(), player = new THREE.Group();
    const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
    const manager = new GroundItemManager(scene, new THREE.PerspectiveCamera(),
      { domElement: canvas } as unknown as THREE.WebGLRenderer, '', definition => store.receive(definition.entity!),
      '/dst/data/anim', player, undefined, undefined, undefined, store.entities);
    try {
      store.applySlotChanges([{ slot, itemId: 'torch', delta: -1 }, { slot: hand, itemId: 'torch', delta: 1 }]);
      expect(equip).toHaveBeenCalledExactlyOnceWith(handEquipmentState);
      controller.onFrame(0.5);
      const definition = { ...GROUND_ITEM_DEFINITIONS.torch, itemId: 'torch', count: 1 };
      expect(await manager.drop(definition, new THREE.Vector3(), () => {
        controller.onFrame(0.25);
        return store.extract(hand, 1, entity) ?? false;
      })).toBe(true);
      let model = scene.children[0] as THREE.Group;
      expect(model.userData.entityId).toBe(entity.id);
      expect(model.userData.torch).toBe(controller);
      expect(controller.isBurning).toBe(false);
      expect(entity.components.fueled.remaining).toBe(74.25);
      expect(entity.components.inventoryitem.owner).toBeNull();
      controller.ignite();
      const cancelled = await manager.reskinTargets[0].prepareNextSkin();
      cancelled.dispose();
      expect(controller.isBurning).toBe(true);
      expect(entity.skinId).toBeUndefined();
      const prepared = await manager.reskinTargets[0].prepareNextSkin();
      controller.onFrame(0.375);
      expect(prepared.apply()).toBe(true);
      model = scene.children[0] as THREE.Group;
      expect(entity.skinId).toBe('torch_barber');
      expect(model.userData.torch).toBe(controller);
      expect(controller.isBurning).toBe(true);
      const [record] = manager.exportRecords();
      expect(record.id).toBe(entity.id);
      expect(record.components.stack?.remainingFuel).toBe(73.875);
      expect(record.components.torch).toEqual({ lit: true });
      vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([{ object: model } as unknown as THREE.Intersection]);
      controller.onFrame(0.125);
      canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, clientX: 50, clientY: 50 }));
      expect(manager.exportRecords()).toEqual([]);
      expect(store.getEntity(slot)).toBe(entity);
      expect(getTorchController(entity)).toBe(controller);
      expect(controller.isBurning).toBe(false);
      expect(entity.components.fueled.remaining).toBe(73.75);
      const saved = store.exportState();
      store.replaceState(saved, {});
      const restored = store.getEntity(slot)!;
      expect(restored).not.toBe(entity);
      expect(restored.id).toBe(entity.id);
      expect(restored.snapshot()).toEqual(entity.snapshot());
      expect(getTorchController(restored)).not.toBe(controller);
      expect(getTorchController(restored).isBurning).toBe(false);
    } finally { binding.dispose(); manager.dispose(); store.entities.dispose(); }
  });

  it('restores a lit ground torch silently, extinguishes through its event and picks it up without affecting held equipment', async () => {
    vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
    const assets = new GroundItemAssets('/dst/data/anim');
    const owner = new THREE.Vector3(12, 0, 0);
    const factory = createTorchGroundFactory({ assets, animationBaseUrl: '/dst/data/anim', inventoryOwnerPosition: owner,
      bernieWorld: { getSanityPercent: () => 1 }, butterflyWorld: { isDay: () => true, getThreatPositions: () => [], getFlowers: () => [] },
      firefliesWorld: { isNight: () => false, getPlayerPositions: () => [] }, getNeighbours: () => [] });
    const definition = { ...GROUND_ITEM_DEFINITIONS.torch, itemId: 'torch', count: 1, remainingFuel: 20, torchLit: true };
    const visual = await factory.create(definition);
    try {
      const held = { itemId: 'hammer', EQUIPSLOTS: 'HANDS' as const };
      handEquipmentState.set(held);
      visual.model.position.set(4, 0, 6);
      // Prepared visual receives the actual state committed after an asynchronous drop.
      visual.setDefinition?.({ ...definition, remainingFuel: 18 });
      visual.model.dispatchEvent({ type: 'onload' });
      const controller = visual.model.userData.torch as TorchController;
      expect(PreloadSounds).toHaveBeenCalledWith(...TORCH_SOUNDS);
      expect(controller.isBurning).toBe(true);
      expect(PlaySound).not.toHaveBeenCalled();
      expect(getPrefabLocalLight(visual.model)).toBeDefined();
      visual.update?.(0.5);
      expect(visual.getDefinition?.()).toEqual({ remainingFuel: 17.5, torchLit: true });
      visual.model.dispatchEvent({ type: 'onextinguish' });
      expect(controller.isBurning).toBe(false);
      expect(getPrefabLocalLight(visual.model)).toBeUndefined();
      expect(handEquipmentState.peek()).toBe(held);
      expect(PlaySound).toHaveBeenLastCalledWith('dontstarve/common/fireOut', visual.model.position);
      const before = visual.model.position.clone();
      visual.update?.(0.1);
      expect(visual.model.position.y).toBe(0);
      expect(visual.model.children[0].position.y).toBeGreaterThan(0);
      expect(visual.model.position.distanceTo(before)).toBeLessThan(1);
      controller.ignite();
      const groundSounds = vi.mocked(PlaySound).mock.results.map(({ value }) => value);
      visual.model.dispatchEvent({ type: 'onputininventory' });
      expect(PlaySound).toHaveBeenLastCalledWith('dontstarve/common/fireOut', owner);
      expect(controller.isBurning).toBe(false);
      expect(visual.getDefinition?.()).toEqual({ remainingFuel: 17.5, torchLit: false });
      expect(handEquipmentState.peek()).toBe(held);
      groundSounds.forEach((sound) => expect(sound.stop).toHaveBeenCalledOnce());
      const calls = vi.mocked(PlaySound).mock.calls.length;
      visual.model.dispatchEvent({ type: 'onputininventory' });
      controller.OnExtinguish();
      expect(PlaySound).toHaveBeenCalledTimes(calls);
    } finally { visual.dispose(); assets.dispose(); }
  });
});
