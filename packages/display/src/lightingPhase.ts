import { clockstate, moonphasestate, seasonstate, type WorldSeason } from '@dontstarve-web/signals';

export type DstSeason = WorldSeason;
/** The phase a colour set is chosen by: the clock's phase, with a full-moon night apart. */
export type DstLightPhase = 'day' | 'dusk' | 'night' | 'full_moon';

/** The world's light phase, read (and tracked) from the clock and moon signals. */
export function lightPhase(): DstLightPhase {
  const { phase } = clockstate.get();
  return phase === 'night' && moonphasestate.get() === 'full' ? 'full_moon' : phase;
}

/** lightPhase without tracking. */
export function peekLightPhase(): DstLightPhase {
  const { phase } = clockstate.peek();
  return phase === 'night' && moonphasestate.peek() === 'full' ? 'full_moon' : phase;
}

export function currentSeason(): DstSeason {
  return seasonstate.get().season;
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
