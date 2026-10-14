import { createSignal, readonlySignal } from '../../signals/src';
import { ComponentTimer } from './timer';
import type { GameTimeScheduler } from './gameTimeScheduler';

/** Engine AnimState queue: logical completion is scheduled independently of rendering. */
export class AnimState {
  private readonly state = createSignal({ name: 'idle_under', loop: true, revision: 0 });
  readonly animation = readonlySignal(this.state);
  private readonly task: ComponentTimer;
  readonly timer;
  private readonly queue: { name: string; loop: boolean }[] = [];
  private done = false;
  private readonly lengths: ReadonlyMap<string, number>;
  private readonly event: (name: string) => void;
  constructor(scheduler: GameTimeScheduler, lengths: ReadonlyMap<string, number>, event: (name: string) => void) {
    this.lengths = lengths; this.event = event;
    this.task = new ComponentTimer(scheduler, () => this.complete()); this.timer = this.task.snapshot;
  }
  get length(): number { return this.lengths.get(this.state.peek().name)!; }
  PlayAnimation(name: string, loop = false): void {
    this.queue.length = 0; this.play(name, loop);
  }
  PushAnimation(name: string, loop = false): void {
    if (this.done) this.play(name, loop);
    else {
      this.queue.push({ name, loop });
      const current = this.state.peek();
      if (current.loop) this.state.set({ ...current, loop: false });
    }
  }
  private play(name: string, loop: boolean): void {
    const length = this.lengths.get(name);
    if (length === undefined || length <= 0) throw new Error(`Missing animation ${name}`);
    this.done = false; this.state.set({ name, loop, revision: this.state.peek().revision + 1 }); this.task.start(length);
  }
  private complete(): void {
    const current = this.state.peek(); this.done = true; this.event('animover');
    if (this.state.peek().revision !== current.revision) return;
    const next = this.queue.shift();
    if (next) this.play(next.name, next.loop);
    else if (current.loop) this.play(current.name, true);
    else this.event('animqueueover');
  }
  stop(): void { this.task.stop(); this.queue.length = 0; this.done = true; }
  dispose(): void { this.stop(); }
}
