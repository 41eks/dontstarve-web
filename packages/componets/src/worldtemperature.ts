import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import {
  batch, createMemo, createSignal, watchSignal, clockstate, seasonstate, type Memo,
  type Signal, type WorldSeason, type WorldPhase, type SeasonTick, type ClockTick, type ClockState, type SeasonState,
} from '../../signals/src';

export interface WorldTemperatureSaveData {
  daylight?: boolean;
  season: WorldSeason;
  seasontemperature: number;
  phasetemperature: number;
  noisetime: number;
}

export interface WorldTemperatureOptions {
  /** Lua perlin contract: a deterministic noise value in [0, 1]. */
  perlin?: (x: number, y: number, z: number) => number;
  /** Host adapter notified synchronously when the derived temperature changes. */
  onTemperatureTick?: (temperature: number) => void;
}

const TEMPERATURE_NOISE_SCALE = .025;
const TEMPERATURE_NOISE_MAG = 8;
const PHASE_TEMPERATURES: Record<WorldPhase, number> = { day: 5, dusk: 0, night: -6 };

/** worldtemperature.lua seasonal curves, preserving saved temperature terms. */
function getWorldSeasonTemperature(state: SeasonState): number {
  if ('temperature' in state) return state.temperature;
  const p = state.progress;
  switch (state.season) {
    case 'winter': return 5 - 30 * Math.sin(Math.PI * p);
    case 'spring': return 5 + 50 * p;
    case 'summer': return 55 + 40 * Math.sin(Math.PI * p);
    case 'autumn': return 55 - 50 * p;
    default: throw new RangeError(`Invalid season: ${state.season}`);
  }
}

function getWorldPhaseTemperature(state: ClockState): number {
  if ('temperature' in state) return state.temperature;
  if (!Object.hasOwn(PHASE_TEMPERATURES, state.phase)) throw new RangeError(`Invalid phase: ${state.phase}`);
  return PHASE_TEMPERATURES[state.phase] * Math.sin(Math.PI * state.timeinphase);
}

const noise = new ImprovedNoise();

/** Normalized ImprovedNoise; DST's native perlin implementation is not in Lua. */
function defaultPerlin(x: number, y: number, z: number): number {
  return (noise.noise(x, y, z) + 1) / 2;
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return value;
}

function nonnegative(value: number, name: string): number {
  if (finite(value, name) < 0) throw new RangeError(`${name} must be nonnegative`);
  return value;
}

/** worldtemperature.lua's temperature state; the host supplies clock/season ticks and active dt. */
export class WorldTemperature {
  readonly temperature: Memo<number>;
  private readonly noisetime = createSignal(0);
  private readonly modifiers = createSignal({ multiplier: 1, locus: 0 });
  private readonly perlin: NonNullable<WorldTemperatureOptions['perlin']>;
  private readonly stopTemperatureTick?: () => void;
  private readonly cleanups: (() => void)[] = [];
  private readonly clock: Signal<ClockState>;
  private readonly season: Signal<SeasonState>;

  constructor(options: WorldTemperatureOptions = {}) {
    this.perlin = options.perlin ?? defaultPerlin;
    this.clock = watchSignal(clockstate, stop => this.cleanups.push(stop));
    this.season = watchSignal(seasonstate, stop => this.cleanups.push(stop));
    try {
      this.temperature = createMemo(() => {
        const sample = this.perlin(0, 0, this.noisetime.get() * TEMPERATURE_NOISE_SCALE);
        if (!Number.isFinite(sample)) throw new RangeError('perlin must be finite');
        if (sample < 0 || sample > 1) throw new RangeError('perlin must be between 0 and 1');
        const noise = 2 * TEMPERATURE_NOISE_MAG * sample - TEMPERATURE_NOISE_MAG;
        const { multiplier, locus } = this.modifiers.get();
        return (noise + getWorldSeasonTemperature(this.season.get()) + getWorldPhaseTemperature(this.clock.get()) - locus) * multiplier + locus;
      });
    } catch (error) { this.cleanups.splice(0).forEach(stop => stop()); throw error; }
    if (options.onTemperatureTick) {
      options.onTemperatureTick(this.temperature.peek());
      this.stopTemperatureTick = this.temperature.subscribe(value => options.onTemperatureTick!(value));
    }
  }

  /** Lua-style adapter for the same season signal exposed to the host. */
  OnSeasonTick(data: SeasonTick): void {
    seasonstate.set(data);
  }

  /** Also tracks phasechanged's daylight flag for the Lua save format. */
  OnClockTick(data: ClockTick): void {
    clockstate.set(data);
  }

  SetTemperatureMod(multiplier: number, locus: number): void {
    finite(multiplier, 'multiplier');
    finite(locus, 'locus');
    this.modifiers.set({ multiplier, locus });
  }

  /** World temperature is not clamped to entity temperature limits. */
  GetTemperature(): number {
    return this.temperature();
  }

  OnUpdate(dt: number): void {
    const nexttime = finite(this.noisetime.peek() + nonnegative(dt, 'dt'), 'noisetime');
    this.noisetime.set(nexttime);
  }

  LongUpdate(dt: number): void { this.OnUpdate(dt); }

  OnSave(): WorldTemperatureSaveData {
    const season = this.season.peek(), clock = this.clock.peek();
    return {
      ...(clock.phase === 'day' ? { daylight: true } : {}),
      season: season.season,
      seasontemperature: getWorldSeasonTemperature(season),
      phasetemperature: getWorldPhaseTemperature(clock),
      noisetime: this.noisetime.peek(),
    };
  }

  /** Global modifiers belong to host world configuration and are not reset by loading. */
  OnLoad(data: Partial<WorldTemperatureSaveData>): void {
    // Validate all fields before changing state, so a rejected load preserves the world.
    const season = data.season ?? 'autumn';
    const fallback = getWorldSeasonTemperature({ season, progress: .5 });
    const seasontemperature = finite(data.seasontemperature ?? fallback, 'seasontemperature');
    const phasetemperature = finite(data.phasetemperature ?? 0, 'phasetemperature');
    const noisetime = nonnegative(data.noisetime ?? 0, 'noisetime');
    if (data.daylight !== undefined && typeof data.daylight !== 'boolean') {
      throw new TypeError('daylight must be a boolean');
    }
    batch(() => {
      seasonstate.set({ season, temperature: seasontemperature });
      clockstate.set({ phase: data.daylight === true ? 'day' : 'dusk', temperature: phasetemperature });
      this.noisetime.set(noisetime);
    });
  }

  GetDebugString(): string {
    const { multiplier, locus } = this.modifiers.peek();
    return `${this.GetTemperature().toFixed(2)}C mult: ${multiplier.toFixed(2)} locus ${locus.toFixed(1)}`;
  }

  dispose(): void {
    this.stopTemperatureTick?.();
    this.temperature.dispose();
    this.cleanups.splice(0).forEach(stop => stop());
  }
}

export default WorldTemperature;
