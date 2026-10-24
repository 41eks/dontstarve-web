import { createSignal, readonlySignal, createMemo, type Memo, type ReadonlySignal } from '../../signals/src';

export interface ArmorSaveData { condition: number }

/** The owner side of armor.lua's `inventoryitem.owner:PushEvent`. */
export interface ArmorOwner { PushEvent(name: string, data?: unknown): void }

export interface ArmorInst {
  PushEvent(name: string, data?: unknown): void;
  ListenForEvent(name: string, listener: (data: unknown) => void): () => void;
  remove(): boolean;
  readonly components: { readonly inventoryitem: { readonly owner: ArmorOwner | null } };
}

/** armor.lua: condition wears with TakeDamage; absorption is the share of damage the wearer ignores. */
export class Armor {
  private readonly conditionState = createSignal(100);
  private readonly maxconditionState = createSignal(100);
  /** Read-only views; the condition itself is only written through SetCondition. */
  readonly condition: ReadonlySignal<number> = readonlySignal(this.conditionState);
  readonly percent: Memo<number>;
  absorb_percent?: number;
  onfinished?: (inst: ArmorInst) => void;
  keeponfinished = false;
  private readonly inst: ArmorInst;
  private readonly stopPercentChanged: () => void;

  constructor(inst: ArmorInst) {
    this.inst = inst;
    this.percent = createMemo(() => this.conditionState.get() / this.maxconditionState.get());
    // armor.lua PercentChanged: a broken armor tells its wearer.
    this.stopPercentChanged = inst.ListenForEvent('percentusedchange', data => {
      const percent = (data as { percent?: number } | undefined)?.percent;
      if (percent !== undefined && percent <= 0) this.inst.components.inventoryitem.owner?.PushEvent('armorbroke', { armor: this.inst });
    });
  }

  get maxcondition(): number { return this.maxconditionState.peek(); }
  InitCondition(amount: number, absorbPercent: number): void {
    if (!Number.isFinite(amount) || amount <= 0) throw new RangeError('Invalid armor condition');
    this.conditionState.set(amount);
    this.maxconditionState.set(amount);
    this.absorb_percent = absorbPercent;
  }
  SetAbsorption(absorbPercent: number): void { this.absorb_percent = absorbPercent; }
  GetAbsorption(): number | undefined { return this.absorb_percent; }
  IsDamaged(): boolean { return this.conditionState.peek() < this.maxconditionState.peek(); }
  GetPercent(): number { return this.percent.peek(); }
  SetPercent(amount: number): void { this.SetCondition(this.maxcondition * amount); }

  SetCondition(amount: number): void {
    const next = Math.min(amount, this.maxcondition);
    this.conditionState.set(next);
    this.inst.PushEvent('percentusedchange', { percent: this.GetPercent() });
    if (next <= 0) {
      this.conditionState.set(0);
      this.onfinished?.(this.inst);
      if (!this.keeponfinished) this.inst.remove();
    }
  }
  TakeDamage(amount: number): void {
    this.SetCondition(this.conditionState.peek() - amount);
    this.inst.PushEvent('armordamaged', amount);
  }
  Repair(amount: number): void { this.SetCondition(this.conditionState.peek() + amount); }

  OnSave(): ArmorSaveData | undefined {
    return this.IsDamaged() ? { condition: this.conditionState.peek() } : undefined;
  }
  OnLoad(data: Partial<ArmorSaveData>): void {
    if (data.condition !== undefined) this.SetCondition(data.condition);
  }
  dispose(): void { this.stopPercentChanged(); this.percent.dispose(); }
}
