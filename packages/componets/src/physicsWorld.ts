import * as CANNON from 'cannon-es';
import { Vector3 } from 'three';
import { createEffect, watchSignal, type TileStateQuery } from '../../signals/src';
import { TileTracker } from './tileManager';

interface BodyRegistration {
  tracker?: TileTracker;
  dispose(): void;
}

/** Cannon types its World fields as the dense implementation. Adapt its native sparse
 * matrix to that numeric interface; contact history remains keyed by stable body IDs
 * when tile sleep/wake changes Cannon's body indices. */
class ContactMatrix extends CANNON.ArrayCollisionMatrix {
  private readonly contacts = new CANNON.ObjectCollisionMatrix();
  override get(first: CANNON.Body, second: CANNON.Body): number { return this.contacts.get(first, second) ? 1 : 0; }
  override set(first: CANNON.Body, second: CANNON.Body, value: boolean): void { this.contacts.set(first, second, value); }
  override reset(): void { this.contacts.reset(); }
  override setNumObjects(_count: number): void { /* Sparse storage follows contacts, not registered body count. */ }
}

/**
 * Owns the simulation membership of registered bodies. Prefabs retain their bodies and domain state;
 * stationary colliders outside the world's ticking area leave Cannon until their tile wakes again.
 * `bodies` is Cannon's active simulation list; `registeredBodies` also includes dormant colliders for planning.
 */
export class PhysicsWorld extends CANNON.World {
  private readonly registrations = new Map<CANNON.Body, BodyRegistration>();
  private readonly tickingarea?: TileStateQuery;
  private disposed = false;

  constructor(options: ConstructorParameters<typeof CANNON.World>[0] = {}, tickingarea?: TileStateQuery) {
    super(options);
    this.tickingarea = tickingarea;
    this.broadphase = new CANNON.SAPBroadphase(this);
    this.collisionMatrix = new ContactMatrix();
    this.collisionMatrixPrevious = new ContactMatrix();
  }

  get registeredBodies(): Iterable<CANNON.Body> { return this.registrations.keys(); }

  /** `dontRemoveOnSleep` keeps a static body simulated outside the ticking area (Physics:SetDontRemoveOnSleep). */
  override addBody(body: CANNON.Body, options: { dontRemoveOnSleep?: boolean } = {}): void {
    if (this.disposed) throw new Error('Physics world is disposed');
    if (this.registrations.has(body)) return;
    const registration: BodyRegistration = { dispose() {} };
    this.registrations.set(body, registration);
    // Infinite ground and moving bodies keep their existing simulation lifecycle.
    if (options.dontRemoveOnSleep || body.type !== CANNON.Body.STATIC || body.shapes.some(shape => shape instanceof CANNON.Plane)) {
      this.setActive(body, true);
      return;
    }
    const position = new Vector3();
    const tracker = registration.tracker = new TileTracker(() => position.set(body.position.x, body.position.y, body.position.z));
    const area = this.tickingarea?.(tracker.tile);
    if (!area) { this.setActive(body, true); return; }
    const cleanups: (() => void)[] = [];
    const active = watchSignal(area, stop => cleanups.push(stop));
    registration.dispose = () => { cleanups.splice(0).forEach(stop => stop()); area.dispose(); };
    createEffect(() => this.setActive(body, active.get()));
  }

  override removeBody(body: CANNON.Body): void {
    const registration = this.registrations.get(body);
    if (!registration) return;
    this.registrations.delete(body);
    registration.dispose();
    this.setActive(body, false);
  }

  /** Static-body owners call after a teleport or relocation, before the next collision/query. */
  syncBody(body: CANNON.Body): void {
    this.registrations.get(body)?.tracker?.sync();
    body.aabbNeedsUpdate = true;
    this.broadphase.dirty = true;
  }

  private setActive(body: CANNON.Body, active: boolean): void {
    if (active) {
      if (!this.disposed && this.registrations.has(body) && body.world !== this) {
        body.aabbNeedsUpdate = true;
        super.addBody(body);
        this.broadphase.dirty = true;
      }
    } else if (body.world === this) {
      super.removeBody(body);
      this.broadphase.dirty = true;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const body of this.registrations.keys()) this.removeBody(body);
  }
}

/** Logical occupancy/material queries include dormant bodies; native standalone worlds already contain them all. */
export function getRegisteredPhysicsBodies(world: CANNON.World): readonly CANNON.Body[] {
  return world instanceof PhysicsWorld ? [...world.registeredBodies] : world.bodies;
}
