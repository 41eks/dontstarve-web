import { createMemo, createSignal, readonlySignal, watchSignal, type ReadonlySignal, type Signal } from '../../signals/src';

/** A prefix sum of temperature-weighted game seconds, relative to this loaded world. */
export interface PerishTick {
  readonly time: number;
  readonly total: number;
}

export interface PerishClock {
  GetTick(time?: number): PerishTick;
  /** Frozen perishables have zero decay below freezing, overriding holder and wetness factors. */
  GetFrozenTick?(time?: number): PerishTick;
}

interface PerishInterval {
  readonly start: PerishTick;
  readonly frozenStart: number;
  endTime: number;
  readonly multiplier: number;
}

/** perishable.lua's currently ported ambient-temperature factors. */
const temperatureMultiplier = (temperature: number) => temperature < 0 ? .75 : temperature > 70 ? 1.25 : 1;

/** One world-wide integral; entity settlement does not need to replay temperature changes. */
export class WorldPerishClock implements PerishClock {
  private readonly temperature: Signal<number>;
  private readonly multiplier;
  private readonly stopTemperature: () => void;
  private readonly settled: Signal<PerishTick>;
  readonly snapshot: ReadonlySignal<PerishTick>;
  private readonly intervals: PerishInterval[] = [];
  private readonly initialTime: number;
  private time: number;
  private total = 0;
  private frozenTotal = 0;
  private disposed = false;

  constructor(temperature: ReadonlySignal<number>, initialTime = 0) {
    if (!Number.isFinite(initialTime) || initialTime < 0) throw new RangeError('Invalid initial perish time');
    this.initialTime = this.time = initialTime;
    this.settled = createSignal(Object.freeze({ time: initialTime, total: 0 }));
    this.snapshot = readonlySignal(this.settled);
    let stop!: () => void;
    this.temperature = watchSignal(temperature, cleanup => { stop = cleanup; });
    this.stopTemperature = stop;
    this.multiplier = createMemo(() => temperatureMultiplier(this.temperature.get()));
  }

  /** Each frame records its actual dt without publishing a signal or changing world temperature. */
  OnUpdate(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('dt must be finite and nonnegative');
    if (this.disposed || dt === 0) return;
    const multiplier = this.multiplier.peek();
    let interval = this.intervals.at(-1);
    if (!interval || interval.multiplier !== multiplier) {
      interval = { start: this.GetTick(), frozenStart: this.frozenTotal, endTime: this.time, multiplier };
      this.intervals.push(interval);
    }
    this.time += dt;
    interval.endTime = this.time;
    this.total = interval.start.total + (this.time - interval.start.time) * multiplier;
    this.frozenTotal = interval.frozenStart + (this.time - interval.start.time) * (multiplier === .75 ? 0 : multiplier);
  }

  /** Publish only at the world's 60-frame settlement or an explicit partial settlement. */
  Flush(): void {
    if (this.settled.peek().time !== this.time) this.settled.set(this.GetTick());
  }

  /** Sampling the live integral also includes frames after the last published snapshot. */
  GetTick(time = this.time): PerishTick {
    if (!Number.isFinite(time) || time < this.initialTime || time > this.time) throw new RangeError('Perish tick outside recorded game time');
    if (time === this.time) return Object.freeze({ time, total: this.total });
    let lo = 0, hi = this.intervals.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.intervals[mid].endTime < time) lo = mid + 1;
      else hi = mid;
    }
    const interval = this.intervals[lo];
    return Object.freeze({ time, total: interval.start.total + (time - interval.start.time) * interval.multiplier });
  }

  GetFrozenTick(time = this.time): PerishTick {
    // Validate and locate time using the same recorded intervals as normal perishables.
    this.GetTick(time);
    if (time === this.time) return Object.freeze({ time, total: this.frozenTotal });
    let lo = 0, hi = this.intervals.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.intervals[mid].endTime < time) lo = mid + 1;
      else hi = mid;
    }
    const interval = this.intervals[lo];
    return Object.freeze({ time, total: interval.frozenStart
      + (time - interval.start.time) * (interval.multiplier === .75 ? 0 : interval.multiplier) });
  }

  dispose(): void {
    if (this.disposed) return;
    this.Flush();
    this.disposed = true;
    this.stopTemperature();
  }
}
