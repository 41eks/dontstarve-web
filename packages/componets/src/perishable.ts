import { batch, createEffect, createMemo, createSignal, readonlySignal, watchSignal, type ReadonlySignal } from '../../signals/src';
import type { PerishClock, PerishTick } from './worldperishclock';
import { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer, type TimerSnapshot } from './timer';

// tuning.lua (perish_warp = 1).
export const TOTAL_DAY_TIME = 30 * 16;
export const PERISH_SUPERFAST = 3 * TOTAL_DAY_TIME;
export const PERISH_FAST = 6 * TOTAL_DAY_TIME;
export const PERISH_MED = 10 * TOTAL_DAY_TIME;
export const PERISH_FRESH = .5;
export const PERISH_STALE = .2;
const PERISH_GROUND_MULT = 1.5;
const PERISH_FRIDGE_MULT = .5;
export const PERISH_CAGE_MULT = .25;
const PERISH_WET_MULT = 1.3;
const PERISH_GLOBAL_MULT = 1;
const UPDATE_PERIOD = 10;

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
  hasTag?(tag: string): boolean;
  readonly components: { inventoryitem: { owner: PerishableOwner | null } };
  PushEvent(name: string, data: unknown): void;
}

export interface PerishableOwner {
  hasTag?(tag: string): boolean;
  /** holder:GiveItem(goop, slot) after the perished inst leaves the same slot. */
  replace(prefab: string): boolean;
}

/** The world owns temperature integration; entities only sample cumulative ticks. */
export interface PerishWorld {
  readonly perishClock: PerishClock;
}

const STOPPED: PerishTimer = Object.freeze({ status: 'stopped' });
const PERISHED: PerishTimer = Object.freeze({ status: 'perished' });

/** components/perishable.lua; elapsed time settles every 10 game seconds. */
export class Perishable {
  private readonly perishTimeState = createSignal<number | undefined>(undefined);
  private readonly timerState = createSignal<PerishTimer>(STOPPED);
  readonly perishtime = readonlySignal(this.perishTimeState);
  readonly timer = readonlySignal(this.timerState);
  readonly updateTimer: ReadonlySignal<TimerSnapshot>;
  /** undefined without a perish time, so presentations hide the spoilage meter. */
  readonly percent: ReadonlySignal<number | undefined>;
  readonly stage: ReadonlySignal<PerishStage | undefined>;
  onperishreplacement?: string;
  perishfn?: (inst: PerishableInst) => void;
  /** perishable.lua SetLocalMultiplier, evaluated at each settlement so holder changes take effect. */
  localMultiplier?: () => number;
  /** perishable.lua Update: with no owner, a caged occupant uses occupier:GetOwner() (a "cage", PERISH_CAGE_MULT). */
  occupierCage?: () => boolean;
  private readonly percentMemo;
  private readonly stageMemo;
  private readonly inst: PerishableInst;
  private readonly wet: ReadonlySignal<boolean>;
  private readonly stopWatchingWet: () => void;
  /** Wetness in effect at lastTick, rather than the already changed source value. */
  private settledWet: boolean;
  private readonly scheduler = new GameTimeScheduler();
  private readonly updateTask: ComponentTimer;
  /** Convert scheduler deadlines to this world's game-time coordinates. */
  private schedulerOrigin: number;
  private world?: PerishWorld;
  private lastTick: PerishTick;
  /** Standalone components use normal-temperature game seconds until a world is injected. */
  private localTick: PerishTick = Object.freeze({ time: 0, total: 0 });
  private disposed = false;

  constructor(inst: PerishableInst, wet: ReadonlySignal<boolean>, world?: PerishWorld) {
    this.inst = inst;
    this.world = world;
    this.lastTick = world?.perishClock.GetTick() ?? this.localTick;
    this.schedulerOrigin = this.lastTick.time;
    this.updateTask = new ComponentTimer(this.scheduler, () => {
      const time = this.scheduler.now + this.schedulerOrigin;
      this.Update(this.world?.perishClock.GetTick(time) ?? Object.freeze({ time, total: time }));
      if (!this.disposed && !this.inst.isRemoved && this.IsPerishing()) this.updateTask.start(UPDATE_PERIOD);
    });
    this.updateTimer = this.updateTask.snapshot;
    let stop!: () => void;
    this.wet = watchSignal(wet, cleanup => { stop = cleanup; });
    this.stopWatchingWet = stop;
    this.settledWet = this.wet.peek();
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
    createEffect(() => {
      this.setWetness(this.wet.get());
    });
  }

