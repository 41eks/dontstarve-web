import { createSignal, type Signal } from './signal';

export type WorldSeason = 'autumn' | 'winter' | 'spring' | 'summer';
export type WorldPhase = 'day' | 'dusk' | 'night';
export type WorldMoonPhase = 'new' | 'quarter' | 'half' | 'threequarter' | 'full';

export interface SeasonTick {
  season: WorldSeason;
  /** seasons.lua's normalized progress, not elapsed days. */
  progress: number;
}

export interface ClockTick {
  phase: WorldPhase;
  /** clock.lua's normalized progress within the current phase. */
  timeinphase: number;
}

/** A loaded Lua save preserves the temperature term without guessing calendar progress. */
export type SeasonState = SeasonTick | { season: WorldSeason; temperature: number };
export type ClockState = ClockTick | { phase: WorldPhase; temperature: number };

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return value;
}

function progress(value: number, name: string): number {
  if (finite(value, name) < 0 || value > 1) throw new RangeError(`${name} must be between 0 and 1`);
  return value;
}

function validatedSignal<T>(initial: T, validate: (value: T) => T): Signal<T> {
  const state = createSignal(validate(initial));
  return { ...state, set: value => state.set(validate(value)) };
}

function validateSeason(data: SeasonState): SeasonState {
  if (!['autumn', 'winter', 'spring', 'summer'].includes(data.season)) {
    throw new RangeError(`Invalid season: ${data.season}`);
  }
  return Object.freeze('temperature' in data
    ? { season: data.season, temperature: finite(data.temperature, 'seasontemperature') }
    : { season: data.season, progress: progress(data.progress, 'progress') });
}

function validateClock(data: ClockState): ClockState {
  if (!['day', 'dusk', 'night'].includes(data.phase)) throw new RangeError(`Invalid phase: ${data.phase}`);
  return Object.freeze('temperature' in data
    ? { phase: data.phase, temperature: finite(data.temperature, 'phasetemperature') }
    : { phase: data.phase, timeinphase: progress(data.timeinphase, 'timeinphase') });
}

function validateMoonPhase(phase: WorldMoonPhase): WorldMoonPhase {
  if (!['new', 'quarter', 'half', 'threequarter', 'full'].includes(phase)) {
    throw new RangeError(`Invalid moon phase: ${phase}`);
  }
  return phase;
}

/** Shared world inputs; loading a world restores these existing singleton signals. */
export const seasonstate = validatedSignal<SeasonState>({ season: 'autumn', progress: 0.5 }, validateSeason);
export const clockstate = validatedSignal<ClockState>({ phase: 'day', timeinphase: 0 }, validateClock);
export const moonphasestate = validatedSignal<WorldMoonPhase>('new', validateMoonPhase);
