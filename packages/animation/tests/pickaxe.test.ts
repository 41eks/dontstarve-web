import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPickupInventory } from './pickupFixture';
import { equipmentSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { getPickaxeLifecycle } from '../../prefab/src/pickaxe';
import { RockManager } from '../../prefab/src/rocks';
import { PickaxeActionController } from '../../stategraphs/src/pickaxe';
import { createWilsonPlayer, type WilsonAnimationController } from '../../prefab/src/player';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { PlaySound } from '../../prefab/src/sound';
import type { ActionWorldContext } from '../../stategraphs/src/actionContext';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('uses 33 ordinary or 132 golden mining hits and removes depleted equipment through its injected inventory slot', () => {
  const inventory = createPickupInventory(), hand = equipmentSlotAddress('hand');
  try {
    for (const [prefab, hits, step] of [['pickaxe', 33, 1], ['goldenpickaxe', 132, .25]] as const) {
      expect(inventory.add(prefab, 1)).toBe(true);
      expect(inventory.transfer(inventorySlotAddress(0), hand, 1)).toBe(true);
      const entity = inventory.getEntity(hand)!;
      const lifecycle = getPickaxeLifecycle(entity);
      lifecycle.onequip();
      expect(entity.hasTag('MINE_tool')).toBe(true);
      expect(entity.signals.durabilityPercent.peek()).toBe(1);
      entity.components.finiteuses.useForAction('MINE');
      expect(entity.components.finiteuses.remaining).toBe(33 - step);
      expect(entity.signals.durabilityPercent.peek()).toBe((33 - step) / 33);
      for (let i = 1; i < hits - 1; i++) expect(entity.components.finiteuses.useForAction('MINE')).toBe(true);
      expect(entity.isRemoved).toBe(false);
      expect(entity.components.finiteuses.remaining).toBe(step);
      expect(entity.components.finiteuses.useForAction('MINE')).toBe(true);
      expect(entity.isRemoved).toBe(true);
      expect(inventory.getEntity(hand)).toBeNull();
      expect(inventory.handEquipment.peek()).toBeNull();
      expect(entity.components.finiteuses.useForAction('MINE')).toBe(false);
    }
    inventory.add('pickaxe', 1, undefined, undefined, 1);
    inventory.transfer(inventorySlotAddress(0), hand, 1);
    const old = inventory.getEntity(hand)!, lifecycle = getPickaxeLifecycle(old);
    lifecycle.onequip();
    // Even a stale binding must not clear another instance's equipment identity.
    const detached = inventory.extract(hand, 1, old)!;
    inventory.add('goldenpickaxe', 1);
    inventory.transfer(inventorySlotAddress(0), hand, 1);
    const replacement = inventory.handEquipment.peek();
    detached.components.finiteuses.useForAction('MINE');
    expect(inventory.handEquipment.peek()).toBe(replacement);
    expect(old.isRemoved).toBe(true);
    lifecycle.onunequip();
    expect(inventory.handEquipment.peek()).toBe(replacement);
  } finally { inventory.dispose(); }
});

it('walks into range and commits mining at frame seven, preserving durability when cancelled or the target disappears', async () => {
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = player.userData.animationController as WilsonAnimationController;
  await animation.setCarryItem('goldenpickaxe');
  const inventory = createPickupInventory();
  inventory.add('goldenpickaxe', 1);
  inventory.transfer(inventorySlotAddress(0), equipmentSlotAddress('hand'), 1);
  const entity = inventory.getEntity(equipmentSlotAddress('hand'))!;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const loot = vi.fn(() => true), dispose = vi.fn();
  const rocks = new RockManager(scene, '/dst/data/anim', {
    prepareSpawn: async () => ({ spawn: loot, dispose }),
  });
  const world = { player, scene, camera, ground: new THREE.Group(), renderer: { domElement: new EventTarget() } } as unknown as ActionWorldContext;
  const locomotor = { goToPoint: vi.fn(() => true), stop: vi.fn(), destination: undefined };
  const controller = new PickaxeActionController(world, animation, locomotor, inventory.handEquipment, () => rocks.mineTargets);
  const advance = (frames: number) => { for (let i = 0; i < frames; i++) animation.update(1 / 30); };
  const begin = () => {
    expect(controller.request(rocks.mineTargets[0])).toBe(true); controller.update(0);
    while (animation.stategraph.stateName === 'mine_start') animation.update(1 / 30);
  };
  try {
    await rocks.spawn('rock_flintless_low', new THREE.Vector3(1, 0, 0));
    player.position.set(0, 0, 15);
    expect(controller.request(rocks.mineTargets[0])).toBe(true); controller.update(0);
    expect(locomotor.goToPoint).toHaveBeenCalled();
    player.position.set(1, 0, 3); controller.update(0);
    while (animation.stategraph.stateName === 'mine_start') animation.update(1 / 30);
    advance(6);
    expect(entity.components.finiteuses.remaining).toBeUndefined();
    expect(rocks.mineTargets[0].entity.components.workable!.GetWorkLeft()).toBe(2);
    advance(1);
    expect(entity.components.finiteuses.remaining).toBe(32.75);
    expect(rocks.mineTargets[0].entity.components.workable!.GetWorkLeft()).toBe(1);
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/wilson/use_pick_rock');
    advance(60);
    begin(); advance(6); controller.cancel(); advance(60);
    expect(entity.components.finiteuses.remaining).toBe(32.75);
    begin(); advance(6);
    // Another worker completes this boulder before the buffered action lands.
    vi.spyOn(Math, 'random').mockReturnValue(.9);
    expect(performToolWork('MINE', rocks.mineTargets[0].entity, {})).toBe(true);
    advance(60);
    expect(entity.components.finiteuses.remaining).toBe(32.75);
    expect(rocks.mineTargets).toEqual([]);
    expect(rocks.renderEntities).toEqual([]);
    expect(rocks.exportRecords()).toEqual([]);
    expect(loot).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledOnce(); // unused chance loot
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/wilson/rock_break', expect.any(THREE.Vector3));
    await rocks.spawn('rock1', new THREE.Vector3(1, 0, 0));
    begin(); advance(6); inventory.transfer(equipmentSlotAddress('hand'), inventorySlotAddress(0), 1); advance(60);
    expect(entity.components.finiteuses.remaining).toBe(32.75);
    expect(rocks.mineTargets[0].entity.components.workable!.GetWorkLeft()).toBe(6);
  } finally { controller.dispose(); rocks.dispose(); inventory.dispose(); }
});

it('changes full/med/low source poses and resets surviving rock work on reload', async () => {
  const scene = new THREE.Scene(), spawn = vi.fn(() => true), dispose = vi.fn();
  const world = { prepareSpawn: async () => ({ spawn, dispose }) };
  const rocks = new RockManager(scene, '/dst/data/anim', world);
  const restored = new RockManager(new THREE.Scene(), '/dst/data/anim', world);
  try {
    await rocks.spawn('rock1', new THREE.Vector3(3, 0, 4));
    const target = rocks.mineTargets[0], animation = target.model.userData.animationController;
    for (let i = 0; i < 3; i++) performToolWork('MINE', target.entity, {});
    expect(target.entity.components.workable!.GetWorkLeft()).toBe(3);
    expect(animation.currentAnimation).toBe('med');
    const { prefabId, record } = rocks.exportRecords()[0];
    await restored.spawn(prefabId, new THREE.Vector3(...record.transform.position), record);
    expect(restored.exportRecords()).toEqual(rocks.exportRecords());
    expect(restored.mineTargets[0].entity.components.workable!.GetWorkLeft()).toBe(6);
    for (let i = 0; i < 2; i++) performToolWork('MINE', target.entity, {});
    expect(animation.currentAnimation).toBe('low');
    vi.spyOn(Math, 'random').mockReturnValue(.1);
    performToolWork('MINE', target.entity, {});
    expect(spawn).toHaveBeenCalledTimes(7); // guaranteed loot plus both chance entries
    expect(rocks.exportRecords()).toEqual([]);
  } finally { rocks.dispose(); restored.dispose(); }
});
