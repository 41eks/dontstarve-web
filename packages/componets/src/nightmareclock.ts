import { createSignal, readonlySignal } from '../../signals/src/signal.ts';
import type { WorldNightmarePhase } from '../../signals/src/world';
import type { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';

export type NightmarePhase = Exclude<WorldNightmarePhase, 'none'>;
export type NightmareSegs = Readonly<Record<NightmarePhase, number>>;

const PHASE_NAMES: readonly NightmarePhase[] = ['calm', 'warn', 'wild', 'dawn'];

export interface NightmareClockOptions {
  /** TUNING.NIGHTMARE_SEGS */
  readonly segs: NightmareSegs;
  /** TUNING.SEG_TIME */
  readonly segTime: number;
  /** TUNING.NIGHTMARE_SEG_VARIATION */
  readonly segVariation: number;
  readonly random?: () => number;
}

/** nightmareclock.lua OnSave. */
export interface NightmareClockSaveData {
  lengths: Record<NightmarePhase, number>;
  phase: NightmarePhase;
  totaltimeinphase: number;
  remainingtimeinphase: number;
  lockedphase?: NightmarePhase;
}

/**
 * nightmareclock.lua on the game-time scheduler: the phase ends at a deadline instead of decrementing a remaining time
 * each frame, and a scheduled task's actual deadline carries the overshoot of a long frame into the next phase.
 * Lua's ms_* events are methods. The ambient sounds stay out until areaaware can tell where the player is.
 */
export class NightmareClock {
  private readonly current = createSignal<NightmarePhase>('calm');
  /** worldstate.lua nightmarephase, published once per settlement as nightmarephasechanged is. */
  readonly phase = readonlySignal(this.current);
  private readonly phaseTimer: ComponentTimer;
  readonly timer: ComponentTimer['snapshot'];
  private readonly defaults: NightmareSegs;
  private segs: NightmareSegs;
  private readonly segTime: number;
  private readonly segVariation: number;
  private readonly random: () => number;
  private totalTimeInPhase: number;
  private lockedPhase?: NightmarePhase;

  constructor(scheduler: GameTimeScheduler, options: NightmareClockOptions) {
    this.defaults = this.segs = options.segs;
    this.segTime = options.segTime;
    this.segVariation = options.segVariation;
    this.random = options.random ?? Math.random;
    this.phaseTimer = new ComponentTimer(scheduler, () => { if (this.lockedPhase === undefined) this.advance(this.current.peek()); });
    this.timer = this.phaseTimer.snapshot;
    // Initialization is the one place the source sets a phase's time without the random variation.
    this.totalTimeInPhase = this.segs.calm * this.segTime;
    this.setRemaining(this.totalTimeInPhase);
  }

  get remainingTimeInPhase(): number { return this.phaseTimer.remainingSeconds ?? 0; }

  /** worldstate.lua nightmaretimeinphase; sampled on demand because the phase timer stays discrete. */
  GetTimeInPhase(): number {
    return 1 - (this.totalTimeInPhase > 0 ? this.remainingTimeInPhase / this.totalTimeInPhase : 0);
  }

  /** ms_setnightmaresegs; no lengths restores the defaults. The fraction of the phase left is kept. */
  SetSegs(lengths?: Partial<NightmareSegs>): void {
    const remaining = this.totalTimeInPhase > 0 ? this.remainingTimeInPhase / this.totalTimeInPhase : 1;
    this.segs = lengths
      ? { calm: lengths.calm ?? 0, warn: lengths.warn ?? 0, wild: lengths.wild ?? 0, dawn: lengths.dawn ?? 0 }
      : this.defaults;
    this.totalTimeInPhase = this.rollTime(this.current.peek());
    this.setRemaining(remaining * this.totalTimeInPhase);
  }

  /** ms_setnightmarephase */
  SetPhase(phase: NightmarePhase): void {
    if (this.lockedPhase !== undefined) return;
    this.totalTimeInPhase = this.rollTime(phase);
    this.current.set(phase);
    this.setRemaining(this.totalTimeInPhase);
  }

  /** ms_nextnightmarephase */
  NextPhase(): void {
    if (this.lockedPhase !== undefined) return;
    this.setRemaining(0);
  }

  /** ms_nextnightmarecycle: from the last phase, so the next one is the first. */
  NextCycle(): void {
    if (this.lockedPhase !== undefined) return;
    this.phaseTimer.stop();
    this.advance('dawn');
  }

  /** ms_locknightmarephase: holds a phase with no time left; unlocking therefore moves on to the next phase. */
  LockPhase(phase?: NightmarePhase): void {
    this.lockedPhase = phase;
    if (phase !== undefined) {
      this.totalTimeInPhase = this.rollTime(phase);
      this.current.set(phase);
      this.phaseTimer.stop();
    } else if (this.remainingTimeInPhase <= 0) {
      this.advance(this.current.peek());
    }
  }

  OnSave(): NightmareClockSaveData {
    return {
      lengths: { ...this.segs },
      phase: this.current.peek(),
      totaltimeinphase: this.totalTimeInPhase,
      remainingtimeinphase: this.remainingTimeInPhase,
      ...(this.lockedPhase === undefined ? {} : { lockedphase: this.lockedPhase }),
    };
  }

  OnLoad(data: NightmareClockSaveData): void {
    this.segs = { ...data.lengths };
    this.lockedPhase = data.lockedphase;
    this.totalTimeInPhase = data.totaltimeinphase;
    this.current.set(data.phase);
    this.setRemaining(Math.min(data.remainingtimeinphase, data.totaltimeinphase));
  }

  dispose(): void { this.phaseTimer.stop(); }

  private rollTime(phase: NightmarePhase): number {
    return this.segs[phase] * this.segTime + this.random() * this.segVariation * this.segTime;
  }

  /** OnUpdate's two branches: time left runs down; none left moves on unless the phase is locked. */
  private setRemaining(seconds: number): void {
    if (seconds > 0) { this.phaseTimer.start(seconds); return; }
    this.phaseTimer.stop();
    if (this.lockedPhase === undefined) this.advance(this.current.peek());
  }

  /** Skips phases that roll no time, publishing only the phase it stops on. */
  private advance(from: NightmarePhase): void {
    let phase = from, total: number;
    do {
      phase = PHASE_NAMES[(PHASE_NAMES.indexOf(phase) + 1) % PHASE_NAMES.length];
      total = this.rollTime(phase);
    } while (total <= 0);
    this.totalTimeInPhase = total;
    this.current.set(phase);
    this.phaseTimer.start(total);
  }
}
