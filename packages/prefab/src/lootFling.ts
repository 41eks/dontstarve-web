import * as THREE from 'three';
import { TILE_SIZE } from './tile';

const WORLD_SCALE = TILE_SIZE / 4;

/** lootdropper.lua:FlingItem defaults, in DST world units. */
export const LOOT_FLING = {
  minSpeed: 0, maxSpeed: 2, ySpeed: 8, ySpeedVariance: 4,
  inventoryRadius: 0.5, restitution: 0.5, friction: 0.1,
} as const;

/** A flat-ground trajectory for loot; height never changes its saved foot point. */
export class LootFling {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  height = 0;
  settled = false;
  // Lua delegates gravity to native Physics. Use a short local arc in the same
  // scaled space as the launch velocities, independent of player jump physics.
  private readonly gravity = 30 * WORLD_SCALE;

  constructor(origin: Pick<THREE.Vector3, 'x' | 'z'>, dropperRadius = 0.4, random = Math.random) {
    const angle = random() * Math.PI * 2;
    const speed = (LOOT_FLING.minSpeed + random() * (LOOT_FLING.maxSpeed - LOOT_FLING.minSpeed)) * WORLD_SCALE;
    const ySpeed = (LOOT_FLING.ySpeed + (random() * 2 - 1) * LOOT_FLING.ySpeedVariance) * WORLD_SCALE;
    const dx = Math.cos(angle);
    const dz = -Math.sin(angle);
    // FlingItem starts outside the sum of the item/dropper physics radii.
    const radius = (dropperRadius + LOOT_FLING.inventoryRadius) * WORLD_SCALE;
    this.position = new THREE.Vector3(origin.x + dx * radius, 0, origin.z + dz * radius);
    this.velocity = new THREE.Vector3(dx * speed, ySpeed, dz * speed);
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0 || this.settled) return;
    let remaining = dt;
    while (remaining > 0 && !this.settled) {
      const landingTime = (this.velocity.y + Math.sqrt(this.velocity.y ** 2 + 2 * this.gravity * this.height)) / this.gravity;
      const step = Math.min(remaining, landingTime);
      this.position.x += this.velocity.x * step;
      this.position.z += this.velocity.z * step;
      this.height = Math.max(0, this.height + this.velocity.y * step - 0.5 * this.gravity * step * step);
      this.velocity.y -= this.gravity * step;
      remaining = Math.max(0, remaining - step);
      if (step < landingTime) break;
      this.height = 0;
      this.velocity.y = -this.velocity.y * LOOT_FLING.restitution;
      // Damp horizontal motion at each impact and stop tiny rebounds so loot
      // becomes an ordinary, stable ground item rather than bouncing forever.
      this.velocity.x *= 1 - LOOT_FLING.friction;
      this.velocity.z *= 1 - LOOT_FLING.friction;
      if (this.velocity.y <= 0.5 * WORLD_SCALE + 1e-8) {
        this.velocity.set(0, 0, 0);
        this.settled = true;
      }
    }
  }
}
