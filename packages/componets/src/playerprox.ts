import { createSignal, readonlySignal } from '../../signals/src/signal.ts';
import type { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';

interface Position { x: number; z: number }
export interface PlayerProxInst { isValid(): boolean; getPosition(): Position }

/** playerprox.lua's default AnyPlayer mode. No save data; world sleep stops its periodic task. */
export class PlayerProx {
  private readonly close = createSignal(false);
  readonly isclose = readonlySignal(this.close);
  private readonly timer: ComponentTimer;
  private enabled = false;
  private disposed = false;
  private near = 2;
  private far = 3;
  private period = 10 / 30;
  private readonly inst: PlayerProxInst;
  private readonly players: () => readonly Position[];
  private onnear?: () => void;
  private onfar?: () => void;

  constructor(inst: PlayerProxInst, scheduler: GameTimeScheduler, players: () => readonly Position[]) {
    this.inst = inst; this.players = players;
    this.timer = new ComponentTimer(scheduler, () => {
      this.ForceUpdate();
      if (this.enabled && !this.disposed) this.timer.start(this.period);
    });
    this.Schedule();
  }
  get timerState() { return this.timer.snapshot; }
  SetDist(near: number, far: number): void { this.near = near; this.far = far; }
  SetOnPlayerNear(fn: () => void): void { this.onnear = fn; }
  SetOnPlayerFar(fn: () => void): void { this.onfar = fn; }
  IsPlayerClose(): boolean { return this.close.peek(); }
  Schedule(period = this.period): void {
    if (this.disposed) return;
    this.Stop(); this.period = period; this.enabled = true; this.timer.start(period);
  }
  ForceUpdate(): void {
    if (!this.enabled || this.disposed || !this.inst.isValid()) return;
    const origin = this.inst.getPosition(), wasClose = this.close.peek();
    const distance = wasClose ? this.far : this.near;
    const isClose = this.players().some(point => (point.x - origin.x) ** 2 + (point.z - origin.z) ** 2 < distance ** 2);
    if (wasClose === isClose) return;
    this.close.set(isClose);
    if (isClose) this.onnear?.(); else this.onfar?.();
  }
  Stop(): void { this.enabled = false; this.timer.stop(); }
  OnEntityWake(): void { this.Schedule(); this.ForceUpdate(); }
  OnEntitySleep(): void { this.ForceUpdate(); this.Stop(); }
  dispose(): void { this.disposed = true; this.Stop(); }
}
