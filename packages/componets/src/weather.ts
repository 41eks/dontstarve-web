import {
  batch, createMemo, createSignal, readonlySignal, seasonstate,
  type Memo, type ReadonlySignal, type WorldSeason,
} from '../../signals/src';

export type PrecipitationType = 'none' | 'rain' | 'snow';

export interface WeatherSaveData {
  moisture: number;
  moisturefloor: number;
  moistureceil: number;
  preciptype: PrecipitationType;
  peakprecipitationrate: number;
}

export interface WeatherOptions {
  /** TUNING.TOTAL_DAY_TIME; moisture ceilings scale with the length of a day. */
  totalDayTime: number;
  /** The world temperature that StartPrecipitation compares with the snow threshold. */
  temperature(): number;
  random?: () => number;
}

// components/weather.lua constants.
const PRECIP_RATE_SCALE = 10;
const MIN_PRECIP_RATE = 0.1;
const MOISTURE_CEIL_MULTIPLIERS: Record<WorldSeason, number> = { autumn: 8, winter: 3, spring: 5.5, summer: 13 };
const MOISTURE_FLOOR_MULTIPLIERS: Record<WorldSeason, number> = { autumn: 1, winter: 1, spring: 0.25, summer: 1.5 };
const START_SNOW_THRESHOLDS: Record<WorldSeason, number> = { autumn: -5, winter: 5, spring: -5, summer: -5 };
const PEAK_PRECIPITATION_RANGES: Record<WorldSeason, { min: number; max: number }> = {
  autumn: { min: 0.1, max: 0.66 }, winter: { min: 0.1, max: 0.8 }, spring: { min: 0.5, max: 1 }, summer: { min: 1, max: 1 },
};
/** `_moisturerate` is season-driven in Lua (seasontick); seasons do not advance here, so moisture never accumulates by itself. */
const MOISTURE_RATE = 0;

const PRECIPITATION_TYPES: readonly PrecipitationType[] = ['none', 'rain', 'snow'];

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return value;
}

/**
 * The precipitation part of components/weather.lua: moisture, its ceiling and floor, the precipitation type and the
 * derived precipitation rate. Moisture only moves by `ForcePrecipitation` (the `ms_forceprecipitation` event, used by
 * `book_rain`) and by dissipating while it precipitates. Wetness, snow cover, lightning, lunar hail, precipitation
 * modes and the seasonal moisture rate are not ported.
 */
export class Weather {
  private readonly moistureState = createSignal(0);
  private readonly moistureceilState = createSignal(0);
  private readonly moisturefloorState = createSignal(0);
  private readonly preciptypeState = createSignal<PrecipitationType>('none');
  private readonly peakprecipitationrateState = createSignal(1);
  readonly moisture = readonlySignal(this.moistureState);
  readonly moistureceil = readonlySignal(this.moistureceilState);
  readonly moisturefloor = readonlySignal(this.moisturefloorState);
  readonly preciptype = readonlySignal(this.preciptypeState);
  readonly peakprecipitationrate = readonlySignal(this.peakprecipitationrateState);
  /** weather.lua CalculatePrecipitationRate(): zero when dry, otherwise a rise and fall over the moisture range. */
  readonly precipitationRate: Memo<number>;
  /** The rain particles and ambience follow the rate only for rain; snow has no art yet. */
  readonly rainRate: ReadonlySignal<number>;
  private readonly rainRateMemo: Memo<number>;
  private readonly options: WeatherOptions;
  private readonly random: () => number;

  constructor(options: WeatherOptions) {
    this.options = options;
    this.random = options.random ?? Math.random;
    this.moistureceilState.set(this.randomizeMoistureCeil());
    this.precipitationRate = createMemo(() => {
      if (this.preciptypeState.get() === 'none') return 0;
      const floor = this.moisturefloorState.get();
      const p = Math.max(0, Math.min(1, (this.moistureState.get() - floor) / (this.moistureceilState.get() - floor)));
      const rate = MIN_PRECIP_RATE + (1 - MIN_PRECIP_RATE) * Math.sin(p * Math.PI);
      return Math.min(rate, this.peakprecipitationrateState.get());
    });
    this.rainRateMemo = createMemo(() => this.preciptypeState.get() === 'rain' ? this.precipitationRate.get() : 0);
    this.rainRate = readonlySignal(this.rainRateMemo);
  }

