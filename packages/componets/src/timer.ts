import { batch, createSignal, readonlySignal } from '../../signals/src/signal.ts';
import type { GameTimeScheduler } from './gameTimeScheduler';

export type TimerSnapshot =
  | { readonly status: 'stopped' }
  | { readonly status: 'scheduled'; readonly endTime: number }
  | { readonly status: 'paused'; readonly remainingSeconds: number }
  | { readonly status: 'expired' };

/** timer.lua task ownership, with explicit signal snapshots for stop and completion. */
export class ComponentTimer {
  private readonly state = createSignal<TimerSnapshot>(Object.freeze({ status: 'stopped' }));
  readonly snapshot = readonlySignal(this.state);
  private cancelTask?: () => void;

  private readonly scheduler: GameTimeScheduler;
  private readonly onDone: () => void;

  constructor(scheduler: GameTimeScheduler, onDone: () => void) {
    this.scheduler = scheduler; this.onDone = onDone;
  }

  get remainingSeconds(): number | undefined {
    const timer = this.state.peek();
    return timer.status === 'scheduled' ? Math.max(0, timer.endTime - this.scheduler.now)
      : timer.status === 'paused' ? timer.remainingSeconds : undefined;
  }

  start(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Invalid timer duration');
    this.cancelTask?.();
    this.cancelTask = this.scheduler.schedule(seconds, () => {
      this.cancelTask = undefined;
      batch(() => {
        this.state.set(Object.freeze({ status: 'expired' }));
        this.onDone();
      });
    });
    this.state.set(Object.freeze({ status: 'scheduled', endTime: this.scheduler.now + seconds }));
  }

  pause(): void {
    if (this.state.peek().status !== 'scheduled') return;
    const remainingSeconds = this.remainingSeconds!;
    this.cancelTask?.(); this.cancelTask = undefined;
    this.state.set(Object.freeze({ status: 'paused', remainingSeconds }));
  }

  restorePaused(remainingSeconds: number): void {
    if (!Number.isFinite(remainingSeconds) || remainingSeconds < 0) throw new RangeError('Invalid paused duration');
    this.cancelTask?.(); this.cancelTask = undefined;
    this.state.set(Object.freeze({ status: 'paused', remainingSeconds }));
  }

  stop(): void {
    this.cancelTask?.(); this.cancelTask = undefined;
    if (this.state.peek().status !== 'stopped') this.state.set(Object.freeze({ status: 'stopped' }));
  }
}

export interface SavedNamedTimer { timeleft: number; paused: boolean; initial_time: number; }
export interface NamedTimerSave { timers: Record<string, SavedNamedTimer>; }

/** timer.lua: named tasks keep distinct stopped/expired snapshots; only live timers persist. */
export class Timer {
  private readonly timers = new Map<string, { timer: ComponentTimer; initialTime: number }>();
  private readonly scheduler: GameTimeScheduler;
  private readonly onDone: (name: string) => void;
  private disposed = false;
  constructor(scheduler: GameTimeScheduler, onDone: (name: string) => void, names: readonly string[] = []) {
    this.scheduler = scheduler; this.onDone = onDone;
    for (const name of names) this.ensure(name);
  }
  private ensure(name: string) {
    let entry = this.timers.get(name);
    if (!entry) {
      entry = { timer: new ComponentTimer(this.scheduler, () => this.onDone(name)), initialTime: 0 };
      this.timers.set(name, entry);
    }
    return entry;
  }
  snapshot(name: string) { return this.ensure(name).timer.snapshot; }
  TimerExists(name: string): boolean {
    const status = this.timers.get(name)?.timer.snapshot.peek().status;
    return status === 'scheduled' || status === 'paused';
  }
  StartTimer(name: string, seconds: number, paused = false, initialTime = seconds): boolean {
    if (this.disposed || this.TimerExists(name)) return false;
    const entry = this.ensure(name); entry.initialTime = initialTime;
    if (paused) entry.timer.restorePaused(seconds); else entry.timer.start(seconds);
    return true;
  }
  StopTimer(name: string): void { if (this.TimerExists(name)) this.timers.get(name)?.timer.stop(); }
  GetTimeLeft(name: string): number | undefined { return this.timers.get(name)?.timer.remainingSeconds; }
  GetTimeElapsed(name: string): number | undefined {
    const remaining = this.GetTimeLeft(name);
    return remaining === undefined ? undefined : this.timers.get(name)!.initialTime - remaining;
  }
  PauseTimer(name: string): void { this.timers.get(name)?.timer.pause(); }
  ResumeTimer(name: string): boolean {
    const entry = this.timers.get(name);
    if (this.disposed || entry?.timer.snapshot.peek().status !== 'paused') return false;
    entry.timer.start(entry.timer.remainingSeconds!); return true;
  }
  OnSave(): NamedTimerSave | undefined {
    const timers = Object.fromEntries([...this.timers].filter(([name]) => this.TimerExists(name)).map(([name, entry]) =>
      [name, { timeleft: Math.min(entry.initialTime, entry.timer.remainingSeconds!),
        paused: entry.timer.snapshot.peek().status === 'paused', initial_time: entry.initialTime }]));
    return Object.keys(timers).length ? { timers } : undefined;
  }
  OnLoad(data?: NamedTimerSave): void {
    if (!data || this.disposed) return;
    for (const [name, saved] of Object.entries(data.timers)) {
      this.StopTimer(name); this.StartTimer(name, saved.timeleft, saved.paused, saved.initial_time);
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const name of this.timers.keys()) this.StopTimer(name);
  }
}
