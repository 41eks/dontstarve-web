import { createMemo, readonlySignal } from '../../signals/src';
import { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';
import type { BurnableInst } from './burnable';
import type { WorkInst } from './workable';

/** Dry-weather structure heat branches of components/propagator.lua. */
export class Propagator {
  readonly flashpoint: number;
  readonly propagaterange: number;
  readonly heatoutput: number;
  readonly decayrate = .5;
  currentheat = 0;
  private heatThisUpdate = 0;
  private maxHeatThisUpdate = 0;
  private spreading = false;
  private pauseheating = false;
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly updateTimer: ComponentTimer;
  private readonly updatingMemo;
  readonly timer;
  readonly updating;
  private removed = false;
  readonly inst: BurnableInst;
  private readonly nearby: (radius: number) => readonly BurnableInst[];
  private readonly unitsPerMeter: number;
  constructor(inst: BurnableInst, size: 'small' | 'medium',
    nearby: (radius: number) => readonly BurnableInst[], unitsPerMeter = 1, scheduler?: GameTimeScheduler) {
    this.inst = inst; this.nearby = nearby; this.unitsPerMeter = unitsPerMeter;
    this.scheduler = scheduler ?? new GameTimeScheduler();
    this.ownsScheduler = !scheduler;
    this.updateTimer = new ComponentTimer(this.scheduler, () => this.updateHeat());
    this.updatingMemo = createMemo(() => this.updateTimer.snapshot.get().status === 'scheduled');
    this.timer = this.updateTimer.snapshot;
    this.updating = readonlySignal(this.updatingMemo);
    this.flashpoint = size === 'small' ? 5 + Math.random() * 5 : 15 + Math.random() * 10;
    this.propagaterange = size === 'small' ? 3 + Math.random() * 2 : 5 + Math.random() * 2;
    this.heatoutput = size === 'small' ? 3 + Math.random() * 2 : 5 + Math.random() * 3.5;
    this.calculateHeatCap();
  }
  StartSpreading(_source?: WorkInst): void { this.spreading = true; this.startUpdating(); }
  StopSpreading(): void { this.spreading = false; if (this.currentheat === 0) this.updateTimer.stop(); }
  AcceptsHeat(): boolean { return !this.removed && !this.pauseheating; }
  AddHeat(amount: number): void {
    if (!this.AcceptsHeat() || this.inst.hasTag('fireimmune')) return;
    const heat = Math.min(amount, this.maxHeatThisUpdate - this.heatThisUpdate);
    this.heatThisUpdate += heat;
    this.currentheat += heat;
    if (this.currentheat > 0) this.startUpdating();
    if (this.currentheat > this.flashpoint) {
      this.pauseheating = true;
      this.inst.components.burnable?.StartWildfire();
    }
  }
  NearbyHeat(radius: number): number { return this.nearby(radius * this.unitsPerMeter).reduce((sum, inst) => sum + (inst.components.propagator?.currentheat ?? 0), 0); }
  Update(dt: number): void {
    if (this.removed || !Number.isFinite(dt) || dt <= 0) return;
    if (this.ownsScheduler) this.scheduler.advance(dt);
  }
  private startUpdating(): void {
    if (!this.removed && this.updateTimer.snapshot.peek().status !== 'scheduled') {
      // propagator.lua starts its periodic task after .5 + random() * .67 seconds.
      this.updateTimer.start(.5 + Math.random() * .67);
    }
  }
  private updateHeat(): void {
    if (this.removed || this.inst.isRemoved) return;
    this.calculateHeatCap();
    this.currentheat = Math.max(0, this.currentheat - .5 * this.decayrate);
    if (this.spreading) {
      const origin = this.inst.getPosition();
      const range = this.propagaterange * this.unitsPerMeter;
      for (const target of this.nearby(range)) {
        if (target === this.inst || target.isRemoved || target.hasTag('INLIMBO')) continue;
        const position = target.getPosition();
        const distanceSquared = (position.x - origin.x) ** 2 + (position.z - origin.z) ** 2;
        target.components.propagator?.AddHeat(this.heatoutput * Math.max(.1, 1 - distanceSquared / range ** 2) * .5);
      }
    }
    if (this.spreading || this.currentheat > 0) this.updateTimer.start(.5);
  }
  dispose(): void {
    this.StopSpreading(); this.removed = true;
    this.updateTimer.stop(); this.updatingMemo.dispose();
    if (this.ownsScheduler) this.scheduler.dispose();
  }
  private calculateHeatCap(): void {
    this.heatThisUpdate = 0;
    this.maxHeatThisUpdate = this.flashpoint / (1 + 3 * (1 - (1 - Math.random()) ** 3)) * .5;
  }
}
