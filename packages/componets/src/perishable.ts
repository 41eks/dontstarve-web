import { createMemo, createSignal, readonlySignal, type ReadonlySignal } from '../../signals/src';

// tuning.lua (perish_warp = 1).
export const TOTAL_DAY_TIME = 30 * 16;
export const PERISH_SUPERFAST = 3 * TOTAL_DAY_TIME;
export const PERISH_FAST = 6 * TOTAL_DAY_TIME;
export const PERISH_MED = 10 * TOTAL_DAY_TIME;
export const PERISH_FRESH = .5;
export const PERISH_STALE = .2;
const PERISH_GROUND_MULT = 1.5;
const PERISH_WET_MULT = 1.3;
const PERISH_WINTER_MULT = .75;
const PERISH_SUMMER_MULT = 1.25;
const PERISH_GLOBAL_MULT = 1;
const OVERHEAT_TEMP = 70;
const SETTLEMENT_FRAMES = 60;

/** perishremainingtime with its updatetask: perishing, paused (StopPerishing), unset, or Perish() done. */
export type PerishTimer =
  | { readonly status: 'stopped' }
  | { readonly status: 'perishing'; readonly remainingSeconds: number }
  | { readonly status: 'paused'; readonly remainingSeconds: number }
  | { readonly status: 'perished' };

/** perishable.lua's fresh / stale / spoiled tags, derived from GetPercent(). */
export type PerishStage = 'fresh' | 'stale' | 'spoiled';

export interface PerishableInst {
  readonly isRemoved: boolean;
  readonly components: { inventoryitem: { owner: PerishableOwner | null } };
  GetIsWet(): boolean;
  PushEvent(name: string, data: unknown): void;
}

export interface PerishableOwner {
  /** holder:GiveItem(goop, slot) after the perished inst leaves the same slot. */
  replace(prefab: string): boolean;
}

/** Ambient state sampled at settlement; GetTemperatureAtXZ falls back to the world temperature. */
export interface PerishWorld {
  readonly temperature: () => number;
}

const STOPPED: PerishTimer = Object.freeze({ status: 'stopped' });
const PERISHED: PerishTimer = Object.freeze({ status: 'perished' });

/** components/perishable.lua; elapsed time settles once every 60 active frames. */
export class Perishable {
  private readonly perishTimeState = createSignal<number | undefined>(undefined);
  private readonly timerState = createSignal<PerishTimer>(STOPPED);
  readonly perishtime = readonlySignal(this.perishTimeState);
  readonly timer = readonlySignal(this.timerState);
  /** undefined without a perish time, so presentations hide the spoilage meter. */
  readonly percent: ReadonlySignal<number | undefined>;
  readonly stage: ReadonlySignal<PerishStage | undefined>;
  onperishreplacement?: string;
  perishfn?: (inst: PerishableInst) => void;
  /** perishable.lua SetLocalMultiplier, evaluated at each settlement so holder changes take effect. */
  localMultiplier?: () => number;
  private readonly percentMemo;
  private readonly stageMemo;
  private readonly inst: PerishableInst;
  private world?: PerishWorld;
  private pendingSeconds = 0;
  private pendingFrames = 0;

  constructor(inst: PerishableInst) {
    this.inst = inst;
    this.percentMemo = createMemo(() => {
      const perishtime = this.perishTimeState.get();
      const timer = this.timerState.get();
      if (perishtime === undefined || timer.status === 'stopped') return undefined;
      if (timer.status === 'perished' || perishtime <= 0) return 0;
      return Math.max(0, Math.min(1, timer.remainingSeconds / perishtime));
    });
    this.stageMemo = createMemo((): PerishStage | undefined => {
      const percent = this.percentMemo.get();
      return percent === undefined ? undefined
        : percent >= PERISH_FRESH ? 'fresh' : percent > PERISH_STALE ? 'stale' : 'spoiled';
    });
    this.percent = readonlySignal(this.percentMemo);
    this.stage = readonlySignal(this.stageMemo);
  }

  IsFresh(): boolean { return this.stage.peek() === 'fresh'; }
  IsStale(): boolean { return this.stage.peek() === 'stale'; }
  IsSpoiled(): boolean { return this.stage.peek() === 'spoiled'; }
  IsPerishing(): boolean { return this.timerState.peek().status === 'perishing'; }
  GetPercent(): number { return this.percent.peek() ?? 0; }

