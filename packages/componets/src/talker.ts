import { createSignal, readonlySignal } from '../../signals/src';
import type { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';

/** tuning.lua DEFAULT_TALKER_DURATION / MAX_TALKER_DURATION. */
const DEFAULT_TALKER_DURATION = 2.5;
const MAX_TALKER_DURATION = 8;

export interface TalkerInst {
  PushEvent(name: string, data?: unknown): void;
  readonly components?: object;
}

/** components/talker.lua for one line at a time: the text the HUD shows, and the ontalk / donetalking events. */
export class Talker {
  private readonly inst: TalkerInst;
  private readonly lineState = createSignal<string | undefined>(undefined);
  /** The widget's string while the line is said. */
  readonly line = readonlySignal(this.lineState);
  private readonly task: ComponentTimer;

  constructor(inst: TalkerInst, scheduler: GameTimeScheduler) {
    this.inst = inst;
    this.task = new ComponentTimer(scheduler, () => this.finish());
  }

  IsTalking(): boolean {
    return this.lineState.peek() !== undefined;
  }

  /** Talker:Say(script, time, noanim, force); a script of several lines is not used by anything ported. */
  Say(script: string, time?: number, noanim?: boolean, force?: boolean): void {
    const { health, sleeper } = (this.inst.components ?? {}) as {
      health?: { IsDead(): boolean };
      sleeper?: { IsAsleep(): boolean };
    };
    if (!force && (health?.IsDead() || sleeper?.IsAsleep())) {
      return;
    }
    this.ShutUp();
    const duration = Math.min(time ?? DEFAULT_TALKER_DURATION, MAX_TALKER_DURATION);
    this.lineState.set(script);
    this.inst.PushEvent('ontalk', { noanim, duration });
    this.task.start(duration);
  }

  /** CancelSay: a line in progress ends now, with its donetalking. */
  ShutUp(): void {
    if (!this.IsTalking()) {
      return;
    }
    this.task.stop();
    this.finish();
  }

  private finish(): void {
    this.lineState.set(undefined);
    this.inst.PushEvent('donetalking');
  }

  OnRemoveEntity(): void {
    this.ShutUp();
  }
}
