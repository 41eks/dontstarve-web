import { readFile } from 'node:fs/promises';
import * as CANNON from 'cannon-es';
import { Vector3 } from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { bindPhysics, GROUND_COLLISION_GROUP } from '../../componets/src/physicsBinding';
import { COLLISION, PhysicsState } from '../../componets/src/physicsState';
import { CHARACTER_COLLISION_MASK, MakeCharacterPhysics, MakeGhostPhysics, WORLD_SCALE } from '../../prefab/src/standardcomponents';
import { createWilsonPlayerPrefab, PLAYER_PHYSICS_RADIUS } from '../../prefab/src/player';
import { prefabInstance } from '../../prefab/src/prefabInstance';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));
afterEach(() => { vi.unstubAllGlobals(); });

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

it('binds a moving character: frictionless damped sphere, ghost and toggled masks, teleport and release on one body', async () => {
  const world = new CANNON.World();
  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: new CANNON.Material('ground') });
  ground.collisionFilterGroup = GROUND_COLLISION_GROUP;
  world.addBody(ground);
  const entity = { physics: new PhysicsState() }, position = new Vector3(3, 0, -6);
  MakeCharacterPhysics(entity, 75, .5);
  const binding = bindPhysics(world, entity.physics, () => position);
  // The body exists as soon as it is bound, standing its radius above the ground origin.
  const body = binding.body!;
  expect(world.bodies).toContain(body);
  expect(body.type).toBe(CANNON.Body.DYNAMIC);
  expect(body.mass).toBe(75);
  expect(body.shapes).toEqual([expect.objectContaining({ radius: .5 * WORLD_SCALE })]);
  expect(body.position.toArray()).toEqual([3, .5 * WORLD_SCALE, -6]);
  expect(body.collisionFilterMask).toBe((CHARACTER_COLLISION_MASK.reduce((mask, group) => mask | group, 0) & ~COLLISION.GROUND) | GROUND_COLLISION_GROUP);
  // SetFriction(0) against the ground already registered.
  expect(world.getContactMaterial(body.material!, ground.material!)?.friction).toBe(0);

  // SetDamping(5) after each step, horizontal only.
  body.velocity.set(10, 0, 0);
  world.step(1 / 60);
  expect(body.velocity.x).toBeCloseTo(10 * Math.exp(-5 / 60));

  // Physics:Teleport moves the body before the next step.
  position.set(-9, 0, 12);
  entity.physics.Teleport();
  expect([body.position.x, body.position.z]).toEqual([-9, 12]);

  // MakeGhostPhysics excludes obstacles while retaining world, characters and giants.
  MakeGhostPhysics(entity, 1, .5);
  await settle();
  expect(binding.body).toBe(body);
  expect(body.mass).toBe(1);
  expect(body.collisionFilterMask).toBe((COLLISION.WORLD & ~COLLISION.GROUND) | GROUND_COLLISION_GROUP | COLLISION.CHARACTERS | COLLISION.GIANTS);
  expect([body.position.x, body.position.z]).toEqual([-9, 12]);
  MakeCharacterPhysics(entity, 75, .5);
  await settle();
  expect(body.collisionFilterMask).toBe((CHARACTER_COLLISION_MASK.reduce((mask, group) => mask | group, 0) & ~COLLISION.GROUND) | GROUND_COLLISION_GROUP);
  // SGwilson ToggleOffPhysics / ToggleOnPhysics.
  entity.physics.SetCollisionMask(COLLISION.GROUND);
  await settle();
  expect(body.collisionFilterMask).toBe(GROUND_COLLISION_GROUP);
  entity.physics.SetCollisionMask(...CHARACTER_COLLISION_MASK);
  await settle();
  expect(body.collisionFilterMask).toBe((CHARACTER_COLLISION_MASK.reduce((mask, group) => mask | group, 0) & ~COLLISION.GROUND) | GROUND_COLLISION_GROUP);

  binding.dispose();
  expect(world.bodies).toEqual([ground]);
  body.velocity.set(10, 0, 0);
  world.step(1 / 60);
  expect(body.velocity.x).toBe(10);
});

it('makes the player an entity whose instance owns its tags and collider, while the scene keeps the body binding', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const world = new CANNON.World();
  const { model, physics, physicsBinding, body } = await createWilsonPlayerPrefab('/dst/data/anim', world);
  const instance = prefabInstance(model)!;
  expect(instance.prefab).toBe('wortox');
  expect(instance.hasTag('player')).toBe(true);
  expect(prefabInstance(model)!.listTags()).toContain('player');
  // player_common.lua MakeCharacterPhysics(inst, 75, .5) is the instance's collider.
  expect(physics).toBe(instance.physics);
  expect(instance.getPhysicsRadius(0)).toBe(PLAYER_PHYSICS_RADIUS * WORLD_SCALE);
  expect(world.bodies).toContain(body);
  // Scene teardown releases the body before its world; the player entity and its model stay.
  physicsBinding.dispose();
  expect(world.bodies).not.toContain(body);
  expect(instance.status.peek()).toBe('active');
});
