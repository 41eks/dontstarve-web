import { createSignal } from '../../signals/src';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { ICE_BOX_DEFINITION } from '../../prefab/src/icebox';
import { TREASURE_CHEST_DEFINITION } from '../../prefab/src/treasurechest';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import type { WorldContext } from '../../prefab/src/worldContext';
import { createPickupInventory } from './pickupFixture';
import { workTargets } from './workTargets';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
vi.mock('../../prefab/src/sound', () => ({ PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));

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
    const target = workTargets('HAMMER')[0], address = { containerId: 'world:icebox:icebox', slotKey: '0' };
    const item = inventory.getEntity(address)!;
    const before = item.snapshot();
    target.work();
    expect(target.entity.hasTag('HAMMER_workable')).toBe(true);
    expect(target.entity.components.workable!.GetWorkLeft()).toBe(1);
    expect(inventory.getEntity(address)).toBeNull();
    expect(dropped).toEqual([item]);
    expect(item.snapshot()).toEqual(before);
    expect(item.transform.position.toArray()).toEqual([3, 0, -6]);
    expect(dropLoot).not.toHaveBeenCalled();
    target.work(); target.work();
    expect(target.entity.hasTag('HAMMER_workable')).toBe(false);
    expect(model.parent).toBeNull(); expect(placement.exportRecords()).toEqual([]);
    expect(dropLoot.mock.calls.flatMap(([items]) => items)).toEqual([
      { itemId: 'goldnugget', count: 1 }, { itemId: 'gears', count: 1 }, { itemId: 'cutstone', count: 1 },
    ]);
    expect(dropLoot.mock.calls.every(([, position]) => position.equals(new THREE.Vector3(3, 0, -6)))).toBe(true);
    expect(item.isRemoved).toBe(false);
  } finally { stop(); placement.dispose(); inventory.dispose(); }
});

it('burns a chest through shared components, drops its live contents and restores the burnt instance', () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const inventory = createPickupInventory(), dropped: unknown[] = [];
  const stop = inventory.subscribeDropped(entity => dropped.push(entity));
  const world = { scene: new THREE.Scene(), player: new THREE.Group(), camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    cameraFacing: createSignal(8), cameraHeading: createSignal(45),
    renderer: { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer,
    registerContainer: (id, container, saved) => inventory.registerContainer(id, container, saved),
    unregisterContainer: (id, container) => inventory.unregisterContainer(id, container),
  } as WorldContext;
  const definition = { treasurechest: TREASURE_CHEST_DEFINITION };
  const placement = new AnimatedBuildingPlacement(world, definition, () => false);
  let restored: AnimatedBuildingPlacement<'treasurechest'> | undefined;
  try {
    const model = placement.spawnFromSave('treasurechest', { id: 'burning-chest', transform: { position: [3, 0, -6], rotationY: 0 },
      components: { building: { state: 'closed' }, container: { slotCount: 9,
        slots: [{ slotKey: '0', item: { entityId: 'stored-seeds', itemId: 'seeds', count: 3, freshnessPercent: .6 } }] } } });
    const inst = prefabInstance(model)!;
    const item = inventory.getEntity({ containerId: 'world:treasurechest:burning-chest', slotKey: '0' })!;
    const before = item.snapshot(), burnable = inst.components.burnable!;
    const dispose = vi.spyOn(burnable, 'dispose');
    expect(burnable.inst).toBe(inst);
    burnable.Ignite();
    expect(inst.sprite.fx.peek().size).toBe(1);
    placement.update(10);
    expect(inst.hasTag('burnt')).toBe(true);
    expect(inst.components.workable!.GetWorkLeft()).toBe(1);
    expect(inst.components.container).toBeUndefined();
    expect(inst.components.burnable).toBeUndefined();
    expect(inst.components.propagator).toBeUndefined();
    expect(inst.sprite.fx.peek().size).toBe(0);
    expect(dropped).toEqual([item]);
    expect(item.snapshot()).toEqual(before);
    expect(item.transform.position.toArray()).toEqual([3, 0, -6]);
    const record = placement.exportRecords()[0].record;
    expect(record).toMatchObject({ id: 'burning-chest', components: { building: { burnt: true } } });
    placement.dispose();
    expect(dispose).toHaveBeenCalledOnce();

    restored = new AnimatedBuildingPlacement(world, definition, () => false);
    const loaded = prefabInstance(restored.spawnFromSave('treasurechest', record))!;
    expect(loaded.entityId).toBe(inst.entityId);
    expect(loaded.position.toArray()).toEqual([3, 0, -6]);
    expect(loaded.hasTag('burnt')).toBe(true);
    expect(loaded.components.workable!.GetWorkLeft()).toBe(1);
    expect(loaded.components.container).toBeUndefined();
    expect(restored.exportRecords()[0].record).toEqual(record);
  } finally { stop(); placement.dispose(); restored?.dispose(); inventory.dispose(); }
});
