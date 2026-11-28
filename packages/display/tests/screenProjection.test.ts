import * as THREE from 'three';
import { expect, it } from 'vitest';
import { ScreenProjection } from '@dontstarve-web/display';

it('projects a world source into an offset, CSS-sized canvas using browser top-left coordinates', () => {
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 0, 20);
  const canvas = { getBoundingClientRect: () => ({ left: 40, top: 60, width: 320, height: 240 }) } as HTMLCanvasElement;
  const projection = new ScreenProjection(camera, canvas);
  const position = new THREE.Vector3(5, 5, 0);
  expect(projection.GetScreenPos(position)).toEqual({ x: 280, y: 120 });
  expect(position.toArray()).toEqual([5, 5, 0]);
  expect(projection.GetScreenPos(new THREE.Vector3(0, 0, 30))).toBeNull();
});

it('uses the current perspective camera, parent transform and canvas size on each call', () => {
  const camera = new THREE.PerspectiveCamera(90, 2, 0.1, 100);
  const parent = new THREE.Group();
  parent.add(camera);
  parent.position.set(0, 0, 10);
  const rect = { left: 10, top: 20, width: 400, height: 200 };
  const canvas = { getBoundingClientRect: () => rect } as HTMLCanvasElement;
  const projection = new ScreenProjection(camera, canvas);
  const source = projection.GetScreenPos(new THREE.Vector3(10, 5, 0))!;
  expect(source.x).toBeCloseTo(310);
  expect(source.y).toBeCloseTo(70);

  parent.position.x = 10;
  rect.width = 800;
  rect.height = 400;
  const moved = projection.GetScreenPos(new THREE.Vector3(10, 5, 0))!;
  expect(moved.x).toBeCloseTo(410);
  expect(moved.y).toBeCloseTo(120);
  expect(source.x).toBeCloseTo(310);
  expect(source.y).toBeCloseTo(70);
});

it('returns no screen position for an unmeasurable canvas or invalid world coordinates', () => {
  const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 100);
  camera.position.z = 10;
  const rect = { left: 0, top: 0, width: 0, height: 200 };
  const canvas = { getBoundingClientRect: () => rect } as HTMLCanvasElement;
  const projection = new ScreenProjection(camera, canvas);
  expect(projection.GetScreenPos(new THREE.Vector3())).toBeNull();
  rect.width = 200;
  expect(projection.GetScreenPos(new THREE.Vector3(NaN, 0, 0))).toBeNull();
});
