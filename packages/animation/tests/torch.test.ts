import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createSignal, handEquipmentState, type HandEquipment } from '@dontstarve-web/signals';
import { TORCH_FUEL, TORCH_SOUNDS, TorchController, createTorchGroundFactory } from '../../prefab/src/torch';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { PlaySound, PreloadSounds } from '../../prefab/src/sound';
import { getPrefabLocalLight } from '../../prefab/src/localLight';

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop: vi.fn() })),
}));
afterEach(() => { handEquipmentState.set(null); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fixture(initialFuel = TORCH_FUEL) {
  let remainingFuel: number | null = initialFuel;
  const fuel = {
    getRemainingFuel: () => remainingFuel,
    setRemainingFuel: vi.fn((seconds: number) => { remainingFuel = seconds; return true; }),
    remove: vi.fn(() => { remainingFuel = null; return true; }),
  };
  const onBurningChange = vi.fn();
  const torch = new TorchController(fuel);
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
