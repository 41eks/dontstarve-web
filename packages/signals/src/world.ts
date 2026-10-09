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

/** Optional clocktick presentation fields; temperature-only Lua saves omit them. */
export interface ClockCalendar {
  cycles: number;
  time: number;
  daySegments: number;
  duskSegments: number;
  waxing: boolean;
  playerAge: number;
}

/** A loaded Lua save preserves the temperature term without guessing calendar progress. */
export type SeasonState = SeasonTick | { season: WorldSeason; temperature: number };
export type ClockState = (ClockTick | { phase: WorldPhase; temperature: number }) & Partial<ClockCalendar>;

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
  const calendar: Partial<ClockCalendar> = {};
  for (const key of ['cycles', 'playerAge', 'daySegments', 'duskSegments'] as const) {
    const value = data[key];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 0 || (key.endsWith('Segments') && value > 16)) {
      throw new RangeError(`Invalid ${key}: ${value}`);
    }
    calendar[key] = value;
  }
  if ((data.daySegments ?? 10) + (data.duskSegments ?? 4) > 16) {
    throw new RangeError('Clock segments must fit within 16 segments');
  }
  if (data.time !== undefined) calendar.time = progress(data.time, 'time');
  if (data.waxing !== undefined) {
    if (typeof data.waxing !== 'boolean') throw new TypeError('waxing must be a boolean');
    calendar.waxing = data.waxing;
  }
  return Object.freeze('temperature' in data
    ? { ...calendar, phase: data.phase, temperature: finite(data.temperature, 'phasetemperature') }
    : { ...calendar, phase: data.phase, timeinphase: progress(data.timeinphase, 'timeinphase') });
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
