import { createSignal } from '@dontstarve-web/signals';
import { PhysicsWorld } from '../../componets/src/physicsWorld';
import { DisposeTileStates, GetTileStateAtPoint } from '../../componets/src/tileManager';
import { useTestTileMap } from './tileMapFixture';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WallsPlacement } from '../../prefab/src/walls';
import { WALL_PHYSICS_RADIUS } from '../../prefab/src/wallPlacement';
import type { WorldContext } from '../../prefab/src/worldContext';
import type { Health } from '../../componets/src/health';

useTestTileMap();

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => {
    const file = String(url).split('dst/data/')[1];
    return new Response(await readFile(new URL(`../../../public/dst/data/${file}`, import.meta.url)));
  });
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

function setup(physics: CANNON.World = new CANNON.World()) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 12, 40); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const world = { physics, scene: new THREE.Scene(), camera, cameraFacing: createSignal(8), cameraHeading: createSignal(45), ground: new THREE.Group(), player: new THREE.Group(),
    renderer: { domElement: new EventTarget() }, createCursorLabel: () => ({ show() {}, hide() {}, update() {} }),
  } as unknown as WorldContext;
  return { physics, placement: new WallsPlacement(world, () => false) };
}

const healthOf = (placement: WallsPlacement, index: number) =>
  (placement.combatTargets[index].inst.components as { health: Health }).health;
const wallBodies = (physics: CANNON.World) => physics.bodies.filter(body => body.type === CANNON.Body.STATIC);

it('blocks with a static obstacle at the foot point only while the wall has health', async () => {
  const { physics, placement } = setup();
  try {
    await placement.spawnFromSave('wall_stone', { id: 'wall', transform: { position: [3, 0, -6], rotationY: 0 },
      components: { health: { current: 100, maximum: 400 } } });
    await new Promise(resolve => setTimeout(resolve, 0));
    const [body] = wallBodies(physics);
    // walls.lua MakeObstaclePhysics(inst, .5) on the ground origin
    expect(body.position.x).toBe(3);
    expect(body.position.z).toBe(-6);
    expect(body.shapes.some(shape => shape instanceof CANNON.Sphere && shape.radius === WALL_PHYSICS_RADIUS)).toBe(true);

    healthOf(placement, 0).DoDelta(-100); // to zero: clearobstacle
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(wallBodies(physics)).toHaveLength(0);
    healthOf(placement, 0).DoDelta(-1); // already broken stays clear
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(wallBodies(physics)).toHaveLength(0);
    healthOf(placement, 0).DoDelta(50); // repaired: makeobstacle again
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(wallBodies(physics)).toEqual([body]);
  } finally { placement.dispose(); }
  expect(wallBodies(physics)).toHaveLength(0);
});

it('restores a saved broken wall without an obstacle and releases the obstacle when hammered out', async () => {
  const { physics, placement } = setup();
  try {
    await placement.spawnFromSave('wall_stone', { id: 'broken', transform: { position: [3, 0, -6], rotationY: 0 },
      components: { health: { current: 0, maximum: 400 } } });
    await placement.spawnFromSave('wall_stone', { id: 'live', transform: { position: [7, 0, -6], rotationY: 0 },
      components: { health: { current: 200, maximum: 400 } } });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(wallBodies(physics).map(body => body.position.x)).toEqual([7]);
    placement.hammerTargets.find(target => target.id === 'live')!.playHit();
    placement.hammerTargets.find(target => target.id === 'live')!.playHit();
    placement.hammerTargets.find(target => target.id === 'live')!.playHit();
    expect(wallBodies(physics)).toHaveLength(0);
  } finally { placement.dispose(); }
});

it('keeps a wall colliding outside the ticking area (SetDontRemoveOnSleep) while health decides SetActive', async () => {
  const position = createSignal<THREE.Vector3 | undefined>(new THREE.Vector3());
  const physics = new PhysicsWorld({}, GetTileStateAtPoint(position));
  const { placement } = setup(physics);
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    // A pen far from the player still holds what it encloses.
    await placement.spawnFromSave('wall_stone', { id: 'dormant-wall', transform: { position: [240, 0, 0], rotationY: 0 },
      components: { health: { current: 100, maximum: 400 } } });
    await settle();
    const [body] = [...physics.registeredBodies];
    expect(physics.bodies).toEqual([body]);
    healthOf(placement, 0).DoDelta(-100);
    position.set(new THREE.Vector3(240, 0, 0)); await settle();
    expect(physics.bodies).toEqual([]);
    expect([...physics.registeredBodies]).toEqual([]);
    healthOf(placement, 0).DoDelta(50);
    position.set(new THREE.Vector3()); await settle();
    expect(physics.bodies).toEqual([body]);
    placement.dispose();
    position.set(new THREE.Vector3(240, 0, 0)); await settle();
    expect(physics.bodies).toEqual([]);
    expect([...physics.registeredBodies]).toEqual([]);
  } finally { placement.dispose(); physics.dispose(); DisposeTileStates(position); }
});
