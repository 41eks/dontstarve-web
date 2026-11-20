import type { LuaFn } from './luaFn';
/** instrument.lua onheard(listener, musician, inst): the only callback whose first argument is not the instrument. */
export type InstrumentOnHeardFn<Inst, Musician, Listener> = LuaFn<[listener: Listener, musician: Musician, inst: Inst]>;
export type InstrumentOnPlayedFn<Inst, Musician> = LuaFn<[inst: Inst, musician: Musician]>;
export type InstrumentOnFinishedPlayingFn<Inst, Musician> = LuaFn<[inst: Inst, musician: Musician]>;

/** components/instrument.lua: onplayed, then onheard for every entity in range, then onfinishedplaying. */
export class Instrument<Musician, Listener, Inst = unknown> {
  range = 15;
  private onheard?: InstrumentOnHeardFn<Inst, Musician, Listener>;
  private onplayed?: InstrumentOnPlayedFn<Inst, Musician>;
  private onfinishedplaying?: InstrumentOnFinishedPlayingFn<Inst, Musician>;
  private readonly inst: Inst;
  private readonly findListeners: (musician: Musician, range: number) => Iterable<Listener>;

  /** `findListeners` is the prefab's TheSim:FindEntities(x, y, z, range, nil, {FX, DECOR, INLIMBO}) at the musician. */
  constructor(inst: Inst, findListeners: (musician: Musician, range: number) => Iterable<Listener>) {
    this.inst = inst; this.findListeners = findListeners;
  }

  dispose(): void { /* no timers or subscriptions */ }

  SetRange(range: number): void { this.range = range; }
  SetOnHeardFn(fn: InstrumentOnHeardFn<Inst, Musician, Listener> | undefined): void { this.onheard = fn; }
  SetOnPlayedFn(fn: InstrumentOnPlayedFn<Inst, Musician> | undefined): void { this.onplayed = fn; }
  SetOnFinishedPlayingFn(fn: InstrumentOnFinishedPlayingFn<Inst, Musician> | undefined): void { this.onfinishedplaying = fn; }

  Play(musician: Musician): boolean {
    this.onplayed?.(this.inst, musician);
    if (this.onheard) {
      const self: unknown = this.inst; // listeners are entities like the instrument; only identity is compared
      for (const listener of this.findListeners(musician, this.range)) {
        if (listener !== self) { this.onheard(listener, musician, this.inst); }
      }
    }
    this.onfinishedplaying?.(this.inst, musician);
    return true;
  }
}
