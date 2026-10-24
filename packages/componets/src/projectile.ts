import { Vector3 } from 'three';
import type { CombatActor, CombatInst } from './combat';
import type { Weapon } from './weapon';

const STUCKCHECK_TIME_TO_BE_STUCK = 1;
/** If a projectile is this close (2D, squared) to a non-moving target and cannot reach it, it is stuck. */
const STUCKCHECK_2D_DIST_TO_NONMOVING_TARGET = 4 * 4;

export interface ProjectileTarget extends CombatInst {
  readonly isRemoved?: boolean;
  getPosition(): Vector3;
  getPhysicsRadius(): number;
  PushEvent?(name: string, data: unknown): void;
}

/** The weapon inst that launched the projectile. */
export interface ProjectileOwner {
  readonly isRemoved?: boolean;
  readonly components: { weapon?: Weapon; inventoryitem?: { readonly owner: unknown | null } };
}

/**
 * components/projectile.lua for homing projectiles: Throw, per-frame OnUpdate with hit/miss/stuck tests,
 * Hit → combat:DoAttack(target, weapon, projectile) and DelayVisibility. Distances are in scene units.
 */
export class Projectile {
  /** Scene units per second. */
  speed = 0;
  hitdist = 1;
  homing = true;
  onhit?: (projectile: Projectile, attacker: CombatActor | undefined, target: ProjectileTarget) => void;
  onmiss?: (projectile: Projectile, attacker: CombatActor | undefined, target: ProjectileTarget) => void;
  /** Ground contact of the projectile. */
  readonly position = new Vector3();
  readonly heading = new Vector3(1, 0, 0);
  visible = true;
  target?: ProjectileTarget;
  owner?: ProjectileOwner;
  private attacker?: CombatActor;
  private dest = new Vector3();
  private delayRemaining = 0;
  private delaypos?: Vector3[];
  private stuckTargetPos?: Vector3;
  private stuckPos?: Vector3;
  private stuckDistSq?: number;
  private movedTowardsTarget?: boolean;
  private stuckTime = 0;
  private readonly scratch = new Vector3();

  SetSpeed(speed: number): void { this.speed = speed; }
  SetHitDist(distance: number): void { this.hitdist = distance; }
  SetOnHitFn(fn: Projectile['onhit']): void { this.onhit = fn; }
  SetOnMissFn(fn: Projectile['onmiss']): void { this.onmiss = fn; }
  IsThrown(): boolean { return this.target !== undefined; }

  /** Throw: aim from the owner's launch point at the target and announce `hostileprojectile`. */
  Throw(owner: ProjectileOwner, target: ProjectileTarget, attacker: CombatActor): void {
    this.owner = owner; this.target = target; this.attacker = attacker;
    this.dest.copy(target.getPosition());
    this.stuckTargetPos = undefined; this.stuckDistSq = undefined;
    this.rotateToTarget();
    target.PushEvent?.('hostileprojectile', { thrower: owner, attacker, target });
  }

  /** DelayVisibility: hidden while the swing reaches the staff, replaying the hidden path afterwards. */
  DelayVisibility(duration: number): void {
    this.visible = false; this.delayRemaining = duration; this.delaypos = [];
  }

  /** The projectile ends when its holder lets go of the weapon, matching the owner `newstate`/`onremove` watch. */
  Cancel(): void { this.Stop(); }

  Update(dt: number): void {
    const target = this.target;
    if (!target) return;
    if (this.homing && !target.isRemoved && !target.hasTag('INLIMBO')) this.dest.copy(target.getPosition());
    if (this.delaypos) {
      this.delayRemaining -= dt;
      if (this.delayRemaining > 0) {
        this.delaypos.push(this.position.clone());
        if (this.homing && this.checkTarget(target)) this.rotateToTarget();
        this.advance(dt);
        return;
      }
      const replay = this.delaypos;
      this.delaypos = undefined; this.visible = true;
      for (const point of replay) if (this.doUpdate(target, point, dt)) return;
    }
    if (this.doUpdate(target, this.position, dt)) return;
    this.advance(dt);
  }

  private advance(dt: number): void { this.position.addScaledVector(this.heading, this.speed * dt); }

  private rotateToTarget(): void {
    this.heading.subVectors(this.dest, this.position);
    if (this.heading.lengthSq() < 1e-12) this.heading.set(1, 0, 0); else this.heading.normalize();
  }

