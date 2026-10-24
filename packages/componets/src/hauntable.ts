import type { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';
import { createMemo } from '../../signals/src';

/** tuning.lua HAUNT_INSTANT_REZ / HAUNT_COOLDOWN_SMALL / HAUNT_COOLDOWN_MEDIUM. */
export const HAUNT_INSTANT_REZ = 9999;
export const HAUNT_COOLDOWN_SMALL = 3;
export const HAUNT_COOLDOWN_MEDIUM = 5;

export interface HauntableInst {
  addTag(tag: string): void;
  removeTag(tag: string): void;
  PushEvent(name: string, data?: unknown): void;
}

/** The ghost doing the haunting. */
export interface Haunter {
  hasTag(tag: string): boolean;
  PushEvent(name: string, data?: unknown): void;
}

/**
 * components/hauntable.lua, for a fixed haunt value: DoHaunt runs onhaunt, sends `respawnfromghost` for an
 * instant-rez value, then holds the `haunted` tag for the cooldown. The cooldown is a game-time timer
 * whose expiry is StopHaunt. Panic has its own deadline; flicker and shader fx are not ported.
 */
export class Hauntable {
  private readonly inst: HauntableInst;
  private readonly cooldown: ComponentTimer;
  private readonly panicTask: ComponentTimer;
  private readonly panicking;
  panicable = false;
  get panic(): boolean { return this.panicking.peek(); }
  private onhaunt: (inst: HauntableInst, haunter: Haunter) => boolean = () => true;
  private hauntvalue: number | undefined;
  private hauntedValue = false;
  private disposed = false;

  constructor(inst: HauntableInst, scheduler: GameTimeScheduler) {
    this.inst = inst;
    this.cooldown = new ComponentTimer(scheduler, () => this.StopHaunt());
    this.panicTask = new ComponentTimer(scheduler, () => {});
    this.panicking = createMemo(() => this.panicTask.snapshot.get().status === 'scheduled');
  }

  get cooldownState() { return this.cooldown.snapshot; }
  get panicTimer() { return this.panicTask.snapshot; }
  Panic(seconds: number): void { this.panicTask.start(seconds); }
  IsHaunted(): boolean { return this.hauntedValue; }
  SetOnHauntFn(fn: Hauntable['onhaunt']): void { this.onhaunt = fn; }
  SetHauntValue(value: number | undefined): void { if (value) this.hauntvalue = value; }

  DoHaunt(doer: Haunter): void {
    if (this.disposed) return;
    const success = this.onhaunt(this.inst, doer);
    if (success) {
      if (this.hauntvalue === HAUNT_INSTANT_REZ && doer.hasTag('playerghost')) doer.PushEvent('respawnfromghost', { source: this.inst });
    }
    this.setHaunted(true);
    this.cooldown.start(success ? HAUNT_COOLDOWN_MEDIUM : HAUNT_COOLDOWN_SMALL);
    this.inst.PushEvent('haunted');
  }

  StopHaunt(): void {
    this.cooldown.stop();
    this.setHaunted(false);
  }

  /** inst:RemoveComponent("hauntable"): the cooldown task and the `haunted` tag go with it. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.panicTask.stop(); this.panicking.dispose();
    this.StopHaunt();
  }

  private setHaunted(haunted: boolean): void {
    this.hauntedValue = haunted;
    if (haunted) this.inst.addTag('haunted'); else this.inst.removeTag('haunted');
  }
}
