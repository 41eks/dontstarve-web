import type { Health, HealthAfflicter } from './health';
import type { Weapon } from './weapon';

export interface CombatInst extends HealthAfflicter {
  readonly isRemoved?: boolean;
  /** Ground contact in DST units. */
  getPosition(): { x: number; y: number; z: number };
  getPhysicsRadius(): number;
  hasTag(tag: string): boolean;
  PushEvent?(name: string, data: unknown): void;
  readonly components: { combat?: Combat; health?: Health };
}

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
  onhitfn?: (inst: CombatInst, attacker: CombatInst, damage: number) => void;
  keeptargetfn?: () => boolean;
  private laststartattacktime?: number;
  private readonly inst: CombatInst;
  private readonly now: () => number;
  private readonly getWeapon: () => Weapon | undefined;

  constructor(inst: CombatInst, now: () => number, getWeapon: () => Weapon | undefined = () => undefined) {
    this.inst = inst;
    this.now = now;
    this.getWeapon = getWeapon;
  }

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
    return target !== this.inst && !target.isRemoved && !target.hasTag('INLIMBO') && !target.hasTag('notarget')
      && target.components.combat !== undefined && target.components.health !== undefined && !target.components.health.IsDead();
  }

  CanBeAttacked(): boolean { return !this.inst.isRemoved && !(this.inst.components.health?.IsDead() ?? false); }

  CanHitTarget(target: CombatInst): boolean {
    if (this.inst.isRemoved || target.isRemoved || target.hasTag('INLIMBO') || !target.components.combat?.CanBeAttacked()) return false;
    return distanceSq(this.inst.getPosition(), target.getPosition()) <= this.CalcHitRangeSq(target);
  }

  CalcDamage(target: CombatInst, weapon = this.getWeapon()): number {
    if (target.hasTag('alwaysblock')) return 0;
    // No player damage multiplier applies to weapons or to non-player targets.
    return (weapon ? weapon.GetDamage() : this.defaultdamage) * this.damagemultiplier;
  }

  DoAttack(target: CombatInst, weapon = this.getWeapon()): boolean {
    if (!this.CanHitTarget(target)) {
      this.inst.PushEvent?.('onmissother', { target, weapon });
      return false;
    }
    const damage = this.CalcDamage(target, weapon);
    weapon?.OnAttack(this.inst, target);
    target.components.combat!.GetAttacked(this.inst, damage, weapon);
    this.inst.PushEvent?.('onhitother', { target, damage, weapon });
    return true;
  }

  GetAttacked(attacker: CombatInst, damage: number, weapon?: Weapon): boolean {
    const health = this.inst.components.health;
    if (!health || health.IsDead()) return true;
    // Only positive damage reaches health; it fires ondelta before onhitfn.
    if (damage > 0) health.DoDelta(-damage, false, attacker.hasTag('player') ? 'player' : undefined, false, attacker);
    this.inst.PushEvent?.('attacked', { attacker, damage, weapon });
    this.onhitfn?.(this.inst, attacker, damage);
    return false;
  }
}

function distanceSq(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}
