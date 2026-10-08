import { createStatState, type StatState } from './stat';

export type HungerState = StatState;

export function createHungerState(initialValue: number, maximum: number): HungerState {
  return createStatState(initialValue, maximum, 'Hunger');
}
