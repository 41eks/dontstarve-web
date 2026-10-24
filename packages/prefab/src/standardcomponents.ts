import { COLLISION, type PhysicsState } from '../../componets/src/physicsState';

/** World units per DST unit. */
export { WORLD_SCALE } from './tile';

/** Cannon group of the world's ground body. */
export { GROUND_COLLISION_GROUP } from '../../componets/src/physicsBinding';

/** An entity with a declared inst.Physics; `PrefabInstance` is one. */
export interface PhysicsEntity { readonly physics: PhysicsState }

/**
 * standardcomponents.lua MakeObstaclePhysics(inst, rad, height): declares a static capsule; the entity's
 * `PhysicsBinding` builds and registers the body. `rad` and `height` are in DST units.
 */
export function MakeObstaclePhysics(inst: PhysicsEntity, rad: number, height = 2): PhysicsState {
  const phys = inst.physics;
  phys.SetMass(0);
  phys.SetCollisionGroup(COLLISION.OBSTACLES);
  phys.SetCollisionMask(COLLISION.ITEMS, COLLISION.CHARACTERS, COLLISION.GIANTS);
  phys.SetCapsule(rad, height);
  return phys;
}

/** standardcomponents.lua MakeSmallObstaclePhysics(inst, rad, height): collides with characters but not giants. */
export function MakeSmallObstaclePhysics(inst: PhysicsEntity, rad: number, height = 2): PhysicsState {
  const phys = inst.physics;
  phys.SetMass(0);
  phys.SetCollisionGroup(COLLISION.SMALLOBSTACLES);
  phys.SetCollisionMask(COLLISION.ITEMS, COLLISION.CHARACTERS);
  phys.SetCapsule(rad, height);
  return phys;
}

/** COLLISION masks of a character: SGwilson ToggleOnPhysics and ChangeToCharacterPhysics share it. */
export const CHARACTER_COLLISION_MASK = [COLLISION.WORLD, COLLISION.OBSTACLES, COLLISION.SMALLOBSTACLES, COLLISION.CHARACTERS,
  COLLISION.GIANTS] as const;

/**
 * standardcomponents.lua MakeCharacterPhysics(inst, mass, rad): a moving capsule, a circle on the ground plane.
 * `PhysicsBinding` makes it one sphere and applies the zero friction and SetDamping(5) after each step.
 */
export function MakeCharacterPhysics(inst: PhysicsEntity, mass: number, rad: number): PhysicsState {
  const phys = inst.physics;
  phys.SetMass(mass);
  phys.SetFriction(0);
  phys.SetDamping(5);
  phys.SetCollisionGroup(COLLISION.CHARACTERS);
  phys.SetCollisionMask(...CHARACTER_COLLISION_MASK);
  phys.SetCapsule(rad, 1);
  return phys;
}

/**
 * standardcomponents.lua MakeGhostPhysics(inst, mass, rad), outside a world whose flyers cross barriers: the mask
 * leaves out obstacles, so the binding lets the ghost stand on the ground and pass through everything else.
 */
export function MakeGhostPhysics(inst: PhysicsEntity, mass: number, rad: number): PhysicsState {
  const phys = inst.physics;
  phys.SetMass(mass);
  phys.SetFriction(0);
  phys.SetDamping(5);
  phys.SetCollisionGroup(COLLISION.CHARACTERS);
  phys.SetCollisionMask(COLLISION.WORLD, COLLISION.CHARACTERS, COLLISION.GIANTS);
  phys.SetCapsule(rad, 1);
  return phys;
}

/** standardcomponents.lua MakePondPhysics(inst, rad, height). */
export function MakePondPhysics(inst: PhysicsEntity, rad: number, height = 2): PhysicsState {
  return MakeObstaclePhysics(inst, rad, height);
}

/** standardcomponents.lua RemovePhysicsColliders(inst): a static body keeps its radius but stops colliding. */
export function RemovePhysicsColliders(inst: PhysicsEntity): void {
  const phys = inst.physics;
  if (!phys.json.peek()) return;
  if (phys.GetMass() > 0) phys.SetCollisionMask(COLLISION.GROUND);
  else phys.ClearCollisionMask();
}
