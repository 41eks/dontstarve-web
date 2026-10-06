import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GroundItemManager } from '../../../src/groundItems';
import { ButterflyController } from '../../prefab/src/butterfly';
import { createGroundItemSprite } from '@dontstarve-web/prefab/groundItems';

vi.mock('@dontstarve-web/animation/imageAtlas', () => ({
  loadImageAtlas: async () => ({
    require: () => ({ width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]) }),
  }),
}));

// This suite checks save/transfer state; browser tests load the real DST assets.
vi.mock('@dontstarve-web/prefab/groundItems', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dontstarve-web/prefab/groundItems')>();
  const createGroundItemSprite = vi.fn(async () => {
    const model = new THREE.Group();
    model.add(new THREE.Group());
    model.userData.events = [];
    for (const type of ['ondropped', 'onputininventory', 'onload'] as const) {
      model.addEventListener(type, () => model.userData.events.push(type));
    }
    return { model, update() {}, dispose() { model.userData.events.push('dispose'); model.removeFromParent(); } };
  });
  return {
    ...actual, createGroundItemSprite,
    createGroundItemFactory: () => ({
      itemIds: Object.keys(actual.GROUND_ITEM_DEFINITIONS),
      create: createGroundItemSprite,
    }),
  };
});

vi.mock('@dontstarve-web/prefab/butterfly', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dontstarve-web/prefab/butterfly')>();
  class MockButterflyAssets {
    dispose() {}
    async create(world: import('../../prefab/src/butterfly').ButterflyWorld) {
      const model = new THREE.Group();
      model.add(new THREE.Group());
      const controller = new actual.ButterflyController(model,
        { start() {}, playOnce() {}, update() {} }, world, () => 0);
      return { model, controller, update: (dt: number) => controller.update(dt),
        dispose: () => model.removeFromParent() };
    }
  }
  return {
    ...actual, ButterflyAssets: MockButterflyAssets,
    createButterflyGroundFactory: (context: import('../../prefab/src/groundPrefab').GroundPrefabContext) => {
      const assets = new MockButterflyAssets();
      return {
        itemIds: [actual.BUTTERFLY_ID], capture: 'net',
        create: () => actual.createButterflyGroundSprite(
          assets as unknown as InstanceType<typeof actual.ButterflyAssets>,
          context.butterflyWorld, context.getNeighbours),
        dispose: () => assets.dispose(),
      };
    },
  };
});

afterEach(() => vi.restoreAllMocks());

function setup() {
  const scene = new THREE.Scene();
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  });
  const pickup = vi.fn(() => true);
  const player = new THREE.Group();
  const manager = new GroundItemManager(scene, new THREE.PerspectiveCamera(),
    { domElement: canvas } as unknown as THREE.WebGLRenderer, 'images.zip', pickup, 'anim', player);
  return { manager, scene, canvas, pickup, player };
}

const definition = { itemId: 'log', count: 1, name: 'Log', icon: 'log.tex' };

