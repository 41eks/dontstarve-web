import type { Vector3 } from 'three';
import type { WorkInst } from './workable';
import { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';
import type { Propagator } from './propagator';
import { batch, createMemo, createSignal, readonlySignal } from '../../signals/src';

export interface BurnableInst extends WorkInst {
  components: { burnable?: Burnable; propagator?: Propagator };
  getPosition(): Vector3;
}

/** The supported structure branches of components/burnable.lua, on active game time. */
export class Burnable {
  private readonly burningState = createSignal(false);
  readonly burning = readonlySignal(this.burningState);
  private lightable = true;
  private readonly removedState = createSignal(false);
  private get removed(): boolean { return this.removedState.peek(); }
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly burnTimer: ComponentTimer;
  private readonly smolderTask: ComponentTimer;
  private readonly smolderRemaining = createSignal<number | undefined>(undefined);
  private readonly phaseMemo;
  readonly timer;
  readonly phase;
  burntime?: number;
  onignite?: (inst: BurnableInst, source?: WorkInst, doer?: WorkInst) => void;
  onextinguish?: (inst: BurnableInst) => void;
  onburnt?: (inst: BurnableInst) => void;
  readonly inst: BurnableInst;
  constructor(inst: BurnableInst, scheduler?: GameTimeScheduler) {
    this.inst = inst;
    this.scheduler = scheduler ?? new GameTimeScheduler();
    this.ownsScheduler = !scheduler;
    this.burnTimer = new ComponentTimer(this.scheduler, () => {
      if (this.removed || this.inst.isRemoved) return;
      this.inst.PushEvent?.('onburnt', undefined);
      this.onburnt?.(this.inst);
      this.Extinguish();
    });
    this.smolderTask = new ComponentTimer(this.scheduler, () => this.updateSmolder());
    this.phaseMemo = createMemo(() => {
      if (this.removedState.get()) return 'removed';
      const burning = this.burning.get();
      const smolder = this.smolderTask.snapshot.get();
      const burn = this.burnTimer.snapshot.get();
      return burning ? 'burning' : smolder.status === 'scheduled' ? 'smoldering'
        : burn.status === 'expired' ? 'burnt' : 'idle';
    });
    this.timer = this.burnTimer.snapshot;
    this.phase = readonlySignal(this.phaseMemo);
    this.refreshTags();
  }
  get canlight(): boolean { return this.lightable; }
  set canlight(value: boolean) { this.lightable = value; this.refreshTags(); }
  SetBurnTime(time: number): void { this.burntime = time; }
  SetOnIgniteFn(fn: Burnable['onignite']): void { this.onignite = fn; }
  SetOnExtinguishFn(fn: Burnable['onextinguish']): void { this.onextinguish = fn; }
  SetOnBurntFn(fn: Burnable['onburnt']): void { this.onburnt = fn; }
  IsBurning(): boolean { return this.burning.peek(); }
  IsSmoldering(): boolean { return this.smolderTask.snapshot.peek().status === 'scheduled'; }
  Ignite(_immediate = false, source?: WorkInst, doer?: WorkInst): void {
    if (this.removed || this.inst.isRemoved || this.IsBurning() || this.inst.hasTag('fireimmune')) return;
    this.StopSmoldering();
    if (this.burntime !== undefined) this.burnTimer.start(this.burntime);
    this.setBurning(true);
    this.inst.PushEvent?.('onignite', { source, doer });
    this.onignite?.(this.inst, source, doer);
    this.inst.components.propagator?.spreading.set(true);
  }
  StartWildfire(): void {
    if (this.removed || this.IsBurning() || this.IsSmoldering() || this.inst.hasTag('fireimmune')) return;
    this.smolderRemaining.set(this.inst.components.propagator?.flashpoint ?? 10);
    this.smolderTask.start(Math.random() * 2);
    this.inst.addTag('smolder');
  }
  StopSmoldering(): void {
    this.smolderTask.stop();
    this.smolderRemaining.set(undefined);
    this.inst.removeTag('smolder');
  }
  Extinguish(): void {
    this.StopSmoldering();
    if (!this.IsBurning()) return;
    if (this.burnTimer.snapshot.peek().status === 'scheduled') this.burnTimer.stop();
    this.inst.components.propagator?.spreading.set(false);
    this.setBurning(false);
    this.onextinguish?.(this.inst);
    this.inst.PushEvent?.('onextinguish', undefined);
  }
  Update(dt: number): void {
    if (this.removed || !Number.isFinite(dt) || dt <= 0) return;
    if (this.ownsScheduler) this.scheduler.advance(dt);
  }
  private updateSmolder(): void {
    if (this.removed || this.inst.isRemoved) return;
    const remaining = this.smolderRemaining.peek();
    if (remaining === undefined) return;
    const heat = this.inst.components.propagator?.NearbyHeat(12) ?? 0;
    const next = remaining - 2 * Math.max(1, Math.min(2.2, 1 + (heat - 20) / 70 * 1.2));
    this.smolderRemaining.set(next);
    if (next <= 0) this.Ignite();
    else this.smolderTask.start(2);
  }
  dispose(): void {
    if (this.removed) return;
    this.Extinguish();
    this.removedState.set(true);
    this.burnTimer.stop(); this.smolderTask.stop(); this.phaseMemo.dispose();
    if (this.ownsScheduler) this.scheduler.dispose();
    for (const tag of ['canlight', 'nolight', 'fire', 'smolder']) this.inst.removeTag(tag);
  }
  private refreshTags(): void {
    const lightable = this.lightable && !this.IsBurning() && !this.removed;
    for (const [tag, enabled] of [['canlight', lightable], ['nolight', !lightable], ['fire', this.IsBurning()]] as const) {
      if (enabled) this.inst.addTag(tag); else this.inst.removeTag(tag);
    }
  }
  private setBurning(value: boolean): void {
    batch(() => { this.burningState.set(value); this.refreshTags(); });
  }
}
