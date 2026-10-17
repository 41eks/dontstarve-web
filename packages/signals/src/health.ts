import { createStatState, type StatState } from './stat';

/** health.lua state: the signal plus the flags DoDelta consults before applying a change. */
export interface HealthState extends StatState {
  /** health.lua SetInvincible: damage is ignored. */
  invincible: boolean;
  /** health.lua canheal: healing is ignored. */
  canheal: boolean;
  /** health.lua SetCurrentHealth: assigns directly, bypassing invincible and canheal. */
  SetCurrentHealth(value: number): void;
  /** health.lua penalty: the fraction of the maximum that can no longer be healed. */
  readonly penalty: number;
  /** health.lua SetPenalty: clamped to 0..MAXIMUM_HEALTH_PENALTY, and the current health is capped at the new maximum. */
  SetPenalty(penalty: number): void;
  /** health.lua DeltaPenalty */
  DeltaPenalty(delta: number): void;
  /** health.lua GetMaxWithPenalty */
  GetMaxWithPenalty(): number;
}

/** tuning.lua MAXIMUM_HEALTH_PENALTY. */
export const MAXIMUM_HEALTH_PENALTY = 0.75;

export function createHealthState(initialValue: number, maximum: number, initialPenalty = 0): HealthState {
  const stat = createStatState(initialValue, maximum, 'Health');
  let penalty = Math.min(Math.max(initialPenalty, 0), MAXIMUM_HEALTH_PENALTY);
  const capped = (value: number) => Math.min(value, maximum - maximum * penalty);
  const health: HealthState = {
    ...stat,
    invincible: false,
    canheal: true,
    // DoDelta: an invincible inst takes no damage and a canheal=false inst takes no healing.
    set(value) {
      const current = stat.peek();
      if ((health.invincible && value < current) || (!health.canheal && value > current)) return;
      stat.set(capped(value));
    },
    SetCurrentHealth: value => stat.set(capped(value)),
    get penalty() { return penalty; },
    SetPenalty(value) {
      penalty = Math.min(Math.max(value, 0), MAXIMUM_HEALTH_PENALTY);
      stat.set(capped(stat.peek()));
    },
    DeltaPenalty: delta => health.SetPenalty(penalty + delta),
    GetMaxWithPenalty: () => maximum - maximum * penalty,
  };
  return health;
}