describe('ground item save records', () => {
  it('flings one entity per loot piece, keeps flight heights out of saves and stops motion on pickup', async () => {
    const { manager, canvas, pickup, player } = setup();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      await manager.flingLoot([{ ...definition, count: 3 }], new THREE.Vector3(1, 0, 2));
      const models = manager.renderEntities.map(({ object }) => object);
      expect(models).toHaveLength(3);
      expect(manager.exportRecords().map(({ components }) => components.stack?.count)).toEqual([1, 1, 1]);
      manager.update(0.1, new THREE.Quaternion());
      expect(models.every((model) => model.children[0].position.y > 0 && model.position.y === 0)).toBe(true);
      expect(manager.exportRecords().every((record) => record.transform.position[1] === 0)).toBe(true);
      const model = models[0];
      player.position.copy(model.position);
      vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([
        { object: model } as unknown as THREE.Intersection,
      ]);
      canvas.dispatchEvent(Object.assign(new Event('pointerdown', { cancelable: true }),
        { button: 0, clientX: 50, clientY: 50 }));
      expect(pickup).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'log', count: 1 }), 'pickup', model.position);
      expect(model.parent).toBeNull();
      const pickedUpPosition = model.position.clone();
      manager.update(5, new THREE.Quaternion());
      expect(model.position).toEqual(pickedUpPosition);
      expect(manager.exportRecords()).toHaveLength(2);
      expect(models.slice(1).every((model) => model.children[0].position.y === 0)).toBe(true);
      const records = manager.exportRecords();
      manager.update(5, new THREE.Quaternion());
      expect(manager.exportRecords()).toEqual(records);
    } finally { manager.dispose(); }
  });

  it.each(['log', 'test_icon_fallback'])('limits %s pickup to chest proximity and leaves distant items untouched', async (itemId) => {
    const { manager, scene, canvas, pickup, player } = setup();
    const item = { ...definition, itemId };
    const foot = new THREE.Vector3(3, 0, 4);
    const distance = (value: number) => player.position.copy(foot).add(new THREE.Vector3(value, 100, 0));
    distance(9.01);
    const model = await manager.spawnFromSave('range_item', item, foot);
    const onInventory = vi.fn();
    model.addEventListener('onputininventory', onInventory);
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([{ object: model } as THREE.Intersection]);
    const click = () => canvas.dispatchEvent(Object.assign(new Event('pointerdown', { cancelable: true }),
      { button: 0, clientX: 50, clientY: 50 }));
    const saved = manager.exportRecords();
    click();
    expect(pickup).not.toHaveBeenCalled();
    expect(onInventory).not.toHaveBeenCalled();
    expect(model.parent).toBe(scene);
    expect(manager.exportRecords()).toEqual(saved);

    // Click checks the current player position, even before the next frame.
    pickup.mockReturnValue(false);
    distance(9);
    click();
    expect(pickup).toHaveBeenCalledTimes(1);
    distance(10);
    click();
    expect(pickup).toHaveBeenCalledTimes(2);
    expect(onInventory).not.toHaveBeenCalled();
    expect(manager.exportRecords()).toEqual(saved);
    distance(10.01);
    click();
    distance(9.5);
    click();
    expect(pickup).toHaveBeenCalledTimes(2);
    expect(onInventory).not.toHaveBeenCalled();

    // A diagonal approach is measured on the ground plane, ignoring height.
    player.position.copy(foot).add(new THREE.Vector3(5.4, 100, 7.2));
    pickup.mockReturnValue(true);
    click();
    expect(pickup).toHaveBeenCalledTimes(3);
    expect(onInventory).toHaveBeenCalledOnce();
    expect(manager.exportRecords()).toEqual([]);
    expect(model.parent).toBeNull();
    manager.dispose();
  });

  it('dispatches prefab events only after successful transfers and distinguishes restore from drop', async () => {
    const { manager, scene, canvas, pickup } = setup();
    const lastModel = async () => (await vi.mocked(createGroundItemSprite).mock.results.at(-1)!.value).model;
    expect(await manager.drop(definition, new THREE.Vector3(), () => false)).toBe(false);
    expect((await lastModel()).userData.events).toEqual(['dispose']);
    await expect(manager.drop(definition, new THREE.Vector3(), () => { throw new Error('transfer failed'); }))
      .rejects.toThrow('transfer failed');
    expect((await lastModel()).userData.events).toEqual(['dispose']);
    await manager.drop(definition, new THREE.Vector3(3, 7, 4), () => true);
    const model = await lastModel();
    expect(model.userData.events).toEqual(['ondropped']);
    expect(model.position.toArray()).toEqual([3, 0, 4]);
    let attachedOnPickup = false;
    model.addEventListener('onputininventory', () => { attachedOnPickup = model.parent === scene; });
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([{ object: model } as THREE.Intersection]);
    const click = () => canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, clientX: 50, clientY: 50 }));
    pickup.mockReturnValueOnce(false);
    click();
    expect(model.userData.events).toEqual(['ondropped']);
    expect(manager.exportRecords()).toHaveLength(1);
    click();
    expect(model.userData.events).toEqual(['ondropped', 'onputininventory', 'dispose']);
    expect(attachedOnPickup).toBe(true);
    expect(manager.exportRecords()).toHaveLength(0);
    const restored = await manager.spawnFromSave('restored-events', definition, new THREE.Vector3(2, 0.25, 3));
    expect(restored.userData.events).toEqual(['onload']);
    expect(restored.position.toArray()).toEqual([2, 0.25, 3]);
    manager.update(0, new THREE.Quaternion());
    expect(manager.exportRecords()[0].transform.position).toEqual([2, 0.25, 3]);
    manager.dispose();
  });
  it('saves live drops at their ground position and excludes failed drops and picked-up items', async () => {
    const { manager, scene, canvas, pickup, player } = setup();
    player.position.set(8, 0, 9);
    expect(await manager.drop(definition, new THREE.Vector3(8, 30, 9), () => false)).toBe(false);
    expect(manager.exportRecords()).toEqual([]);
    expect(await manager.drop(definition, new THREE.Vector3(8, 30, 9), () => true)).toBe(true);
    const [record] = manager.exportRecords();
    expect(record.id).toBe(scene.children[0].userData.entityId);
    expect(record.transform.position).toEqual([8, 0, 9]);
    expect(record.components.stack).toEqual({ itemId: 'log', count: 1 });
    record.components.stack!.count = 20;
    expect(manager.exportRecords()[0].components.stack?.count).toBe(1);
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([
      { object: scene.children[0] } as THREE.Intersection,
    ]);
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, clientX: 50, clientY: 50 }));
    expect(pickup).toHaveBeenCalledWith(definition, 'pickup', new THREE.Vector3(8, 0, 9));
    expect(manager.exportRecords()).toEqual([]);
    expect(scene.children).toHaveLength(0);
  });

  it('requires NET for living butterflies and keeps a failed capture in the world', async () => {
    const { manager, scene, canvas, pickup } = setup();
    const butterfly = { itemId: 'butterfly', count: 1, name: '蝴蝶', icon: 'butterfly.tex' };
    await manager.drop(butterfly, new THREE.Vector3(), () => true);
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([
      { object: scene.children[0] } as THREE.Intersection,
    ]);
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, clientX: 50, clientY: 50 }));
    expect(pickup).not.toHaveBeenCalled();
    const [target] = manager.netCaptureTargets;
    pickup.mockReturnValue(false);
    expect(target.capture()).toBe(false);
    expect(target.isValid()).toBe(true);
    expect(manager.exportRecords()).toHaveLength(1);
    pickup.mockReturnValue(true);
    expect(target.capture()).toBe(true);
    expect(target.isValid()).toBe(false);
    expect(target.capture()).toBe(false);
    expect(pickup).toHaveBeenCalledTimes(2);
    expect(scene.children).toHaveLength(0);
    expect(manager.exportRecords()).toHaveLength(0);
  });
});
