import { BT, type BehaviourContext } from './behaviourtree';
import type { BrainInst } from './types';

/**
 * scripts/brain.lua with BrainWrangler folded in: the owning entity calls `tick(now)` every frame and
 * the brain only updates once the tree's sleep time has elapsed.
 */
export abstract class Brain {
  readonly inst: BrainInst;
  bt?: BT;
  stopped = true;
  paused = false;
  private wakeAt = 0;

  constructor(inst: BrainInst) { this.inst = inst; }

  protected abstract OnStart(): void;
  protected OnInitializationComplete?(): void;
  protected OnStop?(): void;
  protected DoUpdate?(): void;

  protected get context(): BehaviourContext { return this.inst; }

  ForceUpdate(): void {
    this.bt?.ForceUpdate();
    this.wakeAt = 0;
  }

  GetSleepTime(): number | undefined { return this.bt ? this.bt.GetSleepTime() : 0; }

  /** EntityScript:RestartBrain → Brain:_Start_Internal. */
  Start(): void {
    if (!this.stopped) return;
    this.OnStart();
    this.stopped = false;
    this.wakeAt = 0;
    this.OnInitializationComplete?.();
  }

  Stop(): void {
    if (this.stopped) return;
    this.OnStop?.();
    this.bt?.Stop();
    this.stopped = true;
  }

  Pause(): void { this.paused = true; }
  Resume(): void { this.paused = false; }

  OnUpdate(): void {
    this.DoUpdate?.();
    this.bt?.Update();
  }

  /** BrainManager:Update for one instance: wake up once the previous sleep time has passed. */
  tick(now: number): void {
    if (this.stopped || this.paused || now < this.wakeAt) return;
    this.OnUpdate();
    const sleep = this.GetSleepTime();
    // No sleep time means the tree hibernates until something forces an update.
    this.wakeAt = sleep === undefined ? Infinity : now + sleep;
  }
}
