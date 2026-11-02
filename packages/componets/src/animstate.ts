import { AnimationPlayback, type PlaybackClip } from '../../animation/src/animationPlayback';
import { createSignal, readonlySignal } from '../../signals/src';
import { ComponentTimer } from './timer';
import type { GameTimeScheduler } from './gameTimeScheduler';

/** Engine AnimState queue: logical completion is scheduled independently of rendering. */
export class AnimState {
  private readonly state = createSignal({ name: 'idle_under', loop: true, revision: 0 });
  readonly animation = readonlySignal(this.state);
  private readonly task: ComponentTimer;
  readonly timer;
  private readonly playback: AnimationPlayback<PlaybackClip>;
  private completeTask?: () => void;
  private readonly lengths: ReadonlyMap<string, number>;

  constructor(scheduler: GameTimeScheduler, lengths: ReadonlyMap<string, number>, event: (name: string) => void) {
    this.lengths = lengths;
    this.task = new ComponentTimer(scheduler, () => {
      const complete = this.completeTask; this.completeTask = undefined;
      complete?.();
    });
    this.timer = this.task.snapshot;
    this.playback = new AnimationPlayback(clip => {
      const length = lengths.get(clip.name);
      if (length === undefined || length <= 0) throw new Error(`Missing animation ${clip.name}`);
      this.state.set({ name: clip.name, loop: clip.loop === true, revision: this.state.peek().revision + 1 });
      return length;
    }, (seconds, complete) => {
      this.completeTask = complete; this.task.start(seconds);
      return () => { this.task.stop(); if (this.completeTask === complete) this.completeTask = undefined; };
    });
    this.playback.on('animover', () => event('animover'));
    this.playback.on('animqueueover', () => event('animqueueover'));
  }
  get length(): number { return this.lengths.get(this.state.peek().name)!; }
  PlayAnimation(name: string, loop = false): void { this.playback.play([{ name, loop }]); }
  PushAnimation(name: string, loop = false): void {
    const playing = !this.playback.done;
    this.playback.push([{ name, loop }]);
    const current = this.state.peek();
    if (playing && current.loop) this.state.set({ ...current, loop: false });
  }
  stop(): void { this.playback.stop(); }
  dispose(): void { this.stop(); }
}