  private checkTarget(target: ProjectileTarget): boolean {
    return !target.isRemoved && !target.hasTag('INLIMBO') && !target.hasTag('flight') && !target.hasTag('invisible');
  }

  /** projectile.lua DoUpdate for a homing projectile; true once it has hit or missed. */
  private doUpdate(target: ProjectileTarget, pos: Vector3, dt: number): boolean {
    if (this.checkTarget(target)) {
      const range = target.getPhysicsRadius() + this.hitdist;
      const distanceSq = pos.distanceToSquared(target.getPosition());
      if (distanceSq < range * range) { this.Hit(target); return true; }
      if (this.dest.distanceToSquared(pos) > 1e-12) this.heading.subVectors(this.dest, pos).normalize();
      const projected = this.scratch.copy(pos).addScaledVector(this.heading, this.speed * dt);
      // Overshooting the destination this frame counts as a hit.
      if (this.heading.dot(projected.subVectors(this.dest, projected)) < 0) { this.Hit(target); return true; }
      if (this.checkStuck(target, distanceSq, pos, dt)) { this.Miss(target); return true; }
      return false;
    }
    const weapon = this.owner?.components.weapon;
    const combat = this.attacker?.components.combat;
    if (!this.owner || this.owner.isRemoved || !combat || weapon?.attackrange === undefined) {
      // Lost our target, e.g. a bird flew away.
      this.Miss(target); return true;
    }
    // Our weapon flies on to its maximum distance before missing.
    const range = combat.attackrange + weapon.attackrange;
    const attackerPosition = this.attacker!.getPosition();
    const distanceSq = (attackerPosition.x - pos.x) ** 2 + (attackerPosition.z - pos.z) ** 2;
    if (distanceSq > range * range || this.checkStuck(target, distanceSq, pos, dt)) { this.Miss(target); return true; }
    return false;
  }

  private checkStuck(target: ProjectileTarget, distanceSq: number, pos: Vector3, dt: number): boolean {
    if (this.stuckDistSq === undefined) {
      this.stuckTargetPos = target.getPosition().clone(); this.stuckPos = pos.clone();
      this.stuckDistSq = distanceSq; this.movedTowardsTarget = undefined; this.stuckTime = 0;
      return false;
    }
    const expected = this.speed * dt;
    const realTravelSq = this.stuckPos!.distanceToSquared(pos);
    const previous = this.movedTowardsTarget;
    this.movedTowardsTarget = distanceSq < this.stuckDistSq;
    const targetPosition = target.getPosition();
    const canCheck2D = targetPosition.distanceToSquared(this.stuckTargetPos!) < 0.01;
    if (!canCheck2D) this.stuckTargetPos!.copy(targetPosition);
    if (realTravelSq < expected * expected || (canCheck2D && distanceSq < STUCKCHECK_2D_DIST_TO_NONMOVING_TARGET)) {
      this.stuckTime += dt;
      if (this.stuckTime >= STUCKCHECK_TIME_TO_BE_STUCK) return true;
    } else {
      this.stuckPos!.copy(pos);
      if (previous === !this.movedTowardsTarget && previous !== undefined) {
        this.stuckTime += dt;
        if (this.stuckTime >= STUCKCHECK_TIME_TO_BE_STUCK) return true;
      } else this.stuckTime = 0;
    }
    this.stuckDistSq = distanceSq;
    return false;
  }

  Stop(): void {
    this.target = undefined; this.owner = undefined; this.delaypos = undefined;
    this.stuckTargetPos = undefined; this.stuckPos = undefined; this.stuckDistSq = undefined; this.stuckTime = 0;
  }

  Miss(target: ProjectileTarget): void {
    const attacker = this.attacker;
    this.Stop();
    this.onmiss?.(this, attacker, target);
  }

  /** Hit: the holder's combat re-enters DoAttack with this projectile, ignoring hit range, then onhit. */
  Hit(target: ProjectileTarget): void {
    const weapon = this.owner?.components.weapon;
    const holder = this.owner?.components.inventoryitem?.owner ? this.attacker : undefined;
    this.Stop();
    const combat = holder?.components.combat;
    if (combat && weapon) {
      combat.ignorehitrange = true;
      try { combat.DoAttack(target, weapon, this); } finally { combat.ignorehitrange = false; }
    }
    this.onhit?.(this, holder, target);
  }
}
