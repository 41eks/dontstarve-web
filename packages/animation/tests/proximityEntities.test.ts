import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAnimationArchive } from '../src/animationAssets';
import { createAnimatedSpriteFactory } from '../src/sprite';
import { createMoonTreeForest } from '../../prefab/src/moontree';
import { ProximityEntities } from '../../prefab/src/proximityEntities';
import { TILE_SIZE } from '../../prefab/src/tile';
import { setSpriteEntityRenderOrder } from '../src/renderOrder';

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
  it('loads the inclusive circular XZ boundary and releases models when leaving', () => {
    const create = vi.fn(() => new THREE.Group());
    const dispose = vi.fn();
    const positions = [
      new THREE.Vector3(6, 0, 8),
      new THREE.Vector3(10.001, 0, 0),
      new THREE.Vector3(8, 0, 8),
    ];
    const nearby = new ProximityEntities(positions, 10, create, dispose);
    expect(create).not.toHaveBeenCalled();
    nearby.update(new THREE.Vector3(0, 100, 0));
    expect(nearby.group.children).toHaveLength(1);
    expect(nearby.entities[0].model!.position).toEqual(positions[0]);
    const original = nearby.entities[0].model!;
    nearby.update(new THREE.Vector3());
    expect(create).toHaveBeenCalledTimes(1);

    nearby.update(new THREE.Vector3(100, 0, 100));
    expect(dispose).toHaveBeenCalledWith(original);
    expect(original.parent).toBeNull();
    expect(nearby.entities[0].model).toBeUndefined();
    expect(nearby.activeEntities.size).toBe(0);

    nearby.update(new THREE.Vector3());
    expect(nearby.entities[0].model).not.toBe(original);
    expect(nearby.entities[0].id).toBe(0);
    expect(nearby.entities[0].position).toBe(positions[0]);
    nearby.dispose();
    expect(nearby.group.children).toHaveLength(0);
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it('shares archive textures while disposing only departing entity geometry', async () => {
    const factory = await createAnimatedSpriteFactory('/dst/data/anim', 'moon_tree.zip');
    const options = { initialAnimation: 'sway1_loop_tall' };
    const first = factory.create(options);
    const second = factory.create(options);
    const firstMesh = spriteMesh(first);
    const secondMesh = spriteMesh(second);
    expect(loadAnimationArchive).toHaveBeenCalledTimes(1);
    expect(firstMesh.geometry).not.toBe(secondMesh.geometry);
    expect(first.userData.animationController).not.toBe(second.userData.animationController);
    expect(firstMesh.material[0]).toBe(secondMesh.material[0]);
    expect(firstMesh.material[0].map).toBe(secondMesh.material[0].map);
    const geometryDispose = vi.spyOn(firstMesh.geometry, 'dispose');
    const textureDispose = vi.spyOn(firstMesh.material[0].map!, 'dispose');
    factory.disposeSprite(first);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).not.toHaveBeenCalled();
    second.userData.animationController.update(0.1);
    factory.dispose();
    expect(textureDispose).toHaveBeenCalledTimes(1);
    expect(() => factory.create(options)).toThrow('disposed');
  });

  it('keeps 500 tree records with no models until the player approaches', async () => {
    const initialPositions = Array.from({ length: 500 }, () => new THREE.Vector3(200, 0, 0));
    const random = vi.fn(() => { throw new Error('Explicit positions must bypass random generation'); });
    const forest = await createMoonTreeForest('/dst/data/anim', {
      positions: initialPositions,
      count: 1,
      random,
    });
    expect(forest.entities).toHaveLength(500);
    expect(random).not.toHaveBeenCalled();
    initialPositions[0].set(0, 0, 0);
    expect(forest.entities[0].position.toArray()).toEqual([200, 0, 0]);
    expect(forest.group.children).toHaveLength(0);
    forest.updateNearby(new THREE.Vector3());
    expect(forest.activeEntities.size).toBe(0);
    forest.updateNearby(new THREE.Vector3(200 - 10 * TILE_SIZE - 0.001, 0, 0));
    expect(forest.activeEntities.size).toBe(0);
    forest.updateNearby(new THREE.Vector3(200 - 10 * TILE_SIZE, 0, 0));
    expect(forest.activeEntities.size).toBe(500);
    expect(forest.group.children.every((child) => child instanceof THREE.Group)).toBe(true);
    const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1);
    forest.setNormals(quaternion);
    forest.update(0.1);
    for (const entity of forest.activeEntities) {
      expect(entity.model!.quaternion.equals(quaternion)).toBe(true);
      setSpriteEntityRenderOrder(entity.model!, entity.id);
      expect(entity.model!.children[0].renderOrder).toBe(entity.id);
    }
    expect(loadAnimationArchive).toHaveBeenCalledTimes(1);
    forest.updateNearby(new THREE.Vector3());
    expect(forest.group.children).toHaveLength(0);
    expect(forest.entities.every((entity) => entity.model === undefined)).toBe(true);
    forest.dispose();
  });
});
