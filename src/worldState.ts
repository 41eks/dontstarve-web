import { batch, type ReadonlySignal, type Signal } from '@dontstarve-web/signals';
import { WorldTemperature, type WorldTemperatureClockState, type WorldTemperatureSeasonState } from '../packages/componets/src/worldtemperature';
import type { SaveDocument } from './save/types';
import { getDstCycle } from './tuning';

export interface WorldState {
  readonly temperature: ReadonlySignal<number>;
  readonly clock: Signal<WorldTemperatureClockState>;
  readonly season: Signal<WorldTemperatureSeasonState>;
  readonly worldtemperature: WorldTemperature;
}

/** Session-owned world state; temperaturetick is published through a read-only signal. */
export function createWorldState(world: Pick<SaveDocument['world'], 'elapsedSeconds' | 'systems'>): WorldState {
  const worldtemperature = new WorldTemperature();
  // Until seasons.lua is ported, retain the loaded seasonal term. Legacy saves start
  // at their configured season's midpoint, with noise aligned to saved game time.
  worldtemperature.OnLoad(world.systems.worldtemperature ?? {
    season: world.systems.season?.name ?? 'spring',
    noisetime: world.elapsedSeconds,
  });
  const cycle = getDstCycle(world.elapsedSeconds);
  worldtemperature.OnClockTick({ phase: cycle.phase, timeinphase: cycle.phaseProgress });
  worldtemperature.OnUpdate(0);
  return { temperature: worldtemperature.temperature, clock: worldtemperature.clock,
    season: worldtemperature.season, worldtemperature };
}

/** Accumulate active frame time without writing clock/temperature signals between settlements. */
export function createWorldClockUpdater(
  state: WorldState,
  initialElapsedSeconds: number,
  onClockTick?: (elapsedSeconds: number, dt: number) => void,
) {
  let elapsedSeconds = initialElapsedSeconds;
  let pendingFrames = 0, pendingSeconds = 0;
  const flush = () => {
    if (pendingFrames === 0) return;
    const dt = pendingSeconds;
    pendingFrames = 0;
    pendingSeconds = 0;
    const cycle = getDstCycle(elapsedSeconds);
    batch(() => {
      state.clock.set({ phase: cycle.phase, timeinphase: cycle.phaseProgress });
      state.worldtemperature.OnUpdate(dt);
    });
    onClockTick?.(elapsedSeconds, dt);
  };
  const updateClock = (dt: number) => {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('dt must be finite and nonnegative');
    if (dt === 0) return;
    elapsedSeconds += dt;
    pendingSeconds += dt;
    if (++pendingFrames === 60) flush();
  };
  onClockTick?.(elapsedSeconds, 0);
  return { update: updateClock, flush, get elapsedSeconds() { return elapsedSeconds; } };
}
