import { ComponentTimer } from './timer';
import type { GameTimeScheduler } from './gameTimeScheduler';

interface MusicHandle { stop(): void; }
const MOONBASE_MUSIC = ['dontstarve/music/music_epicfight_moonbase', 'dontstarve/music/music_epicfight_moonbase_b'] as const;

/** dynamicmusic.lua StartTriggeredDanger's moonbase branch, shared by all nearby moonbases. */
export class DynamicMusic {
  private handle?: MusicHandle;
  private level = 0;
  private readonly expiry: ComponentTimer;
  readonly timer;
  private readonly play: (path: typeof MOONBASE_MUSIC[number]) => MusicHandle;
  constructor(scheduler: GameTimeScheduler, play: DynamicMusic['play']) {
    this.play = play;
    this.expiry = new ComponentTimer(scheduler, () => this.stop());
    this.timer = this.expiry.snapshot;
  }
  TriggerMoonbase(level: 1 | 2): void {
    if (level !== this.level) {
      this.handle?.stop(); this.level = level;
      this.handle = this.play(MOONBASE_MUSIC[level - 1]);
    }
    this.expiry.start(10);
  }
  private stop(): void { this.handle?.stop(); this.handle = undefined; this.level = 0; }
  dispose(): void { this.expiry.stop(); this.stop(); }
}
