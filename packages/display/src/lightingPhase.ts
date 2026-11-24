import {
  clockstate,
  createMemo,
  moonphasestate,
  seasonstate,
  watchSignal,
  type Memo,
  type WorldSeason,
} from '@dontstarve-web/signals';

export type DstSeason = WorldSeason;
/** The phase a colour set is chosen by: the clock's phase, with a full-moon night apart. */
export type DstLightPhase = 'day' | 'dusk' | 'night' | 'full_moon';

/** The world's season and light phase as seen by one lighting consumer. */
export interface LightingWorld {
  readonly season: Memo<DstSeason>;
  readonly phase: Memo<DstLightPhase>;
}

/**
 * The owner's private view of the clock, moon and season: its own watched signals and the memos derived from them,
 * released through `registerCleanup`. The phase only notifies when it changes, not on every clock settlement.
 */
export function watchLightingWorld(registerCleanup: (stop: () => void) => void): LightingWorld {
  const clock = watchSignal(clockstate, registerCleanup);
  const moon = watchSignal(moonphasestate, registerCleanup);
  const seasons = watchSignal(seasonstate, registerCleanup);
  const season = createMemo(() => seasons.get().season);
  const phase = createMemo<DstLightPhase>(() => {
    const { phase } = clock.get();
    return phase === 'night' && moon.get() === 'full' ? 'full_moon' : phase;
  });
  registerCleanup(() => {
    season.dispose();
    phase.dispose();
  });
  return { season, phase };
}

const PHASE_BLEND_SECONDS: Record<DstLightPhase, number> = {
  day: 4,
  dusk: 6,
  night: 8,
  full_moon: 8,
};
const SEASON_BLEND_SECONDS = 10;
/** colourcube.lua DEFAULT_BLEND_TIME, used when playervision overrides the cube table. */
const OVERRIDE_BLEND_SECONDS = 0.25;

/** How long a change of the lighting inputs takes: a vision override, then a new season, then the phase's own time. */
export function transitionSeconds(phase: DstLightPhase, seasonChanged: boolean, overrideChanged: boolean): number {
  return overrideChanged ? OVERRIDE_BLEND_SECONDS : seasonChanged ? SEASON_BLEND_SECONDS : PHASE_BLEND_SECONDS[phase];
}
