import { createStatState, type StatState } from './stat';

export type HealthState = StatState;

export function createHealthState(initialValue: number, maximum: number): HealthState {
  return createStatState(initialValue, maximum, 'Health');
}
