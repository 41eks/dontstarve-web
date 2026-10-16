interface ScheduledTask {
  at: number;
  order: number;
  /** -1 after cancellation or execution, so retained cancellation handles stay harmless. */
  index: number;
  run?: () => void;
}

/** One task queue per running scene. Time advances only with active game time. */
export class GameTimeScheduler {
  private time: number;
  private readonly tasks: ScheduledTask[] = [];
  private nextOrder = 0;
  private disposed = false;

  constructor(initialTime = 0) {
    if (!Number.isFinite(initialTime) || initialTime < 0) throw new RangeError('Invalid game time');
    this.time = initialTime;
  }

  get now(): number { return this.time; }

  schedule(delay: number, run: () => void): () => void {
    if (this.disposed) throw new Error('Game-time scheduler has been disposed');
    if (!Number.isFinite(delay) || delay < 0) throw new RangeError('Invalid task delay');
    const task: ScheduledTask = { at: this.time + delay, order: this.nextOrder++, index: this.tasks.length, run };
    this.tasks.push(task);
    this.siftUp(task.index);
    return () => {
      if (task.index < 0) return;
      this.removeTask(task.index);
      task.run = undefined;
    };
  }

  advance(dt: number): void { this.advanceTo(this.time + dt); }

  advanceTo(time: number): void {
    if (!Number.isFinite(time) || time < this.time) throw new RangeError('Game time must be monotonic');
    if (this.disposed) return;
    // Callbacks observe their actual deadline, even when one frame crosses several tasks.
    while (this.tasks.length && this.tasks[0].at <= time && !this.disposed) {
      const task = this.removeTask(0);
      this.time = task.at;
      const run = task.run!;
      task.run = undefined;
      run();
    }
    this.time = time;
  }

  dispose(): void {
    this.disposed = true;
    for (const task of this.tasks) { task.index = -1; task.run = undefined; }
    this.tasks.length = 0;
  }

  /** Deadline first, insertion order second: equal-deadline tasks retain FIFO semantics. */
  private before(a: ScheduledTask, b: ScheduledTask): boolean {
    return a.at < b.at || (a.at === b.at && a.order < b.order);
  }

  /** Indexed removal avoids both linear searches and cancelled-task tombstones. */
  private removeTask(index: number): ScheduledTask {
    const task = this.tasks[index], last = this.tasks.pop()!;
    task.index = -1;
    if (index < this.tasks.length) {
      this.tasks[index] = last;
      last.index = index;
      if (index > 0 && this.before(last, this.tasks[(index - 1) >>> 1])) this.siftUp(index);
      else this.siftDown(index);
    }
    return task;
  }

  private siftUp(index: number): void {
    const task = this.tasks[index];
    while (index > 0) {
      const parentIndex = (index - 1) >>> 1, parent = this.tasks[parentIndex];
      if (!this.before(task, parent)) break;
      this.tasks[index] = parent;
      parent.index = index;
      index = parentIndex;
    }
    this.tasks[index] = task;
    task.index = index;
  }

  private siftDown(index: number): void {
    const task = this.tasks[index], length = this.tasks.length;
    while (index * 2 + 1 < length) {
      let childIndex = index * 2 + 1;
      if (childIndex + 1 < length && this.before(this.tasks[childIndex + 1], this.tasks[childIndex])) childIndex++;
      const child = this.tasks[childIndex];
      if (!this.before(child, task)) break;
      this.tasks[index] = child;
      child.index = index;
      index = childIndex;
    }
    this.tasks[index] = task;
    task.index = index;
  }
}
