import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { Locomotor, staticObstacleTest } from '../../prefab/src/locomotor';
import { LocoMotor } from '../../componets/src/locomotor';
import { Pathfinder, STATUS_CALCULATING } from '../../prefab/src/pathfinder';

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

const land = { isPassableAtPoint: ({ x, z }: { x: number; z: number }) => Math.abs(x) <= 45 && Math.abs(z) <= 45, isOceanAtWorld: () => false };
const passable = (x: number, z: number) => land.isPassableAtPoint({ x, z });
/** A wall line across x = 12, from z = -15 to 15. */
function wallLine(pathfinder: Pathfinder) {
  for (let z = -15; z <= 15; z += 3) pathfinder.AddWall(new THREE.Vector3(13.5, 0, z + 1.5));
}
function walk(locomotor: Locomotor, world: CANNON.World, pathfinder: Pathfinder, seconds: number, each?: () => void) {
  for (let i = 0; i < seconds * 60 && locomotor.destination; i++) {
    pathfinder.update();
    locomotor.update(8, 1 / 60);
    world.step(1 / 60);
    each?.();
  }
}

it('heads for the point while it searches, then follows the path around a wall to the destination', () => {
  const player = body();
  const world = new CANNON.World();
  world.addBody(player);
  const pathfinder = new Pathfinder(land);
  wallLine(pathfinder);
  const locomotor = new Locomotor(player, { pathfinder, physicsRadius: .5 });
  const target = new THREE.Vector3(24, 0, 0);
  expect(locomotor.goToPoint(target)).toBe(true);
  expect(locomotor.destination!.toArray()).toEqual(target.toArray());
  // FindPath's search has not run yet: Lua keeps moving towards the destination meanwhile.
  locomotor.update(8, 1 / 60);
  expect(player.velocity.x).toBeCloseTo(8);
  let widest = 0;
  walk(locomotor, world, pathfinder, 30, () => { widest = Math.max(widest, Math.abs(player.position.z)); });
  expect(locomotor.destination).toBeUndefined();
  expect(Math.hypot(player.position.x - 24, player.position.z)).toBeLessThanOrEqual(.25);
  expect(widest).toBeGreaterThan(15);
});

it('searches only without a clear line and for a new path tile, and kills the search when it stops', () => {
  const player = body();
  const pathfinder = new Pathfinder(land);
  const submit = vi.spyOn(pathfinder, 'SubmitSearch'), kill = vi.spyOn(pathfinder, 'KillSearch');
  const locomotor = new Locomotor(player, { pathfinder });
  locomotor.goToPoint(new THREE.Vector3(24, 0, 0));
  expect(submit).not.toHaveBeenCalled();
  locomotor.stop();
  wallLine(pathfinder);
  locomotor.goToPoint(new THREE.Vector3(24, 0, 0));
  expect(submit).toHaveBeenCalledOnce();
  const handle = submit.mock.results[0].value as number;
  expect(pathfinder.GetSearchStatus(handle)).toBe(STATUS_CALCULATING);
  // Same path tile: the search in hand stands for the new point too.
  locomotor.goToPoint(new THREE.Vector3(24.5, 0, 0));
  expect(submit).toHaveBeenCalledOnce();
  expect(locomotor.destination!.x).toBe(24.5);
  locomotor.stop();
  expect(kill).toHaveBeenCalledWith(handle);
  expect(pathfinder.GetSearchStatus(handle)).toBeUndefined();
});

it('refuses a point off the ground, walks straight when no path exists, and stops at the shore', () => {
  const player = body();
  const world = new CANNON.World();
  world.addBody(player);
  const pathfinder = new Pathfinder(land);
  const locomotor = new Locomotor(player, { pathfinder, isPassable: passable });
  player.velocity.set(2, 3, 4);
  expect(locomotor.goToPoint(new THREE.Vector3(60, 0, 0))).toBe(false);
  expect(player.velocity).toEqual(new CANNON.Vec3(0, 3, 0));
  // Land cut off by water on every side has no path; locomotor.lua keeps heading straight for it.
  const isle = new Pathfinder({ isPassableAtPoint: ({ x, z }) => land.isPassableAtPoint({ x, z }) && !(x >= 12 && x <= 18), isOceanAtWorld: () => false });
  const cutOff = new Locomotor(player, { pathfinder: isle, isPassable: (x, z) => isle.IsClear({ x, y: 0, z }, { x, y: 0, z }) });
  player.position.set(0, player.position.y, 0);
  expect(cutOff.goToPoint(new THREE.Vector3(24, 0, 0))).toBe(true);
  walk(cutOff, world, isle, 30);
  expect(cutOff.destination).toBeUndefined();
  expect(player.position.x).toBeGreaterThan(9);
  expect(player.position.x).toBeLessThan(12);
  expect(Math.abs(player.position.z)).toBeLessThan(.01);
});