  IsFresh(): boolean { return this.stage.peek() === 'fresh'; }
  IsStale(): boolean { return this.stage.peek() === 'stale'; }
  IsSpoiled(): boolean { return this.stage.peek() === 'spoiled'; }
  IsPerishing(): boolean { return this.timerState.peek().status === 'perishing'; }
  GetPercent(): number { return this.percent.peek() ?? 0; }

  SetPerishTime(time: number): void {
    if (!Number.isFinite(time) || time <= 0) throw new RangeError('Invalid perish time');
    this.flush();
    const status = this.timerState.peek().status;
    if (this.disposed || this.inst.isRemoved || status === 'perished') return;
    batch(() => {
      this.perishTimeState.set(time);
      this.timerState.set(Object.freeze({ status: status === 'perishing' ? 'perishing' : 'paused', remainingSeconds: time }));
    });
    if (status === 'perishing') this.updateTask.start(UPDATE_PERIOD);
  }

  SetPercent(percent: number): void {
    const currentPerishTime = this.perishTimeState.peek();
    if (currentPerishTime === undefined || !Number.isFinite(percent)) return;
    const clamped = Math.max(0, Math.min(1, percent));
    const currentTimer = this.timerState.peek();
    if (this.disposed || this.inst.isRemoved || currentTimer.status === 'perished') return;
    // Store commits re-apply snapshots: a no-op must retain the pending batch.
    // Read authoritative time because derived percent may be pending in an outer batch.
    if (currentTimer.status !== 'stopped' && currentTimer.remainingSeconds / currentPerishTime === clamped) return;
    this.flush();
    const perishtime = this.perishTimeState.peek()!;
    const timer = this.timerState.peek();
    if (this.disposed || this.inst.isRemoved || timer.status === 'perished') return;
    const remainingSeconds = clamped * perishtime;
    if (timer.status !== 'stopped' && timer.remainingSeconds / perishtime === clamped) return;
    this.timerState.set(Object.freeze({
      status: timer.status === 'perishing' ? 'perishing' : 'paused', remainingSeconds,
    }));
    if (timer.status === 'perishing') this.updateTask.start(UPDATE_PERIOD);
  }

  StartPerishing(): void {
    if (this.disposed || this.inst.isRemoved) return;
    // Rebase while paused so restarting never charges time spent stopped.
    this.flush();
    const timer = this.timerState.peek();
    if (timer.status === 'paused' || timer.status === 'perishing') {
      this.timerState.set(Object.freeze({ status: 'perishing', remainingSeconds: timer.remainingSeconds }));
      this.updateTask.start(UPDATE_PERIOD);
    }
  }

  StopPerishing(): void {
    this.flush();
    this.updateTask.stop();
    const timer = this.timerState.peek();
    if (timer.status === 'perishing') this.timerState.set(Object.freeze({ status: 'paused', remainingSeconds: timer.remainingSeconds }));
  }

  /** Advance active game time; only the scheduled 10-second tasks change remaining time. */
  onFrame(dt: number, world?: PerishWorld): void {
    if (this.disposed || this.inst.isRemoved || this.perishTimeState.peek() === undefined) return;
    if (world) this.BindWorld(world);
    if (this.timerState.peek().status !== 'perishing' || this.inst.isRemoved || !Number.isFinite(dt) || dt <= 0) return;
    if (!this.world) this.localTick = Object.freeze({ time: this.localTick.time + dt, total: this.localTick.total + dt });
    const tick = this.world?.perishClock.GetTick() ?? this.localTick;
    this.scheduler.advanceTo(tick.time - this.schedulerOrigin);
  }

