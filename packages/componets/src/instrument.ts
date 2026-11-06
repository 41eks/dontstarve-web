/** components/instrument.lua: onplayed, then onheard for every entity in range, then onfinishedplaying. */
export class Instrument<Musician, Listener> {
  range = 15;
  private onheard?: (listener: Listener, musician: Musician, instrument: unknown) => void;
  private onplayed?: (instrument: unknown, musician: Musician) => void;
  private onfinishedplaying?: (instrument: unknown, musician: Musician) => void;
  private readonly inst: unknown;
  private readonly findListeners: (musician: Musician, range: number) => Iterable<Listener>;

  /** `findListeners` is the prefab's TheSim:FindEntities(x, y, z, range, nil, {FX, DECOR, INLIMBO}) at the musician. */
  constructor(inst: unknown, findListeners: (musician: Musician, range: number) => Iterable<Listener>) {
    this.inst = inst; this.findListeners = findListeners;
  }

  dispose(): void { /* no timers or subscriptions */ }

  SetRange(range: number): void { this.range = range; }
  SetOnHeardFn(fn: Instrument<Musician, Listener>['onheard']): void { this.onheard = fn; }
  SetOnPlayedFn(fn: Instrument<Musician, Listener>['onplayed']): void { this.onplayed = fn; }
  SetOnFinishedPlayingFn(fn: Instrument<Musician, Listener>['onfinishedplaying']): void { this.onfinishedplaying = fn; }

  Play(musician: Musician): boolean {
    this.onplayed?.(this.inst, musician);
    if (this.onheard) {
      for (const listener of this.findListeners(musician, this.range)) {
        if (listener as unknown !== this.inst) this.onheard(listener, musician, this.inst);
      }
    }
    this.onfinishedplaying?.(this.inst, musician);
    return true;
  }
}
