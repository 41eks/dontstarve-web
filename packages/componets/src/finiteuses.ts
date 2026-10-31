import { batch, createMemo, createSignal, readonlySignal, type Memo, type ReadonlySignal } from '../../signals/src';

export interface FiniteUsesInst {
  readonly isRemoved: boolean;
  PushEvent?(name: string, data: unknown): void;
}

export interface FiniteUsesSaveData { uses: number }

/** components/finiteuses.lua for world entities: the remaining uses are a private signal with a read-only view. */
export class FiniteUses {
  private readonly currentState = createSignal(0);
  private readonly totalState = createSignal(100);
  readonly current: ReadonlySignal<number> = readonlySignal(this.currentState);
  readonly total: ReadonlySignal<number> = readonlySignal(this.totalState);
  /** GetPercent(): derived from the uses signals. */
  readonly percent: Memo<number>;
  private onfinished?: (inst: FiniteUsesInst) => void;
  private readonly inst: FiniteUsesInst;

  constructor(inst: FiniteUsesInst) {
    this.inst = inst;
    this.percent = createMemo(() => this.currentState.get() / this.totalState.get());
  }

  SetMaxUses(value: number): void {
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('Invalid finiteuses maximum');
    this.totalState.set(value);
  }

  SetOnFinished(fn: ((inst: FiniteUsesInst) => void) | undefined): void { this.onfinished = fn; }
  GetUses(): number { return this.currentState.peek(); }
  GetPercent(): number { return this.currentState.peek() / this.totalState.peek(); }

  /** finiteuses.lua SetUses: percentusedchange first, then onfinished when nothing is left. */
  SetUses(value: number): void {
    if (!Number.isFinite(value)) throw new RangeError('Invalid finiteuses value');
    const current = Math.max(0, value);
    batch(() => {
      this.currentState.set(current);
      this.inst.PushEvent?.('percentusedchange', { percent: current / this.totalState.peek() });
    });
    if (current <= 0) this.onfinished?.(this.inst);
  }

  Use(amount = 1): void {
    if (!Number.isFinite(amount) || amount < 0) throw new RangeError('Invalid finiteuses amount');
    this.SetUses(this.currentState.peek() - amount);
  }

  OnSave(): FiniteUsesSaveData { return { uses: this.currentState.peek() }; }

  /** Validates before changing state; a saved count above the maximum is rejected. */
  OnLoad(data: Partial<FiniteUsesSaveData>): void {
    if (data.uses === undefined) return;
    if (!Number.isFinite(data.uses) || data.uses < 0 || data.uses > this.totalState.peek()) throw new RangeError('Invalid saved finiteuses');
    batch(() => {
      this.currentState.set(data.uses!);
      this.inst.PushEvent?.('percentusedchange', { percent: data.uses! / this.totalState.peek() });
    });
  }

  dispose(): void { this.percent.dispose(); this.onfinished = undefined; }
}