  /** Settle a partial period before saving, transferring, eating or changing the timer. */
  flush(): void {
    this.Update(this.world?.perishClock.GetTick() ?? this.localTick);
  }

  /** Normal settlement, wake-up and future morning snapshots all consume the same prefix difference. */
  Update(tick: PerishTick): void {
    if (this.disposed || this.inst.isRemoved) return;
    if (!Number.isFinite(tick.time) || !Number.isFinite(tick.total)
      || tick.time < this.lastTick.time || tick.total < this.lastTick.total) throw new RangeError('Perish ticks must be finite and monotonic');
    this.scheduler.advanceTo(tick.time - this.schedulerOrigin);
    if (this.disposed || this.inst.isRemoved) return;
    const owner = this.inst.components.inventoryitem.owner;
    const frozen = this.inst.hasTag?.('frozen') === true;
    const refrigeratedFrozen = frozen && owner?.hasTag?.('fridge') === true
      && !owner.hasTag('nocool') && !owner.hasTag('lowcool');
    const frozenClock = frozen ? this.world?.perishClock.GetFrozenTick?.bind(this.world.perishClock) : undefined;
    const accumulatedPerish = refrigeratedFrozen ? 0 : frozenClock
      ? frozenClock(tick.time).total - frozenClock(this.lastTick.time).total
      : tick.total - this.lastTick.total;
    // Advance before callbacks: a perish event can remove or transfer this entity and flush again.
    this.lastTick = Object.freeze({ time: tick.time, total: tick.total });
    if (!this.world && tick.time >= this.localTick.time) this.localTick = this.lastTick;
    const timer = this.timerState.peek(), perishtime = this.perishTimeState.peek();
    if (timer.status !== 'perishing' || perishtime === undefined || this.inst.isRemoved) return;
    if (accumulatedPerish === 0 && timer.remainingSeconds > 0) return;
    const remainingSeconds = Math.min(perishtime, timer.remainingSeconds - accumulatedPerish * this.rateModifier());
    if (remainingSeconds > 0) {
      this.timerState.set(Object.freeze({ status: 'perishing', remainingSeconds }));
      return;
    }
    this.Perish();
  }

  Perish(): void {
    this.updateTask.stop();
    this.timerState.set(PERISHED);
    this.perishfn?.(this.inst);
    if (this.inst.isRemoved) return;
    this.inst.PushEvent('perished', undefined);
    // Holders replace the inst in its slot; world items are replaced by their ground presentation.
    const owner = this.inst.components.inventoryitem.owner;
    if (!this.inst.isRemoved && this.onperishreplacement !== undefined && owner) owner.replace(this.onperishreplacement);
  }

  dispose(): void {
    if (this.disposed) return;
    this.flush();
    this.disposed = true;
    this.stopWatchingWet();
    this.updateTask.stop();
    this.scheduler.dispose();
    this.world = undefined;
    this.percentMemo.dispose();
    this.stageMemo.dispose();
  }

  /** Bind at creation/restoration, before the first world frame; preserve state when changing worlds. */
  BindWorld(world: PerishWorld): void {
    if (this.disposed || this.inst.isRemoved || world.perishClock === this.world?.perishClock) return;
    this.flush();
    if (this.inst.isRemoved || this.disposed) return;
    this.world = world;
    this.lastTick = world.perishClock.GetTick();
    this.schedulerOrigin = this.lastTick.time - this.scheduler.now;
  }

  private setWetness(wet: boolean): void {
    if (this.disposed || this.inst.isRemoved || wet === this.settledWet) return;
    this.flush();
    this.settledWet = wet;
  }

  private rateModifier(): number {
    const owner = this.inst.components.inventoryitem.owner;
    let modifier = owner?.hasTag?.('fridge') ? PERISH_FRIDGE_MULT
      : owner ? 1 : this.occupierCage?.() ? PERISH_CAGE_MULT : PERISH_GROUND_MULT;
    if (this.settledWet) modifier *= PERISH_WET_MULT;
    return modifier * PERISH_GLOBAL_MULT * (this.localMultiplier?.() ?? 1);
  }
}
