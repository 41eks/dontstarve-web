import { createSignal, readonlySignal, type WorldPhase } from '../../signals/src';

/** The entity that owns a sleepingbag: only its tags are touched (`hassleeper`). */
export interface SleepingBagInst {
  addTag(tag: string): void;
  removeTag(tag: string): void;
}

/** The sleepingbaguser side of a sleeper, as the bag sees it (`doer.sleepingbag` and the user component). */
export interface SleepingBagSleeper {
  /** doer.sleepingbag */
  bed: SleepingBag | undefined;
  DoSleep(bed: SleepingBag): void;
  DoWakeUp(nostatechange?: boolean): void;
}

// TUNING.SLEEP_TICK_PERIOD / SLEEP_HUNGER_PER_TICK / SLEEP_HEALTH_PER_TICK / SLEEP_SANITY_PER_TICK.
const SLEEP_TICK_PERIOD = 1;
const SLEEP_HUNGER_PER_TICK = -1;
const SLEEP_HEALTH_PER_TICK = 1;
const SLEEP_SANITY_PER_TICK = 1;

/** components/sleepingbag.lua; the sleeper is a signal, and `hassleeper` follows it. */
export class SleepingBag {
  healthsleep = true;
  dryingrate: number | undefined;
  onsleep?: (inst: SleepingBagInst, sleeper: SleepingBagSleeper) => void;
  onwake?: (inst: SleepingBagInst, sleeper: SleepingBagSleeper, nostatechange: boolean) => void;
  tick_period = SLEEP_TICK_PERIOD;
  hunger_tick = SLEEP_HUNGER_PER_TICK;
  health_tick = SLEEP_HEALTH_PER_TICK;
  sanity_tick = SLEEP_SANITY_PER_TICK;
  temperaturetickfn?: (inst: SleepingBagInst, sleeper: SleepingBagSleeper) => void;
  private sleep_phase: WorldPhase = 'night';
  private readonly sleeperState = createSignal<SleepingBagSleeper | undefined>(undefined);
  readonly sleeper = readonlySignal(this.sleeperState);
  private readonly inst: SleepingBagInst;

  constructor(inst: SleepingBagInst) { this.inst = inst; }

  SetSleepPhase(phase: WorldPhase): void { this.sleep_phase = phase; }
  GetSleepPhase(): WorldPhase { return this.sleep_phase; }
  SetTemperatureTickFn(fn: SleepingBag['temperaturetickfn']): void { this.temperaturetickfn = fn; }

  DoSleep(doer: SleepingBagSleeper): void {
    if (this.sleeperState.peek() !== undefined || doer.bed !== undefined) return;
    this.sleeperState.set(doer);
    this.inst.addTag('hassleeper');
    doer.DoSleep(this);
    this.onsleep?.(this.inst, doer);
  }

  DoWakeUp(nostatechange = false): void {
    const sleeper = this.sleeperState.peek();
    if (!sleeper || sleeper.bed !== this) return;
    sleeper.DoWakeUp(nostatechange);
    this.sleeperState.set(undefined);
    this.inst.removeTag('hassleeper');
    this.onwake?.(this.inst, sleeper, nostatechange);
  }

  /** The bed's temperaturetickfn, run by every sleeper tick. */
  TemperatureTick(sleeper: SleepingBagSleeper): void { this.temperaturetickfn?.(this.inst, sleeper); }

  InUse(): boolean { return this.sleeperState.peek() !== undefined; }

  /** OnRemoveFromEntity / OnRemoveEntity: wake the sleeper before the bed goes away. */
  dispose(): void { this.DoWakeUp(); }
}
