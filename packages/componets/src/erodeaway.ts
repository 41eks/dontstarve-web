import { createMemo } from '../../signals/src';
import type { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';

/** simutil.lua ErodeAway: interpolate erosion for one game second, then remove through the scheduler. */
export class ErodeAway {
  private readonly delayTask: ComponentTimer;
  private readonly erodeTask: ComponentTimer;
  readonly delay;
  readonly timer;
  readonly active;
  private readonly scheduler: GameTimeScheduler;
  private readonly setErosion: (amount: number) => void;

  constructor(scheduler: GameTimeScheduler, setErosion: (amount: number) => void, remove: () => void) {
    this.scheduler = scheduler; this.setErosion = setErosion;
    this.erodeTask = new ComponentTimer(scheduler, remove);
    this.delayTask = new ComponentTimer(scheduler, () => this.erodeTask.start(1));
    this.delay = this.delayTask.snapshot; this.timer = this.erodeTask.snapshot;
    this.active = createMemo(() => this.delay.get().status !== 'stopped' || this.timer.get().status !== 'stopped');
  }

  start(delay = 0): void { this.delayTask.start(delay); }

  /** Presentation interpolation samples the deadline; completion never depends on rendering. */
  update(): void {
    const timer = this.timer.peek();
    if (timer.status === 'scheduled') this.setErosion(Math.max(0, Math.min(1, 1 - (timer.endTime - this.scheduler.now))));
  }

  dispose(): void { this.delayTask.stop(); this.erodeTask.stop(); this.active.dispose(); }
}
