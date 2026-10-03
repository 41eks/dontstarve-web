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

it('replaces an old destination and slows the final step instead of overshooting', () => {
  const player = body();
  const locomotor = new Locomotor(player);
  locomotor.goToPoint(new THREE.Vector3(100, 0, 0));
  locomotor.goToPoint(new THREE.Vector3(0, 0, -1));
  locomotor.update(16, 0.5);
  expect(player.velocity.x).toBe(0);
  expect(player.velocity.z).toBe(-2);
  expect(locomotor.destination).toEqual(new THREE.Vector3(0, 0, -1));
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

it('accepts ground left-clicks after interactions and ignores other buttons and missing ground', () => {
  vi.stubGlobal('window', new EventTarget());
  const canvas = new EventTarget();
  const context = {
    camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(), renderer: { domElement: canvas },
  } as unknown as WorldContext;
  const locomotor = new Locomotor(body());
  const track = vi.spyOn(PointerRaycaster.prototype, 'trackPointer').mockImplementation(() => {});
  const hit = vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockReturnValue(new THREE.Vector3(8, 0, 6));
  let handled = false;
  canvas.addEventListener('pointerdown', (event) => { if (handled) event.preventDefault(); });
  const dispose = setupLocomotorInput(context, locomotor);
  const click = (button: number) => canvas.dispatchEvent(Object.assign(new Event('pointerdown', { cancelable: true }), { button }));
  click(0);
  expect(locomotor.destination).toEqual(new THREE.Vector3(8, 0, 6));
  click(2);
  expect(track).toHaveBeenCalledTimes(1);
  handled = true;
  click(0);
  expect(locomotor.destination).toBeUndefined();
  expect(track).toHaveBeenCalledTimes(1);
  handled = false;
  hit.mockReturnValue(undefined);
  click(0);
  expect(locomotor.destination).toBeUndefined();
  dispose();
  hit.mockReturnValue(new THREE.Vector3(5, 0, 5));
  click(0);
  expect(locomotor.destination).toBeUndefined();
});
