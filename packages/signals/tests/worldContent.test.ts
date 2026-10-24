import { expect, expectTypeOf, it, vi } from 'vitest';
import { bindWorldContent, createEffect, createSignal, getWatchWorldContent, WorldContentKey,
  GameTimeScheduler, type WorldContentSignal, type WorldPhase, type SeasonState, type WorldContentEnvironment } from '../src';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const world = (phase: WorldPhase) => ({
  scheduler: new GameTimeScheduler(), cycle: createSignal(phase), season: createSignal<SeasonState>({ season: 'spring', progress: .5 }),
} satisfies WorldContentEnvironment);

it('resolves typed keys and keeps consumer cleanup independent from other owners and world sources', async () => {
  const sources = world('day'), unbind = bindWorldContent(sources);
  const firstStops: (() => void)[] = [], secondStops: (() => void)[] = [];
  const first = getWatchWorldContent(WorldContentKey.Cycle, stop => firstStops.push(stop));
  const second = getWatchWorldContent(WorldContentKey.Cycle, stop => secondStops.push(stop));
  const season = getWatchWorldContent(WorldContentKey.Season, stop => secondStops.push(stop));
  expectTypeOf(first).toEqualTypeOf<WorldContentSignal<WorldPhase>>();
  expectTypeOf(season).toEqualTypeOf<WorldContentSignal<SeasonState>>();
  const firstChanged = vi.fn(), secondChanged = vi.fn();
  createEffect(() => firstChanged(first.get()));
  createEffect(() => secondChanged(second.get(), season.get().season));
  try {
    expect(first.scheduler).toBe(sources.scheduler);
    expect(second.scheduler).toBe(first.scheduler);
    expect(season.scheduler).toBe(first.scheduler);
    expect(first.peek()).toBe('day');
    sources.cycle.set('dusk');
    await settle();
    expect(firstChanged).toHaveBeenLastCalledWith('dusk');
    expect(secondChanged).toHaveBeenLastCalledWith('dusk', 'spring');
    sources.cycle.set('night');
    firstStops.forEach(stop => stop());
    const sharedTask = vi.fn();
    second.scheduler.schedule(1, sharedTask);
    second.scheduler.advance(1);
    expect(sharedTask).toHaveBeenCalledOnce();
    sources.season.set({ season: 'winter', progress: .5 });
    await settle();
    expect(firstChanged).toHaveBeenCalledTimes(2);
    expect(secondChanged).toHaveBeenLastCalledWith('night', 'winter');
    second.set('day');
    expect(sources.cycle.peek()).toBe('night');
  } finally {
    firstStops.forEach(stop => stop()); secondStops.forEach(stop => stop()); unbind(); sources.scheduler.dispose();
  }
});

it('older world cleanup cannot unbind a replacement and explicit source binding stays with its world', () => {
  const old = world('day'), next = world('night'), stops: (() => void)[] = [];
  const oldCleanup = bindWorldContent(old);
  const oldCycle = getWatchWorldContent(WorldContentKey.Cycle, stop => stops.push(stop), old);
  const nextCleanup = bindWorldContent(next);
  try {
    oldCleanup();
    const nextCycle = getWatchWorldContent(WorldContentKey.Cycle, stop => stops.push(stop));
    expect(oldCycle.scheduler).toBe(old.scheduler);
    expect(nextCycle.scheduler).toBe(next.scheduler);
    expect(oldCycle.scheduler).not.toBe(nextCycle.scheduler);
    expect(oldCycle.peek()).toBe('day');
    expect(nextCycle.peek()).toBe('night');
    nextCleanup();
    expect(() => getWatchWorldContent(WorldContentKey.Cycle, stop => stops.push(stop))).toThrow('not bound');
  } finally { stops.forEach(stop => stop()); oldCleanup(); nextCleanup(); old.scheduler.dispose(); next.scheduler.dispose(); }
});
