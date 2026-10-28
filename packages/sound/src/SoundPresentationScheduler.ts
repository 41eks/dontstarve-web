import { Vector3 } from 'three';
import { createRenderEffect, watchSignal, type GameTimeScheduler, type ReadonlySignal } from '@dontstarve-web/signals';
import { ComponentTimer } from '../../componets/src/timer';
import { WORLD_SCALE } from '@dontstarve-web/prefab/tile';
import { PlaySound, UpdateSoundListener, type SoundHandle } from '@dontstarve-web/prefab/sound';

interface WaterfallSource { position: Vector3; radius: number; volume: number }
interface SoundFade { from: number; to: number; startedAt: number; done?: () => void }
interface WaterfallEmitter { position: Vector3; handle?: SoundHandle; source?: WaterfallSource; volume: number; fade?: SoundFade }

/** grottowaterfallsoundcontroller.lua constants; distances are in DST units. */
const WATERFALL_MAX_DISTANCE_SQ = 1600;
const WATERFALL_EMITTER_COUNT = 3;
const WATERFALL_SELECT_PERIOD = 5 / 30;
const WATERFALL_MIN_FADE_VOLUME = .05;
const WATERFALL_HALF_FADE_TIME = .2;
const WATERFALL_SOUND = 'grotto/common/waterfall_LP' as const;

/** World-owned sound presentation. Prefabs register sources; the listener and emitter allocation stay here. */
export class SoundPresentationScheduler {
  private readonly cleanups: (() => void)[] = [];
  private readonly playerPositions: ReturnType<typeof watchSignal<readonly Vector3[]>>;
  private readonly waterfalls = new Set<WaterfallSource>();
  private readonly emitters: WaterfallEmitter[] = Array.from({ length: WATERFALL_EMITTER_COUNT }, () => ({ position: new Vector3(), volume: 0 }));
  private readonly selectionTimer: ComponentTimer;
  private readonly fadeTimer: ComponentTimer;
  private readonly scheduler: GameTimeScheduler;
  private disposed = false;

  constructor(playerPositions: ReadonlySignal<readonly Vector3[]>, scheduler: GameTimeScheduler) {
    this.scheduler = scheduler;
    this.playerPositions = watchSignal(playerPositions, stop => this.cleanups.push(stop));
    this.selectionTimer = new ComponentTimer(scheduler, () => {
      this.selectWaterfalls();
      if (this.waterfalls.size) this.selectionTimer.start(WATERFALL_SELECT_PERIOD);
    });
    this.fadeTimer = new ComponentTimer(scheduler, () => this.advanceFades());
    // The world already publishes player position snapshots; audio observes that signal directly.
    createRenderEffect(() => {
      const player = this.playerPositions.get()[0];
      if (player) UpdateSoundListener(player);
    });
  }

  /** grottowaterfallsoundcontroller.lua: ms_registergrottopool. Radius is in DST units. */
  registerWaterfallPool(position: Vector3, radius: number, large: boolean): () => void {
    if (this.disposed) throw new Error('Sound presentation has been disposed');
    const source: WaterfallSource = { position, radius, volume: large ? 1 : .8 };
    this.waterfalls.add(source);
    if (this.selectionTimer.snapshot.peek().status !== 'scheduled') this.selectionTimer.start(WATERFALL_SELECT_PERIOD);
    return () => {
      if (!this.waterfalls.delete(source)) return;
      if (!this.waterfalls.size) this.selectionTimer.stop();
      this.selectWaterfalls();
    };
  }

  private setVolume(emitter: WaterfallEmitter, volume: number): void {
    emitter.volume = volume;
    emitter.handle?.setVolume(volume);
  }

  private stopEmitter(emitter: WaterfallEmitter): void {
    emitter.fade = undefined;
    emitter.handle?.stop();
    emitter.handle = undefined; emitter.source = undefined; emitter.volume = 0;
  }

  private fade(emitter: WaterfallEmitter, from: number, to: number, done?: () => void): void {
    emitter.fade = { from, to, startedAt: this.scheduler.now, done };
    this.setVolume(emitter, from);
    if (this.fadeTimer.snapshot.peek().status !== 'scheduled') this.fadeTimer.start(1 / 30);
  }

  private advanceFades(): void {
    for (const emitter of this.emitters) {
      const fade = emitter.fade;
      if (!fade) continue;
      const progress = Math.min(1, Math.max(0, (this.scheduler.now - fade.startedAt) / WATERFALL_HALF_FADE_TIME));
      this.setVolume(emitter, fade.from + (fade.to - fade.from) * progress);
      if (progress >= 1) { emitter.fade = undefined; fade.done?.(); }
    }
    if (this.emitters.some(emitter => emitter.fade)) this.fadeTimer.start(1 / 30);
  }

  private selectWaterfalls(): void {
    const player = this.playerPositions.peek()[0];
    if (!player) { for (const emitter of this.emitters) this.stopEmitter(emitter); return; }
    const nearest = [...this.waterfalls].map(source => ({ source,
      dsq: source.position.distanceToSquared(player) / (WORLD_SCALE * WORLD_SCALE) - source.radius * source.radius }))
      .filter(entry => entry.dsq < WATERFALL_MAX_DISTANCE_SQ).sort((a, b) => a.dsq - b.dsq).slice(0, this.emitters.length);
    const paired = new Set<WaterfallEmitter>(), unclaimed: WaterfallSource[] = [];
    for (const { source } of nearest) {
      const emitter = this.emitters.find(candidate => candidate.source === source);
      if (emitter) paired.add(emitter); else unclaimed.push(source);
    }
    for (const emitter of this.emitters) {
      if (paired.has(emitter)) continue;
      const source = unclaimed.pop();
      if (!source) { this.stopEmitter(emitter); continue; }
      if (!emitter.handle?.isPlaying() || !emitter.source || !this.waterfalls.has(emitter.source)) {
        this.stopEmitter(emitter);
        emitter.position.copy(source.position);
        emitter.handle = PlaySound(WATERFALL_SOUND, emitter.position);
        emitter.source = source;
        this.setVolume(emitter, source.volume);
        continue;
      }
      const oldVolume = emitter.volume;
      emitter.source = source;
      this.fade(emitter, oldVolume, WATERFALL_MIN_FADE_VOLUME, () => {
        if (!this.waterfalls.has(source)) return;
        emitter.position.copy(source.position);
        this.fade(emitter, WATERFALL_MIN_FADE_VOLUME, source.volume);
      });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.selectionTimer.stop(); this.fadeTimer.stop();
    this.waterfalls.clear();
    for (const emitter of this.emitters) this.stopEmitter(emitter);
    this.cleanups.splice(0).forEach(stop => stop());
  }
}

