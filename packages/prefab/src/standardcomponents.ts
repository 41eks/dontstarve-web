import * as CANNON from 'cannon-es';
import { WORLD_SCALE } from './tile';

/** World units per DST unit. */
export { WORLD_SCALE } from './tile';

/** standardcomponents.lua MakeCharacterPhysics: phys:SetDamping(5). */
export const CHARACTER_DAMPING = 5;

/**
 * standardcomponents.lua MakeCharacterPhysics(inst, mass, rad). The Lua capsule is a circle
 * on the XZ plane, so the body is one sphere; `rad` is in DST units.
 */
export function MakeCharacterPhysics(mass: number, rad: number): { mass: number; shape: CANNON.Shape; fixedRotation: true } {
  return { mass, shape: new CANNON.Sphere(rad * WORLD_SCALE), fixedRotation: true };
}

/** COLLISION.GROUND: the world's ground body. Characters, obstacles and items keep cannon's default group. */
export const GROUND_COLLISION_GROUP = 2;

/**
 * standardcomponents.lua MakeGhostPhysics: `SetCollisionMask(COLLISION.GROUND)`, so a ghost passes through every
 * obstacle and character but still stands on the ground.
 */
export function MakeGhostPhysics(body: CANNON.Body): void {
  body.collisionFilterMask = GROUND_COLLISION_GROUP;
}

/** standardcomponents.lua MakeCharacterPhysics's collision mask after MakeGhostPhysics: every group again. */
export function MakeCharacterCollision(body: CANNON.Body): void {
  body.collisionFilterMask = -1;
}

/**
 * Apply SetDamping(5) after a physics step. Only the horizontal velocity is damped, since
 * cannon would otherwise also damp gravity; collision impulses fade without moving the
 * body far, while a locomotor that rewrites velocity every frame is unaffected.
 */
export function DampCharacterVelocity(body: CANNON.Body, dt: number): void {
  const factor = Math.exp(-CHARACTER_DAMPING * dt);
  body.velocity.x *= factor;
  body.velocity.z *= factor;
}

/**
 * standardcomponents.lua MakeObstaclePhysics(inst, rad, height): a static capsule standing on
 * its ground origin. `rad` and `height` are in DST units; the end caps are spheres, which
 * also lets planners recognise the obstacle's footprint.
 */
export function MakeObstaclePhysics(position: { x: number; y: number; z: number }, rad: number, height = 2): CANNON.Body {
  const radius = rad * WORLD_SCALE;
  const length = height * WORLD_SCALE;
  const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC,
    position: new CANNON.Vec3(position.x, position.y + length / 2, position.z) });
  body.addShape(new CANNON.Cylinder(radius, radius, length, 24));
  body.addShape(new CANNON.Sphere(radius), new CANNON.Vec3(0, -length / 2, 0));
  body.addShape(new CANNON.Sphere(radius), new CANNON.Vec3(0, length / 2, 0));
  return body;
}
