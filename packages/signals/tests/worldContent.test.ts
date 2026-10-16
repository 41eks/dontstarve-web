import { expect, expectTypeOf, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { bindWorldContent, createEffect, createMemo, createSignal, getBoundWatchWorldContent, getWatchWorldContent, GetTileStateAtPoint, WorldContentKey,
  GameTimeScheduler, type WorldContentSignal, type PlayerPositionsSignal, type WorldPhase, type WorldMoonState, type SeasonState, type WorldContentEnvironment, type WorldWindChange, type PerishTick, type ReadonlySignal } from '../src';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const world = (phase: WorldPhase) => ({
  playerpositions: createSignal<import('three').Vector3[]>([]), snowLevel: createSignal(0), wind: createSignal({ angle: 0, velocity: 1 }), perishTick: createSignal({ time: 0, total: 0 }),
  moon: createSignal<WorldMoonState>({ phase: 'new', waxing: true }),
  scheduler: new GameTimeScheduler(), temperature: createSignal(30), cycle: createSignal(phase), season: createSignal<SeasonState>({ season: 'spring', progress: .5 }),
} satisfies WorldContentEnvironment);

it('resolves typed keys and keeps consumer cleanup independent from other owners and world sources', async () => {
  const sources = world('day'), unbind = bindWorldContent(sources);
  const firstStops: (() => void)[] = [], secondStops: (() => void)[] = [];
  const first = getWatchWorldContent(WorldContentKey.Cycle, stop => firstStops.push(stop));
  const second = getWatchWorldContent(WorldContentKey.Cycle, stop => secondStops.push(stop));
  const season = getWatchWorldContent(WorldContentKey.Season, stop => secondStops.push(stop));
  const temperature = getWatchWorldContent(WorldContentKey.Temperature, stop => secondStops.push(stop));
  const wind = getWatchWorldContent(WorldContentKey.Wind, stop => secondStops.push(stop));
  const perish = getWatchWorldContent(WorldContentKey.PerishClock, stop => secondStops.push(stop));
  const snow = getWatchWorldContent(WorldContentKey.SnowLevel, stop => secondStops.push(stop));
  const moon = getWatchWorldContent(WorldContentKey.Moon, stop => secondStops.push(stop));
  const positions = getWatchWorldContent(WorldContentKey.PlayerPositions, stop => secondStops.push(stop));
  expectTypeOf(positions).toEqualTypeOf<PlayerPositionsSignal>();
  expectTypeOf(moon).toEqualTypeOf<WorldContentSignal<WorldMoonState>>();
  expectTypeOf(first).toEqualTypeOf<WorldContentSignal<WorldPhase>>();
  expectTypeOf(season).toEqualTypeOf<WorldContentSignal<SeasonState>>();
  expectTypeOf(temperature).toEqualTypeOf<WorldContentSignal<number>>();
  expectTypeOf(wind).toEqualTypeOf<WorldContentSignal<WorldWindChange>>();
  expectTypeOf(perish).toEqualTypeOf<WorldContentSignal<PerishTick>>();
  expectTypeOf(snow).toEqualTypeOf<WorldContentSignal<number>>();
  const firstChanged = vi.fn(), secondChanged = vi.fn();
  createEffect(() => firstChanged(first.get()));
  createEffect(() => secondChanged(second.get(), season.get().season, temperature.get()));
  try {
    expect(first.scheduler).toBe(sources.scheduler);
    expect(second.scheduler).toBe(first.scheduler);
    expect(season.scheduler).toBe(first.scheduler);
    expect(temperature.scheduler).toBe(first.scheduler);
    expect(wind.scheduler).toBe(first.scheduler);
    expect(perish.scheduler).toBe(first.scheduler);
    expect(snow.scheduler).toBe(first.scheduler);
    expect(moon.scheduler).toBe(first.scheduler);
    expect(positions.scheduler).toBe(first.scheduler);
    expect(positions.peek()).toBe(sources.playerpositions.peek());
    sources.moon.set({ phase: 'half', waxing: false });
    expect(moon.peek()).toEqual({ phase: 'half', waxing: false });
    sources.snowLevel.set(.2);
    expect(snow.peek()).toBe(.2);
    expect(temperature.peek()).toBe(30);
    expect(first.peek()).toBe('day');
    sources.cycle.set('dusk');
    await settle();
    expect(firstChanged).toHaveBeenLastCalledWith('dusk');
    expect(secondChanged).toHaveBeenLastCalledWith('dusk', 'spring', 30);
    sources.cycle.set('night');
    firstStops.forEach(stop => stop());
    const sharedTask = vi.fn();
    second.scheduler.schedule(1, sharedTask);
    second.scheduler.advance(1);
    expect(sharedTask).toHaveBeenCalledOnce();
    sources.season.set({ season: 'winter', progress: .5 });
    sources.temperature.set(-10);
    await settle();
    expect(firstChanged).toHaveBeenCalledTimes(2);
    expect(secondChanged).toHaveBeenLastCalledWith('night', 'winter', -10);
    second.set('day');
    expect(sources.cycle.peek()).toBe('night');
  } finally {
    firstStops.forEach(stop => stop()); secondStops.forEach(stop => stop()); unbind(); sources.scheduler.dispose();
  }
});

it('older world cleanup cannot unbind a replacement and explicit source binding stays with its world', () => {
  const old = world('day'), next = world('night'), stops: (() => void)[] = [];
  const oldCleanup = bindWorldContent(old);
  const getOldWorldContent = getBoundWatchWorldContent()!;
  const oldCycle = getWatchWorldContent(WorldContentKey.Cycle, stop => stops.push(stop), old);
  const nextCleanup = bindWorldContent(next);
  try {
    oldCleanup();
    const nextCycle = getWatchWorldContent(WorldContentKey.Cycle, stop => stops.push(stop));
    const lateOldCycle = getOldWorldContent(WorldContentKey.Cycle, stop => stops.push(stop));
    expect(lateOldCycle.peek()).toBe('day');
    expect(lateOldCycle.scheduler).toBe(old.scheduler);
    expect(oldCycle.scheduler).toBe(old.scheduler);
    expect(nextCycle.scheduler).toBe(next.scheduler);
    expect(oldCycle.scheduler).not.toBe(nextCycle.scheduler);
    expect(oldCycle.peek()).toBe('day');
    expect(nextCycle.peek()).toBe('night');
    nextCleanup();
    expect(() => getWatchWorldContent(WorldContentKey.Cycle, stop => stops.push(stop))).toThrow('not bound');
  } finally { stops.forEach(stop => stop()); oldCleanup(); nextCleanup(); old.scheduler.dispose(); next.scheduler.dispose(); }
});

it('resolves tile queries through the bound world while captured queries stay with their own world', () => {
  const oldMemo = createMemo(() => true), nextMemo = createMemo(() => false);
  const oldQuery = vi.fn((_position: ReadonlySignal<number>, _radius?: number) => oldMemo);
  const nextQuery = vi.fn((_position: ReadonlySignal<number>, _radius?: number) => nextMemo);
  const old = { ...world('day'), tickingarea: oldQuery };
  const next = { ...world('night'), tickingarea: nextQuery };
  const oldCleanup = bindWorldContent(old);
  const position = createSignal(7);
  expect(GetTileStateAtPoint(position)).toBe(oldMemo);
  expect(oldQuery).toHaveBeenLastCalledWith(position, 10);
  const capturedQuery = old.tickingarea;
  const nextCleanup = bindWorldContent(next);
  try {
    oldCleanup();
    expect(GetTileStateAtPoint(position, 3)).toBe(nextMemo);
    expect(nextQuery).toHaveBeenLastCalledWith(position, 3);
    expect(capturedQuery(position, 0)).toBe(oldMemo);
    nextCleanup();
    expect(() => GetTileStateAtPoint(position)).toThrow('not bound');
  } finally {
    oldCleanup(); nextCleanup(); oldMemo.dispose(); nextMemo.dispose();
    old.scheduler.dispose(); next.scheduler.dispose();
  }
});

it('gates watched world inputs by the tile tickingarea memo and releases the memo with the consumer', async () => {
  const sources = world('day'), awake = createSignal(true);
  const area = createMemo(() => awake.get()), dispose = vi.spyOn(area, 'dispose');
  const query = vi.fn((_position: ReadonlySignal<number>, _radius?: number) => area);
  const world1: WorldContentEnvironment = { ...sources, tickingarea: query };
  const tile = createSignal(7), stops: (() => void)[] = [];
  const gated = getWatchWorldContent(WorldContentKey.Cycle, stop => stops.push(stop), world1, { tile });
  const open = getWatchWorldContent(WorldContentKey.Cycle, stop => stops.push(stop), world1);
  expect(query).toHaveBeenCalledOnce(); expect(query).toHaveBeenCalledWith(tile);
  try {
    expect(gated.area).toBe(area); expect(open.area).toBeUndefined();
    awake.set(false);
    sources.cycle.set('night');
    expect(open.peek()).toBe('night'); expect(gated.peek()).toBe('day');
    awake.set(true);
    expect(gated.peek()).toBe('night');
    sources.cycle.set('dusk');
    expect(gated.peek()).toBe('dusk');

    // Positions without a tickingarea memo (outside the grid) keep the ordinary subscription.
    const ungated = getWatchWorldContent(WorldContentKey.Cycle, stop => stops.push(stop),
      { ...sources, tickingarea: () => undefined }, { tile });
    awake.set(false); sources.cycle.set('day');
    expect(ungated.peek()).toBe('day');
    expect(dispose).not.toHaveBeenCalled();
    stops.splice(0).forEach(stop => stop());
    expect(dispose).toHaveBeenCalled();
    sources.cycle.set('night');
    expect(gated.peek()).toBe('dusk'); // released: holds its last value
  } finally { area.dispose(); sources.scheduler.dispose(); }
});
