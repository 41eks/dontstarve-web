import * as THREE from 'three';
import { expect, it } from 'vitest';
import { GroundPathSearch, Pathfinder, PathfindingWall, STATUS_CALCULATING, STATUS_FOUNDPATH, STATUS_NOPATH } from '../../prefab/src/pathfinder';

const point = (x: number, z = 0) => new THREE.Vector3(x, 0, z);
/** Land within 60 of the origin along z, ocean for x beyond 30. */
const map = {
  isPassableAtPoint: ({ x, z }: { x: number; z: number }) => Math.abs(x) < 30 && Math.abs(z) < 60,
  isOceanAtWorld: ({ x, z }: { x: number; z: number }) => x >= 30 && x < 60 && Math.abs(z) < 60,
};
/** A wall line across x = 10, one path tile thick, from z = -30 to 30. */
function walled(pathfinder: Pathfinder, halfSpan = 30) {
  const walls = [];
  for (let z = -halfSpan; z <= halfSpan; z += 3) { const wall = point(10.5, z + .5); pathfinder.AddWall(wall); walls.push(wall); }
  return walls;
}
function finish(pathfinder: Pathfinder, handle: number) {
  for (let i = 0; i < 100 && pathfinder.GetSearchStatus(handle) === STATUS_CALCULATING; i++) pathfinder.update();
  return pathfinder.GetSearchStatus(handle);
}

it('reports a clear line by ground, ocean caps and walls', () => {
  const pathfinder = new Pathfinder(map);
  expect(pathfinder.IsClear(point(0), point(20))).toBe(true);
  expect(pathfinder.IsClear(point(0), point(40))).toBe(false);
  expect(pathfinder.IsClear(point(0), point(40), { allowocean: true })).toBe(true);
  expect(pathfinder.IsClear(point(0), point(20), { allowocean: true, ignoreLand: true })).toBe(false);
  expect(pathfinder.IsClear(point(40), point(50), { allowocean: true, ignoreLand: true })).toBe(true);
  const [wall] = walled(pathfinder, 0);
  expect(pathfinder.IsClear(point(0), point(20))).toBe(false);
  expect(pathfinder.IsClear(point(0), point(20), { ignorewalls: true })).toBe(true);
  // A second wall on the same path tile keeps it blocked until both have gone.
  pathfinder.AddWall(wall); pathfinder.RemoveWall(wall);
  expect(pathfinder.IsClear(point(0), point(20))).toBe(false);
  pathfinder.RemoveWall(wall);
  expect(pathfinder.IsClear(point(0), point(20))).toBe(true);
});

it('searches across updates around a wall, with the start as the first step', () => {
  const pathfinder = new Pathfinder(map);
  walled(pathfinder);
  const from = point(0), to = point(20), handle = pathfinder.SubmitSearch(from, to);
  from.set(99, 0, 99);
  expect(pathfinder.GetSearchStatus(handle)).toBe(STATUS_CALCULATING);
  expect(pathfinder.GetSearchResult(handle)).toBeUndefined();
  pathfinder.update(1);
  expect(pathfinder.GetSearchStatus(handle)).toBe(STATUS_CALCULATING);
  expect(finish(pathfinder, handle)).toBe(STATUS_FOUNDPATH);
  const { steps } = pathfinder.GetSearchResult(handle)!;
  expect(steps.length).toBeGreaterThan(2);
  expect(steps[0].toArray()).toEqual([0, 0, 0]);
  expect(steps.at(-1)!.toArray()).toEqual(to.toArray());
  for (const [index, step] of steps.entries()) {
    if (index) expect(pathfinder.IsClear(steps[index - 1], step)).toBe(true);
  }
  expect(Math.max(...steps.map(step => Math.abs(step.z)))).toBeGreaterThan(30);
});

it('gives a straight line two steps and an unreachable destination no path', () => {
  const pathfinder = new Pathfinder(map);
  const straight = pathfinder.SubmitSearch(point(0), point(20));
  expect(finish(pathfinder, straight)).toBe(STATUS_FOUNDPATH);
  expect(pathfinder.GetSearchResult(straight)!.steps).toHaveLength(2);
  const offLand = pathfinder.SubmitSearch(point(0), point(40));
  expect(finish(pathfinder, offLand)).toBe(STATUS_NOPATH);
  expect(pathfinder.GetSearchResult(offLand)).toBeUndefined();
});

it('shares the budget among searches in order, and a killed handle reads as lost', () => {
  const pathfinder = new Pathfinder(map);
  walled(pathfinder);
  const killed = pathfinder.SubmitSearch(point(0), point(20)), next = pathfinder.SubmitSearch(point(0, 3), point(20, 3));
  pathfinder.update(1);
  pathfinder.KillSearch(killed);
  expect(pathfinder.GetSearchStatus(killed)).toBeUndefined();
  expect(pathfinder.GetSearchResult(killed)).toBeUndefined();
  expect(() => pathfinder.KillSearch(killed)).not.toThrow();
  expect(finish(pathfinder, next)).toBe(STATUS_FOUNDPATH);
  expect(pathfinder.GetPathTileIndexFromPoint(point(-.5, 3))).toEqual([-1, 1]);
});

it('finds the same path in slices as all at once', () => {
  const walls = new Pathfinder(map);
  walled(walls);
  const isWalkable = (position: THREE.Vector3) => walls.IsClear(position, position);
  const search = new GroundPathSearch(point(0), point(20), { cellSize: 3, isWalkable });
  search.advance(Infinity);
  const whole = search.result!;
  const handle = walls.SubmitSearch(point(0), point(20));
  while (walls.GetSearchStatus(handle) === STATUS_CALCULATING) walls.update(7);
  expect(walls.GetSearchResult(handle)!.steps.slice(1).map(step => step.toArray())).toEqual(whole.map(step => step.toArray()));
});

it('stops a search at its limit, and a wall leaves the grid only when it stops being an obstacle', () => {
  const isWalkable = (position: THREE.Vector3) => Math.abs(position.x) < 10 && Math.abs(position.z) < 10 && !(position.x >= 3 && position.x <= 5);
  const limited = new GroundPathSearch(point(0), point(8), { isWalkable, maxVisited: 100 });
  limited.advance(Infinity);
  expect(limited.result).toBeNull();
  const pathfinder = new Pathfinder(map), wall = new PathfindingWall(pathfinder, () => point(10.5));
  wall.set(true); wall.set(true);
  expect(pathfinder.IsClear(point(0), point(20))).toBe(false);
  wall.set(false); wall.set(false);
  expect(pathfinder.IsClear(point(0), point(20))).toBe(true);
});
