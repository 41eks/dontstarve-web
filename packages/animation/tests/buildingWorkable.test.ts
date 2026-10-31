import { createSignal } from '../../signals/src';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { ICE_BOX_DEFINITION } from '../../prefab/src/icebox';
import type { WorldContext } from '../../prefab/src/worldContext';
import { createPickupInventory } from './pickupFixture';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('restores container contents, drops their live entities at the building foot and finishes on work two', async () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const inventory = createPickupInventory();
  const scene = new THREE.Scene(), dropLoot = vi.fn(), dropped: unknown[] = [];
  const stop = inventory.subscribeDropped(entity => dropped.push(entity));
  const world = { scene, player: new THREE.Group(), camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(), cameraFacing: createSignal(8), cameraHeading: createSignal(45),
    renderer: { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer, dropLoot,
    registerContainer: (id, container, saved) => inventory.registerContainer(id, container, saved),
    unregisterContainer: (id, container) => inventory.unregisterContainer(id, container),
  } as WorldContext;
  const placement = new AnimatedBuildingPlacement(world, { icebox: ICE_BOX_DEFINITION }, () => false);
  try {
    const model = await placement.spawnFromSave('icebox', { id: 'icebox', transform: { position: [3, 0, -6], rotationY: 0 },
      components: { building: { state: 'closed' }, container: { slotCount: 9,
        slots: [{ slotKey: '0', item: { entityId: 'stored_food', itemId: 'seeds', count: 3, freshnessPercent: .6 } }] } } });
    const target = placement.hammerTargets[0], address = { containerId: 'world:icebox:icebox', slotKey: '0' };
    const item = inventory.getEntity(address)!;
    const before = item.snapshot();
    target.playHit();
    expect(target.entity.hasTag('HAMMER_workable')).toBe(true);
    expect(target.entity.components.workable!.GetWorkLeft()).toBe(1);
    expect(inventory.getEntity(address)).toBeNull();
    expect(dropped).toEqual([item]);
    expect(item.snapshot()).toEqual(before);
    expect(item.transform.position.toArray()).toEqual([3, 0, -6]);
    expect(dropLoot).not.toHaveBeenCalled();
    target.playHit(); target.playHit();
    expect(target.entity.hasTag('HAMMER_workable')).toBe(false);
    expect(model.parent).toBeNull(); expect(placement.exportRecords()).toEqual([]);
    expect(dropLoot.mock.calls.flatMap(([items]) => items)).toEqual([
      { itemId: 'goldnugget', count: 1 }, { itemId: 'gears', count: 1 }, { itemId: 'cutstone', count: 1 },
    ]);
    expect(dropLoot.mock.calls.every(([, position]) => position.equals(new THREE.Vector3(3, 0, -6)))).toBe(true);
    expect(item.isRemoved).toBe(false);
  } finally { stop(); placement.dispose(); inventory.dispose(); }
});
