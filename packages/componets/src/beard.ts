import { batch, createMemo, createSignal, readonlySignal } from '../../signals/src';
import type { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';

export type BeardVerdict = { ok: true } | { ok: false; reason?: string };
export type BeardTest = (inst: BeardInst, shaver: unknown) => BeardVerdict;

export interface BeardInst {
  PushEvent(name: string, data?: unknown): void;
  getPosition(): { x: number; y: number; z: number };
}

export interface BeardSave { growth: number; growthaccumulator: number; bits: number }

/** Where the beard's prize bits go: the host spawns and launches them (beard.lua SpawnPrefab + SetVel). */
export interface BeardHost {
  /** The scene's game-time scheduler, shared with every other component timer. */
  readonly scheduler: GameTimeScheduler;
  /**
   * Seconds from the scheduler time `now` until the world's next day boundary, strictly positive.
   * The world owns the day length, so the beard never reads the clock or the tuning itself.
   */
  secondsUntilNextDay(now: number): number;
  spawnPrize(prefab: string, count: number, position: { x: number; y: number; z: number }): void;
}

/**
 * components/beard.lua for non-player insts. Not ported: the Wilson beard-skill bonus days,
 * the beard sack inventory (UpdateBeardInventory), the respawn reset and sanity gain on self-shaving.
 *
 * Bits and growth days are private signals with read-only views; `hairy` is a pure memo of them.
 * Domain logic reads the signals with `peek()`, so it sees the value written inside an open batch.
 * Growth is one discrete timer to the next day boundary on the shared scheduler (a private signal snapshot,
 * unchanged while waiting); each expiry calls OnDayComplete and arms the next boundary, so a long
 * frame or a load catches up one day at a time. It replaces beard.lua's WatchWorldState("cycles").
 */
export class Beard {
  private readonly bitsState = createSignal(0);
  private readonly daysgrowthState = createSignal(0);
  private readonly accumulatorState = createSignal(0);
  readonly bits = readonlySignal(this.bitsState);
  readonly daysgrowth = readonlySignal(this.daysgrowthState);
  readonly daysgrowthaccumulator = readonlySignal(this.accumulatorState);
  /** Whether any hair is left; the prefab derives its has_beard tag and hairy build from it. */
  readonly hairy = createMemo(() => this.bitsState.get() > 0);
  insulation_factor = 1;
  pause = false;
  prize?: string;
  onreset?: (inst: BeardInst) => void;
  canshavetest?: BeardTest;
  private readonly callbacks = new Map<number, (inst: BeardInst) => void>();
  private readonly dayTimer: ComponentTimer;
  /** Read-only view of the day timer: scheduled, stopped (growth disabled or disposed) or expired. */
  readonly dayTimerState;
  private disposed = false;
  private readonly inst: BeardInst;
  private readonly host: BeardHost;

  constructor(inst: BeardInst, host: BeardHost) {
    this.inst = inst;
    this.host = host;
    this.dayTimer = new ComponentTimer(host.scheduler, () => this.onDayBoundary());
    this.dayTimerState = this.dayTimer.snapshot;
    this.EnableGrowth(true);
  }

  /** beard.lua's constructor adds the "bearded" tag, whatever the bit count. */
  HasTag(tag: string): boolean | undefined { return tag === 'bearded' && !this.disposed ? true : undefined; }

  /** Direct assignment of `bits` / `daysgrowth` by the owning prefab (beefalo.lua, SGBeefalo.lua). */
  SetBits(bits: number): void { this.bitsState.set(bits); }
  SetDaysGrowth(days: number): void { this.daysgrowthState.set(days); }

  AddCallback(day: number, cb: (inst: BeardInst) => void): void { this.callbacks.set(day, cb); }

  EnableGrowth(enable: boolean): void {
    if (enable && !this.disposed) {
      if (this.dayTimer.snapshot.peek().status !== 'scheduled') this.armDayTimer();
    } else if (!enable) this.dayTimer.stop();
  }

  private armDayTimer(): void {
    this.dayTimer.start(this.host.secondsUntilNextDay(this.host.scheduler.now));
  }

  /** The timer expired at the day boundary: grow, then wait for the next one. */
  private onDayBoundary(): void {
    if (this.disposed) return;
    this.OnDayComplete();
    if (!this.disposed) this.armDayTimer();
  }

  private DoCallbacksForDay(): void { this.callbacks.get(this.daysgrowthState.peek())?.(this.inst); }

  OnDayComplete(): void {
    if (this.pause) return;
    this.daysgrowthState.set(this.daysgrowthState.peek() + 1);
    this.DoCallbacksForDay();
  }

  ShouldTryToShave(doer: unknown): BeardVerdict {
    if (this.bitsState.peek() === 0) return { ok: false, reason: 'NOBITS' };
    return this.canshavetest?.(this.inst, doer) ?? { ok: true };
  }

  Shave(doer: unknown): BeardVerdict {
    const verdict = this.ShouldTryToShave(doer);
    if (!verdict.ok) return verdict;
    const oldbits = this.bitsState.peek();
    let currentflag = true;
    let daysback = 0;
    for (let k = this.daysgrowthState.peek(); k >= 0; k--) {
      const cb = this.callbacks.get(k);
      if (cb) {
        // skip past current level
        if (currentflag) currentflag = false;
        else { cb(this.inst); break; }
      }
      daysback++;
    }
    this.daysgrowthState.set(this.daysgrowthState.peek() - daysback);
    if (this.daysgrowthState.peek() <= 0) this.Reset();
    const dropbits = oldbits - this.bitsState.peek();
    if (this.prize !== undefined && dropbits > 0) this.host.spawnPrize(this.prize, dropbits, this.inst.getPosition());
    this.inst.PushEvent('shaved');
    return { ok: true };
  }

  Reset(): void {
    batch(() => {
      this.daysgrowthState.set(0);
      this.accumulatorState.set(0);
      this.bitsState.set(0);
    });
    this.onreset?.(this.inst);
  }

  OnSave(): BeardSave {
    return { growth: this.daysgrowthState.peek(), growthaccumulator: this.accumulatorState.peek(), bits: this.bitsState.peek() };
  }

  OnLoad(data: Partial<BeardSave>): void {
    batch(() => {
      if (data.bits !== undefined) this.bitsState.set(data.bits);
      if (data.growth !== undefined) this.daysgrowthState.set(data.growth);
      if (data.growthaccumulator !== undefined) this.accumulatorState.set(data.growthaccumulator);
    });
    for (let k = 0; k <= this.daysgrowthState.peek(); k++) this.callbacks.get(k)?.(this.inst);
  }

  dispose(): void {
    this.EnableGrowth(false);
    this.disposed = true;
    this.hairy.dispose();
  }
}
