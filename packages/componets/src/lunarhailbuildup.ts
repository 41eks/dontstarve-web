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

/** The loaded state and passive decay of components/lunarhailbuildup.lua. */
export class LunarHailBuildup {
  private readonly workleft = createSignal(0);
  private buildupcurrent = 0;
  private totalworkamount = 0;
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
  moonglassamount = 0;

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
    this.workleft.set(Math.min(this.workleft.peek(), amount));
  }

  SetMoonGlassAmount(amount: number): void {
    this.moonglassamount = amount;
  }

  IsBuildupWorkable(): boolean {
    return this.workleft.peek() > 0;
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
    const workleft = this.workleft.peek();
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
