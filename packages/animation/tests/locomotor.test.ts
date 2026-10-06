import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { Locomotor, findGroundPath, setupLocomotorInput } from '../../prefab/src/locomotor';
import { PointerRaycaster } from '../../prefab/src/pointerRaycaster';
import type { WorldContext } from '../../prefab/src/worldContext';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function body() {
  return new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(0.5), linearDamping: 0 });
}

it('walks using physics to a copied target, then stops without teleporting or changing vertical velocity', () => {
  const player = body();
  const world = new CANNON.World();
  world.addBody(player);
  player.velocity.y = 3;
  const locomotor = new Locomotor(player);
  const target = new THREE.Vector3(8, 0, 6);
  expect(locomotor.goToPoint(target)).toBe(true);
  target.x = 100;
  expect(player.position.x).toBe(0);
  locomotor.update(16, 1 / 60);
  expect(player.velocity.y).toBe(3);
  expect(Math.hypot(player.velocity.x, player.velocity.z)).toBeCloseTo(16);
  for (let i = 0; i < 90; i++) {
    locomotor.update(16, 1 / 60);
    world.step(1 / 60);
  }
  expect(Math.hypot(player.position.x - 8, player.position.z - 6)).toBeLessThanOrEqual(0.25);
  expect(player.velocity.x).toBe(0);
  expect(player.velocity.z).toBe(0);
  expect(player.velocity.y).toBe(3);
  expect(locomotor.destination).toBeUndefined();
});

it('gives manual movement priority and does not resume the cancelled target after key release', () => {
  const player = body();
  const locomotor = new Locomotor(player);
  locomotor.goToPoint(new THREE.Vector3(10, 0, 0));
  locomotor.update(16, 1 / 60, new THREE.Vector3(0, 0, 2));
  expect(locomotor.destination).toBeUndefined();
  expect(player.velocity.z).toBe(16);
  locomotor.update(16, 1 / 60);
  expect(player.velocity.z).toBe(0);
  locomotor.goToPoint(new THREE.Vector3(10, 0, 0));
  locomotor.update(16, 1 / 60, new THREE.Vector3());
  expect(locomotor.destination).toBeUndefined();
  expect(player.velocity.x).toBe(0);
});

it('finds and follows a route around an obstacle without cutting its corners', () => {
  const player = body();
  const world = new CANNON.World();
  world.addBody(player);
  const isWalkable = (point: THREE.Vector3) => Math.abs(point.x) <= 15 && Math.abs(point.z) <= 15
    && !(point.x >= 3 && point.x <= 7 && point.z >= -2 && point.z <= 2);
  const findPath = (start: THREE.Vector3, target: THREE.Vector3) => findGroundPath(start, target, { isWalkable, cellSize: 1 });
  expect(findPath(new THREE.Vector3(), new THREE.Vector3(10, 0, 0))!.length).toBeGreaterThan(1);
  const locomotor = new Locomotor(player, { findPath });
  expect(locomotor.goToPoint(new THREE.Vector3(10, 0, 0))).toBe(true);
  for (let i = 0; i < 180; i++) {
    locomotor.update(8, 1 / 60);
    world.step(1 / 60);
    expect(isWalkable(new THREE.Vector3(player.position.x, 0, player.position.z))).toBe(true);
  }
  expect(Math.hypot(player.position.x - 10, player.position.z)).toBeLessThanOrEqual(0.25);
  expect(locomotor.destination).toBeUndefined();
});

it('rejects a blocked or unreachable destination and bounds the search', () => {
  const isWalkable = vi.fn((point: THREE.Vector3) => Math.abs(point.x) < 10 && Math.abs(point.z) < 10
    && !(point.x >= 3 && point.x <= 5));
  expect(findGroundPath(new THREE.Vector3(), new THREE.Vector3(4, 0, 0), { isWalkable })).toBeNull();
  expect(findGroundPath(new THREE.Vector3(), new THREE.Vector3(8, 0, 0), { isWalkable, maxVisited: 100 })).toBeNull();
  const player = body();
  const locomotor = new Locomotor(player, { findPath: () => null });
  player.velocity.set(2, 3, 4);
  expect(locomotor.goToPoint(new THREE.Vector3(8, 0, 0))).toBe(false);
  expect(player.velocity).toEqual(new CANNON.Vec3(0, 3, 0));
});
