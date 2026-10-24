import { batch, createMemo, readonlySignal, clockstate, seasonstate, moonphasestate, type ReadonlySignal, type Signal, type ClockState, type SeasonState, type WorldMoonPhase } from '@dontstarve-web/signals';
import { WorldTemperature } from '../packages/componets/src/worldtemperature';
import { Weather } from '../packages/componets/src/weather';
import { WorldPerishClock } from '../packages/componets/src/worldperishclock';
import type { SaveDocument } from './save/types';
import { getDstCycle, getDstClock, MOON_PHASE_CYCLES, TUNING } from './tuning';

export interface WorldState {
  readonly temperature: ReadonlySignal<number>;
  readonly clock: Signal<ClockState>;
  readonly season: Signal<SeasonState>;
  readonly moonPhase: Signal<WorldMoonPhase>;
  /** TheWorld.state.moonphase with iswaxingmoon, derived in one step so watchers never see a mixed pair. */
  readonly moon: ReadonlySignal<{ readonly phase: WorldMoonPhase; readonly waxing: boolean }>;
  readonly fullMoon: ReadonlySignal<boolean>;
  readonly isNight: ReadonlySignal<boolean>;
  /** clock.lua ms_setmoonphase: the first cycle step with the phase (waxing from the start, else from mid-cycle). */
  SetMoonPhase(phase: WorldMoonPhase, waxing?: boolean): void;
  /** clock.lua OnSave `mooomphasecycle`, one-based. */
  moonPhaseCycle(): number;
  /** getDstClock for this world's moon cycle. */
  clockAt(elapsedSeconds: number): ReturnType<typeof getDstClock>;
  dispose(): void;
  readonly worldtemperature: WorldTemperature;
  readonly weather: Weather;
  readonly perishClock: WorldPerishClock;
}

/** Session temperature derived from the shared clock/season singleton signals. */
export function createWorldState(world: Pick<SaveDocument['world'], 'elapsedSeconds' | 'systems'>): WorldState {
  const worldtemperature = new WorldTemperature();
  // Until seasons.lua is ported, retain the loaded seasonal term. Legacy saves start
  // at their configured season's midpoint, with noise aligned to saved game time.
  worldtemperature.OnLoad(world.systems.worldtemperature ?? {
    season: world.systems.season?.name ?? 'spring',
    noisetime: world.elapsedSeconds,
  });
  const weather = new Weather({ totalDayTime: TUNING.TOTAL_DAY_TIME, temperature: () => worldtemperature.temperature.get() });
  weather.OnLoad(world.systems.weather ?? {});
  const cycle = getDstCycle(world.elapsedSeconds);
  // clock.lua OnLoad: a saved mooomphasecycle replaces the cycle-derived default.
  let moonCycleOffset = world.systems.moon === undefined ? 0
    : world.systems.moon.mooomphasecycle - 1 - cycle.cycles % MOON_PHASE_CYCLES.length;
  moonCycleOffset = (moonCycleOffset % MOON_PHASE_CYCLES.length + MOON_PHASE_CYCLES.length) % MOON_PHASE_CYCLES.length;
  const clockAt = (elapsedSeconds: number) => getDstClock(elapsedSeconds, moonCycleOffset);
  const { moonPhase, ...clock } = clockAt(world.elapsedSeconds);
  batch(() => {
    clockstate.set({ ...clock, timeinphase: cycle.phaseProgress });
    moonphasestate.set(moonPhase);
  });
  worldtemperature.OnUpdate(0);
  const perishClock = new WorldPerishClock(worldtemperature.temperature, world.elapsedSeconds);
  const fullMoon = createMemo(() => clockstate.get().phase === 'night' && moonphasestate.get() === 'full');
  const moon = createMemo(() => ({ phase: moonphasestate.get(), waxing: clockstate.get().waxing ?? true }));
  const isNight = createMemo(() => clockstate.get().phase === 'night');
  return { temperature: worldtemperature.temperature, clock: clockstate,
    SetMoonPhase(phase, waxing) {
      const length = MOON_PHASE_CYCLES.length;
      for (let i = waxing ? 1 : length / 2; i <= length; i++) {
        if (MOON_PHASE_CYCLES[i - 1] !== phase) continue;
        const cycles = clockstate.peek().cycles ?? 0;
        moonCycleOffset = (i - 1 - cycles % length + length) % length;
        // GetMoonPhase: both values are published at once.
        batch(() => {
          moonphasestate.set(phase);
          clockstate.set({ ...clockstate.peek(), waxing: i <= length / 2 });
        });
        return;
      }
    },
    moonPhaseCycle: () => ((clockstate.peek().cycles ?? 0) + moonCycleOffset) % MOON_PHASE_CYCLES.length + 1,
    clockAt,
    season: seasonstate, moonPhase: moonphasestate, moon: readonlySignal(moon), fullMoon: readonlySignal(fullMoon), isNight: readonlySignal(isNight), worldtemperature, weather, perishClock,
    dispose() { moon.dispose(); isNight.dispose(); fullMoon.dispose(); weather.dispose(); perishClock.dispose(); worldtemperature.dispose(); } };
}

/** Accumulate active frame time without writing clock/temperature signals between settlements. */
export function createWorldClockUpdater(
  state: WorldState,
  initialElapsedSeconds: number,
) {
  let elapsedSeconds = initialElapsedSeconds;
  let pendingFrames = 0, pendingSeconds = 0;
  const flush = () => {
    if (pendingFrames === 0) return;
    const dt = pendingSeconds;
    pendingFrames = 0;
    pendingSeconds = 0;
    const cycle = getDstCycle(elapsedSeconds);
    const { moonPhase, ...clock } = state.clockAt(elapsedSeconds);
    batch(() => {
      state.clock.set({ ...clock, timeinphase: cycle.phaseProgress });
      state.moonPhase.set(moonPhase);
      state.worldtemperature.OnUpdate(dt);
      state.weather.OnUpdate(dt);
    });
    state.perishClock.Flush();
  };
  const updateClock = (dt: number) => {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('dt must be finite and nonnegative');
    if (dt === 0) return;
    state.perishClock.OnUpdate(dt);
    elapsedSeconds += dt;
    pendingSeconds += dt;
    if (++pendingFrames === 60) flush();
  };
  return { update: updateClock, flush, get elapsedSeconds() { return elapsedSeconds; } };
}
