import { createMemo, createSignal, readonlySignal } from '@dontstarve-web/signals';
import type { WorkInst, Workable } from './workable';
import type { Repairer } from './repairer';

export interface RepairItem { readonly components?: { repairer?: Repairer }; }

/** repairable.lua's workable branch. The target owns repair amounts; the inventory consumes one item. */
export class Repairable {
  private readonly disposed = createSignal(false);
  private readonly repairableMemo;
  readonly workrepairable;
  noannounce = false;
  onrepaired?: () => void;
  private readonly inst: WorkInst;
  private readonly workable: Workable;
  readonly repairmaterial: string;
  constructor(inst: WorkInst, workable: Workable, repairmaterial: string) {
    this.inst = inst; this.workable = workable; this.repairmaterial = repairmaterial;
    this.repairableMemo = createMemo(() => !this.disposed.get() && workable.enabled.get() && workable.maxwork.get() > 0
      && workable.workleft.get() < workable.maxwork.get());
    this.workrepairable = readonlySignal(this.repairableMemo);
    inst.addTag(`repairable_${repairmaterial}`);
  }
  HasTag(tag: string): boolean | undefined {
    return tag === 'workrepairable' ? !this.disposed.peek() && this.CanRepairWork() : undefined;
  }
  private CanRepairWork(): boolean {
    return this.workable.enabled.peek() && this.workable.maxwork.peek() > 0
      && this.workable.workleft.peek() < this.workable.maxwork.peek();
  }
  CanRepair(item: RepairItem): boolean {
    const repairer = item.components?.repairer;
    return !this.disposed.peek() && !this.inst.isRemoved && this.CanRepairWork()
      && repairer?.repairmaterial === this.repairmaterial && repairer.workrepairvalue > 0;
  }
  Repair(item: RepairItem, consume: () => boolean): boolean {
    if (!this.CanRepair(item) || !consume()) return false;
    this.workable.SetWorkLeft(this.workable.GetWorkLeft() + item.components!.repairer!.workrepairvalue);
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
