import type { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';
import type { SleepingBag, SleepingBagSleeper } from './sleepingbag';
import type { ReadonlySignal, WorldPhase } from '../../signals/src';

export interface SleepingBagUserOptions {
  scheduler: GameTimeScheduler;
  /** TheWorld.state.phase, which WatchWorldState("phase") observes. */
  phase: ReadonlySignal<WorldPhase>;
  hunger?: { DoDelta(delta: number, overtime?: boolean, ignoreInvincible?: boolean): void; IsStarving(): boolean };
  sanity?: { DoDelta(delta: number, overtime?: boolean): void; GetPercentWithPenalty(): number };
  health?: { DoDelta(delta: number, overtime?: boolean, cause?: string, ignoreInvincible?: boolean): number | void };
  /** `inst.sg:GoToState("wakeup", { goodsleep })`, skipped when `nostatechange` is set. */
  goToWakeup(data: { goodsleep: boolean }): void;
  /** Whether a head item tagged `good_sleep_aid` is equipped. */
  hasGoodSleepAid?(): boolean;
}

// TUNING.GOODSLEEP_SANITY: the extra sanity a good sleep aid adds to every tick.
const GOODSLEEP_SANITY = 1.3;

/** components/sleepingbaguser.lua: the sleeper's per-tick hunger, sanity and health changes. */
export class SleepingBagUser implements SleepingBagSleeper {
  bed: SleepingBag | undefined;
  hunger_bonus_mult = 1;
  health_bonus_mult = 1;
  sanity_bonus_mult = 1;
  cansleepfn?: () => readonly [success: boolean, reason?: string];
  private readonly tick: ComponentTimer;
  private stopWatchingPhase?: () => void;
  private readonly options: SleepingBagUserOptions;

  constructor(options: SleepingBagUserOptions) {
    this.options = options;
    this.tick = new ComponentTimer(options.scheduler, () => {
      this.SleepTick();
      // A tick may have woken the sleeper, which stops the task.
      if (this.bed) this.tick.start(this.bed.tick_period);
    });
  }

  SetHungerBonusMult(bonus: number): void { this.hunger_bonus_mult = bonus; }
  SetHealthBonusMult(bonus: number): void { this.health_bonus_mult = bonus; }
  SetSanityBonusMult(bonus: number): void { this.sanity_bonus_mult = bonus; }
  SetCanSleepFn(fn: SleepingBagUser['cansleepfn']): void { this.cansleepfn = fn; }

  ShouldSleep(): readonly [success: boolean, reason?: string] { return this.cansleepfn ? this.cansleepfn() : [true]; }

  /** Waking when the phase leaves the bed's sleep phase, e.g. at dawn for a tent. */
  private wakeUpTest(phase: WorldPhase): void {
    const bed = this.bed;
    if (bed && phase !== bed.GetSleepPhase()) bed.DoWakeUp();
  }

  DoSleep(bed: SleepingBag): void {
    this.bed = bed;
    this.stopWatchingPhase?.();
    this.stopWatchingPhase = this.options.phase.subscribe(phase => this.wakeUpTest(phase));
    this.tick.start(bed.tick_period);
  }

  DoWakeUp(nostatechange = false): void {
    this.tick.stop();
    this.stopWatchingPhase?.();
    this.stopWatchingPhase = undefined;
    this.bed = undefined;
    if (!nostatechange) this.options.goToWakeup({ goodsleep: this.options.hasGoodSleepAid?.() === true });
  }

  SleepTick(): void {
    const bed = this.bed;
    if (!bed) return;
    const { hunger, sanity, health } = this.options;
    const goodsleeper = this.options.hasGoodSleepAid?.() === true;
    const hungerTick = bed.hunger_tick * this.hunger_bonus_mult;
    const healthTick = bed.health_tick * this.health_bonus_mult;
    const sanityTick = bed.sanity_tick * this.sanity_bonus_mult * (goodsleeper ? GOODSLEEP_SANITY : 1);

    let starving = false;
    if (hunger) {
      hunger.DoDelta(hungerTick, true, true);
      starving = hunger.IsStarving();
    }
    if (sanity && sanity.GetPercentWithPenalty() < 1) sanity.DoDelta(sanityTick, true);
    if (!starving && bed.healthsleep) health?.DoDelta(healthTick, true, undefined, true);
    bed.TemperatureTick(this);
    if (starving) bed.DoWakeUp();
  }

  dispose(): void {
    this.tick.stop();
    this.stopWatchingPhase?.();
    this.stopWatchingPhase = undefined;
    this.bed = undefined;
  }
}
