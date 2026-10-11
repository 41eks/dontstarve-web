import type { SanityState } from '@dontstarve-web/signals';
import type { EquipmentKind } from '../../inventory/src/types';
import type { Equippable, EquippableOwner } from './equippable';

export interface SanityInst extends EquippableOwner {
  readonly components: {
    inventory: { GetEquippedItem(slot: EquipmentKind): {
      readonly isRemoved: boolean;
      readonly components: { equippable?: Pick<Equippable, 'GetDapperness'> };
    } | null };
    health?: { IsInvincible(): boolean };
  };
  readonly sg?: { hasStateTag(tag: string): boolean };
  readonly is_teleporting?: boolean;
}

/** sanity.lua OnUpdate/Recalc, for equipment dapperness. The injected stat is authoritative. */
export class Sanity {
  dapperness = 0;
  dapperness_mult = 1;
  rate_modifier = 1;
  no_moisture_penalty = false;
  ignore = false;
  private disposed = false;
  private readonly inst: SanityInst;
  private readonly current: SanityState;

  constructor(inst: SanityInst, current: SanityState) { this.inst = inst; this.current = current; }
  GetRate(): number {
    if (this.disposed || this.ignore || this.inst.components.health?.IsInvincible()
      || this.inst.hasTag('spawnprotection') || this.inst.sg?.hasStateTag('sleeping') || this.inst.is_teleporting) return 0;
    if (this.dapperness_mult === 0) return 0;
    let total = this.dapperness;
    for (const slot of ['hand', 'head', 'body'] as const) {
      const item = this.inst.components.inventory.GetEquippedItem(slot);
      if (item && !item.isRemoved) total += item.components.equippable?.GetDapperness(this.inst, this.no_moisture_penalty) ?? 0;
    }
    return total * this.dapperness_mult * this.rate_modifier; // TUNING.SANITY_DAPPERNESS = 1
  }
  DoDelta(delta: number): void { if (!this.disposed) this.current.set(this.current.peek() + delta); }
  OnUpdate(dt: number): void {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    const delta = this.GetRate() * dt;
    if (delta !== 0) this.DoDelta(delta);
  }
  dispose(): void { this.disposed = true; }
}
