import type { Health, HealthAfflicter } from './health';
import type { Weapon } from './weapon';

export interface CombatInst<HealthComponent extends Pick<Health, 'IsDead' | 'DoDelta'> = Health> extends HealthAfflicter {
  readonly isRemoved?: boolean;
  /** Ground contact in DST units. */
  getPosition(): { x: number; y: number; z: number };
  getPhysicsRadius(): number;
  hasTag(tag: string): boolean;
  PushEvent?(name: string, data: unknown): void;
  readonly components: { combat?: Combat; health?: HealthComponent; sanity?: { doDelta(delta: number): void };
    /** inventory:ApplyDamage: equipped armor absorbs its share before health; creature inventories wear none. */
    inventory?: { ApplyDamage?(damage: number, attacker?: CombatActor, weapon?: Weapon): number } };
}

/** Players may bind the combat health operations to their existing authoritative stat store. */
export type CombatActor = CombatInst<Pick<Health, 'IsDead' | 'DoDelta'>>;

/**
 * The supported branches of components/combat.lua: default/weapon damage,
 * attack cooldown, range checks and GetAttacked → health:DoDelta → onhitfn.
 */
export class Combat {
  defaultdamage = 0;
  min_attack_period = 4;
  attackrange = 3;
  hitrange = 3;
  damagemultiplier = 1;
  onhitfn?: (inst: CombatActor, attacker: CombatActor, damage: number) => void;
  keeptargetfn?: () => boolean;
  /** Projectiles hit from wherever they are: the weapon's range was checked at launch. */
  ignorehitrange = false;
  private laststartattacktime?: number;
  private readonly inst: CombatActor;
  private readonly now: () => number;
  private readonly getWeapon: () => Weapon | undefined;

  constructor(inst: CombatActor, now: () => number, getWeapon: () => Weapon | undefined = () => undefined) {
    this.inst = inst;
    this.now = now;
    this.getWeapon = getWeapon;
  }

  target?: CombatInst;
  DropTarget(): void { this.target = undefined; }

  SetDefaultDamage(damage: number): void { this.defaultdamage = damage; }
  SetAttackPeriod(period: number): void { this.min_attack_period = period; }
  SetRange(attack: number, hit = attack): void { this.attackrange = attack; this.hitrange = hit; }
  SetKeepTargetFunction(fn: () => boolean): void { this.keeptargetfn = fn; }
  GetWeapon(): Weapon | undefined { return this.getWeapon(); }

  InCooldown(): boolean {
    return this.laststartattacktime !== undefined && this.laststartattacktime + this.min_attack_period > this.now();
  }
  StartAttack(): void { this.laststartattacktime = this.now(); }
  /** Combat.CancelAttack = ResetCooldown. */
  CancelAttack(): void { this.laststartattacktime = undefined; }

  GetAttackRange(): number {
    const weapon = this.getWeapon();
    return weapon?.attackrange !== undefined ? Math.max(0, this.attackrange + weapon.attackrange) : this.attackrange;
  }
  GetHitRange(): number {
    const weapon = this.getWeapon();
    return weapon?.hitrange !== undefined ? this.hitrange + weapon.hitrange : this.hitrange;
  }
  CalcAttackRangeSq(target: CombatInst): number { return (target.getPhysicsRadius() + this.GetAttackRange()) ** 2; }
  CalcHitRangeSq(target: CombatInst): number { return (target.getPhysicsRadius() + this.GetHitRange()) ** 2; }

  /** replica combat:CanTarget for the ported cases: live, attackable, not in limbo. */
  CanTarget(target: CombatInst): boolean {
    return target !== this.inst && !target.isRemoved && !target.hasTag('INLIMBO') && !target.hasTag('notarget') && !target.hasTag('noattack')
      && target.components.combat !== undefined && target.components.health !== undefined && !target.components.health.IsDead();
  }

  CanBeAttacked(): boolean { return !this.inst.isRemoved && !(this.inst.components.health?.IsDead() ?? false); }

  /** combat.lua CanLightTarget: a rangedlighter weapon and a burnable that can light and is not already alight. */
  CanLightTarget(target: CombatInst, weapon = this.getWeapon()): boolean {
    const burnable = (target.components as { burnable?: { canlight: boolean; IsBurning(): boolean } }).burnable;
    return !!weapon?.hasTag('rangedlighter') && !!burnable && burnable.canlight && !burnable.IsBurning() && !target.hasTag('burnt');
  }

  CanHitTarget(target: CombatInst, weapon = this.getWeapon()): boolean {
    if (this.inst.isRemoved || target.isRemoved || target.hasTag('INLIMBO')) return false;
    if (!this.CanLightTarget(target, weapon) && !target.components.combat?.CanBeAttacked()) return false;
    if (this.ignorehitrange) return true;
    return distanceSq(this.inst.getPosition(), target.getPosition()) <= this.CalcHitRangeSq(target);
  }

  CalcDamage(target: CombatInst, weapon = this.getWeapon()): number {
    if (target.hasTag('alwaysblock')) return 0;
    // No player damage multiplier applies to weapons or to non-player targets.
    return (weapon ? weapon.GetDamage() : this.defaultdamage) * this.damagemultiplier;
  }

  /** A ranged weapon launches its projectile; the projectile's hit re-enters with `projectile` set. */
  DoAttack(target: CombatInst, weapon = this.getWeapon(), projectile?: object): boolean {
    if (!this.CanHitTarget(target, weapon)) {
      this.inst.PushEvent?.('onmissother', { target, weapon });
      return false;
    }
    if (weapon && projectile === undefined && weapon.CanRangedAttack()) {
      weapon.LaunchProjectile(this.inst, target);
      return true;
    }
    // Only combat targets take damage; a lit burnable is handled by the weapon's onattack.
    const damage = target.components.combat ? this.CalcDamage(target, weapon) : 0;
    target.components.combat?.GetAttacked(this.inst, damage, weapon);
    weapon?.OnAttack(this.inst, target);
    this.inst.PushEvent?.('onhitother', { target, damage, weapon });
    return true;
  }

  /** combat.lua GetAttacked: armor first, then health; fully absorbed damage is "blocked" instead of "attacked". */
  GetAttacked(attacker: CombatActor, damage: number, weapon?: Weapon): boolean {
    const health = this.inst.components.health;
    if (!health || health.IsDead()) return true;
    const original_damage = damage;
    const inventory = this.inst.components.inventory;
    if (inventory?.ApplyDamage) damage = inventory.ApplyDamage(damage, attacker, weapon);
    if (damage <= 0 && original_damage > 0) {
      this.inst.PushEvent?.('blocked', { attacker, damage, original_damage });
      return false;
    }
    // Only positive damage reaches health; it fires ondelta before onhitfn.
    if (damage > 0) health.DoDelta(-damage, false, attacker.hasTag('player') ? 'player' : undefined, false, attacker);
    this.inst.PushEvent?.('attacked', { attacker, damage, original_damage, weapon });
    this.onhitfn?.(this.inst, attacker, damage);
    return true;
  }
}

function distanceSq(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}
