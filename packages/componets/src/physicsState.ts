import { createSignal, readonlySignal, type ReadonlySignal } from '../../signals/src';

/** constants.lua COLLISION. Groups and masks are recorded as declared; `PhysicsBinding` reads only the bits it documents. */
export const COLLISION = {
  GROUND: 32,
  BOAT_LIMITS: 64,
  LAND_OCEAN_LIMITS: 128,
  LIMITS: 128 + 64,
  WORLD: 128 + 64 + 32,
  ITEMS: 256,
  OBSTACLES: 512,
  CHARACTERS: 1024,
  FLYERS: 2048,
  SANITY: 4096,
  SMALLOBSTACLES: 8192,
  GIANTS: 16384,
} as const;

/** inst.Physics as data. Sizes are in DST units; the binding scales them to the world. */
export interface PhysicsJson {
  /** Physics:SetCapsule(rad, height). */
  readonly capsule: { readonly radius: number; readonly height: number };
  /** Physics:SetMass; 0 is static. */
  readonly mass: number;
  /** Physics:SetFriction; undefined keeps the world's default contact. */
  readonly friction?: number;
  /** Physics:SetDamping: horizontal velocity decay per second of a moving body. */
  readonly damping: number;
  readonly group: number;
  /** Physics:SetCollisionMask / ClearCollisionMask (0). */
  readonly mask: number;
  /** Physics:SetActive. */
  readonly active: boolean;
  /** Physics:SetDontRemoveOnSleep: the body keeps colliding while its tile is not ticking. */
  readonly dontRemoveOnSleep: boolean;
}

const DEFAULTS: PhysicsJson = { capsule: { radius: 0, height: 0 }, mass: 0, damping: 0, group: 0, mask: 0, active: true, dontRemoveOnSleep: false };

/**
 * inst.Physics: the entity only declares its collider here. A `PhysicsBinding` subscribes to `json` and keeps
 * the Cannon body; `json` is undefined until the first Make*Physics, as `inst.Physics` is nil in Lua.
 */
export class PhysicsState {
  private readonly state = createSignal<PhysicsJson | undefined>(undefined);
  private readonly teleports = createSignal(0);
  readonly json: ReadonlySignal<PhysicsJson | undefined> = readonlySignal(this.state);
  /** Counts Physics:Teleport calls; the position itself is the entity's transform, not a signal. */
  readonly moved: ReadonlySignal<number> = readonlySignal(this.teleports);

  private write(change: Partial<PhysicsJson>): void {
    this.state.set({ ...this.state.peek() ?? DEFAULTS, ...change });
  }

  SetCapsule(radius: number, height = 2): void { this.write({ capsule: { radius, height } }); }
  SetMass(mass: number): void { this.write({ mass }); }
  SetFriction(friction: number): void { this.write({ friction }); }
  SetDamping(damping: number): void { this.write({ damping }); }
  SetCollisionGroup(group: number): void { this.write({ group }); }
  SetCollisionMask(...groups: number[]): void { this.write({ mask: groups.reduce((mask, group) => mask | group, 0) }); }
  ClearCollisionMask(): void { this.write({ mask: 0 }); }
  SetActive(active: boolean): void { if (this.state.peek()?.active !== active) this.write({ active }); }
  IsActive(): boolean { return this.state.peek()?.active ?? false; }
  SetDontRemoveOnSleep(dontRemoveOnSleep: boolean): void { this.write({ dontRemoveOnSleep }); }
  GetMass(): number { return this.state.peek()?.mass ?? 0; }
  /** Physics:GetRadius, in DST units; undefined without physics. */
  GetRadius(): number | undefined { return this.state.peek()?.capsule.radius; }
  /** Physics:Teleport: the caller has already moved the entity's transform; the binding moves the body at once. */
  Teleport(): void { this.teleports.set(this.teleports.peek() + 1); }
}
