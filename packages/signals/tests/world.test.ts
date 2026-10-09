import { afterEach, expect, it, vi } from 'vitest';
import { batch, clockstate, seasonstate, moonphasestate } from '../src';
import { clockstate as sharedClock, seasonstate as sharedSeason, moonphasestate as sharedMoonPhase } from '../src/world';

afterEach(() => batch(() => {
  clockstate.set({ phase: 'day', timeinphase: 0 });
  seasonstate.set({ season: 'autumn', progress: 0.5 });
  moonphasestate.set('new');
}));

it('exports world singletons and publishes immutable validated snapshots', () => {
  expect(clockstate).toBe(sharedClock);
  expect(seasonstate).toBe(sharedSeason);
  expect(moonphasestate).toBe(sharedMoonPhase);
  expect(moonphasestate.peek()).toBe('new');
  expect(clockstate.peek()).toEqual({ phase: 'day', timeinphase: 0 });
  expect(seasonstate.peek()).toEqual({ season: 'autumn', progress: 0.5 });
  const clockChanged = vi.fn(), seasonChanged = vi.fn(), moonChanged = vi.fn();
  const stopClock = clockstate.subscribe(clockChanged), stopSeason = seasonstate.subscribe(seasonChanged);
  const stopMoon = moonphasestate.subscribe(moonChanged);
  try {
    const tick = { phase: 'night' as const, timeinphase: 0.5 };
    clockstate.set(tick);
    seasonstate.set({ season: 'winter', temperature: -25 });
    moonphasestate.set('full');
    moonphasestate.set('full');
    expect(sharedMoonPhase.get()).toBe('full');
    expect(moonChanged).toHaveBeenCalledExactlyOnceWith('full', 'new');
    tick.timeinphase = 1;
    expect(sharedClock.get()).toEqual({ phase: 'night', timeinphase: 0.5 });
    expect(sharedSeason.get()).toEqual({ season: 'winter', temperature: -25 });
    expect(Object.isFrozen(clockstate.peek())).toBe(true);
    expect(Object.isFrozen(seasonstate.peek())).toBe(true);
    expect(clockChanged).toHaveBeenCalledOnce();
    expect(seasonChanged).toHaveBeenCalledOnce();
    stopClock(); stopSeason(); stopMoon();
    clockstate.set({ phase: 'day', temperature: 5 });
    seasonstate.set({ season: 'spring', progress: 0 });
    moonphasestate.set('half');
    expect(moonChanged).toHaveBeenCalledOnce();
    expect(clockChanged).toHaveBeenCalledOnce();
    expect(seasonChanged).toHaveBeenCalledOnce();
  } finally { stopClock(); stopSeason(); stopMoon(); }
});

it('rejects invalid singleton updates without replacing state or publishing', () => {
  const clock = clockstate.peek(), season = seasonstate.peek();
  const moonPhase = moonphasestate.peek();
  const changed = vi.fn();
  const stopClock = clockstate.subscribe(changed), stopSeason = seasonstate.subscribe(changed);
  const stopMoon = moonphasestate.subscribe(changed);
  try {
    expect(() => clockstate.set({ phase: 'night', timeinphase: 1.1 })).toThrow(RangeError);
    expect(() => seasonstate.set({ season: 'winter', progress: NaN })).toThrow(RangeError);
    expect(() => clockstate.set({ phase: 'day', temperature: Infinity })).toThrow(RangeError);
    expect(() => seasonstate.set({ season: 'winter', temperature: -Infinity })).toThrow(RangeError);
    expect(() => clockstate.set({ phase: 'invalid' as 'day', timeinphase: 0 })).toThrow('Invalid phase');
    expect(() => seasonstate.set({ season: 'invalid' as 'autumn', progress: 0 })).toThrow('Invalid season');
    expect(() => moonphasestate.set('invalid' as 'new')).toThrow('Invalid moon phase');
    expect(clockstate.peek()).toBe(clock);
    expect(seasonstate.peek()).toBe(season);
    expect(moonphasestate.peek()).toBe(moonPhase);
    expect(changed).not.toHaveBeenCalled();
  } finally { stopClock(); stopSeason(); stopMoon(); }
});
