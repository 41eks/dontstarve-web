import * as CANNON from 'cannon-es';
import { Vector3 } from 'three';
import { expect, it } from 'vitest';
import { createSignal } from '../../signals/src';
import { PhysicsWorld, getRegisteredPhysicsBodies } from '../../componets/src/physicsWorld';
import { DisposeTileStates, GetTileStateAtPoint } from '../../componets/src/tileManager';
import { useTestTileMap } from './tileMapFixture';

useTestTileMap();
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const obstacle = (x: number) => new CANNON.Body({ mass: 0, shape: new CANNON.Sphere(1), position: new CANNON.Vec3(x, 0, 0) });

it('simulates active tiles while retaining dormant collision data, waking the same bodies and releasing removed registrations', async () => {
  const position = createSignal<Vector3 | undefined>(new Vector3());
  const world = new PhysicsWorld({}, GetTileStateAtPoint(position));
  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
  const player = new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(.5) });
  const edge = obstacle(120), next = obstacle(132);
  const shapes = [...edge.shapes];
  try {
    world.addBody(ground); world.addBody(player); world.addBody(edge); world.addBody(next);
    for (let i = 0; i < 1000; i++) world.addBody(obstacle(200 + i / 10));
    expect(world.bodies).toEqual([ground, player, edge]);
    expect(getRegisteredPhysicsBodies(world)).toHaveLength(1004);
    expect(next.world).toBeNull();
    world.step(1 / 60);
    expect(world.collisionMatrix.matrix).toHaveLength(0);
    expect(world.collisionMatrixPrevious.matrix).toHaveLength(0);

    position.set(new Vector3(252, 0, 0)); await settle();
    expect(world.bodies).not.toContain(edge);
    expect(world.bodies).toContain(next);
    expect(world.bodies).toContain(ground);
    expect(world.bodies).toContain(player);
    expect(edge.shapes).toEqual(shapes);
    expect(edge.position.x).toBe(120);

    position.set(new Vector3()); await settle();
    expect(world.bodies).toContain(edge);
    world.removeBody(next); // Permanent removal of a dormant body must stop its tile subscription.
    position.set(new Vector3(252, 0, 0)); await settle();
    expect(world.bodies).not.toContain(next);
    expect(getRegisteredPhysicsBodies(world)).not.toContain(next);
    edge.position.x = 252; world.syncBody(edge); await settle();
    expect(world.bodies).toContain(edge);
    world.dispose();
    position.set(new Vector3()); await settle();
    expect(world.bodies).toEqual([]);
    expect(getRegisteredPhysicsBodies(world)).toEqual([]);
  } finally { world.dispose(); DisposeTileStates(position); }
});

it('retains collision-start history by body ID when removing a body reindexes ongoing contacts', () => {
  const world = new PhysicsWorld();
  const far = obstacle(100), near = obstacle(0);
  const player = new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(1), position: new CANNON.Vec3(1.5, 0, 0) });
  let collisions = 0;
  player.addEventListener('collide', () => collisions++);
  try {
    world.addBody(far); world.addBody(near); world.addBody(player);
    world.step(1 / 60);
    expect(collisions).toBe(1);
    world.removeBody(far);
    player.position.set(1.5, 0, 0); player.velocity.setZero(); player.aabbNeedsUpdate = true;
    world.step(1 / 60);
    expect(world.contacts.some(contact => contact.bi === near || contact.bj === near)).toBe(true);
    expect(collisions).toBe(1);
    const native = new CANNON.World(); native.addBody(far);
    expect(getRegisteredPhysicsBodies(native)).toEqual([far]);
    native.removeBody(far);
  } finally { world.dispose(); }
});
