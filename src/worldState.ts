import { batch, clockstate, seasonstate, moonphasestate, type ReadonlySignal, type Signal, type ClockState, type SeasonState, type WorldMoonPhase } from '@dontstarve-web/signals';
import { WorldTemperature } from '../packages/componets/src/worldtemperature';
import type { SaveDocument } from './save/types';
import { getDstCycle, getDstClock } from './tuning';

export interface WorldState {
  readonly temperature: ReadonlySignal<number>;
  readonly clock: Signal<ClockState>;
  readonly season: Signal<SeasonState>;
  readonly moonPhase: Signal<WorldMoonPhase>;
  readonly worldtemperature: WorldTemperature;
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
  const cycle = getDstCycle(world.elapsedSeconds);
  const { moonPhase, ...clock } = getDstClock(world.elapsedSeconds);
  batch(() => {
    clockstate.set({ ...clock, timeinphase: cycle.phaseProgress });
    moonphasestate.set(moonPhase);
  });
  worldtemperature.OnUpdate(0);
  return { temperature: worldtemperature.temperature, clock: clockstate,
    season: seasonstate, moonPhase: moonphasestate, worldtemperature };
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
    const { moonPhase, ...clock } = getDstClock(elapsedSeconds);
    batch(() => {
      state.clock.set({ ...clock, timeinphase: cycle.phaseProgress });
      state.moonPhase.set(moonPhase);
      state.worldtemperature.OnUpdate(dt);
    });
  };
  const updateClock = (dt: number) => {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('dt must be finite and nonnegative');
    if (dt === 0) return;
    elapsedSeconds += dt;
    pendingSeconds += dt;
    if (++pendingFrames === 60) flush();
  };
  return { update: updateClock, flush, get elapsedSeconds() { return elapsedSeconds; } };
}
