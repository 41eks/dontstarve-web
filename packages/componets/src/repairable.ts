import { createMemo, createSignal, readonlySignal, type Memo, type ReadonlySignal } from '@dontstarve-web/signals';
import { NO_TAGS, type DerivedTags } from './derivedTags';
import type { WorkInst, Workable } from './workable';
import type { Repairer } from './repairer';
import type { Health } from './health';

export interface RepairItem {
  readonly components?: { repairer?: Repairer; stackable?: { Consume(): boolean } };
  remove?(): boolean;
}

const HEALTH_TAGS = Object.freeze(['healthrepairable']),
  WORK_TAGS = Object.freeze(['workrepairable']);
const BOTH_TAGS = Object.freeze(['healthrepairable', 'workrepairable']);
/** Shared arrays, so a health change that keeps the same tags notifies nobody. */
const repairTags = (health: boolean, work: boolean): readonly string[] =>
  health && work ? BOTH_TAGS : health ? HEALTH_TAGS : work ? WORK_TAGS : NO_TAGS;

/** repairable.lua's work and health branches. The inventory consumes one repair item. */
export class Repairable implements DerivedTags {
  private readonly disposed = createSignal(false);
  private readonly repairableMemo;
  readonly workrepairable;
  private readonly derivedTagsMemo: Memo<readonly string[]>;
  readonly derivedTags: ReadonlySignal<readonly string[]>;
  noannounce = false;
  /** repairable.lua onrepaired(inst, doer, repair_item); the inst is the callback's own closure. */
  onrepaired?: (doer: unknown) => void;
  private readonly inst: WorkInst;
  private readonly workable?: Workable;
  private readonly health?: Health;
  readonly repairmaterial: string;
  constructor(
    inst: WorkInst & { components?: { health?: Health } },
    workable: Workable | undefined,
    repairmaterial: string,
  ) {
    this.inst = inst;
    this.workable = workable;
    this.repairmaterial = repairmaterial;
    this.health = inst.components?.health;
    this.repairableMemo = createMemo(
      () =>
        !this.disposed.get() &&
        !!workable &&
        workable.enabled.get() &&
        workable.maxwork.get() > 0 &&
        workable.workleft.get() < workable.maxwork.get(),
    );
    this.workrepairable = readonlySignal(this.repairableMemo);
    const health = this.health;
    // onhealthrepairable / onworkrepairable, which health.lua and workable.lua set from their own state.
    this.derivedTagsMemo = createMemo(() =>
      repairTags(
        !this.disposed.get() && !!health && health.current.get() < health.maxWithPenalty.get(),
        this.repairableMemo.get(),
      ),
    );
    this.derivedTags = readonlySignal(this.derivedTagsMemo);
    inst.addTag(`repairable_${repairmaterial}`);
  }
  private CanRepairWork(): boolean {
    return (
      !!this.workable &&
      this.workable.enabled.peek() &&
      this.workable.maxwork.peek() > 0 &&
      this.workable.workleft.peek() < this.workable.maxwork.peek()
    );
  }
  CanRepair(item: RepairItem): boolean {
    const repairer = item.components?.repairer;
    return (
      !this.disposed.peek() &&
      !this.inst.isRemoved &&
      repairer?.repairmaterial === this.repairmaterial &&
      ((this.CanRepairWork() && repairer.workrepairvalue > 0) ||
        (!!this.health?.IsHurt() && repairer.healthrepairvalue > 0))
    );
  }
  /** repairable.lua Repair(doer, repair_item): apply the repair, then remove one of the repair item's stack. */
  Repair(doer: unknown, item: RepairItem): boolean {
    if (!this.CanRepair(item)) {
      return false;
    }
    const repairer = item.components!.repairer!;
    if (this.health?.IsHurt() && repairer.healthrepairvalue > 0) {
      this.health.DoDelta(repairer.healthrepairvalue);
    } else {
      this.workable!.SetWorkLeft(this.workable!.GetWorkLeft() + repairer.workrepairvalue);
    }
    if (item.components?.stackable) {
      item.components.stackable.Consume();
    } else {
      item.remove?.();
    }
    this.onrepaired?.(doer);
    return true;
  }
  dispose(): void {
    if (this.disposed.peek()) {
      return;
    }
    this.disposed.set(true);
    this.inst.removeTag(`repairable_${this.repairmaterial}`);
    this.derivedTagsMemo.dispose();
    this.repairableMemo.dispose();
    this.onrepaired = undefined;
  }
}
