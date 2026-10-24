/** One task queue per running scene. Time advances only with active game time. */
export class GameTimeScheduler {
  private time: number;
  private readonly tasks: { at: number; run: () => void }[] = [];
  private disposed = false;

  constructor(initialTime = 0) {
    if (!Number.isFinite(initialTime) || initialTime < 0) throw new RangeError('Invalid game time');
    this.time = initialTime;
  }

  get now(): number { return this.time; }

  schedule(delay: number, run: () => void): () => void {
    if (this.disposed) throw new Error('Game-time scheduler has been disposed');
    if (!Number.isFinite(delay) || delay < 0) throw new RangeError('Invalid task delay');
    const task = { at: this.time + delay, run };
    let lo = 0, hi = this.tasks.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.tasks[mid].at <= task.at) lo = mid + 1;
      else hi = mid;
    }
    this.tasks.splice(lo, 0, task);
    return () => {
      const index = this.tasks.indexOf(task);
      if (index >= 0) this.tasks.splice(index, 1);
    };
  }

  advance(dt: number): void { this.advanceTo(this.time + dt); }

  advanceTo(time: number): void {
    if (!Number.isFinite(time) || time < this.time) throw new RangeError('Game time must be monotonic');
    if (this.disposed) return;
    // Callbacks observe their actual deadline, even when one frame crosses several tasks.
    while (this.tasks.length && this.tasks[0].at <= time && !this.disposed) {
      const task = this.tasks.shift()!;
      this.time = task.at;
      task.run();
    }
    this.time = time;
  }

  dispose(): void { this.disposed = true; this.tasks.length = 0; }
}