it('moves a creature around a wall through the same search, and holds it at the ocean when no path exists', () => {
  const pathfinder = new Pathfinder(land);
  wallLine(pathfinder);
  const position = { x: 0, y: 0, z: 0 };
  let heading = 0, speed = 0;
  const inst = { isValid: () => true, getPosition: () => position, getPhysicsRadius: () => .5, components: {}, PushEvent() {}, PushBufferedAction() {},
    setRotation: (degrees: number) => { heading = degrees; }, setMotorSpeed: (value: number) => { speed = value; },
    getAngleToPoint: (x: number, _y: number, z: number) => Math.atan2(position.z - z, x - position.x) * 180 / Math.PI };
  const motor = new LocoMotor(inst, { arriveDistance: .45, pathfinder });
  motor.walkspeed = 8;
  motor.GoToPoint({ x: 24, y: 0, z: 0 });
  expect(motor.HasDestination()).toBe(true);
  let widest = 0;
  for (let i = 0; i < 1800 && motor.HasDestination(); i++) {
    pathfinder.update();
    motor.update(1 / 60);
    // WalkForward's motor: forward is (cos, -sin), as the stategraph would run it.
    const radians = heading * Math.PI / 180;
    speed = 8;
    position.x += Math.cos(radians) * speed / 60; position.z -= Math.sin(radians) * speed / 60;
    widest = Math.max(widest, Math.abs(position.z));
  }
  expect(motor.HasDestination()).toBe(false);
  expect(Math.hypot(position.x - 24, position.z)).toBeLessThanOrEqual(.45 + 8 / 60);
  expect(widest).toBeGreaterThan(15);

  const moving = { hasStateTag: (tag: string) => tag === 'moving' || tag === 'canrotate' };
  position.x = 44.7; position.z = 0;
  const shore = new LocoMotor({ ...inst, sg: moving }, { arriveDistance: .45, pathfinder });
  shore.walkspeed = 8;
  shore.GoToPoint({ x: 60, y: 0, z: 0 });
  pathfinder.update(Infinity);
  shore.update(1 / 60);
  expect(speed).toBe(0);
  expect(shore.HasDestination()).toBe(true);
});

it('tests ground points against nearby static colliders, following a relocated body', () => {
  const wall = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(1, 1, 1)), position: new CANNON.Vec3(10, 0, 0) });
  const ghost = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(1, 1, 1)), position: new CANNON.Vec3(-10, 0, 0) });
  ghost.collisionResponse = false;
  const mover = body(); mover.position.set(0, 0, 10);
  const blocked = staticObstacleTest([wall, ghost, mover], .5);
  expect(blocked(new THREE.Vector3(11.4, 0, 0))).toBe(true);
  expect(blocked(new THREE.Vector3(11.6, 0, 0))).toBe(false);
  expect(blocked(new THREE.Vector3(-10, 0, 0))).toBe(false);
  expect(blocked(new THREE.Vector3(0, 0, 10))).toBe(false);
  // A relocation flags the cached AABB; an untouched body keeps it.
  wall.position.set(-20, 0, 0); wall.aabbNeedsUpdate = true;
  const moved = staticObstacleTest([wall], .5);
  expect(moved(new THREE.Vector3(10, 0, 0))).toBe(false);
  expect(moved(new THREE.Vector3(-20, 0, 0))).toBe(true);
});

it('PushAction walks to an obstacle-centred target, buffers it within ARRIVE_STEP plus both radii and fails when replaced', () => {
  const player = body();
  const world = new CANNON.World();
  world.addBody(player);
  const obstacle = new THREE.Vector3(10, 0, 0);
  // The obstacle's own path tile is a wall, so its search finds no path and the body heads straight for it.
  const pathfinder = new Pathfinder(land);
  pathfinder.AddWall(obstacle);
  const locomotor = new Locomotor(player, { pathfinder, physicsRadius: 1.5 });
  const arrive = vi.fn(), fail = vi.fn();
  const action = { target: { getPosition: () => obstacle, getPhysicsRadius: () => 1 }, isValid: () => true };
  locomotor.PushAction(action, arrive, fail);
  expect(locomotor.bufferedAction).toBe(action);
  expect(locomotor.destination!.toArray()).toEqual(obstacle.toArray());
  for (let i = 0; i < 120 && !arrive.mock.calls.length; i++) { pathfinder.update(); locomotor.update(16, 1 / 60); world.step(1 / 60); }
  expect(arrive).toHaveBeenCalledOnce();
  // ARRIVE_STEP (.15 * WORLD_SCALE) + 1 + 1.5.
  expect(player.position.distanceTo(new CANNON.Vec3(10, player.position.y, 0))).toBeLessThanOrEqual(.45 + 2.5);
  expect(locomotor.bufferedAction).toBeUndefined();
  expect(fail).not.toHaveBeenCalled();
  player.position.set(-10, player.position.y, 0);
  locomotor.PushAction(action, arrive, fail);
  expect(locomotor.goToPoint(new THREE.Vector3(-5, 0, 0))).toBe(true);
  expect(fail).toHaveBeenCalledOnce();
  expect(arrive).toHaveBeenCalledOnce();
});
