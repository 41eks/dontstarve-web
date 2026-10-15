import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { compareRenderEntries } from '../src/renderOrder';

describe('compareRenderEntries', () => {
  it('draws background entities before world entities and sorts background billboards by foot depth', () => {
    const backgroundNear = { object: new THREE.Object3D(), cameraDepth: -5, footPosition: { x: 0, z: 0 }, renderLayer: -1 };
    const backgroundFar = { object: new THREE.Object3D(), cameraDepth: -25, footPosition: { x: 0, z: 0 }, renderLayer: -1 };
    const world = { object: new THREE.Object3D(), cameraDepth: -50, footPosition: { x: 0, z: 0 } };
    expect([world, backgroundNear, backgroundFar].sort(compareRenderEntries)).toEqual([backgroundFar, backgroundNear, world]);
  });

  it('orders far to near by camera depth', () => {
    const far = { object: new THREE.Object3D(), cameraDepth: -30, footPosition: { x: 0, z: 0 } };
    const near = { object: new THREE.Object3D(), cameraDepth: -10, footPosition: { x: 0, z: 0 } };
    expect([near, far].sort(compareRenderEntries)).toEqual([far, near]);
  });

  it('orders a row of walls on one line of sight by foot x then z, whatever their ids or depth noise', () => {
    const feet = [[6, 3], [0, 3], [3, 3], [3, 0], [9, 3]];
    const walls = feet.map(([x, z]) => ({ object: new THREE.Object3D(), cameraDepth: -20, footPosition: { x, z } }));
    const expected = [[0, 3], [3, 0], [3, 3], [6, 3], [9, 3]];
    for (let frame = 0; frame < 50; frame++) {
      const noisy = walls.map((wall) => ({ ...wall, cameraDepth: -20 + (Math.random() - 0.5) * 2e-6 }));
      expect(noisy.sort(compareRenderEntries).map((wall) => [wall.footPosition.x, wall.footPosition.z])).toEqual(expected);
    }
  });

  it('keeps grouped parts of one entity in layer order', () => {
    const object = new THREE.Object3D();
    const top = { object, cameraDepth: -20, footPosition: { x: 5, z: 0 }, sortGroup: 1, sortLayer: 2 };
    const base = { object, cameraDepth: -20, footPosition: { x: 0, z: 0 }, sortGroup: 1, sortLayer: 1 };
    expect([top, base].sort(compareRenderEntries)).toEqual([base, top]);
  });
});
