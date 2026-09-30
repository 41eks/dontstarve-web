import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GroundItemManager } from '../../../src/groundItems';

vi.mock('@three-roaming/animation/imageAtlas', () => ({
  loadImageAtlas: async () => ({
    require: () => ({ width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]) }),
  }),
}));

afterEach(() => vi.restoreAllMocks());

function setup() {
  const scene = new THREE.Scene();
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  });
  const pickup = vi.fn(() => true);
  const manager = new GroundItemManager(scene, new THREE.PerspectiveCamera(),
    { domElement: canvas } as unknown as THREE.WebGLRenderer, 'images.zip', pickup);
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
    expect(pickup).toHaveBeenCalledWith(definition);
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
});
