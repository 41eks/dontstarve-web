import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GroundItemManager } from '../../../src/groundItems';
import { ButterflyController } from '../../prefab/src/butterfly';

vi.mock('@three-roaming/animation/imageAtlas', () => ({
  loadImageAtlas: async () => ({
    require: () => ({ width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]) }),
  }),
}));

// This suite checks save/transfer state; browser tests load the real DST assets.
vi.mock('@three-roaming/prefab/groundItems', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@three-roaming/prefab/groundItems')>();
  return {
    ...actual,
    createGroundItemSprite: async () => {
      const model = new THREE.Group();
      model.add(new THREE.Group());
      return { model, update() {}, dispose() { model.removeFromParent(); } };
    },
  };
});

vi.mock('@three-roaming/prefab/butterfly', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@three-roaming/prefab/butterfly')>();
  return {
    ...actual,
    ButterflyAssets: class {
      async create(world: import('../../prefab/src/butterfly').ButterflyWorld) {
        const model = new THREE.Group();
        model.add(new THREE.Group());
        const controller = new actual.ButterflyController(model,
          { start() {}, playOnce() {}, update() {} }, world, () => 0);
        return { model, controller, update: (dt: number) => controller.update(dt),
          dispose: () => model.removeFromParent() };
      }
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
  const manager = new GroundItemManager(scene, new THREE.PerspectiveCamera(),
    { domElement: canvas } as unknown as THREE.WebGLRenderer, 'images.zip', pickup, 'anim');
  return { manager, scene, canvas, pickup };
}

const definition = { itemId: 'log', count: 1, name: 'Log', icon: 'log.tex' };

describe('ground item save records', () => {
  it('saves live drops at their ground position and excludes failed drops and picked-up items', async () => {
    const { manager, scene, canvas, pickup } = setup();
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
    expect(pickup).toHaveBeenCalledWith(definition, 'pickup');
    expect(manager.exportRecords()).toEqual([]);
    expect(scene.children).toHaveLength(0);
  });

  it('keeps restored IDs and item skins without pickup side effects', async () => {
    const { manager, pickup } = setup();
    const restored = { ...definition, itemId: 'treasurechest', skinId: 'treasurechest_ancient' };
    await manager.spawnFromSave('e_restored_item', restored, new THREE.Vector3(3, 0, 4));
    expect(manager.exportRecords()).toEqual([{
      id: 'e_restored_item', transform: { position: [3, 0, 4], rotationY: 0 },
      components: { stack: { itemId: 'treasurechest', skinId: 'treasurechest_ancient', count: 1 } },
    }]);
    expect(pickup).not.toHaveBeenCalled();
  });

  it('splits a live butterfly stack, saves moving foot points and nets only the clicked creature', async () => {
    const { manager, scene, canvas, pickup } = setup();
    manager.setNetCaptureHandler((target) => target.capture());
    const butterfly = { itemId: 'butterfly', count: 3, name: '蝴蝶', icon: 'butterfly.tex' };
    expect(await manager.drop(butterfly, new THREE.Vector3(8, 30, 9), () => false)).toBe(false);
    expect(scene.children).toHaveLength(0);
    expect(await manager.drop(butterfly, new THREE.Vector3(8, 30, 9), () => true)).toBe(true);
    expect(scene.children).toHaveLength(3);
    expect(new Set(manager.exportRecords().map(({ id }) => id)).size).toBe(3);
    for (let frame = 0; frame < 20; frame++) manager.update(0.1, new THREE.Quaternion());
    const records = manager.exportRecords();
    expect(records.every(({ components }) => components.stack?.count === 1)).toBe(true);
    expect(records[0].transform.position[0]).toBeGreaterThan(8);
    expect(records[0].transform.position).toEqual(scene.children[0].position.toArray());
    expect(manager.renderEntities[0].footPosition.toArray()).toEqual(records[0].transform.position);
    expect(scene.children[0].userData.butterflyController).toBeInstanceOf(ButterflyController);
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([
      { object: scene.children[0] } as THREE.Intersection,
    ]);
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, clientX: 50, clientY: 50 }));
    expect(pickup).toHaveBeenCalledWith({ ...butterfly, count: 1 }, 'net');
    expect(manager.exportRecords()).toHaveLength(2);
    expect(scene.children).toHaveLength(2);
    const restored = setup();
    await restored.manager.spawnFromSave(records[0].id, { ...butterfly, count: 1 }, new THREE.Vector3(...records[0].transform.position));
    expect(restored.manager.exportRecords()[0]).toEqual(records[0]);
    for (let frame = 0; frame < 20; frame++) restored.manager.update(0.1, new THREE.Quaternion());
    expect(restored.manager.exportRecords()[0].transform.position[0]).toBeGreaterThan(records[0].transform.position[0]);
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