  SetPerishTime(time: number): void {
    if (!Number.isFinite(time) || time <= 0) throw new RangeError('Invalid perish time');
    const status = this.timerState.peek().status;
    this.perishTimeState.set(time);
    this.timerState.set(Object.freeze({ status: status === 'perishing' ? 'perishing' : 'paused', remainingSeconds: time }));
  }

  SetPercent(percent: number): void {
    const perishtime = this.perishTimeState.peek();
    if (perishtime === undefined || !Number.isFinite(percent)) return;
    const clamped = Math.max(0, Math.min(1, percent));
    const timer = this.timerState.peek();
    // Store commits re-apply snapshots; an unchanged percent keeps the same timer value.
    if (timer.status === 'perished' || this.percent.peek() === clamped) return;
    this.timerState.set(Object.freeze({
      status: timer.status === 'perishing' ? 'perishing' : 'paused', remainingSeconds: clamped * perishtime,
    }));
  }

  StartPerishing(): void {
    const timer = this.timerState.peek();
    if (timer.status === 'paused') this.timerState.set(Object.freeze({ status: 'perishing', remainingSeconds: timer.remainingSeconds }));
  }

  StopPerishing(): void {
    this.flush();
    const timer = this.timerState.peek();
    if (timer.status === 'perishing') this.timerState.set(Object.freeze({ status: 'paused', remainingSeconds: timer.remainingSeconds }));
  }

  /** Frame scheduling only accumulates; remaining time changes at each 60-frame settlement. */
  onFrame(dt: number, world?: PerishWorld): void {
    if (world) this.world = world;
    if (this.timerState.peek().status !== 'perishing' || this.inst.isRemoved || !Number.isFinite(dt) || dt <= 0) return;
    this.pendingSeconds += dt;
    if (++this.pendingFrames >= SETTLEMENT_FRAMES) this.flush();
  }

  /** Settle a partial batch before saving, transferring, eating or changing the timer. */
  flush(): void {
    const elapsed = this.pendingSeconds;
    this.pendingSeconds = 0;
    this.pendingFrames = 0;
    if (elapsed > 0) this.Update(elapsed);
  }

  Update(dt: number): void {
    const timer = this.timerState.peek(), perishtime = this.perishTimeState.peek();
    if (timer.status !== 'perishing' || perishtime === undefined || this.inst.isRemoved) return;
    const remainingSeconds = Math.min(perishtime, timer.remainingSeconds - dt * this.rateModifier());
    if (remainingSeconds > 0) {
      this.timerState.set(Object.freeze({ status: 'perishing', remainingSeconds }));
      return;
    }
    this.Perish();
  }

  Perish(): void {
    this.pendingSeconds = 0;
    this.pendingFrames = 0;
    this.timerState.set(PERISHED);
    this.perishfn?.(this.inst);
    if (this.inst.isRemoved) return;
    this.inst.PushEvent('perished', undefined);
    // Holders replace the inst in its slot; world items are replaced by their ground presentation.
    const owner = this.inst.components.inventoryitem.owner;
    if (!this.inst.isRemoved && this.onperishreplacement !== undefined && owner) owner.replace(this.onperishreplacement);
  }

  dispose(): void {
    this.pendingSeconds = 0;
    this.pendingFrames = 0;
    this.world = undefined;
    this.percentMemo.dispose();
    this.stageMemo.dispose();
  }

  private rateModifier(): number {
    const owner = this.inst.components.inventoryitem.owner;
    // Player inventory and backpacks have no preserver/fridge tags; the ground uses PERISH_GROUND_MULT.
    let modifier = owner ? 1 : PERISH_GROUND_MULT;
    if (this.inst.GetIsWet()) modifier *= PERISH_WET_MULT;
    const temperature = this.world?.temperature();
    if (temperature !== undefined && temperature < 0) modifier *= PERISH_WINTER_MULT;
    if (temperature !== undefined && temperature > OVERHEAT_TEMP) modifier *= PERISH_SUMMER_MULT;
    return modifier * PERISH_GLOBAL_MULT * (this.localMultiplier?.() ?? 1);
  }
}
