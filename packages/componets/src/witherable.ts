import { batch, createEffect, createSignal, readonlySignal, watchSignal, type ReadonlySignal } from '../../signals/src';
import { ComponentTimer } from './timer';
import type { GameTimeScheduler } from './gameTimeScheduler';

export interface WitherableSave {
  withered?: boolean;
  restoreCycles?: number;
  delaySeconds?: number;
  taskSeconds?: number;
  protectSeconds?: number;
}
export interface WitherablePickable {
  cyclesLeft: number | undefined;
  IsBarren(): boolean;
  MakeBarren(): void;
  MakeEmpty(): void;
}

/** witherable.lua's pickable branch: discrete checks, rain, fertilizer protection and save/load. */
export class Witherable {
  private readonly withered = createSignal(false);
  private enabled = true;
  private removed = false;
  private restoreCycles?: number;
  private readonly task: ComponentTimer;
  private readonly delay: ComponentTimer;
  private readonly protection: ComponentTimer;
  private readonly cleanups: (() => void)[] = [];
  private readonly rain?: ReadonlySignal<'none' | 'rain' | 'snow'>;
  private readonly witherTemp: number;
  private readonly rejuvenateTemp: number;
  readonly state;

  private readonly inst: { addTag(tag: string): void; removeTag(tag: string): void };
  private readonly pickable: WitherablePickable;
  private readonly temperature: () => number;
  private readonly random: () => number;
  constructor(inst: { addTag(tag: string): void; removeTag(tag: string): void },
    pickable: WitherablePickable, scheduler: GameTimeScheduler,
    temperature: () => number, rain?: ReadonlySignal<'none' | 'rain' | 'snow'>,
    saved?: WitherableSave, protectedCycles?: number, random = Math.random) {
    this.inst = inst; this.pickable = pickable; this.temperature = temperature; this.random = random;
    inst.addTag('witherable');
    this.witherTemp = 70 + Math.floor(random() * 25);
    this.rejuvenateTemp = 45 + Math.floor(random() * 11);
    this.task = new ComponentTimer(scheduler, () => this.check());
    this.delay = new ComponentTimer(scheduler, () => this.Start());
    this.protection = new ComponentTimer(scheduler, () => {});
    this.state = Object.freeze({ withered: readonlySignal(this.withered), timer: this.task.snapshot,
      delayTimer: this.delay.snapshot, protectionTimer: this.protection.snapshot });
    this.rain = rain && watchSignal(rain, cleanup => this.cleanups.push(cleanup));
    this.restoreCycles = saved?.restoreCycles;
    if (saved?.withered) { this.withered.set(true); inst.addTag('withered'); }
    this.enabled = !(protectedCycles && protectedCycles > 0);
    if (this.enabled) {
      if (saved?.delaySeconds !== undefined) this.delay.start(saved.delaySeconds);
      else if (saved?.taskSeconds !== undefined) this.task.start(saved.taskSeconds);
      else this.Start();
    }
    if (saved?.protectSeconds !== undefined) this.Protect(saved.protectSeconds);
    let wasRaining = this.rain?.peek() === 'rain';
    createEffect(() => {
      const raining = this.rain?.get() === 'rain';
      if (raining && !wasRaining && this.IsWithered() && this.delay.remainingSeconds !== undefined) {
        this.Stop(); this.Start();
      }
      wasRaining = raining;
    });
  }
  IsWithered(): boolean { return this.withered.peek(); }
  Enable(enable: boolean): void {
    if (this.removed || enable === this.enabled) return;
    this.enabled = enable;
    if (enable) this.Start(); else this.Stop();
  }
  Start(): void {
    if (this.removed || !this.enabled || this.task.remainingSeconds !== undefined || this.delay.remainingSeconds !== undefined) return;
    if (this.protection.remainingSeconds !== undefined) {
      this.delay.start(this.protection.remainingSeconds);
      return;
    }
    this.task.start(30 + Math.floor(this.random() * 31));
  }
  Protect(seconds: number): void {
    if (this.removed || seconds <= (this.protection.remainingSeconds ?? 0)) return;
    this.protection.start(seconds);
    if (this.IsWithered()) this.ForceRejuvenate();
    if (this.enabled && seconds > (this.delay.remainingSeconds ?? 0)) {
      this.Stop();
      this.delay.start(seconds);
    }
  }
  Stop(): void { this.task.stop(); this.delay.stop(); }
  private check(): void {
    const raining = this.rain?.peek() === 'rain';
    if (this.IsWithered()) {
      if (this.temperature() < this.rejuvenateTemp || raining) this.ForceRejuvenate();
      else this.Start();
    } else if (this.temperature() > this.witherTemp && !raining) this.ForceWither();
    else this.Start();
  }
  ForceWither(): void {
    if (this.removed || this.IsWithered()) return;
    this.Stop();
    batch(() => {
      this.withered.set(true); this.inst.addTag('withered');
      this.restoreCycles = this.pickable.cyclesLeft;
      if (!this.pickable.IsBarren()) this.pickable.MakeBarren();
    });
    if (this.enabled) { if (this.rain?.peek() !== 'rain') this.delay.start(480); else this.Start(); }
  }
  ForceRejuvenate(): void {
    if (this.removed || !this.IsWithered()) return;
    this.Stop();
    batch(() => {
      this.pickable.cyclesLeft = this.restoreCycles === undefined ? undefined
        : Math.max(this.pickable.cyclesLeft ?? 0, this.restoreCycles);
      this.restoreCycles = undefined;
      // makeemptyfn sees the withered tag during dead_to_empty.
      if (!this.pickable.IsBarren()) this.pickable.MakeEmpty();
      this.withered.set(false); this.inst.removeTag('withered');
    });
    if (this.enabled) this.delay.start(15);
  }
  exportState(): WitherableSave {
    return { ...(this.IsWithered() ? { withered: true, ...(this.restoreCycles === undefined ? {} : { restoreCycles: this.restoreCycles }) } : {}),
      ...(this.delay.remainingSeconds === undefined ? {} : { delaySeconds: this.delay.remainingSeconds }),
      ...(this.task.remainingSeconds === undefined ? {} : { taskSeconds: this.task.remainingSeconds }),
      ...(this.protection.remainingSeconds === undefined ? {} : { protectSeconds: this.protection.remainingSeconds }) };
  }
  dispose(): void {
    if (this.removed) return;
    this.removed = true; this.Stop(); this.protection.stop(); this.cleanups.splice(0).forEach(cleanup => cleanup());
    this.inst.removeTag('witherable'); this.inst.removeTag('withered');
  }
}
