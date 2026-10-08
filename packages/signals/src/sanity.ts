import { createStatState, type StatState } from './stat';

export type SanityState = StatState;

/** Sanity points are finite and clamped to the character's supported range. */
export function createSanityState(initialValue: number, maximum: number): SanityState {
  return createStatState(initialValue, maximum, 'Sanity');
}
