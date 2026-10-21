import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAnimationArchive } from '../src/animationAssets';
import { createAnimatedSpriteFactory } from '../src/sprite';
import { ProximityEntities } from '../../prefab/src/proximityEntities';
import { createSignal } from '../../signals/src/signal';
import { DisposeTileStates, GetTileStateAtPoint } from '../../componets/src/tileManager';
import { useTestTileMap } from './tileMapFixture';

useTestTileMap();

vi.mock('../src/animationAssets', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/animationAssets')>();
  const elements = [{
    imageHash: 1, imageIndex: 0, layerHash: 1, z: 0,
    matrix: [1, 0, 0, 1, 0, 0],
  }];
  return {
    ...original,
    loadAnimationArchive: vi.fn(async () => ({
      buildPackage: {
        build: {
          name: 'moon_tree', atlasNames: ['atlas.tex'],
          symbols: new Map([[1, [{
            index: 0, duration: 1, x: 0, y: -5, width: 2, height: 10,
            vertexIndex: 0, vertexCount: 6, sampler: 0,
            bbx: 0, bby: 0, canvasWidth: 2, canvasHeight: 10,
          }]]]),
        },
        atlases: [{ width: 2, height: 10, pixels: new Uint8Array(80) }],
      },
      animations: { animations: [{
        name: 'sway1_loop_tall', frameRate: 30, facing: 255, bankHash: 1,
        frames: [{ elements }, { elements }],
      }] },
    })),
  };
});

afterEach(() => vi.clearAllMocks());

function spriteMesh(model: THREE.Group): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]> {
  return model.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
}

describe('nearby entity lifecycle', () => {
  it('loads entities whose tile is in the tickingarea and releases models when it moves away or unbinds', async () => {
    const player = createSignal(new THREE.Vector3());
    const create = vi.fn(() => new THREE.Group());
    const dispose = vi.fn();
    const positions = [new THREE.Vector3(100, 0, 0), new THREE.Vector3(300, 0, 0)];
    const nearby = new ProximityEntities(positions, create, dispose);
    const query = GetTileStateAtPoint(player);
    const wait = () => new Promise(resolve => setTimeout(resolve, 0));
    const loaded = () => nearby.entities.map(entity => !!entity.model);
    try {
      nearby.update();
      expect(create).not.toHaveBeenCalled(); // Nothing is active before an area is bound.
      const unbind = nearby.bindTickingarea(query);
      await wait();
      nearby.update();
      expect(loaded()).toEqual([true, false]);
      const original = nearby.entities[0].model!;
      expect(original.position).toEqual(positions[0]);
      nearby.update();
      expect(create).toHaveBeenCalledTimes(1);

      player.set(new THREE.Vector3(300, 0, 0)); await wait();
      nearby.update();
      expect(dispose).toHaveBeenCalledWith(original);
      expect(original.parent).toBeNull();
      expect(loaded()).toEqual([false, true]);
      expect(nearby.activeEntities.size).toBe(1);
      expect(nearby.entities[1].id).toBe(1);

      unbind();
      nearby.update();
      expect(loaded()).toEqual([false, false]);
    } finally { nearby.dispose(); DisposeTileStates(player); }
    expect(nearby.group.children).toHaveLength(0);
  });

  it('shares archive textures and frame geometry between sprites of one factory', async () => {
    const factory = await createAnimatedSpriteFactory('/dst/data/anim', 'moon_tree.zip');
    const options = { initialAnimation: 'sway1_loop_tall' };
    const first = factory.create(options);
    const second = factory.create(options);
    const firstMesh = spriteMesh(first);
    const secondMesh = spriteMesh(second);
    expect(loadAnimationArchive).toHaveBeenCalledTimes(1);
    // Identical frames are built once per factory, so sprites draw the same buffers.
    expect(firstMesh.geometry).toBe(secondMesh.geometry);
    expect(first.userData.animationController).not.toBe(second.userData.animationController);
    expect(firstMesh.material[0]).toBe(secondMesh.material[0]);
    expect(firstMesh.material[0].map).toBe(secondMesh.material[0].map);
    const textureDispose = vi.spyOn(firstMesh.material[0].map!, 'dispose');
    factory.disposeSprite(first);
    expect(secondMesh.geometry.getAttribute('position')).toBeDefined();
    expect(textureDispose).not.toHaveBeenCalled();
    second.userData.animationController.update(0.1);
    // A per-instance appearance (hidden layer) leaves the shared frames and draws its own buffers.
    second.userData.animationController.setSymbolOverrides(new Map(), ['not_a_layer']);
    expect(secondMesh.geometry).not.toBe(firstMesh.geometry);
    factory.dispose();
    expect(textureDispose).toHaveBeenCalledTimes(1);
    expect(() => factory.create(options)).toThrow('disposed');
  });
});
