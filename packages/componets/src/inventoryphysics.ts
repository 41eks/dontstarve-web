import * as THREE from 'three';
import type { ComponentUpdates, UpdatingComponent } from './componentUpdates';

/** lootdropper.lua:FlingItem defaults, in DST world units. */
export const LOOT_FLING = {
  minSpeed: 0, maxSpeed: 2, ySpeed: 8, ySpeedVariance: 4,
  inventoryRadius: 0.5, restitution: 0.5, friction: 0.1,
} as const;

/** A directed launch such as pigking.lua launchitem, in DST units: `angle` is radians in the scene x/z plane. */
export interface LootLaunch {
  angle: number;
  /** Launched from this height instead of the ground, with no collision-radius offset. */
  height: number;
  speed: { min: number; range: number };
  ySpeed: { min: number; range: number };
}

interface FlightTransform {
  readonly position: { readonly x: number; readonly z: number };
  setPosition(x: number, y: number, z: number): void;
  offsetPosition(dx: number, dy: number, dz: number): void;
}

/** A flat-ground trajectory for loot; height never changes its saved foot point. */
export class LootFling {
  private readonly transform: FlightTransform;
  readonly velocity: THREE.Vector3;
  /** Detached projection; the entity transform owns the trajectory's ground position. */
  get position(): THREE.Vector3 { return new THREE.Vector3(this.transform.position.x, 0, this.transform.position.z); }
  height = 0;
  settled = false;
  // Lua delegates gravity to native Physics. Use a short local arc in the same
  // scaled space as the launch velocities, independent of player jump physics.
  private readonly gravity: number;
  private readonly unitScale: number;

  /** `unitScale` converts DST units to scene units. */
  constructor(transform: FlightTransform, dropperRadius = 0.4, random = Math.random, launch?: LootLaunch, unitScale = 1) {
    this.transform = transform;
    this.unitScale = unitScale;
    this.gravity = 30 * unitScale;
    if (launch) {
      const speed = (launch.speed.min + random() * launch.speed.range) * unitScale;
      this.height = launch.height * unitScale;
      this.velocity = new THREE.Vector3(Math.cos(launch.angle) * speed,
        (launch.ySpeed.min + random() * launch.ySpeed.range) * unitScale, Math.sin(launch.angle) * speed);
      return;
    }
    const angle = random() * Math.PI * 2;
    const speed = (LOOT_FLING.minSpeed + random() * (LOOT_FLING.maxSpeed - LOOT_FLING.minSpeed)) * unitScale;
    const ySpeed = (LOOT_FLING.ySpeed + (random() * 2 - 1) * LOOT_FLING.ySpeedVariance) * unitScale;
    const dx = Math.cos(angle);
    const dz = -Math.sin(angle);
    // FlingItem starts outside the sum of the item/dropper physics radii.
    const radius = (dropperRadius + LOOT_FLING.inventoryRadius) * unitScale;
    transform.setPosition(transform.position.x + dx * radius, 0, transform.position.z + dz * radius);
    this.velocity = new THREE.Vector3(dx * speed, ySpeed, dz * speed);
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0 || this.settled) { return; }
    let remaining = dt;
    while (remaining > 0 && !this.settled) {
      const landingTime = (this.velocity.y + Math.sqrt(this.velocity.y ** 2 + 2 * this.gravity * this.height)) / this.gravity;
      const step = Math.min(remaining, landingTime);
      this.transform.offsetPosition(this.velocity.x * step, 0, this.velocity.z * step);
      this.height = Math.max(0, this.height + this.velocity.y * step - 0.5 * this.gravity * step * step);
      this.velocity.y -= this.gravity * step;
      remaining = Math.max(0, remaining - step);
      if (step < landingTime) { break; }
      this.height = 0;
      this.velocity.y = -this.velocity.y * LOOT_FLING.restitution;
      // Damp horizontal motion at each impact and stop tiny rebounds so loot
      // becomes an ordinary, stable ground item rather than bouncing forever.
      this.velocity.x *= 1 - LOOT_FLING.friction;
      this.velocity.z *= 1 - LOOT_FLING.friction;
      if (this.velocity.y <= 0.5 * this.unitScale + 1e-8) {
        this.velocity.set(0, 0, 0);
        this.settled = true;
      }
    }
  }
}

export interface InventoryPhysicsInst {
  readonly transform: FlightTransform;
  readonly isRemoved: boolean;
  /** A body put into an inventory mid-flight stops there. */
  readonly inlimbo?: boolean;
  /** The sprite is drawn this high above the inst's ground position while it flies. */
  readonly sprite: { setVisualHeight(height: number): void };
  PushEvent(name: string, data?: unknown): void;
}

/**
 * MakeInventoryPhysics as the items' flights use it: lootdropper FlingItem, inventory DropItem's random direction and
 * LaunchAt give the body a velocity, and it flies until it rests on the ground (`on_landed`). Only a flying body is
 * visited each frame.
 */
export class InventoryPhysics implements UpdatingComponent {
  private readonly inst: InventoryPhysicsInst;
  private readonly updates: ComponentUpdates;
  private readonly unitScale: number;
  private flight?: LootFling;
  private stopUpdating?: () => void;

  constructor(inst: InventoryPhysicsInst, updates: ComponentUpdates, unitScale: number) {
    this.inst = inst; this.updates = updates; this.unitScale = unitScale;
  }

  get flying(): boolean { return this.flight !== undefined; }

  /** FlingItem from the inst's position when `launch` is absent, else the launch's exact flight. */
  Launch(launch?: LootLaunch, dropperRadius?: number, random = Math.random): void {
    if (this.inst.isRemoved) { return; }
    this.flight = new LootFling(this.inst.transform, dropperRadius, random, launch, this.unitScale);
    this.inst.sprite.setVisualHeight(this.flight.height);
    this.stopUpdating ??= this.updates.register(this);
  }

  OnUpdate(dt: number): void {
    const flight = this.flight;
    if (!flight || this.inst.isRemoved || this.inst.inlimbo) { this.Stop(); return; }
    flight.update(dt);
    this.inst.sprite.setVisualHeight(flight.height);
    if (flight.settled) {
      this.Stop();
      this.inst.PushEvent('on_landed');
    }
  }

  /** The body rests where it is, as when it is picked up mid-flight. */
  Stop(): void {
    this.stopUpdating?.(); this.stopUpdating = undefined;
    if (!this.flight) { return; }
    this.flight = undefined;
    this.inst.sprite.setVisualHeight(0);
  }
}
