import { createMemo, createSignal, readonlySignal, type ReadonlySignal } from '../../signals/src';
import type { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';

export interface LunarHailBuildupSaveData {
  workleft?: number;
  buildupcurrent?: number;
}

interface LunarHailInst {
  addTag(tag: string): void;
  removeTag(tag: string): void;
  PushEvent(name: string, data?: unknown): void;
}

// tuning.lua LUNARHAIL_BUILDUP_*: the buildup amounts standardcomponents.lua's SetLunarHailBuildupAmount* choose.
export const LUNARHAIL_BUILDUP_TOTAL_WORK_AMOUNT_SMALL = 2;
export const LUNARHAIL_BUILDUP_MOONGLASS_AMOUNT_SMALL = 1;
export const LUNARHAIL_BUILDUP_TOTAL_WORK_AMOUNT_MEDIUM = 3;
export const LUNARHAIL_BUILDUP_MOONGLASS_AMOUNT_MEDIUM = 2;
export const LUNARHAIL_BUILDUP_TOTAL_WORK_AMOUNT_LARGE = 4;
export const LUNARHAIL_BUILDUP_MOONGLASS_AMOUNT_LARGE = 3;
/** LUNARHAIL_BUILDUP_DECAY_TICK_TIME, in seconds. */
export const LUNARHAIL_BUILDUP_DECAY_TICK_TIME = 4.5;
/** LUNARHAIL_BUILDUP_DECAY_RATE: 1 / total_day_time, per second. */
export const LUNARHAIL_BUILDUP_DECAY_RATE = 1 / 480;

/** The loaded state and passive decay of components/lunarhailbuildup.lua. */
export class LunarHailBuildup {
  private readonly workleft = createSignal(0);
  private buildupcurrent = 0;
  private totalworkamount = LUNARHAIL_BUILDUP_TOTAL_WORK_AMOUNT_MEDIUM;
  private readonly decay: ComponentTimer;
  private readonly inst: LunarHailInst;
  private readonly decayPeriod: number;
  private readonly decayRate: number;
  readonly timer;
  /**
   * IsBuildupWorkable as state: whether there is buildup left to knock off. standardcomponents.lua
   * UpdateLunarHailBuildup's look follows it, which the display combines with the world's issnowcovered.
   */
  readonly buildupWorkable: ReadonlySignal<boolean>;
  moonglassamount = LUNARHAIL_BUILDUP_MOONGLASS_AMOUNT_MEDIUM;

  constructor(inst: LunarHailInst, scheduler: GameTimeScheduler, decayPeriod: number, decayRate: number) {
    this.inst = inst;
    this.decayPeriod = decayPeriod;
    this.decayRate = decayRate;
    this.decay = new ComponentTimer(scheduler, () => {
      this.DoBuildupDelta(-this.decayPeriod * this.decayRate);
      if (this.buildupcurrent > 0) {
        this.decay.start(this.decayPeriod);
      }
    });
    this.timer = this.decay.snapshot;
    this.buildupWorkable = readonlySignal(createMemo(() => this.workleft.get() > 0));
  }

  SetTotalWorkAmount(amount: number): void {
    this.totalworkamount = amount;
    this.workleft.set(Math.min(this.workleft.value, amount));
  }

  SetMoonGlassAmount(amount: number): void {
    this.moonglassamount = amount;
  }

  IsBuildupWorkable(): boolean {
    return this.workleft.value > 0;
  }

  private setWorkLeft(workleft: number): void {
    const workable = this.IsBuildupWorkable();
    this.workleft.set(workleft);
    if (workable !== this.IsBuildupWorkable()) {
      if (this.IsBuildupWorkable()) {
        this.inst.addTag('LunarBuildup');
      } else {
        this.inst.removeTag('LunarBuildup');
      }
      this.inst.PushEvent('lunarhailbuildupworkablestatechanged');
    }
  }

  private DoBuildupDelta(delta: number): void {
    const previous = this.buildupcurrent;
    const next = Math.min(1, Math.max(0, previous + delta));
    if (next === previous) {
      return;
    }
    this.buildupcurrent = next;
    if (next === 1 && !this.IsBuildupWorkable()) {
      this.setWorkLeft(this.totalworkamount);
    } else if (next === 0) {
      this.setWorkLeft(0);
    }
    this.inst.PushEvent('lunarhailbuildupdelta', { oldpercent: previous, newpercent: next });
  }

  OnSave(): LunarHailBuildupSaveData {
    const workleft = this.workleft.value;
    return {
      ...(workleft > 0 ? { workleft } : {}),
      ...(this.buildupcurrent > 0 ? { buildupcurrent: this.buildupcurrent } : {}),
    };
  }

  OnLoad({ workleft, buildupcurrent }: LunarHailBuildupSaveData): void {
    if (workleft !== undefined) {
      this.setWorkLeft(Math.min(workleft, this.totalworkamount));
    }
    if (buildupcurrent !== undefined) {
      this.DoBuildupDelta(buildupcurrent - this.buildupcurrent);
    }
  }

  LoadPostPass(_newents: unknown, _data: LunarHailBuildupSaveData): void {
    if (this.buildupcurrent > 0) {
      this.decay.start(Math.random() * this.decayPeriod);
    }
  }

  OnRemoveFromEntity(): void {
    this.decay.stop();
    this.setWorkLeft(0);
  }
}
