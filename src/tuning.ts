/** Day-cycle values from DST scripts/tuning.lua (Tune's default composition). */
const SEG_TIME = 30;
const DAY_SEGS_DEFAULT = 10;
const DUSK_SEGS_DEFAULT = 4;
const NIGHT_SEGS_DEFAULT = 2;

export const TUNING = {
  SEG_TIME,
  TOTAL_DAY_TIME: SEG_TIME * 16,
  DAY_SEGS_DEFAULT,
  DUSK_SEGS_DEFAULT,
  NIGHT_SEGS_DEFAULT,
  DAY_TIME_DEFAULT: SEG_TIME * DAY_SEGS_DEFAULT,
  DUSK_TIME_DEFAULT: SEG_TIME * DUSK_SEGS_DEFAULT,
  NIGHT_TIME_DEFAULT: SEG_TIME * NIGHT_SEGS_DEFAULT,
  TORCH_FUEL: SEG_TIME * NIGHT_SEGS_DEFAULT * 1.25,
} as const;

export type DstCyclePhase = 'day' | 'dusk' | 'night';

const MOON_PHASE_CYCLES = [
  'new', 'quarter', 'quarter', 'quarter', 'half', 'half', 'half',
  'threequarter', 'threequarter', 'threequarter', 'full',
  'threequarter', 'threequarter', 'threequarter', 'half', 'half', 'half',
  'quarter', 'quarter', 'quarter',
] as const;

/** `cycles` counts completed days, as in DST's components/clock.lua. */
export function getDstCycle(elapsedSeconds: number): {
  cycles: number;
  phase: DstCyclePhase;
  phaseProgress: number;
} {
  const elapsed = Math.max(0, elapsedSeconds);
  const cycles = Math.floor(elapsed / TUNING.TOTAL_DAY_TIME);
  const time = elapsed % TUNING.TOTAL_DAY_TIME;
  if (time < TUNING.DAY_TIME_DEFAULT) {
    return { cycles, phase: 'day', phaseProgress: time / TUNING.DAY_TIME_DEFAULT };
  }
  const duskTime = time - TUNING.DAY_TIME_DEFAULT;
  if (duskTime < TUNING.DUSK_TIME_DEFAULT) {
    return { cycles, phase: 'dusk', phaseProgress: duskTime / TUNING.DUSK_TIME_DEFAULT };
  }
  return {
    cycles,
    phase: 'night',
    phaseProgress: (duskTime - TUNING.DUSK_TIME_DEFAULT) / TUNING.NIGHT_TIME_DEFAULT,
  };
}

/** Surface clock state from clock.lua's default segments and 20-day moon cycle. */
export function getDstClock(elapsedSeconds: number) {
  const cycle = getDstCycle(elapsedSeconds);
  const moonIndex = cycle.cycles % MOON_PHASE_CYCLES.length;
  return {
    cycles: cycle.cycles,
    phase: cycle.phase,
    time: Math.max(0, elapsedSeconds) % TUNING.TOTAL_DAY_TIME / TUNING.TOTAL_DAY_TIME,
    daySegments: TUNING.DAY_SEGS_DEFAULT,
    duskSegments: TUNING.DUSK_SEGS_DEFAULT,
    moonPhase: MOON_PHASE_CYCLES[moonIndex],
    waxing: moonIndex < MOON_PHASE_CYCLES.length / 2,
  };
}
