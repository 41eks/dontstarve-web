import { readonlySignal, createSignal } from '../../signals/src';
import type { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';

/**
 * What components/sleeper.lua reads from its inst. Not ported (the beefalo has none of them yet):
 * homeseeker, teamattacker, freezable, light watching, and the sleepiness/diminishing-returns drugs.
 */
export interface SleeperInst {
  isValid(): boolean;
  PushEvent(name: string, data?: unknown): void;
  /** TheWorld.state.isnight; the overworld sleeps at night. */
  readonly world: { readonly isNight: boolean };
  readonly sg?: { hasStateTag(tag: string): boolean };
  readonly components: {
    health?: { IsDead?(): boolean; takingfiredamage?: boolean };
    combat?: { target?: unknown };
    burnable?: { IsBurning?(): boolean };
    locomotor?: { Stop(): void };
  };
}

export type SleeperTest = (inst: SleeperInst) => boolean;

/** sleeper.lua StandardSleepChecks, without the unported homeseeker/freezable/teamattacker terms. */
export function StandardSleepChecks(inst: SleeperInst): boolean {
  const { combat, burnable } = inst.components;
  return !(combat?.target) && !burnable?.IsBurning?.() && !inst.sg?.hasStateTag('busy');
}

export function StandardWakeChecks(inst: SleeperInst): boolean {
  const { combat, burnable, health } = inst.components;
  return !!combat?.target || !!burnable?.IsBurning?.() || !!health?.takingfiredamage;
}

export const DefaultSleepTest: SleeperTest = inst => StandardSleepChecks(inst) && inst.world.isNight;
export const DefaultWakeTest: SleeperTest = inst => StandardWakeChecks(inst) || !inst.world.isNight;

/** sleeper.lua: isasleep is a private signal; the periodic sleep/wake test runs on game time. */
export class Sleeper {
  sleeptestfn: SleeperTest = DefaultSleepTest;
  waketestfn: SleeperTest = DefaultWakeTest;
  resistance = 1;
  readonly testperiod = 4;
  private readonly state = createSignal(false);
  readonly isasleep = readonlySignal(this.state);
  private readonly test: ComponentTimer;
  private testing = false;
  private disposed = false;
  private readonly inst: SleeperInst;
  private readonly random: () => number;

  constructor(inst: SleeperInst, scheduler: GameTimeScheduler, random: () => number = Math.random) {
    this.inst = inst;
    this.random = random;
    this.test = new ComponentTimer(scheduler, () => this.runTest());
    this.StartTesting();
  }

  SetResistance(resist: number): void { this.resistance = resist; }
  IsAsleep(): boolean { return this.state.peek(); }

  /** Sleeper:StartTesting: a sleeping inst tests for waking, an awake one for sleeping. */
  StartTesting(): void {
    if (this.disposed) return;
    this.testing = true;
    // some randomness on testing times
    this.test.start(Math.max(0, this.testperiod + this.random() - .5));
  }

  StopTesting(): void {
    this.testing = false;
    this.test.stop();
  }

  private runTest(): void {
    if (this.disposed || !this.testing) return;
    if (this.IsAsleep()) {
      if (this.waketestfn(this.inst)) this.WakeUp();
    } else if (this.sleeptestfn(this.inst)) this.GoToSleep();
    if (this.testing) this.StartTesting();
  }

  GoToSleep(): void {
    const { inst } = this;
    if (this.disposed || !inst.isValid() || inst.components.health?.IsDead?.()) return;
    const wasasleep = this.IsAsleep();
    this.state.set(true);
    if (!inst.sg?.hasStateTag('nosleep')) inst.components.locomotor?.Stop();
    if (!wasasleep) inst.PushEvent('gotosleep');
    this.StartTesting();
  }

  WakeUp(): void {
    const { inst } = this;
    if (!this.IsAsleep() || inst.components.health?.IsDead?.()) return;
    this.state.set(false);
    inst.PushEvent('onwakeup');
    this.StartTesting();
  }

  dispose(): void {
    this.disposed = true;
    this.StopTesting();
  }
}
