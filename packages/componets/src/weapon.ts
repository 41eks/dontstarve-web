import type { LuaFn } from './luaFn';
import type { CombatActor, CombatInst } from './combat';
/** The finite uses a weapon wears on attack. */
export interface WeaponUses {
  use(amount: number): boolean;
}

export type WeaponOnAttackFn<Inst> = LuaFn<[inst: Inst, attacker: CombatActor, target: CombatInst]>;
export type WeaponOnProjectileLaunchedFn<Inst> = LuaFn<
  [inst: Inst, attacker: CombatActor, target: CombatInst, projectile: unknown]
>;

/** components/weapon.lua damage and combat durability loss. */
export class Weapon<Inst extends object = object> {
  damage = 10;
  attackwear = 1;
  attackrange?: number;
  hitrange?: number;
  onattack?: WeaponOnAttackFn<Inst>;
  /** weapon.lua SetProjectile: the prefab a ranged attack launches instead of hitting at once. */
  projectile?: string;
  onprojectilelaunched?: WeaponOnProjectileLaunchedFn<Inst>;
  /** SpawnPrefab(self.projectile) + projectile:Throw, supplied by the prefab that owns the projectile art. */
  launchProjectile?: (attacker: CombatActor, target: CombatInst) => unknown;
  private readonly inst: Inst;
  private readonly uses?: () => WeaponUses | undefined;

  constructor(inst: Inst, uses?: () => WeaponUses | undefined) {
    this.inst = inst;
    this.uses = uses;
  }

  SetDamage(damage: number): void {
    if (!Number.isFinite(damage) || damage < 0) {
      throw new RangeError('Invalid weapon damage');
    }
    this.damage = damage;
  }
  SetRange(attack: number, hit = attack): void {
    this.attackrange = attack;
    this.hitrange = hit;
  }
  SetOnAttack(fn: WeaponOnAttackFn<Inst> | undefined): void {
    this.onattack = fn;
  }
  SetProjectile(projectile: string, launch: NonNullable<Weapon['launchProjectile']>): void {
    this.projectile = projectile;
    this.launchProjectile = launch;
  }
  SetOnProjectileLaunched(fn: WeaponOnProjectileLaunchedFn<Inst> | undefined): void {
    this.onprojectilelaunched = fn;
  }
  CanRangedAttack(): boolean {
    return this.projectile !== undefined;
  }
  /** LaunchProjectile: spawn and throw the projectile, then run onprojectilelaunched. */
  LaunchProjectile(attacker: CombatActor, target: CombatInst): void {
    if (this.projectile === undefined) {
      return;
    }
    const projectile = this.launchProjectile?.(attacker, target);
    this.onprojectilelaunched?.(this.inst, attacker, target, projectile);
  }
  GetDamage(): number {
    return this.damage;
  }
  hasTag(tag: string): boolean {
    return (this.inst as { hasTag?(tag: string): boolean }).hasTag?.(tag) ?? false;
  }

  /** OnAttack: callbacks, then finiteuses:Use(attackwear) when the item has uses. */
  OnAttack(attacker: CombatActor, target: CombatInst): void {
    this.onattack?.(this.inst, attacker, target);
    this.uses?.()?.use(this.attackwear);
  }
}
