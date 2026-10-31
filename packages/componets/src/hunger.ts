import { batch, createMemo, createSignal, readonlySignal } from '@dontstarve-web/signals';
import type { Health } from './health';
import type { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';
import { SourceModifierList } from './sourcemodifierlist';

export interface HungerInst {
  readonly components: { health?: Pick<Health, 'IsInvincible' | 'DoDelta'> };
  readonly is_teleporting?: boolean;
  PushEvent?(name: string, data?: unknown): void;
}

/** hunger.lua: authoritative nutrition, starvation edges and the one-second world task. */
export class Hunger {
  private readonly inst: HungerInst;
  private readonly currentState = createSignal(100);
  private readonly maximumState = createSignal(100);
  readonly value = readonlySignal(this.currentState);
  readonly maximum = readonlySignal(this.maximumState);
  readonly percent = createMemo(() => this.currentState.get() / this.maximumState.get());
  private timer?: ComponentTimer;
  private disposed = false;
  private burning = true;
  hungerrate = 1;
  hurtrate = 1;
  burnrate = 1;
  redirect?: (inst: HungerInst, delta: number, overtime?: boolean) => void;
  overridestarvefn?: (inst: HungerInst, dt: number) => void;
  readonly burnratemodifiers = new SourceModifierList();

  constructor(inst: HungerInst, maximum = 100, scheduler?: GameTimeScheduler) {
    this.inst = inst;
    this.SetMax(maximum);
    if (scheduler) this.BindScheduler(scheduler);
  }
  get current(): number { return this.currentState.peek(); }
  get max(): number { return this.maximumState.peek(); }
  get timerState() { return this.timer?.snapshot; }
  BindScheduler(scheduler: GameTimeScheduler): void {
    this.timer?.stop();
    this.timer = new ComponentTimer(scheduler, () => {
      this.DoDec(1);
      if (!this.disposed && this.burning) this.timer!.start(1);
    });
    if (!this.disposed && this.burning) this.timer.start(1);
  }
  SetMax(amount: number): void {
    if (finite(amount) <= 0) throw new RangeError('Maximum hunger must be positive');
    batch(() => { this.maximumState.set(amount); this.currentState.set(amount); });
  }
  SetRate(rate: number): void { this.hungerrate = finite(rate); }
  SetKillRate(rate: number): void { this.hurtrate = finite(rate); }
  SetOverrideStarveFn(fn: Hunger['overridestarvefn']): void { this.overridestarvefn = fn; }
  IsPaused(): boolean { return !this.burning; }
  IsStarving(): boolean { return this.current <= 0; }
  Pause(): void { this.burning = false; this.timer?.stop(); }
  Resume(): void { if (this.disposed || this.burning) return; this.burning = true; this.timer?.start(1); }
  GetPercent(): number { return this.current / this.max; }
  SetPercent(percent: number, overtime?: boolean): void { this.SetCurrent(finite(percent) * this.max, overtime); }
  SetCurrent(current: number, overtime?: boolean): void {
    if (this.disposed) return;
    const old = this.current;
    this.currentState.set(Math.max(0, Math.min(finite(current), this.max)));
    this.inst.PushEvent?.('hungerdelta', { oldpercent: old / this.max, newpercent: this.GetPercent(), overtime, delta: this.current - old });
    if (old > 0 && this.current <= 0) this.inst.PushEvent?.('startstarving');
    else if (old <= 0 && this.current > 0) this.inst.PushEvent?.('stopstarving');
  }
  DoDelta(delta: number, overtime?: boolean, ignoreInvincible = false): void {
    finite(delta);
    if (this.disposed) return;
    if (this.redirect) { this.redirect(this.inst, delta, overtime); return; }
    if ((!ignoreInvincible && this.inst.components.health?.IsInvincible()) || this.inst.is_teleporting) return;
    this.SetCurrent(this.current + delta, overtime);
  }
  DoDec(dt: number, ignoreDamage = false): void {
    if (this.disposed || !this.burning || finite(dt) <= 0) return;
    if (this.current > 0) this.DoDelta(-this.hungerrate * dt * this.burnrate * this.burnratemodifiers.Get(), true);
    else if (!ignoreDamage) {
      if (this.overridestarvefn) this.overridestarvefn(this.inst, dt);
      else this.inst.components.health?.DoDelta(-this.hurtrate * dt, true, 'hunger');
    }
  }
  LongUpdate(dt: number): void { this.DoDec(dt, true); }
  OnSave(): { hunger: number } | undefined { return this.current === this.max ? undefined : { hunger: this.current }; }
  OnLoad(data: { hunger?: number }): void {
    if (data.hunger === undefined) return;
    this.currentState.set(finite(data.hunger));
    this.DoDelta(0);
  }
  OnRemoveFromEntity(): void { this.dispose(); }
  dispose(): void { this.disposed = true; this.timer?.stop(); this.percent.dispose(); this.burnratemodifiers.Reset(); }
}

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Hunger must be finite');
  return value;
}
