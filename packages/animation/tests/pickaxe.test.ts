import { workTargets } from './workTargets';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPickupInventory } from './pickupFixture';
import { equipmentSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { getPickaxeLifecycle } from '../../prefab/src/pickaxe';
import { rockWorld } from './rockWorldFixture';
import { performToolWork } from '../../stategraphs/src/componentactions';

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


it('changes full/med/low source poses and resets surviving rock work on reload', async () => {
  const scene = new THREE.Scene(), spawn = vi.fn(() => undefined);
  const rocks = rockWorld(scene, { spawnGroundItem: spawn });
  const restored = rockWorld(new THREE.Scene(), { spawnGroundItem: spawn });
  try {
    rocks.spawn('rock1', new THREE.Vector3(3, 0, 4));
    const target = workTargets('MINE')[0], animation = prefabInstance(target.model)!.sprite;
    for (let i = 0; i < 3; i++) performToolWork('MINE', target.entity, {});
    expect(target.entity.components.workable!.GetWorkLeft()).toBe(3);
    expect(animation.currentAnimation).toBe('med');
    const { prefabId, record } = rocks.exportRecords()[0];
    restored.spawn(prefabId, new THREE.Vector3(...record.transform.position), record);
    expect(restored.exportRecords()).toEqual(rocks.exportRecords());
    expect(workTargets('MINE').find(({ model }) => model !== target.model)!.entity.components.workable!.GetWorkLeft()).toBe(6);
    for (let i = 0; i < 2; i++) performToolWork('MINE', target.entity, {});
    expect(animation.currentAnimation).toBe('low');
    vi.spyOn(Math, 'random').mockReturnValue(.1);
    performToolWork('MINE', target.entity, {});
    expect(spawn).toHaveBeenCalledTimes(7); // guaranteed loot plus both chance entries
    expect(rocks.exportRecords()).toEqual([]);
  } finally { rocks.dispose(); restored.dispose(); }
});
