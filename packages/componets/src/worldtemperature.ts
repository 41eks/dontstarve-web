import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { batch, createMemo, createSignal, type Memo, type Signal } from '../../signals/src';

export type WorldTemperatureSeason = 'autumn' | 'winter' | 'spring' | 'summer';
export type WorldTemperaturePhase = 'day' | 'dusk' | 'night';

export interface WorldTemperatureSeasonTick {
  season: WorldTemperatureSeason;
  /** seasons.lua's normalized progress, not elapsed days. */
  progress: number;
}

export interface WorldTemperatureClockTick {
  phase: WorldTemperaturePhase;
  /** clock.lua's normalized progress within the current phase. */
  timeinphase: number;
}

/** A loaded Lua save preserves the temperature term without guessing calendar progress. */
export type WorldTemperatureSeasonState = WorldTemperatureSeasonTick | { season: WorldTemperatureSeason; temperature: number };
export type WorldTemperatureClockState = WorldTemperatureClockTick | { phase: WorldTemperaturePhase; temperature: number };

export interface WorldTemperatureSaveData {
  daylight?: boolean;
  season: WorldTemperatureSeason;
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

const TEMPERATURE_NOISE_SCALE = 0.025;
const TEMPERATURE_NOISE_MAG = 8;
const PHASE_TEMPERATURES: Record<WorldTemperaturePhase, number> = { day: 5, dusk: 0, night: -6 };
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

function progress(value: number, name: string): number {
  if (finite(value, name) < 0 || value > 1) throw new RangeError(`${name} must be between 0 and 1`);
  return value;
}

function seasonTemperature(season: WorldTemperatureSeason, p: number): number {
  switch (season) {
    case 'winter': return 5 - 30 * Math.sin(Math.PI * p);
    case 'spring': return 5 + 50 * p;
    case 'summer': return 55 + 40 * Math.sin(Math.PI * p);
    case 'autumn': return 55 - 50 * p;
    default: throw new RangeError(`Invalid season: ${season}`);
  }
}

function phaseTemperature(phase: WorldTemperaturePhase, p: number): number {
  if (!Object.hasOwn(PHASE_TEMPERATURES, phase)) throw new RangeError(`Invalid phase: ${phase}`);
  return PHASE_TEMPERATURES[phase] * Math.sin(Math.PI * p);
}

function validatedSignal<T>(initial: T, validate: (value: T) => T): Signal<T> {
  const state = createSignal(validate(initial));
  return { ...state, set: value => state.set(validate(value)) };
}

function validateSeason(data: WorldTemperatureSeasonState): WorldTemperatureSeasonState {
  seasonTemperature(data.season, 0.5);
  return Object.freeze('temperature' in data
    ? { season: data.season, temperature: finite(data.temperature, 'seasontemperature') }
    : { season: data.season, progress: progress(data.progress, 'progress') });
}

function validateClock(data: WorldTemperatureClockState): WorldTemperatureClockState {
  phaseTemperature(data.phase, 0);
  return Object.freeze('temperature' in data
    ? { phase: data.phase, temperature: finite(data.temperature, 'phasetemperature') }
    : { phase: data.phase, timeinphase: progress(data.timeinphase, 'timeinphase') });
}

function seasonalTerm(state: WorldTemperatureSeasonState): number {
  return 'temperature' in state ? state.temperature : seasonTemperature(state.season, state.progress);
}

function phaseTerm(state: WorldTemperatureClockState): number {
  return 'temperature' in state ? state.temperature : phaseTemperature(state.phase, state.timeinphase);
}

/** worldtemperature.lua's temperature state; the host supplies clock/season ticks and active dt. */
export class WorldTemperature {
  readonly season = validatedSignal<WorldTemperatureSeasonState>({ season: 'autumn', progress: 0.5 }, validateSeason);
  readonly clock = validatedSignal<WorldTemperatureClockState>({ phase: 'day', timeinphase: 0 }, validateClock);
  readonly temperature: Memo<number>;
  private readonly noisetime = createSignal(0);
  private readonly modifiers = createSignal({ multiplier: 1, locus: 0 });
  private readonly perlin: NonNullable<WorldTemperatureOptions['perlin']>;
  private readonly stopTemperatureTick?: () => void;

  constructor(options: WorldTemperatureOptions = {}) {
    this.perlin = options.perlin ?? defaultPerlin;
    this.temperature = createMemo(() => {
      const sample = progress(this.perlin(0, 0, this.noisetime.get() * TEMPERATURE_NOISE_SCALE), 'perlin');
      const noise = 2 * TEMPERATURE_NOISE_MAG * sample - TEMPERATURE_NOISE_MAG;
      const { multiplier, locus } = this.modifiers.get();
      return (noise + seasonalTerm(this.season.get()) + phaseTerm(this.clock.get()) - locus) * multiplier + locus;
    });
    if (options.onTemperatureTick) {
      options.onTemperatureTick(this.temperature.peek());
      this.stopTemperatureTick = this.temperature.subscribe(value => options.onTemperatureTick!(value));
    }
  }

  /** Lua-style adapter for the same season signal exposed to the host. */
  OnSeasonTick(data: WorldTemperatureSeasonTick): void {
    this.season.set(data);
  }

  /** Also tracks phasechanged's daylight flag for the Lua save format. */
  OnClockTick(data: WorldTemperatureClockTick): void {
    this.clock.set(data);
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
      seasontemperature: seasonalTerm(season),
      phasetemperature: phaseTerm(clock),
      noisetime: this.noisetime.peek(),
    };
  }

  /** Global modifiers belong to host world configuration and are not reset by loading. */
  OnLoad(data: Partial<WorldTemperatureSaveData>): void {
    // Validate all fields before changing state, so a rejected load preserves the world.
    const season = data.season ?? 'autumn';
    const fallback = seasonTemperature(season, 0.5);
    const seasontemperature = finite(data.seasontemperature ?? fallback, 'seasontemperature');
    const phasetemperature = finite(data.phasetemperature ?? 0, 'phasetemperature');
    const noisetime = nonnegative(data.noisetime ?? 0, 'noisetime');
    if (data.daylight !== undefined && typeof data.daylight !== 'boolean') {
      throw new TypeError('daylight must be a boolean');
    }
    batch(() => {
      this.season.set({ season, temperature: seasontemperature });
      this.clock.set({ phase: data.daylight === true ? 'day' : 'dusk', temperature: phasetemperature });
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
  }
}

export default WorldTemperature;
