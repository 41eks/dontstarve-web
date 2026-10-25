import * as CANNON from 'cannon-es';
import { createEffect, watchSignal } from '../../signals/src';
import { WORLD_SCALE } from '../../prefab/src/tile';
import { getRegisteredPhysicsBodies, PhysicsWorld } from './physicsWorld';
import { COLLISION, type PhysicsJson, type PhysicsState } from './physicsState';

/** Cannon collision group of the world's ground body; declared bodies use their source collision group. */
export const GROUND_COLLISION_GROUP = 2;

/** Keeps one entity's Cannon body in step with its declared `PhysicsState`. */
export interface PhysicsBinding {
  /** The entity's body while it has physics. Its identity survives shape, mass and mask changes. */
  readonly body: CANNON.Body | undefined;
  /** Permanent removal: the body leaves the world and the subscriptions end. */
  dispose(): void;
}

/**
 * The declared capsule as Cannon shapes. A static capsule stands on its ground origin with end caps that let
 * planners read the footprint; a moving one is a circle on the ground plane, so it is one sphere.
 */
function shapeBody(body: CANNON.Body, { capsule, mass }: PhysicsJson): void {
  while (body.shapes.length) body.removeShape(body.shapes[0]);
  const radius = capsule.radius * WORLD_SCALE;
  if (mass > 0) { body.addShape(new CANNON.Sphere(radius)); return; }
  const length = capsule.height * WORLD_SCALE;
  body.addShape(new CANNON.Cylinder(radius, radius, length, 24));
  body.addShape(new CANNON.Sphere(radius), new CANNON.Vec3(0, -length / 2, 0));
  body.addShape(new CANNON.Sphere(radius), new CANNON.Vec3(0, length / 2, 0));
}

/** Physics:SetFriction: one material per world and friction, in contact with every material registered beside it. */
const frictionMaterials = new WeakMap<CANNON.World, Map<number, CANNON.Material>>();
function frictionMaterial(world: CANNON.World, friction: number): CANNON.Material {
  let materials = frictionMaterials.get(world);
  if (!materials) frictionMaterials.set(world, materials = new Map());
  let material = materials.get(friction);
  if (!material) materials.set(friction, material = new CANNON.Material({ friction, restitution: 0 }));
  return material;
}
function contactRegisteredMaterials(world: CANNON.World, material: CANNON.Material): void {
  const others = new Set([world.defaultMaterial, ...getRegisteredPhysicsBodies(world).map(body => body.material)
    .filter((other): other is CANNON.Material => other !== null)]);
  for (const other of others) if (!world.getContactMaterial(material, other)) {
    world.addContactMaterial(new CANNON.ContactMaterial(material, other, { friction: material.friction, restitution: 0 }));
  }
}

/** Translate the source ground bit to the host plane's group; all other source groups retain their bits. */
function collisionBits(bits: number): number {
  return (bits & ~COLLISION.GROUND) | (bits & COLLISION.GROUND ? GROUND_COLLISION_GROUP : 0);
}

/**
 * Subscribes to `physics` and owns the body: created on the first declaration, reshaped in place, registered while
 * active (outside the ticking area too with SetDontRemoveOnSleep) and moved at once on Teleport. A static body
 * leaves the world while its mask is clear and blocks characters while the mask includes CHARACTERS, which is the
 * `collisionResponse` pathfinders and placement read; tile sleep stays with `PhysicsWorld`. A moving body is damped
 * after each step as Physics:SetDamping; its owner still drives velocity and follows the body's position each frame.
 * `ground` is the entity's ground origin, read when the body is placed.
 */
export function bindPhysics(world: CANNON.World, physics: PhysicsState, ground: () => { x: number; y: number; z: number }): PhysicsBinding {
  const cleanups: (() => void)[] = [];
  const json = watchSignal(physics.json, stop => cleanups.push(stop));
  const moved = watchSignal(physics.moved, stop => cleanups.push(stop));
  let body: CANNON.Body | undefined;
  let declared: PhysicsJson | undefined;
  /** The dontRemoveOnSleep the body is registered with; undefined while it is out of the world. */
  let registered: boolean | undefined;

  const damp = () => {
    if (!body || !declared) return;
    const factor = Math.exp(-declared.damping * world.dt);
    body.velocity.x *= factor;
    body.velocity.z *= factor;
  };
  const unregister = () => {
    if (!body || registered === undefined) return;
    world.removeBody(body);
    world.removeEventListener('postStep', damp);
    registered = undefined;
  };
  const register = (dontRemoveOnSleep: boolean) => {
    if (!body || registered === dontRemoveOnSleep) return;
    unregister();
    if (world instanceof PhysicsWorld) world.addBody(body, { dontRemoveOnSleep });
    else world.addBody(body);
    registered = dontRemoveOnSleep;
    if (body.type === CANNON.Body.DYNAMIC) world.addEventListener('postStep', damp);
  };
  const place = () => {
    if (!body || !declared) return;
    const { x, y, z } = ground();
    const lift = declared.mass > 0 ? declared.capsule.radius : declared.capsule.height / 2;
    body.position.set(x, y + lift * WORLD_SCALE, z);
    body.previousPosition.copy(body.position);
    body.interpolatedPosition.copy(body.position);
    body.aabbNeedsUpdate = true;
    if (registered !== undefined && world instanceof PhysicsWorld) world.syncBody(body);
  };
  const apply = (next: PhysicsJson | undefined) => {
    if (!next) { unregister(); body = declared = undefined; return; }
    const previous = declared;
    declared = next;
    const moving = next.mass > 0;
    if (!body) body = new CANNON.Body({ linearDamping: 0 });
    const kind = moving ? CANNON.Body.DYNAMIC : CANNON.Body.STATIC;
    // PhysicsWorld gates static and moving bodies differently, so a body changing kind registers again.
    if (body.type !== kind) unregister();
    if (!previous || previous.capsule !== next.capsule || previous.mass !== next.mass) {
      body.type = kind;
      body.mass = next.mass;
      body.fixedRotation = moving;
      shapeBody(body, next);
      body.updateMassProperties();
      if (!previous || (previous.mass > 0) !== moving || previous.capsule.radius !== next.capsule.radius
        || (!moving && previous.capsule.height !== next.capsule.height)) place();
    }
    body.material = next.friction === undefined ? null : frictionMaterial(world, next.friction);
    body.collisionResponse = moving || (next.mask & COLLISION.CHARACTERS) !== 0;
    body.collisionFilterGroup = collisionBits(next.group);
    body.collisionFilterMask = collisionBits(next.mask);
    if (next.active && (moving || next.mask !== 0)) register(next.dontRemoveOnSleep);
    else unregister();
    if (registered !== undefined && body.material) contactRegisteredMaterials(world, body.material);
  };

  createEffect(() => apply(json.get()));
  // Physics:Teleport moves the body before the next step, like the transform write it follows.
  createEffect(() => { moved.get(); place(); }, true);
  let disposed = false;
  return {
    get body() { return body; },
    dispose() {
      if (disposed) return;
      disposed = true;
      cleanups.splice(0).forEach(stop => stop());
      unregister();
      body = declared = undefined;
    },
  };
}
