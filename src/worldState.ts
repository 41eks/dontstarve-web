import { batch, GameTimeScheduler, createMemo, createSignal, readonlySignal, bindWorldContent, getWatchWorldContent, clockstate, seasonstate, moonphasestate, type ReadonlySignal, type Signal, type ClockState, type SeasonState, type WorldMoonPhase, type WorldContentContext, type WorldContentEnvironment } from '@dontstarve-web/signals';
import type { Vector3 } from 'three';
import { WorldTemperature } from '../packages/componets/src/worldtemperature';
import { Weather } from '../packages/componets/src/weather';
import { WorldPerishClock } from '../packages/componets/src/worldperishclock';
import { WorldWind } from '../packages/componets/src/worldwind';
import { GetTileStateAtPoint as bindTileStateQuery, DisposeTileStates } from '../packages/componets/src/tileManager';
import type { SaveDocument } from './save/types';
import { getDstCycle, getDstClock, MOON_PHASE_CYCLES, TUNING } from './tuning';

export interface WorldState extends WorldContentContext {
  readonly clock: Signal<ClockState>;
  readonly season: Signal<SeasonState>;
  readonly moonPhase: Signal<WorldMoonPhase>;
  readonly isNight: ReadonlySignal<boolean>;
  readonly playerpositions: Signal<Vector3[]>;
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
  readonly worldwind: WorldWind;
}

/** Session temperature derived from the shared clock/season singleton signals. */
export function createWorldState(world: Pick<SaveDocument['world'], 'elapsedSeconds' | 'systems'>): WorldState {
  const scheduler = new GameTimeScheduler(world.elapsedSeconds);
  const worldtemperature = new WorldTemperature();
  // Until seasons.lua is ported, retain the loaded seasonal term. Legacy saves start
  // at their configured season's midpoint, with noise aligned to saved game time.
  worldtemperature.OnLoad(world.systems.worldtemperature ?? {
    season: world.systems.season?.name ?? 'spring',
    noisetime: world.elapsedSeconds,
  });
  const weather = new Weather({ totalDayTime: TUNING.TOTAL_DAY_TIME, temperature: () => worldtemperature.temperature.get() });
  weather.OnLoad(world.systems.weather ?? {});
  const initialCycle = getDstCycle(world.elapsedSeconds);
  // clock.lua OnLoad: a saved mooomphasecycle replaces the cycle-derived default.
  let moonCycleOffset = world.systems.moon === undefined ? 0
    : world.systems.moon.mooomphasecycle - 1 - initialCycle.cycles % MOON_PHASE_CYCLES.length;
  moonCycleOffset = (moonCycleOffset % MOON_PHASE_CYCLES.length + MOON_PHASE_CYCLES.length) % MOON_PHASE_CYCLES.length;
  const clockAt = (elapsedSeconds: number) => getDstClock(elapsedSeconds, moonCycleOffset);
  const { moonPhase, ...clock } = clockAt(world.elapsedSeconds);
  batch(() => {
    clockstate.set({ ...clock, timeinphase: initialCycle.phaseProgress });
    moonphasestate.set(moonPhase);
  });
  worldtemperature.OnUpdate(0);
  const temperature = readonlySignal(worldtemperature.temperature);
  const perishClock = new WorldPerishClock(temperature, world.elapsedSeconds);
  const worldwind = new WorldWind(scheduler);
  const moon = createMemo(() => ({ phase: moonphasestate.get(), waxing: clockstate.get().waxing ?? true }));
  const cycle = createMemo(() => clockstate.get().phase);
  const playerpositions = createSignal<Vector3[]>([]);
  const playerPosition = createMemo<Vector3 | undefined>(() => playerpositions.get()[0]);
  const getTileStateAtPoint = bindTileStateQuery(playerPosition);
  // init: inject the component's existing signal; world content only resolves keys and watches it.
  const worldContent: WorldContentEnvironment = Object.freeze({
    scheduler, temperature, cycle: readonlySignal(cycle), moon: readonlySignal(moon), season: readonlySignal(seasonstate),
    wind: worldwind.windchange, perishTick: perishClock.snapshot, perishClock,
    snowLevel: weather.snowLevel,
    playerpositions: readonlySignal(playerpositions),
    getTileStateAtPoint,
  });
  const unbindWorldContent = bindWorldContent(worldContent);
  const isNight = createMemo(() => cycle.get() === 'night');
  return { scheduler, temperature: worldContent.temperature, clock: clockstate, cycle: worldContent.cycle,
    wind: worldContent.wind, perishTick: worldContent.perishTick, snowLevel: worldContent.snowLevel, worldwind,
    playerpositions, getTileStateAtPoint,
    getWatchWorldContent: (key, registerCleanup) => getWatchWorldContent(key, registerCleanup, worldContent),
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
    season: seasonstate, moonPhase: moonphasestate, moon: worldContent.moon, isNight: readonlySignal(isNight), worldtemperature, weather, perishClock,
    dispose() { unbindWorldContent(); DisposeTileStates(playerPosition); playerPosition.dispose(); worldwind.dispose(); scheduler.dispose(); moon.dispose(); isNight.dispose(); cycle.dispose(); weather.dispose(); perishClock.dispose(); worldtemperature.dispose(); } };
}

/** Accumulate active frame time without writing clock/temperature signals between settlements. */
export function createWorldClockUpdater(
  state: WorldState,
  initialElapsedSeconds: number,
  getPlayerPositions?: () => readonly Vector3[],
) {
  let elapsedSeconds = initialElapsedSeconds;
  let pendingFrames = 0, pendingSeconds = 0;
  let playerPositionFrames = 0;
  const publishPlayerPositions = () => {
    if (getPlayerPositions) state.playerpositions.set(getPlayerPositions().map(position => position.clone()));
  };
  publishPlayerPositions();
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
    // Saving can flush world time early; player positions still publish once per 60 active frames.
    if (++playerPositionFrames === 60) {
      playerPositionFrames = 0;
      publishPlayerPositions();
    }
  };
  return { update: updateClock, flush, get elapsedSeconds() { return elapsedSeconds; } };
}
