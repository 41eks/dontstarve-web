import { createMemo, createSignal, readonlySignal } from '@dontstarve-web/signals';
import type { WorkInst, Workable } from './workable';
import type { Repairer } from './repairer';
import type { Health } from './health';

export interface RepairItem {
  readonly components?: { repairer?: Repairer; stackable?: { Consume(): boolean } };
  remove?(): boolean;
}

/** repairable.lua's work and health branches. The inventory consumes one repair item. */
export class Repairable {
  private readonly disposed = createSignal(false);
  private readonly repairableMemo;
  readonly workrepairable;
  noannounce = false;
  onrepaired?: () => void;
  private readonly inst: WorkInst;
  private readonly workable?: Workable;
  private readonly health?: Health;
  readonly repairmaterial: string;
  constructor(inst: WorkInst & { components?: { health?: Health } }, workable: Workable | undefined, repairmaterial: string) {
    this.inst = inst; this.workable = workable; this.repairmaterial = repairmaterial;
    this.health = inst.components?.health;
    this.repairableMemo = createMemo(() => !this.disposed.get() && !!workable && workable.enabled.get() && workable.maxwork.get() > 0
      && workable.workleft.get() < workable.maxwork.get());
    this.workrepairable = readonlySignal(this.repairableMemo);
    inst.addTag(`repairable_${repairmaterial}`);
  }
  HasTag(tag: string): boolean | undefined {
    if (tag === 'healthrepairable') return !this.disposed.peek() && !!this.health?.IsHurt();
    return tag === 'workrepairable' ? !this.disposed.peek() && this.CanRepairWork() : undefined;
  }
  private CanRepairWork(): boolean {
    return !!this.workable && this.workable.enabled.peek() && this.workable.maxwork.peek() > 0
      && this.workable.workleft.peek() < this.workable.maxwork.peek();
  }
  CanRepair(item: RepairItem): boolean {
    const repairer = item.components?.repairer;
    return !this.disposed.peek() && !this.inst.isRemoved && repairer?.repairmaterial === this.repairmaterial
      && (this.CanRepairWork() && repairer.workrepairvalue > 0 || !!this.health?.IsHurt() && repairer.healthrepairvalue > 0);
  }
  /** repairable.lua Repair(doer, repair_item): apply the repair, then remove one of the repair item's stack. */
  Repair(_doer: unknown, item: RepairItem): boolean {
    if (!this.CanRepair(item)) return false;
    const repairer = item.components!.repairer!;
    if (this.health?.IsHurt() && repairer.healthrepairvalue > 0) this.health.DoDelta(repairer.healthrepairvalue);
    else this.workable!.SetWorkLeft(this.workable!.GetWorkLeft() + repairer.workrepairvalue);
    if (item.components?.stackable) item.components.stackable.Consume();
    else item.remove?.();
    this.onrepaired?.();
    return true;
  }
  dispose(): void {
    if (this.disposed.peek()) return;
    this.disposed.set(true);
    this.inst.removeTag(`repairable_${this.repairmaterial}`);
    this.repairableMemo.dispose();
    this.onrepaired = undefined;
  }
}