  private season(): WorldSeason { return seasonstate.peek().season; }
  private randomizeMoistureCeil(): number {
    return (1 + this.random()) * this.options.totalDayTime * MOISTURE_CEIL_MULTIPLIERS[this.season()];
  }

  private startPrecipitation(): void {
    const season = this.season();
    const range = PEAK_PRECIPITATION_RANGES[season];
    batch(() => {
      this.moistureState.set(this.moistureceilState.peek());
      this.moisturefloorState.set((0.25 + this.random() * 0.5) * this.moistureState.peek() * MOISTURE_FLOOR_MULTIPLIERS[season]);
      this.peakprecipitationrateState.set(range.min + this.random() * (range.max - range.min));
      this.preciptypeState.set(this.options.temperature() < START_SNOW_THRESHOLDS[season] ? 'snow' : 'rain');
    });
  }

  private stopPrecipitation(): void {
    batch(() => {
      this.moistureState.set(this.moisturefloorState.peek());
      this.moistureceilState.set(this.randomizeMoistureCeil());
      this.preciptypeState.set('none');
    });
  }

  /** weather.lua OnForcePrecipitation: jump moisture to its ceiling (`enable`) or floor; OnUpdate then reacts. */
  ForcePrecipitation(enable = true): void {
    this.moistureState.set(enable ? this.moistureceilState.peek() : this.moisturefloorState.peek());
  }

  /** The moisture branches of OnUpdate: dissipate while precipitating, otherwise accumulate toward the ceiling. */
  OnUpdate(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('dt must be finite and nonnegative');
    if (this.preciptypeState.peek() !== 'none') {
      const moisture = Math.max(this.moistureState.peek() - this.precipitationRate.peek() * dt * PRECIP_RATE_SCALE, 0);
      if (moisture <= this.moisturefloorState.peek()) this.stopPrecipitation();
      else this.moistureState.set(moisture);
    } else if (this.moistureceilState.peek() > 0) {
      const moisture = this.moistureState.peek() + MOISTURE_RATE * dt;
      if (moisture >= this.moistureceilState.peek()) this.startPrecipitation();
      else this.moistureState.set(moisture);
    }
  }

  OnSave(): WeatherSaveData {
    return {
      moisture: this.moistureState.peek(), moisturefloor: this.moisturefloorState.peek(),
      moistureceil: this.moistureceilState.peek(), preciptype: this.preciptypeState.peek(),
      peakprecipitationrate: this.peakprecipitationrateState.peek(),
    };
  }

  /** Validates every field before changing state, so a rejected load preserves the world. */
  OnLoad(data: Partial<WeatherSaveData>): void {
    const preciptype = data.preciptype ?? 'none';
    if (!PRECIPITATION_TYPES.includes(preciptype)) throw new RangeError(`Invalid precipitation type: ${preciptype}`);
    const moisture = finite(data.moisture ?? 0, 'moisture');
    const moisturefloor = finite(data.moisturefloor ?? 0, 'moisturefloor');
    const moistureceil = finite(data.moistureceil ?? this.randomizeMoistureCeil(), 'moistureceil');
    const peak = finite(data.peakprecipitationrate ?? 1, 'peakprecipitationrate');
    batch(() => {
      this.moistureState.set(moisture);
      this.moisturefloorState.set(moisturefloor);
      this.moistureceilState.set(moistureceil);
      this.preciptypeState.set(preciptype);
      this.peakprecipitationrateState.set(peak);
    });
  }

  dispose(): void {
    this.rainRateMemo.dispose();
    this.precipitationRate.dispose();
  }
}
