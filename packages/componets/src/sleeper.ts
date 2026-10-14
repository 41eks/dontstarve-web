import { readonlySignal, createEffect, createSignal, WorldContentKey, type GetWatchWorldContent, type WorldPhase } from '../../signals/src';
import { ComponentTimer } from './timer';

/**
 * What components/sleeper.lua reads from its inst. Not ported (the beefalo has none of them yet):
 * teamattacker, freezable, light watching, and the sleepiness/diminishing-returns drugs.
 */
export interface SleeperInst {
  isValid(): boolean;
  PushEvent(name: string, data?: unknown): void;
  isNear?(home: { getPosition(): unknown }, distance: number): boolean;
  readonly sg?: { hasStateTag(tag: string): boolean };
  readonly components: {
    homeseeker?: { home?: { isValid(): boolean; getPosition(): unknown } };
    health?: { IsDead?(): boolean; takingfiredamage?: boolean };
    combat?: { target?: unknown };
    burnable?: { IsBurning?(): boolean };
    locomotor?: { Stop(): void };
  };
}

export type SleeperTest = (inst: SleeperInst, cycle: WorldPhase) => boolean;

/** sleeper.lua StandardSleepChecks, including home proximity; freezable/teamattacker are unported. */
export function StandardSleepChecks(inst: SleeperInst): boolean {
  const { combat, burnable } = inst.components;
  const home = inst.components.homeseeker?.home;
  return !(home?.isValid() && inst.isNear?.(home, 40)) && !(combat?.target) && !burnable?.IsBurning?.() && !inst.sg?.hasStateTag('busy');
}

export function StandardWakeChecks(inst: SleeperInst): boolean {
  const { combat, burnable, health } = inst.components;
  return !!combat?.target || !!burnable?.IsBurning?.() || !!health?.takingfiredamage;
}

export const DefaultSleepTest: SleeperTest = (inst, cycle) => StandardSleepChecks(inst) && cycle === 'night';
export const DefaultWakeTest: SleeperTest = (inst, cycle) => StandardWakeChecks(inst) || cycle !== 'night';

/** sleeper.lua tests run on game time; an effect also tests day/night signal changes. */
export class Sleeper {
  sleeptestfn: SleeperTest = DefaultSleepTest;
  waketestfn: SleeperTest = DefaultWakeTest;
  resistance = 1;
  readonly testperiod = 4;
  sleepiness = 0;
  readonly wearofftime = 10;
  private readonly state = createSignal(false);
  readonly isasleep = readonlySignal(this.state);
  private readonly test: ComponentTimer;
  /** DoPeriodicTask(wearofftime, WearOff): drained while sleepiness builds below the resistance. */
  private readonly wearoff: ComponentTimer;
  /** DoTaskInTime(resistance, OnGoToSleep, sleeptime). */
  private readonly delayedSleep: ComponentTimer;
  private delayedSleepTime?: number;
  private testing = false;
  private disposed = false;
  private readonly inst: SleeperInst;
  private readonly random: () => number;
  private readonly cleanups: (() => void)[] = [];
  private readonly cycle;

  constructor(inst: SleeperInst, getWatchWorldContent: GetWatchWorldContent, random: () => number = Math.random) {
    this.cycle = getWatchWorldContent(WorldContentKey.Cycle, stop => this.cleanups.push(stop));
    const { scheduler } = this.cycle;
    this.inst = inst;
    this.random = random;
    this.test = new ComponentTimer(scheduler, () => this.runTest());
    this.wearoff = new ComponentTimer(scheduler, () => this.WearOff());
    this.delayedSleep = new ComponentTimer(scheduler, () => this.GoToSleep(this.delayedSleepTime));
    createEffect(() => {
      // Always track cycle, even when testing is stopped or a custom test short-circuits.
      this.runTest(this.cycle.get());
    });
    this.StartTesting();
  }

  SetNocturnal(nocturnal: boolean): void {
    this.sleeptestfn = nocturnal ? (inst, cycle) => StandardSleepChecks(inst) && cycle === 'day' : DefaultSleepTest;
    this.waketestfn = nocturnal ? (inst, cycle) => StandardWakeChecks(inst) || cycle !== 'day' : DefaultWakeTest;
  }

  SetResistance(resist: number): void { this.resistance = resist; }
  IsAsleep(): boolean { return this.state.peek(); }
  /** The sleeper tag the component adds to its inst; AddSleepiness listeners test for it. */
  HasTag(tag: string): boolean | undefined { return tag === 'sleeper' ? !this.disposed : undefined; }
  /** Deep sleep means the sleeper was drugged, and shouldn't wake up to chase targets. */
  IsInDeepSleep(): boolean { return this.IsAsleep() && this.sleepiness > 0; }

  /** Sleeper:StartTesting: a sleeping inst tests for waking, an awake one for sleeping. */
  StartTesting(time?: number): void {
    if (this.disposed) return;
    this.testing = true;
    // some randomness on testing times; an explicit time delays only the first test.
    this.test.start(Math.max(0, time ?? this.testperiod + this.random() - .5));
  }

  /** sleeper.lua AddSleepiness: sleepiness above the resistance sleeps now, equal to it one resistance-second later. */
  AddSleepiness(sleepiness: number, sleeptime?: number): void {
    if (this.disposed) return;
    this.sleepiness += sleepiness;
    if (this.IsAsleep() || this.sleepiness > this.resistance) this.GoToSleep(sleeptime);
    else if (this.sleepiness === this.resistance) {
      this.delayedSleepTime = sleeptime;
      this.delayedSleep.start(this.resistance);
    } else if (this.wearoff.snapshot.peek().status !== 'scheduled') this.wearoff.start(this.wearofftime);
  }

  private WearOff(): void {
    if (this.sleepiness > 1) this.sleepiness -= 1;
    else if (this.sleepiness > 0) { this.sleepiness = 0; return; }
    if (this.sleepiness > 0 && !this.disposed) this.wearoff.start(this.wearofftime);
  }

  StopTesting(): void {
    this.testing = false;
    this.test.stop();
  }

  private runTest(cycle: WorldPhase = this.cycle.peek()): void {
    if (this.disposed || !this.testing) return;
    if (this.IsAsleep()) {
      if (this.waketestfn(this.inst, cycle)) this.WakeUp();
    } else if (this.sleeptestfn(this.inst, cycle)) this.GoToSleep();
    if (this.testing) this.StartTesting();
  }

  GoToSleep(sleeptime?: number): void {
    const { inst } = this;
    if (this.disposed || !inst.isValid() || inst.components.health?.IsDead?.()) return;
    const wasasleep = this.IsAsleep();
    this.state.set(true);
    this.wearoff.stop();
    if (!inst.sg?.hasStateTag('nosleep')) inst.components.locomotor?.Stop();
    if (!wasasleep) inst.PushEvent('gotosleep');
    this.StartTesting(sleeptime);
  }

  WakeUp(): void {
    const { inst } = this;
    if (!this.IsAsleep() || inst.components.health?.IsDead?.()) return;
    this.state.set(false);
    this.sleepiness = 0;
    inst.PushEvent('onwakeup');
    this.StartTesting();
  }

  dispose(): void {
    this.disposed = true;
    this.cleanups.splice(0).forEach(stop => stop());
    this.StopTesting();
    this.wearoff.stop();
    this.delayedSleep.stop();
  }
}
