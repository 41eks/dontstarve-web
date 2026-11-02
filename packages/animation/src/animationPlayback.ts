import { EventEmitter } from '@dontstarve-web/signals';

export interface PlaybackClip { readonly name: string; readonly loop?: boolean }
type PlaybackEvents<Clip> = { animover: Clip; animqueueover: Clip };

/**
 * AnimState's engine-side clip queue and completion events, independent of visual residency.
 * The host supplies the game-clock task queue and source animation lengths, never a rendered sprite.
 */
export class AnimationPlayback<Clip extends PlaybackClip> {
  private readonly events = new EventEmitter<PlaybackEvents<Clip>>();
  private readonly select: (clip: Clip) => number;
  private readonly schedule: (seconds: number, complete: () => void) => () => void;
  private queue: readonly Clip[] = [];
  private clip?: Clip;
  private cancel?: () => void;
  private revision = 0;
  private completed = false;

  constructor(select: (clip: Clip) => number, schedule: (seconds: number, complete: () => void) => () => void) {
    this.select = select; this.schedule = schedule;
  }
  get current(): Clip | undefined { return this.clip; }
  get done(): boolean { return this.completed; }
  on<Event extends keyof PlaybackEvents<Clip>>(event: Event, listener: (clip: PlaybackEvents<Clip>[Event]) => void): () => void {
    return this.events.on(event, listener);
  }
  play(clips: readonly Clip[]): void {
    if (!clips.length) throw new Error('Animation playback requires a clip');
    this.queue = clips.slice(1);
    this.start(clips[0]);
  }
  push(clips: readonly Clip[]): void {
    if (!clips.length) return;
    if (this.completed) this.play(clips);
    else this.queue = [...this.queue, ...clips];
  }
  private start(clip: Clip): void {
    this.cancel?.(); this.cancel = undefined;
    const revision = ++this.revision;
    this.clip = clip; this.completed = false;
    const duration = this.select(clip);
    // A completion listener or the host's clip selection may have replaced playback.
    if (revision !== this.revision) return;
    if (!Number.isFinite(duration) || duration <= 0) throw new RangeError(`Invalid animation duration: ${clip.name}`);
    this.cancel = this.schedule(duration, () => this.complete());
  }
  private complete(): void {
    this.cancel = undefined;
    const clip = this.clip!, revision = this.revision;
    this.completed = true;
    this.events.emit('animover', clip);
    if (revision !== this.revision) return;
    const [next, ...remaining] = this.queue;
    if (next) { this.queue = remaining; this.start(next); }
    else if (clip.loop) this.start(clip);
    else this.events.emit('animqueueover', clip);
  }
  stop(): void {
    this.revision++;
    this.cancel?.(); this.cancel = undefined;
    this.queue = []; this.completed = true;
  }
}
