import { batch, createSignal, readonlySignal } from '../../signals/src/signal.ts';
import type { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';

/** The `windchange` payload: every change is a fresh object, even if the new angle repeats the old one. */
export interface WorldWindChange { readonly angle: number; readonly velocity: number; }

/** components/worldwind.lua: TUNING.SEG_TIME = 30, so the next change comes 15 to 30 seconds later. */
export const WORLD_WIND_MIN_CHANGE_TIME = 15;
export const WORLD_WIND_MAX_CHANGE_TIME = 30;

/**
 * worldwind.lua. `angle` is the authoritative wind direction in degrees; `windchange` replaces
 * the Lua event and notifies every change. The first change comes after the Lua initial delay of 1 second,
 * and later changes are discrete game-time tasks. Nothing is saved: the component has no OnSave.
 */
export class WorldWind {
  readonly velocity = 1;
  private readonly angleState;
  readonly angle;
  private readonly changeState;
  readonly windchange;
  private readonly timer: ComponentTimer;
  private readonly random: () => number;

  constructor(scheduler: GameTimeScheduler, random: () => number = Math.random) {
    this.random = random;
    this.angleState = createSignal(this.randomInt(0, 360));
    this.angle = readonlySignal(this.angleState);
    this.changeState = createSignal<WorldWindChange>(Object.freeze({ angle: this.angleState.peek(), velocity: this.velocity }));
    this.windchange = readonlySignal(this.changeState);
    this.timer = new ComponentTimer(scheduler, () => this.onWindChange());
    this.Start();
  }
  /** Read-only view of the next-change task: scheduled while updating, stopped after Stop(). */
  get timerSnapshot() { return this.timer.snapshot; }

  /** math.random(min, max) with integer bounds. */
  private randomInt(min: number, max: number): number { return min + Math.floor(this.random() * (max - min + 1)); }

  private onWindChange(): void {
    const angle = this.randomInt(0, 360);
    batch(() => {
      this.angleState.set(angle);
      this.changeState.set(Object.freeze({ angle, velocity: this.velocity }));
    });
    // A long frame catches up one change at a time, since the timer is armed from the change's own deadline.
    this.timer.start(this.randomInt(WORLD_WIND_MIN_CHANGE_TIME, WORLD_WIND_MAX_CHANGE_TIME));
  }

  /** worldwind:Start — StartUpdatingComponent; the Lua initial timeToWindChange is 1. */
  Start(): void { if (this.timer.snapshot.peek().status !== 'scheduled') this.timer.start(1); }
  /** worldwind:Stop. Stopping is distinct from expiring in the timer snapshot. */
  Stop(): void { this.timer.stop(); }
  GetWindAngle(): number { return this.angleState.peek(); }
  GetWindVelocity(): number { return this.velocity; }
  dispose(): void { this.Stop(); }
}
