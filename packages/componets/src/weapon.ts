/** The finite uses a weapon wears on attack. */
export interface WeaponUses { use(amount: number): boolean }

/** components/weapon.lua damage and combat durability loss. */
export class Weapon {
  damage = 10;
  attackwear = 1;
  attackrange?: number;
  hitrange?: number;
  onattack?: (inst: object, attacker: object, target: object) => void;
  private readonly inst: object;
  private readonly uses?: () => WeaponUses | undefined;

  constructor(inst: object, uses?: () => WeaponUses | undefined) {
    this.inst = inst;
    this.uses = uses;
  }

  SetDamage(damage: number): void {
    if (!Number.isFinite(damage) || damage < 0) throw new RangeError('Invalid weapon damage');
    this.damage = damage;
  }
  SetRange(attack: number, hit = attack): void { this.attackrange = attack; this.hitrange = hit; }
  SetOnAttack(fn: Weapon['onattack']): void { this.onattack = fn; }
  GetDamage(): number { return this.damage; }
  hasTag(tag: string): boolean { return (this.inst as { hasTag?(tag: string): boolean }).hasTag?.(tag) ?? false; }

  /** OnAttack: callbacks, then finiteuses:Use(attackwear) when the item has uses. */
  OnAttack(attacker: object, target: object): void {
    this.onattack?.(this.inst, attacker, target);
    this.uses?.()?.use(this.attackwear);
  }
}
