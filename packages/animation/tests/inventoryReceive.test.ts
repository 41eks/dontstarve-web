import * as THREE from 'three';
import { expect, it } from 'vitest';
import { projectInventorySource } from '../../../src/inventoryReceive';

it('projects a world source into an offset, CSS-sized canvas using browser top-left coordinates', () => {
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 0, 20);
  const canvas = { getBoundingClientRect: () => ({ left: 40, top: 60, width: 320, height: 240 }) } as HTMLCanvasElement;
  const position = new THREE.Vector3(5, 5, 0);
  expect(projectInventorySource(position, camera, canvas)).toEqual({ x: 280, y: 120 });
  expect(position.toArray()).toEqual([5, 5, 0]);
  expect(projectInventorySource(new THREE.Vector3(0, 0, 30), camera, canvas)).toBeNull();
});
