import {
  batch, createEffect, createMemo, createSignal, readonlySignal, seasonstate,
  type Memo, type ReadonlySignal, type WorldSeason,
} from '../../signals/src';

export type PrecipitationType = 'none' | 'rain' | 'snow';

export interface WeatherSaveData {
  moisture: number;
  moisturefloor: number;
  moistureceil: number;
  preciptype: PrecipitationType;
  peakprecipitationrate: number;
  /** Legacy precipitation-only saves omit snowlevel. */
  snowlevel?: number;
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
const STOP_SNOW_THRESHOLDS: Record<WorldSeason, number> = { autumn: 0, winter: 10, spring: 0, summer: 0 };
const SNOW_ACCUM_RATE = 1 / 300;
const SNOW_MELT_RATE = 1 / 20;
const MIN_SNOW_MELT_RATE = 1 / 120;
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
 * derived precipitation rate, temperature-driven rain/snow transitions and snow accumulation/melting.
 * Moisture only moves by `ForcePrecipitation` (the `ms_forceprecipitation` event, used by
 * `book_rain`) and by dissipating while it precipitates. Wetness, entity snow cover, lightning, lunar hail, precipitation
 * modes and the seasonal moisture rate are not ported.
 */
export class Weather {
  private readonly moistureState = createSignal(0);
  private readonly moistureceilState = createSignal(0);
  private readonly moisturefloorState = createSignal(0);
  private readonly preciptypeState = createSignal<PrecipitationType>('none');
  private readonly peakprecipitationrateState = createSignal(1);
  private readonly snowlevelState = createSignal(0);
  readonly moisture = readonlySignal(this.moistureState);
  readonly moistureceil = readonlySignal(this.moistureceilState);
  readonly moisturefloor = readonlySignal(this.moisturefloorState);
  readonly preciptype = readonlySignal(this.preciptypeState);
  readonly peakprecipitationrate = readonlySignal(this.peakprecipitationrateState);
  readonly snowLevel = readonlySignal(this.snowlevelState);
  /** weather.lua CalculatePrecipitationRate(): zero when dry, otherwise a rise and fall over the moisture range. */
  readonly precipitationRate: Memo<number>;
  /** Each emitter follows only its own precipitation type. */
  readonly rainRate: ReadonlySignal<number>;
  readonly snowRate: ReadonlySignal<number>;
  /** weather.lua SetGroundOverlay: three successive texture-mask layers. */
  readonly snowCover: ReadonlySignal<number>;
  private readonly rainRateMemo: Memo<number>;
  private readonly snowRateMemo: Memo<number>;
  private readonly snowCoverMemo: Memo<number>;
  private readonly stopTemperature: () => void;
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
    this.snowRateMemo = createMemo(() => this.preciptypeState.get() === 'snow' ? this.precipitationRate.get() : 0);
    this.snowRate = readonlySignal(this.snowRateMemo);
    this.snowCoverMemo = createMemo(() => this.snowlevelState.get() * 3);
    this.snowCover = readonlySignal(this.snowCoverMemo);
    this.stopTemperature = createEffect(() => {
      this.updatePrecipitationType(seasonstate.get().season, options.temperature());
    });
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

  /** weather.lua's final temperature branch uses separate start/stop thresholds (hysteresis). */
  private updatePrecipitationType(season = this.season(), temperature = this.options.temperature()): void {
    if (temperature < START_SNOW_THRESHOLDS[season] && this.preciptypeState.peek() === 'rain') {
      this.preciptypeState.set('snow');
    } else if (temperature > STOP_SNOW_THRESHOLDS[season] && this.preciptypeState.peek() === 'snow') {
      this.preciptypeState.set('rain');
    }
  }

  /** weather.lua OnForcePrecipitation: jump moisture to its ceiling (`enable`) or floor; OnUpdate then reacts. */
  ForcePrecipitation(enable = true): void {
    this.moistureState.set(enable ? this.moistureceilState.peek() : this.moisturefloorState.peek());
  }

  /** The moisture branches of OnUpdate: dissipate while precipitating, otherwise accumulate toward the ceiling. */
  OnUpdate(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('dt must be finite and nonnegative');
    // Lua samples the precipitation rate before settling moisture.
    const rate = this.precipitationRate.peek();
    if (this.preciptypeState.peek() !== 'none') {
      const moisture = Math.max(this.moistureState.peek() - rate * dt * PRECIP_RATE_SCALE, 0);
      if (moisture <= this.moisturefloorState.peek()) this.stopPrecipitation();
      else this.moistureState.set(moisture);
    } else if (this.moistureceilState.peek() > 0) {
      const moisture = this.moistureState.peek() + MOISTURE_RATE * dt;
      if (moisture >= this.moistureceilState.peek()) this.startPrecipitation();
      else this.moistureState.set(moisture);
    }
    const snowlevel = this.snowlevelState.peek();
    const temperature = this.options.temperature();
    if (this.preciptypeState.peek() === 'snow') {
      this.snowlevelState.set(Math.min(snowlevel + rate * dt * SNOW_ACCUM_RATE, 1));
    } else if (snowlevel > 0 && temperature > 0) {
      const meltrate = MIN_SNOW_MELT_RATE + SNOW_MELT_RATE * Math.min(temperature / 20, 1);
      this.snowlevelState.set(Math.max(snowlevel - meltrate * dt, 0));
    }
    this.updatePrecipitationType();
  }

  OnSave(): WeatherSaveData {
    return {
      moisture: this.moistureState.peek(), moisturefloor: this.moisturefloorState.peek(),
      moistureceil: this.moistureceilState.peek(), preciptype: this.preciptypeState.peek(),
      peakprecipitationrate: this.peakprecipitationrateState.peek(),
      snowlevel: this.snowlevelState.peek(),
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
    const snowlevel = finite(data.snowlevel ?? 0, 'snowlevel');
    if (snowlevel < 0 || snowlevel > 1) throw new RangeError('snowlevel must be between 0 and 1');
    batch(() => {
      this.moistureState.set(moisture);
      this.moisturefloorState.set(moisturefloor);
      this.moistureceilState.set(moistureceil);
      this.preciptypeState.set(preciptype);
      this.peakprecipitationrateState.set(peak);
      this.snowlevelState.set(snowlevel);
    });
  }

  dispose(): void {
    this.stopTemperature();
    this.snowCoverMemo.dispose();
    this.snowRateMemo.dispose();
    this.rainRateMemo.dispose();
    this.precipitationRate.dispose();
  }
}
