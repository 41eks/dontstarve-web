import { createMemo, createSignal, readonlySignal } from '../../signals/src';
import { ComponentTimer } from './timer';
import type { GameTimeScheduler } from './gameTimeScheduler';

export interface GrowthStage {
  time(): number;
  fn?(): void;
  growfn?(): void;
}
export interface GrowableSave { stage: number; time?: number; sleeptime?: number; }

/** growable.lua: stage work and growth tasks survive visual sleep independently. */
export class Growable {
  private readonly stageState = createSignal(1);
  readonly stage = readonlySignal(this.stageState);
  private readonly sleepStarted = createSignal<{ since: number; pausedAt: number } | undefined>(undefined);
  private readonly timer: ComponentTimer;
  private readonly growingMemo;
  readonly state;
  loopstages = false;
  springgrowth = false;
  magicgrowable = false;
  /** growable.lua DoGrowth: growfn runs but the stage is left for the prefab to advance (mushtree DoGrowNextStage). */
  growonly = false;
  private disposed = false;
  private readonly pauseReasons = new Set<string>();
  private readonly scheduler: GameTimeScheduler;
  readonly stages: readonly GrowthStage[];
  private readonly growthDuration: (seconds: number) => number;

  constructor(scheduler: GameTimeScheduler, stages: readonly GrowthStage[],
    growthDuration: (seconds: number) => number = seconds => seconds) {
    this.scheduler = scheduler; this.stages = stages; this.growthDuration = growthDuration;
    this.timer = new ComponentTimer(scheduler, () => this.grow(false));
    this.growingMemo = createMemo(() => this.timer.snapshot.get().status === 'scheduled'
      || (this.timer.snapshot.get().status === 'paused' && this.sleepStarted.get() !== undefined));
    this.state = Object.freeze({ stage: this.stage, timer: this.timer.snapshot, growing: readonlySignal(this.growingMemo) });
  }
  GetStage(): number { return this.stageState.peek(); }
  GetNextStage(): number { return this.GetStage() < this.stages.length ? this.GetStage() + 1 : this.loopstages ? 1 : this.stages.length; }
  SetStage(stage: number): void {
    if (this.disposed) return;
    this.stageState.set(Math.max(1, Math.min(this.stages.length, stage)));
    this.stages[this.GetStage() - 1]?.fn?.();
  }
  IsGrowing(): boolean {
    return !this.disposed && (this.timer.snapshot.peek().status === 'scheduled'
      || (this.timer.snapshot.peek().status === 'paused' && this.sleepStarted.peek() !== undefined));
  }
  StartGrowing(time?: number): void {
    if (this.disposed) return;
    this.StopGrowing();
    const seconds = Math.max(0, time ?? this.stages[this.GetStage() - 1].time());
    this.timer.start(this.springgrowth ? this.growthDuration(seconds) : seconds);
  }
  StopGrowing(): void { this.timer.stop(); this.sleepStarted.set(undefined); }
  DoGrowth(skipgrownfn = false): boolean {
    if (this.disposed || this.timer.remainingSeconds === undefined) return false;
    return this.grow(skipgrownfn);
  }
  private grow(skipgrownfn: boolean): boolean {
    if (this.disposed) return false;
    const stage = this.GetNextStage();
    if (!this.growonly) this.SetStage(stage);
    if (!skipgrownfn) this.stages[stage - 1]?.growfn?.();
    if (!this.disposed) {
      if (this.GetStage() < this.stages.length || this.loopstages) this.StartGrowing();
      else this.StopGrowing();
    }
    return true;
  }
  Pause(reason: string): void {
    if (this.sleepStarted.peek() !== undefined) this.OnEntityWake();
    this.timer.pause(); this.pauseReasons.add(reason);
  }
  Resume(reason: string): void {
    this.pauseReasons.delete(reason);
    if (!this.disposed && !this.pauseReasons.size && this.timer.snapshot.peek().status === 'paused') {
      this.timer.start(this.timer.remainingSeconds!);
    }
  }
  OnEntitySleep(): void {
    if (this.disposed || this.timer.snapshot.peek().status !== 'scheduled') return;
    this.timer.pause(); this.sleepStarted.set({ since: this.scheduler.now, pausedAt: this.scheduler.now });
  }
  OnEntityWake(): void {
    const sleep = this.sleepStarted.peek();
    if (this.disposed || sleep === undefined) return;
    // Lua retains targettime while asleep, then LongUpdate subtracts the sleep dt
    // from targettime - GetTime(). Saved sleeptime is restored independently.
    const dt = this.scheduler.now - sleep.since;
    let remaining = this.timer.remainingSeconds! - (this.scheduler.now - sleep.pausedAt) - dt;
    this.sleepStarted.set(undefined);
    const previousStage = this.GetStage();
    while (dt > 0 && remaining <= 0 && !this.disposed) {
      this.grow(true);
      const next = this.timer.remainingSeconds;
      if (next === undefined) break;
      remaining += next;
    }
    if (!this.disposed && this.timer.remainingSeconds !== undefined) this.timer.start(Math.max(0, remaining));
    if (!this.disposed && previousStage !== this.GetStage()) this.stages[this.GetStage() - 1]?.growfn?.();
  }
  OnSave(): GrowableSave {
    const remaining = this.timer.remainingSeconds, sleep = this.sleepStarted.peek();
    return { stage: this.GetStage(), ...(remaining === undefined ? {} : {
      time: Math.max(0, Math.floor(remaining - (sleep === undefined ? 0 : this.scheduler.now - sleep.pausedAt))),
    }), ...(sleep === undefined ? {} : { sleeptime: Math.max(0, Math.floor(this.scheduler.now - sleep.since)) }) };
  }
  OnLoad(data: GrowableSave): void {
    this.StopGrowing(); this.SetStage(data.stage);
    if (data.time !== undefined) this.StartGrowing(data.time);
    if (data.sleeptime !== undefined && this.timer.remainingSeconds !== undefined) {
      this.timer.pause(); this.sleepStarted.set({ since: this.scheduler.now - data.sleeptime, pausedAt: this.scheduler.now });
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.StopGrowing(); this.growingMemo.dispose(); this.pauseReasons.clear();
  }
}
